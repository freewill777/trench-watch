import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { openReadOnly } from "./db.js";
import { lamportsToSol } from "./parse.js";

export const GRADUATION_SOL = 85;
export const SNIPE_SOL = 1;
export const START_SOL = 10;
export const ROUNDS = 12;
export const TRADE_FEE = 0.01;

const LAMPORTS_PER_SOL = 1e9;
const TOKEN_UNITS = 1e6;
const MAX_RUNS = 20;

export const ASSUMPTIONS = [
  "Launches and curve readings are real. The recorder wrote them from the Solana RPC into data/trench.db. The game opens that file read-only.",
  "The sniper enters at the real 5-minute reserves and is marked out at the same coin's real 30-minute reserves, on pump.fun's constant-product curve.",
  "A 1% fee is charged on each side. This is an assumption, not a measured fee.",
  "Fills are hypothetical. There is no priority fee, no block-zero competition, no slippage beyond the curve, and no effect on the recorded reserves.",
  "Only launches with both readings, neither snapshot a completed curve, and neither reading above 85 SOL are dealt. 85 SOL is the usual graduation level.",
  "Rival bots, whales and holder clusters are not in the game. The ledger has no block-zero or holder data for them yet.",
];

export class ArenaError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const JOINS = `FROM tokens t
  JOIN snapshots s5 ON s5.mint = t.mint AND s5.checkpoint = '5m'
  JOIN snapshots s30 ON s30.mint = t.mint AND s30.checkpoint = '30m'`;

const PLAYABLE = `s5.virtual_sol_lamports IS NOT NULL AND s5.virtual_token_raw IS NOT NULL
  AND s30.virtual_sol_lamports IS NOT NULL AND s30.virtual_token_raw IS NOT NULL
  AND COALESCE(s5.complete, 0) = 0 AND COALESCE(s30.complete, 0) = 0
  AND CAST(s5.real_sol_lamports AS REAL) / 1e9 <= ${GRADUATION_SOL}
  AND CAST(s30.real_sol_lamports AS REAL) / 1e9 <= ${GRADUATION_SOL}`;

