import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";
import { Rpc } from "./rpc.js";
import { PUMP_PROGRAM, isCreateLog, decodeCreate, parseCurve, parseMint } from "./parse.js";
import { runInvestigations } from "./investigate.js";
import { labelDue } from "./label.js";
import { startPanel } from "./panel.js";
import { runCrossref } from "./crossref.js";
import { runInsights } from "./insights.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const once = args.includes("--once");
const limitAt = args.indexOf("--limit");
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity;

const db = openDb(path.join(root, "data", "trench.db"));
const rpc = new Rpc();
const wsUrl = process.env.SOLANA_WS_URL || "wss://api.mainnet-beta.solana.com";

const insertToken = db.prepare(
  `INSERT OR IGNORE INTO tokens
   (mint, creator, bonding_curve, slot, signature, created_at, dev_buy, first_seen_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
const updateMint = db.prepare(
  `UPDATE tokens
   SET name = COALESCE(?, name),
       symbol = COALESCE(?, symbol),
       mint_authority = ?,
       freeze_authority = ?,
       supply_raw = ?,
       graduated_at = CASE WHEN ? = 1 AND graduated_at IS NULL THEN ? ELSE graduated_at END
   WHERE mint = ?`
);
const insertSnap = db.prepare(
  `INSERT OR IGNORE INTO snapshots
   (mint, checkpoint, observed_at, real_sol_lamports, virtual_sol_lamports, virtual_token_raw, supply_raw, complete, curve_missing)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

const CHECKPOINTS = [
  ["5m", 5 * 60],
  ["30m", 30 * 60],
  ["2h", 2 * 3600],
  ["6h", 6 * 3600],
  ["24h", 24 * 3600],
  ["48h", 48 * 3600],
];
const LATE_GATE = 500_000_000;

let queue = [];
const seen = new Set();
const retried = new Set();
let stopped = false;
let saved = 0;
let socket;
let gapId = null;
let lastInvestigate = 0;
let lastMsgAt = Date.now();
let msgCount = 0;
const logFile = path.join(root, "data", "watch.log");

function log(line) {
  const text = `${new Date().toISOString()} ${line}\n`;
  fs.appendFileSync(logFile, text);
  console.log(text.trimEnd());
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function enqueue(signature) {
  if (seen.has(signature)) return;
  seen.add(signature);
  if (seen.size > 50000) {
    const keep = [...seen].slice(-20000);
    seen.clear();
    for (const sig of keep) seen.add(sig);
  }
  queue.push(signature);
  if (queue.length > 800) {
    const dropped = queue.length - 800;
    queue = queue.slice(-800);
    log(`queue overflow dropped ${dropped}`);
  }
}

async function drainCreates() {
  while (!stopped) {
    const signature = queue.shift();
    if (!signature) {
      await sleep(150);
      continue;
    }
    try {
      const tx = await rpc.call("getTransaction", [
        signature,
        { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" },
      ]);
      if (!tx) {
        if (!retried.has(signature)) {
          retried.add(signature);
          queue.push(signature);
        }
        continue;
      }
      const decoded = decodeCreate(tx);
      if (!decoded) continue;
      const now = Math.floor(Date.now() / 1000);
      const info = insertToken.run(
        decoded.mint,
        decoded.creator,
        decoded.bondingCurve,
        decoded.slot,
        signature,
        decoded.blockTime || now,
        decoded.devBuy,
        now
      );
      if (info.changes) {
        saved += 1;
        log(`create ${decoded.mint} devBuy=${decoded.devBuy} saved=${saved} queued=${queue.length}`);
        if (once && saved >= limit) stopped = true;
      }
    } catch (err) {
      log(`decode error ${err.message}`);
    }
  }
}

function dueFor(checkpoint, delaySec) {
  const now = Math.floor(Date.now() / 1000);
  const early = checkpoint === "5m" || checkpoint === "30m";
  if (early) {
    return db
      .prepare(
        `SELECT mint, bonding_curve, name FROM tokens t
         WHERE created_at <= ? AND created_at >= ?
           AND bonding_curve IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM snapshots s WHERE s.mint = t.mint AND s.checkpoint = ?)
         LIMIT 40`
      )
      .all(now - delaySec, now - 49 * 3600, checkpoint);
  }
  return db
    .prepare(
      `SELECT t.mint, t.bonding_curve, t.name FROM tokens t
       JOIN snapshots s30 ON s30.mint = t.mint AND s30.checkpoint = '30m'
       WHERE t.created_at <= ? AND t.created_at >= ?
         AND (CAST(s30.real_sol_lamports AS INTEGER) >= ? OR s30.complete = 1)
         AND NOT EXISTS (SELECT 1 FROM snapshots s WHERE s.mint = t.mint AND s.checkpoint = ?)
       LIMIT 40`
    )
    .all(now - delaySec, now - 49 * 3600, LATE_GATE, checkpoint);
}

async function takeDueSnapshots() {
  for (const [checkpoint, delaySec] of CHECKPOINTS) {
    const rows = dueFor(checkpoint, delaySec);
    if (!rows.length) continue;
    const addresses = [];
    for (const row of rows) addresses.push(row.bonding_curve, row.mint);
    const result = await rpc.call("getMultipleAccounts", [addresses, { encoding: "base64" }]);
    const values = result?.value || [];
    const now = Math.floor(Date.now() / 1000);
    rows.forEach((row, i) => {
      const curve = values[i * 2];
      const mint = values[i * 2 + 1];
      let parsed = null;
      let missing = 1;
      if (curve?.data?.[0] && curve.owner === PUMP_PROGRAM) {
        parsed = parseCurve(curve.data[0]);
        missing = parsed ? 0 : 1;
      }
      insertSnap.run(
        row.mint,
        checkpoint,
        now,
        parsed?.realSolLamports || null,
        parsed?.virtualSolLamports || null,
        parsed?.virtualTokenRaw || null,
        parsed?.supplyRaw || null,
        parsed?.complete ?? null,
        missing
      );
      if (mint?.data?.[0]) {
        const meta = parseMint(mint.data[0]);
        if (meta) {
          updateMint.run(
            meta.name,
            meta.symbol,
            meta.mintAuthority,
            meta.freezeAuthority,
            meta.supplyRaw,
            parsed?.complete || 0,
            now,
            row.mint
          );
        }
      }
    });
    log(`snapshot ${checkpoint} ${rows.length}`);
  }
}

async function snapshotLoop() {
  while (!stopped) {
    try {
      await takeDueSnapshots();
      const now = Date.now();
      if (now - lastInvestigate > 60_000) {
        lastInvestigate = now;
        const labeled = labelDue(db);
        if (labeled) log(`labeled ${labeled}`);
        const opened = await runInvestigations(db, rpc, root);
        if (opened) log(`investigations ${opened}`);
      }
    } catch (err) {
      log(`snapshot error ${err.message}`);
    }
    await sleep(10_000);
  }
}

function crossrefOnce() {
  try {
    const snapshot = runCrossref(root);
    log(`crossref ${snapshot.line}`);
  } catch (err) {
    log(`crossref error ${err.message}`);
  }
}

function insightsOnce() {
  try {
    const snapshot = runInsights(root);
    log(`insights ${snapshot.line}`);
  } catch (err) {
    log(`insights error ${err.message}`);
  }
}

async function researchLoop() {
  while (!stopped) {
    await sleep(10 * 60 * 1000);
    if (stopped) return;
    crossrefOnce();
    insightsOnce();
  }
}

async function heartbeat() {
  while (!stopped) {
    await sleep(60_000);
    if (stopped) return;
    const tokens = db.prepare("SELECT COUNT(*) AS n FROM tokens").get().n;
    const silentSec = Math.round((Date.now() - lastMsgAt) / 1000);
    log(`heartbeat tokens=${tokens} saved_session=${saved} queued=${queue.length} msgs=${msgCount} silent_s=${silentSec} rpc=${rpc.calls} rpc_errors=${rpc.errors}`);
  }
}

function connect() {
  log(`connecting ${wsUrl}`);
  socket = new WebSocket(wsUrl);
  socket.addEventListener("open", () => {
    const now = Math.floor(Date.now() / 1000);
    if (gapId) {
      db.prepare("UPDATE ingest_gaps SET ended_at = ? WHERE id = ?").run(now, gapId);
      gapId = null;
    }
    socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "logsSubscribe",
        params: [{ mentions: [PUMP_PROGRAM] }, { commitment: "confirmed" }],
      })
    );
    log("subscribed to pump create logs");
  });
  socket.addEventListener("message", (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    const value = msg.params?.result?.value;
    if (!value) return;
    lastMsgAt = Date.now();
    msgCount += 1;
    if (isCreateLog(value.logs, value.err)) enqueue(value.signature);
  });
  socket.addEventListener("close", () => {
    if (stopped) return;
    const now = Math.floor(Date.now() / 1000);
    if (!gapId) {
      gapId = Number(db.prepare("INSERT INTO ingest_gaps(started_at, reason) VALUES (?, ?)").run(now, "socket closed").lastInsertRowid);
    }
    log("socket closed, reconnecting");
    setTimeout(connect, 3000);
  });
  socket.addEventListener("error", () => {
    log("socket error");
  });
}

