import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openReadOnly } from "./db.js";
import { lamportsToSol } from "./parse.js";
import { readLatest } from "./crossref.js";
import { readLatestInsights } from "./insights.js";
import { pct, verdictLabel } from "./structures.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbFile = path.join(root, "data", "trench.db");
const logFile = path.join(root, "data", "watch.log");
const GRADUATION_SOL = 85;

function queryService() {
  return new Promise((resolve) => {
    execFile("sc.exe", ["query", "TrenchWatch"], { timeout: 4000, windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve({ installed: false, state: "not installed" });
        return;
      }
      const match = String(stdout).match(/STATE\s+:\s+\d+\s+(\w+)/);
      resolve({ installed: true, state: match ? match[1] : "unknown" });
    });
  });
}

function tailLog(maxLines = 40) {
  try {
    const text = fs.readFileSync(logFile, "utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

function logAgeSec() {
  try {
    return (Date.now() - fs.statSync(logFile).mtimeMs) / 1000;
  } catch {
    return null;
  }
}

function crossrefStatus() {
  try {
    const latest = readLatest(root);
    if (!latest) return { live: false, lastRunAt: null };
    const age = Math.round(Date.now() / 1000 - latest.started);
    const current = latest.structures.find((item) => item.id === latest.current);
    return {
      live: latest.error == null && age < 25 * 60,
      lastRunAt: latest.started,
      ageSec: age,
      tokens: latest.tokens,
      structureId: latest.current,
      structureTitle: current ? current.title : latest.current,
      verdicts: (current ? current.joints : []).map((joint) => ({
        title: joint.title,
        verdict: verdictLabel(joint.verdict),
        local: pct(joint.localMissing ? null : joint.local),
        claim: pct(joint.claim),
      })),
    };
  } catch (err) {
    return { live: false, error: err.message };
  }
}

function insightsStatus() {
  try {
    const latest = readLatestInsights(root);
    if (!latest) return { live: false, lastRunAt: null, cards: [] };
    const age = Math.round(Date.now() / 1000 - latest.started);
    return {
      live: age < 25 * 60,
      runId: latest.runId,
      lastRunAt: latest.started,
      ageSec: age,
      tokens: latest.tokens,
      labels: latest.labels,
      learningsHash: latest.learningsHash,
      learningsBytes: latest.learningsBytes,
      counts: latest.counts,
      cards: latest.cards,
      read: latest.read,
    };
  } catch (err) {
    return { live: false, error: err.message, cards: [] };
  }
}

function galleryFile(pathname) {
  let rel = decodeURIComponent(pathname.replace(/^\/gallery\/?/, ""));
  if (!rel || rel.endsWith("/")) rel = `${rel}index.html`;
  if (rel.includes("\0")) return null;
  const full = path.resolve(root, "gallery", rel);
  const base = path.resolve(root, "gallery");
  const diff = path.relative(base, full);
  if (!diff || diff.startsWith("..") || path.isAbsolute(diff)) return null;
  if (path.extname(full).toLowerCase() !== ".html") return null;
  return full;
}

function status() {
  const age = logAgeSec();
  const recorder = {
    logAgeSec: age == null ? null : Math.round(age),
    live: age != null && age < 120,
    logFile,
  };
  let dbStat = null;
  try {
    dbStat = fs.statSync(dbFile);
  } catch {
    return { recorder, database: null, error: "database file is missing" };
  }
  const db = openReadOnly(dbFile);
  try {
    const tokens = db.prepare("SELECT COUNT(*) AS n, MIN(created_at) AS oldest, MAX(created_at) AS newest FROM tokens").get();
    const snapshots = db.prepare("SELECT checkpoint, COUNT(*) AS n FROM snapshots GROUP BY checkpoint").all();
    const investigations = db.prepare("SELECT COUNT(*) AS n FROM investigations").get().n;
    const repeatCreators = db
      .prepare("SELECT COUNT(*) AS n FROM (SELECT creator FROM tokens WHERE creator IS NOT NULL GROUP BY creator HAVING COUNT(*) > 1)")
      .get().n;
    const devBuys = db.prepare("SELECT SUM(dev_buy) AS n FROM tokens").get().n || 0;
    const openGaps = db.prepare("SELECT COUNT(*) AS n FROM ingest_gaps WHERE ended_at IS NULL").get().n;
    const outcomes = db.prepare("SELECT label, COUNT(*) AS n FROM outcomes GROUP BY label ORDER BY n DESC").all();
    const gaps = db
      .prepare("SELECT started_at, ended_at, reason FROM ingest_gaps ORDER BY id DESC LIMIT 8")
      .all();
    const recent = db
      .prepare(
        `SELECT symbol, name, mint, creator, created_at, dev_buy
         FROM tokens ORDER BY created_at DESC LIMIT 15`
      )
      .all();
    const top = db
      .prepare(
        `SELECT t.symbol, t.mint, s.real_sol_lamports, s.observed_at, s.complete
         FROM tokens t
         JOIN snapshots s ON s.mint = t.mint AND s.checkpoint = '30m'
         ORDER BY CAST(s.real_sol_lamports AS INTEGER) DESC
         LIMIT 8`
      )
      .all()
      .map((row) => {
        const sol = lamportsToSol(row.real_sol_lamports);
        return {
          symbol: row.symbol,
          mint: row.mint,
          sol,
          observedAt: row.observed_at,
          complete: row.complete,
          suspicious: sol != null && sol > GRADUATION_SOL + 20,
        };
      });
    const spanHours = tokens.oldest && tokens.newest ? (tokens.newest - tokens.oldest) / 3600 : 0;
    return {
      recorder,
      database: {
        path: dbFile,
        bytes: dbStat.size,
        tokens: tokens.n,
        oldest: tokens.oldest,
        newest: tokens.newest,
        spanHours,
        snapshots,
        investigations,
        repeatCreators,
        devBuys,
        openGaps,
        outcomes,
      },
      top,
      recent,
      gaps,
      log: tailLog(),
    };
  } finally {
    db.close();
  }
}

function page() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trench Watch</title>
<style>
  :root { color-scheme: dark; --bg:#12140f; --card:#1c2118; --ink:#e7efe0; --muted:#9aa892; --line:#31382c; --ok:#b6e37a; --bad:#f0a3a0; --warn:#e6c36a; }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.45 "Segoe UI", sans-serif; background:var(--bg); color:var(--ink); }
  header, main { width:min(1100px, calc(100% - 32px)); margin:0 auto; }
  header { padding:28px 0 8px; display:flex; justify-content:space-between; gap:16px; align-items:end; }
  h1 { font-size:28px; font-weight:650; margin:0; letter-spacing:-0.03em; }
  h2 { font-size:16px; margin:28px 0 10px; }
  p { color:var(--muted); }
  a { color:var(--ok); }
  .chips { display:flex; gap:8px; flex-wrap:wrap; }
  .chip { border:1px solid var(--line); background:var(--card); border-radius:999px; padding:6px 10px; font-size:13px; }
  .ok { color:var(--ok); } .bad { color:var(--bad); } .warn { color:var(--warn); }
  .grid { display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px 14px; }
  .stat b { display:block; font-size:22px; font-variant-numeric:tabular-nums; }
  .stat span { color:var(--muted); font-size:12px; }
  table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; font-size:13px; }
  th { color:var(--muted); font-weight:600; }
  code { font-family:Consolas, monospace; font-size:12px; }
  .log { white-space:pre-wrap; font:12px/1.4 Consolas, monospace; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px; max-height:280px; overflow:auto; }
  .learnings, .cross { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:4px 16px 12px; }
  .learnings li, .cross li { margin:8px 0; }
  .insights { display:grid; gap:12px; }
  .insight { background:var(--card); border:1px solid var(--line); border-left:4px solid var(--line); border-radius:12px; padding:14px 16px; }
  .insight.edge { border-left-color:var(--ok); }
  .insight.avoid { border-left-color:var(--bad); }
  .insight.filter { border-left-color:var(--warn); }
  .insight.measure { border-left-color:#8aa4c8; }
  .insight-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap; }
  .insight h3 { margin:0; font-size:16px; }
  .insight h4 { margin:0 0 4px; font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); }
  .insight p { margin:6px 0; }
  .insight-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:10px; }
  .insight ul { margin:4px 0 0 18px; padding:0; }
  .insight li { margin:4px 0; color:var(--ink); font-size:13px; }
  .insight details { margin-top:10px; }
  .insight summary { cursor:pointer; color:var(--muted); font-size:13px; }
  .insight .evidence { border-top:1px solid var(--line); margin-top:10px; padding-top:8px; }
  .insight .evidence p { font-size:13px; }
  .insight .muted { color:var(--muted); }
  .insight-read { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px 14px; color:var(--ink); margin:0; }
  @media (max-width:800px) { .grid { grid-template-columns:1fr 1fr; } .insight-grid { grid-template-columns:1fr; } }
</style>
</head>
<body>
<header>
  <div>
    <h1>Trench Watch</h1>
    <p id="sub">Local ledger of Pump.fun launches. No wallet. No trades.</p>
  </div>
  <div class="chips" id="chips"></div>
</header>
<main>
  <section class="grid" id="stats"></section>
  <h2>Largest 30-minute curve readings</h2>
  <div id="top"></div>
  <h2>Newest mints</h2>
  <div id="recent"></div>
  <h2>Recent gaps</h2>
  <div id="gaps"></div>
  <h2>Learnings</h2>
  <div class="learnings">
    <p>From the measurement papers, and from this database as of 6 November 2026. Full citations are in LEARNINGS.md. This is not a buy rule.</p>
    <ul>
      <li>Wash trading and comment bots raise the number of traders. They do not raise the average trader's profit. Ding, Lin, Luo, and Xu, SSRN 5953738, on 6,000 Pump.fun coins.</li>
      <li>Of tokens that returned more than 100 percent, 82.8 percent showed wash trading, pool-price inflation, or concentrated ownership. Mongardini and Mei, USENIX Security 2026.</li>
      <li>About 17 percent of sampled Pump.fun trades are a same-address buy and sell inside one transaction. About 1 percent of coins graduate. Szwajcok, Tsuchiya, and coauthors, ACM CCS 2026.</li>
      <li>Early-buyer groups take more cash than a matched placebo. A follower of the first group signal loses in all 32 tested setups. Gafarov, arXiv:2610.39458.</li>
      <li>On Solana the typical rug is a dump or a liquidity pull, not a hidden token contract. Chen and coauthors, arXiv:2603.24625.</li>
      <li>This file: about 95 percent of kept creates include a creator buy. The live counts, the curve distribution, and the profit reading are in Insights below.</li>
    </ul>
  </div>
  <h2>Insights</h2>
  <div class="insights" id="insights"></div>
  <h2>Cross-research</h2>
  <div class="cross" id="cross">
    <p>The agent reads this ledger against the papers. It runs inside the recorder, once at startup and every 10 minutes. It does not send trades.</p>
  </div>
  <h2>Log</h2>
  <div class="log" id="log"></div>
  <p>Readings above about 85 SOL are past the usual Pump.fun graduation level. Treat those as unchecked account parses, not as liquidity you can exit.</p>
</main>
<script>
const fmt = (sec) => sec ? new Date(sec * 1000).toLocaleString() : "—";
const sol = (n) => n == null ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
function chip(text, cls) { return '<span class="chip ' + cls + '">' + text + '</span>'; }
function table(headers, rows) {
  const head = '<tr>' + headers.map(h => '<th>' + h + '</th>').join('') + '</tr>';
  const body = rows.length ? rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + headers.length + '">None yet</td></tr>';
  return '<table>' + head + body + '</table>';
}
function esc(s) { return String(s ?? "").replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function escAttr(s) { return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function readinessLabel(value) { return ({ready:'ready', partial:'partial', blocked:'blocked', thin:'thin'})[value] || value || 'unknown'; }
function insightCard(card) {
  const tone = card.tone || card.kind || 'measure';
  const playbook = (card.playbook || []).map((item) => '<li>' + esc(item) + '</li>').join('');
  const localPoints = ((card.local && card.local.points) || []).map((item) => '<li>' + esc(item) + '</li>').join('');
  const evidence = (card.evidence || []).map((item) => {
    const links = (item.urls || []).map((url) => '<a href="' + escAttr(url) + '" target="_blank" rel="noreferrer">' + esc(item.source || 'source') + '</a>').join(' · ');
    return '<p>' + esc(item.text) + '<br><span class="muted">' + (links || esc(item.source || 'LEARNINGS.md')) + '</span></p>';
  }).join('');
  const risks = (card.risk || []).map((item) => '<li>' + esc(item) + '</li>').join('');
  const local = card.local || {};
  return '<article class="insight ' + esc(tone) + '">' +
    '<div class="insight-head"><h3>' + esc(card.title) + '</h3><div class="chips">' +
      '<span class="chip">' + esc(card.kindLabel || card.kind) + '</span>' +
      '<span class="chip">' + esc(card.confidence) + ' evidence</span>' +
      '<span class="chip">Local: ' + esc(readinessLabel(local.readiness)) + '</span>' +
    '</div></div>' +
    '<p>' + esc(card.thesis) + '</p>' +
    '<div class="insight-grid">' +
      '<div><h4>How to profit</h4><ul>' + playbook + '</ul></div>' +
      '<div><h4>Local reading</h4><p>' + esc(local.headline || 'No local reading yet.') + '</p><ul>' + localPoints + '</ul></div>' +
    '</div>' +
    '<details><summary>Evidence, sources and what would kill it</summary>' +
      '<div class="evidence">' + evidence + '</div>' +
      '<h4>What would kill it</h4><ul>' + risks + '</ul>' +
    '</details>' +
  '</article>';
}
let lastInsightsKey = "";
async function tick() {
  const res = await fetch('/api/status');
  const data = await res.json();
  const rec = data.recorder || {};
  const db = data.database;
  const svc = data.service || {};
  document.getElementById('chips').innerHTML = [
    chip(rec.live ? 'Recorder live' : 'Recorder stopped', rec.live ? 'ok' : 'bad'),
    chip('Service ' + esc(svc.state || 'unknown'), svc.state === 'RUNNING' ? 'ok' : 'warn'),
    chip(db ? db.tokens + ' mints kept' : 'No database', db ? 'ok' : 'bad')
  ].join('');
  if (!db) { document.getElementById('stats').innerHTML = '<p>' + esc(data.error || 'No database') + '</p>'; return; }
  const snapN = (db.snapshots || []).reduce((s, r) => s + r.n, 0);
  const cards = [
    [db.tokens, 'Mints'],
    [db.spanHours.toFixed(1) + ' h', 'Span of creates'],
    [snapN, 'Snapshots'],
    [db.repeatCreators, 'Repeat creators'],
    [db.devBuys + ' / ' + db.tokens, 'Dev buy on create'],
    [db.investigations, 'Investigations saved'],
    [db.openGaps, 'Open ingest gaps'],
    [(db.outcomes || []).map(o => o.label + ' ' + o.n).join(', ') || 'none yet', '48h labels']
  ];
  document.getElementById('stats').innerHTML = cards.map(([b, s]) => '<div class="stat"><b>' + esc(b) + '</b><span>' + esc(s) + '</span></div>').join('');
  document.getElementById('sub').textContent = 'Newest create ' + fmt(db.newest) + ' · ' + db.path;
  document.getElementById('top').innerHTML = table(['Symbol','SOL on curve','Flag','Mint'], (data.top || []).map(r => [
    esc(r.symbol || '—'), sol(r.sol), r.suspicious ? '<span class="warn">above graduation</span>' : (r.complete ? 'complete' : 'curve'), '<code>' + esc(r.mint) + '</code>'
  ]));
  document.getElementById('recent').innerHTML = table(['When','Symbol','Dev buy','Mint'], (data.recent || []).map(r => [
    fmt(r.created_at), esc(r.symbol || r.name || '—'), r.dev_buy ? 'yes' : 'no', '<code>' + esc(r.mint) + '</code>'
  ]));
  document.getElementById('gaps').innerHTML = table(['Started','Ended','Reason'], (data.gaps || []).map(g => [fmt(g.started_at), fmt(g.ended_at), esc(g.reason)]));
  const ins = data.insights || {};
  const insKey = String(ins.runId || "none") + "|" + (ins.error || "");
  if (insKey !== lastInsightsKey) {
    lastInsightsKey = insKey;
    const insCards = ins.cards || [];
    const insCounts = ins.counts || {};
    const insSummary = Object.keys(insCounts).map((key) => insCounts[key] + ' ' + key).join(' · ');
    const insWhen = ins.lastRunAt ? fmt(ins.lastRunAt) : 'not yet';
    document.getElementById('insights').innerHTML =
      '<p>Read from LEARNINGS.md (' + esc(ins.learningsBytes || 0) + ' bytes, hash ' + esc(String(ins.learningsHash || '').slice(0, 12)) + '). ' +
      esc(insCards.length) + ' cards · ' + esc(insSummary || 'no categories') + ' · last run ' + esc(insWhen) + '. These are profit hypotheses and loss filters, not buy rules · <a href="/api/insights">raw run</a>.</p>' +
      (ins.read ? '<p class="insight-read">' + esc(ins.read) + '</p>' : '') +
      (ins.error ? '<p class="bad">' + esc(ins.error) + '</p>' : '') +
      (insCards.length ? insCards.map(insightCard).join('') : '<p>No insight run yet. Start the recorder or run <code>node src/insights.js</code>.</p>');
  }
  const xref = data.crossref || {};
  const xrefRows = (xref.verdicts || []).map(row => [esc(row.title), esc(row.verdict), esc(row.local), esc(row.claim)]);
  const xrefWhen = xref.lastRunAt ? fmt(xref.lastRunAt) : 'not yet';
  const xrefState = xref.error ? 'error' : (xref.live ? 'running' : 'idle');
  document.getElementById('cross').innerHTML =
    '<p>The agent reads this ledger against the papers under the receiving gauge. It runs inside the recorder, once at startup and every 10 minutes. It does not send trades.</p>' +
    '<p>' + esc(xrefState) + ' · last run ' + esc(xrefWhen) + ' · structure ' + esc(xref.structureTitle || 'receiving gauge') + ' · <a href="/gallery">structure gallery</a></p>' +
    table(['Stop','Verdict','Ledger','Paper'], xrefRows);
  document.getElementById('log').textContent = (data.log || []).join('\\n');
}
tick();
setInterval(tick, 5000);
</script>
</body>
</html>`;
}

export function startPanel(port = Number(process.env.PANEL_PORT || 8787)) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/api/status") {
      try {
        const body = status();
        body.service = await queryService();
        body.crossref = crossrefStatus();
        body.insights = insightsStatus();
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(body));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (url.pathname === "/api/insights") {
      try {
        const latest = readLatestInsights(root);
        if (!latest) {
          res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "no insight run yet" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(latest));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (url.pathname === "/api/crossref") {
      try {
        const latest = readLatest(root);
        if (!latest) {
          res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "no cross-reference run yet" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(latest));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (url.pathname === "/gallery" || url.pathname.startsWith("/gallery/")) {
      const file = galleryFile(url.pathname);
      if (!file || !fs.existsSync(file)) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("That structure is not in the gallery.");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(fs.readFileSync(file));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page());
  });
  server.on("error", (err) => {
    console.error(`panel listen failed on 127.0.0.1:${port}: ${err.message}`);
  });
  server.listen(port, "127.0.0.1");
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PANEL_PORT || 8787);
  startPanel(port);
  console.log(`panel http://127.0.0.1:${port}`);
}