function withDb(root, fn) {
  const file = path.join(root, "data", "trench.db");
  if (!fs.existsSync(file)) throw new ArenaError(503, "data/trench.db is missing");
  const db = openReadOnly(file);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function playableMints(root) {
  return withDb(root, (db) =>
    db
      .prepare(`SELECT t.mint AS mint ${JOINS} WHERE ${PLAYABLE}`)
      .all()
      .map((row) => row.mint)
  );
}

export function loadLaunch(root, mint) {
  return withDb(root, (db) =>
    db
      .prepare(
        `SELECT t.mint, t.symbol, t.name, t.created_at, t.dev_buy,
           (SELECT COUNT(*) FROM tokens c WHERE c.creator = t.creator) AS creator_launches,
           s5.observed_at AS obs5, s5.real_sol_lamports AS real5,
           s5.virtual_sol_lamports AS vs5, s5.virtual_token_raw AS vt5,
           s30.observed_at AS obs30, s30.real_sol_lamports AS real30,
           s30.virtual_sol_lamports AS vs30, s30.virtual_token_raw AS vt30
         ${JOINS} WHERE t.mint = ? AND ${PLAYABLE}`
      )
      .get(mint) || null
  );
}
// Constant-product curve, the shape pump.fun uses. Reserves are Numbers:
// virtual SOL in lamports and virtual token in raw units (6 decimals).
export function quoteBuy(vsLamports, vtRaw, spendLamports) {
  const net = spendLamports * (1 - TRADE_FEE);
  return vtRaw - (vsLamports * vtRaw) / (vsLamports + net);
}

export function quoteSell(vsLamports, vtRaw, tokensRaw) {
  const gross = vsLamports - (vsLamports * vtRaw) / (vtRaw + tokensRaw);
  return gross * (1 - TRADE_FEE);
}

// SOL per whole token.
export function priceOf(vsLamports, vtRaw) {
  return vsLamports / LAMPORTS_PER_SOL / (vtRaw / TOKEN_UNITS);
}

export function readingText(sol) {
  if (sol == null) return "unknown";
  if (sol >= 5) return "still holds 5 SOL or more";
  if (sol < 0.2) return "under 0.2 SOL";
  return "between 0.2 and 5 SOL";
}

// The entry is shown to the player. The exit stays on the server until the player decides.
export function buildRound(row) {
  const vs5 = Number(row.vs5);
  const vt5 = Number(row.vt5);
  const vs30 = Number(row.vs30);
  const vt30 = Number(row.vt30);
  const tokensRaw = quoteBuy(vs5, vt5, SNIPE_SOL * LAMPORTS_PER_SOL);
  const real30 = lamportsToSol(row.real30);
  return {
    entry: {
      mint: row.mint,
      symbol: row.symbol || null,
      name: row.name || null,
      createdAt: row.created_at,
      devBuy: row.dev_buy === 1,
      creatorLaunches: row.creator_launches,
      observedAt: row.obs5,
      curveSol: lamportsToSol(row.real5),
      priceSol: priceOf(vs5, vt5),
    },
    exit: {
      observedAt: row.obs30,
      curveSol: real30,
      priceSol: priceOf(vs30, vt30),
      reading: readingText(real30),
      proceedsSol: quoteSell(vs30, vt30, tokensRaw) / LAMPORTS_PER_SOL,
    },
  };
}

// Passing costs nothing. The hypothetical snipe is always reported, so a pass can be judged too.
export function settle(round, action) {
  const taken = action === "snipe";
  const costSol = taken ? SNIPE_SOL : 0;
  const proceedsSol = taken ? round.exit.proceedsSol : 0;
  return {
    action,
    taken,
    costSol,
    proceedsSol,
    pnlSol: proceedsSol - costSol,
    hypotheticalPnlSol: round.exit.proceedsSol - SNIPE_SOL,
    exit: round.exit,
  };
}
// Runs live in memory. The server holds every exit reading, so the browser never receives one before acting.
const runs = new Map();

function shuffled(items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function presentStep(run) {
  const round = run.rounds[run.index];
  return {
    round: run.index + 1,
    total: run.rounds.length,
    balanceSol: run.balanceSol,
    canSnipe: run.balanceSol >= SNIPE_SOL,
    entry: round ? round.entry : null,
  };
}

export function startRun(root) {
  const mints = shuffled(playableMints(root));
  const rounds = [];
  for (const mint of mints) {
    if (rounds.length === ROUNDS) break;
    const row = loadLaunch(root, mint);
    if (row) rounds.push(buildRound(row));
  }
  if (rounds.length === 0) throw new ArenaError(409, "no playable launches in the ledger yet");
  const runId = randomUUID();
  runs.set(runId, { rounds, index: 0, balanceSol: START_SOL, results: [] });
  while (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value);
  return { runId, ...presentStep(runs.get(runId)) };
}

function summarize(run) {
  const taken = run.results.filter((r) => r.taken);
  const passed = run.results.filter((r) => !r.taken);
  const sum = (items) => items.reduce((acc, value) => acc + value, 0);
  return {
    rounds: run.results.length,
    snipes: taken.length,
    wins: taken.filter((r) => r.pnlSol > 0).length,
    realisedPnlSol: sum(taken.map((r) => r.pnlSol)),
    passedHypotheticalPnlSol: sum(passed.map((r) => r.hypotheticalPnlSol)),
    balanceSol: run.balanceSol,
  };
}

export function act(runId, action) {
  if (action !== "snipe" && action !== "pass") throw new ArenaError(400, "action must be snipe or pass");
  const run = runs.get(runId);
  if (!run) throw new ArenaError(404, "run not found or expired; start a new run");
  const round = run.rounds[run.index];
  if (!round) throw new ArenaError(409, "this run is finished");
  if (action === "snipe" && run.balanceSol < SNIPE_SOL) throw new ArenaError(409, "not enough SOL to snipe");
  const result = settle(round, action);
  run.balanceSol += result.pnlSol;
  run.results.push(result);
  run.index += 1;
  const done = run.index >= run.rounds.length;
  return {
    settled: { ...result, mint: round.entry.mint, symbol: round.entry.symbol },
    balanceSol: run.balanceSol,
    done,
    summary: done ? summarize(run) : null,
    next: done ? null : presentStep(run),
  };
}

// The baseline scans every playable launch, so the panel reads a cached copy.
let baselineMemo = { at: 0, value: null };
export function baselineCached(root, maxAgeMs = 60_000) {
  if (!baselineMemo.value || Date.now() - baselineMemo.at > maxAgeMs) {
    baselineMemo = { at: Date.now(), value: ledgerBaseline(root) };
  }
  return baselineMemo.value;
}

// Every playable launch, with the same hypothetical snipe. This is the baseline the game is judged against.
export function ledgerBaseline(root) {
  const rows = withDb(root, (db) =>
    db
      .prepare(
        `SELECT t.mint, t.symbol, t.name, t.created_at, t.dev_buy,
           (SELECT COUNT(*) FROM tokens c WHERE c.creator = t.creator) AS creator_launches,
           s5.observed_at AS obs5, s5.real_sol_lamports AS real5,
           s5.virtual_sol_lamports AS vs5, s5.virtual_token_raw AS vt5,
           s30.observed_at AS obs30, s30.real_sol_lamports AS real30,
           s30.virtual_sol_lamports AS vs30, s30.virtual_token_raw AS vt30
         ${JOINS} WHERE ${PLAYABLE}`
      )
      .all()
  );
  const pnls = rows.map((row) => buildRound(row).exit.proceedsSol - SNIPE_SOL).sort((a, b) => a - b);
  if (pnls.length === 0) return { launches: 0 };
  const at = (p) => pnls[Math.min(pnls.length - 1, Math.floor(p * pnls.length))];
  const aboveCost = pnls.filter((x) => x > 0).length;
  return {
    launches: pnls.length,
    shareAboveCostPct: (aboveCost / pnls.length) * 100,
    meanPnlSol: pnls.reduce((acc, value) => acc + value, 0) / pnls.length,
    p10PnlSol: at(0.1),
    medianPnlSol: at(0.5),
    p90PnlSol: at(0.9),
  };
}