async function verifyCurves() {
  const rows = db.prepare("SELECT mint, bonding_curve FROM tokens ORDER BY first_seen_at DESC LIMIT 3").all();
  if (!rows.length) return;
  const infos = await rpc.call("getMultipleAccounts", [rows.map((row) => row.bonding_curve), { encoding: "base64" }]);
  rows.forEach((row, i) => {
    const info = infos?.value?.[i];
    const parsed = info?.owner === PUMP_PROGRAM && info.data?.[0] ? parseCurve(info.data[0]) : null;
    const sol = parsed ? (Number(parsed.realSolLamports) / 1e9).toFixed(4) : "missing";
    log(`verify ${row.mint} curveSol=${sol}`);
  });
}

setInterval(() => {
  if (stopped || !socket || socket.readyState !== WebSocket.OPEN) return;
  if (Date.now() - lastMsgAt < 20_000) return;
  log("watchdog: no log messages for 20s, reconnecting");
  try {
    socket.close();
  } catch {
    // close handler reconnects
  }
}, 5_000);

connect();
const jobs = [drainCreates()];
if (!once) {
  const port = Number(process.env.PANEL_PORT || 8787);
  startPanel(port);
  log(`panel http://127.0.0.1:${port}`);
  crossrefOnce();
  insightsOnce();
  jobs.push(snapshotLoop(), heartbeat(), researchLoop());
}
await Promise.all(jobs);
if (once) {
  await verifyCurves();
  socket?.close();
  log(`once done saved=${saved}`);
}
