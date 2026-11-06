// Profit insights derived from LEARNINGS.md and the live ledger.
// A card is a hypothesis or a loss filter, not a buy rule.
// The recorder runs this at startup and every ten minutes; the panel reads the last run.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { openReadOnly } from "./db.js";

const FIVE_SOL = 5_000_000_000;
const DUST = 200_000_000;
const ONE_SOL = 1_000_000_000;
const GRADUATION_BAND = 85_000_000_000;
const ABSURD = 105_000_000_000;

const KIND_STYLE = {
  edge: { label: "Profit edge", tone: "edge" },
  avoid: { label: "Negative edge", tone: "avoid" },
  filter: { label: "Loss filter", tone: "filter" },
  measure: { label: "Measure first", tone: "measure" },
};

const CONFIDENCE = {
  strong: "Strong",
  moderate: "Moderate",
  hypothesis: "Hypothesis",
};

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  tokens INTEGER NOT NULL,
  labels INTEGER NOT NULL,
  learnings_hash TEXT NOT NULL,
  learnings_bytes INTEGER NOT NULL,
  insight_count INTEGER NOT NULL,
  metrics TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS insight_cards (
  run_id INTEGER NOT NULL,
  card_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  confidence TEXT NOT NULL,
  thesis TEXT NOT NULL,
  playbook TEXT NOT NULL,
  evidence TEXT NOT NULL,
  local TEXT NOT NULL,
  risk TEXT NOT NULL,
  sources TEXT NOT NULL,
  PRIMARY KEY (run_id, card_id)
);

CREATE INDEX IF NOT EXISTS idx_insight_cards_run ON insight_cards(run_id, rank);
`;

export function runInsights(root) {
  const started = Math.floor(Date.now() / 1000);
  const learnings = readLearnings(root);
  const trench = openReadOnly(path.join(root, "data", "trench.db"));
  let metrics;
  try {
    metrics = measureLedger(trench);
  } finally {
    trench.close();
  }
  const cards = buildCards(learnings, metrics);
  const snapshot = {
    started,
    finished: Math.floor(Date.now() / 1000),
    tokens: metrics.tokens,
    labels: metrics.outcomeTotal,
    learnings: {
      file: path.basename(learnings.file),
      hash: learnings.hash,
      bytes: learnings.bytes,
    },
    metrics,
    read: buildRead(metrics),
    cards,
    counts: countKinds(cards),
    line: `insights v1 ${cards.length} cards tokens=${metrics.tokens} labels=${metrics.outcomeTotal}`,
  };
  persist(root, snapshot);
  return snapshot;
}

export function readLatestInsights(root) {
  const file = path.join(root, "data", "insights.db");
  if (!fs.existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true, timeout: 5000 });
  try {
    const run = db.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT 1").get();
    if (!run) return null;
    const rows = db
      .prepare("SELECT * FROM insight_cards WHERE run_id = ? ORDER BY rank")
      .all(run.id);
    const cards = rows.map(parseCard);
    const metrics = safeJson(run.metrics, {});
    return {
      runId: run.id,
      started: run.started_at,
      finished: run.finished_at,
      tokens: run.tokens,
      labels: run.labels,
      learningsHash: run.learnings_hash,
      learningsBytes: run.learnings_bytes,
      counts: countKinds(cards),
      cards,
      metrics,
      read: buildRead(metrics),
      line: `insights v1 ${cards.length} cards tokens=${run.tokens} labels=${run.labels}`,
    };
  } finally {
    db.close();
  }
}

function readLearnings(root) {
  const file = path.join(root, "LEARNINGS.md");
  const text = fs.readFileSync(file, "utf8");
  const hash = createHash("sha256").update(text).digest("hex");
  const blocks = [];
  let section = "Preamble";
  for (const raw of text.split(/\r?\n\s*\r?\n/)) {
    const cleaned = raw.trim();
    if (!cleaned) continue;
    const heading = cleaned.match(/^#{1,3}\s+(.+)$/m);
    if (heading && cleaned.startsWith("#")) section = heading[1].trim();
    const body = cleaned.replace(/^#{1,3}\s+.+$/gm, "").trim();
    if (!body) continue;
    const urls = urlsIn(cleaned);
    for (const item of splitItems(body)) {
      blocks.push({ section, text: item, urls });
    }
  }
  return {
    file,
    text,
    hash,
    bytes: Buffer.byteLength(text, "utf8"),
    lines: text.split(/\r?\n/).length,
    blocks,
  };
}

function splitItems(body) {
  const items = [];
  let current = [];
  const flush = () => {
    if (current.length) {
      items.push(current.join(" ").trim());
      current = [];
    }
  };
  for (const line of body.split(/\r?\n/)) {
    const text = line.trim();
    if (!text) {
      flush();
      continue;
    }
    const bullet = text.match(/^[-*]\s+(.+)$/) || text.match(/^\d+\.\s+(.+)$/);
    if (bullet) {
      flush();
      current.push(bullet[1]);
    } else {
      current.push(text);
    }
  }
  flush();
  return items.length ? items : [body];
}

function urlsIn(text) {
  const found = text.match(/https?:\/\/[^\s<>"')]+/g) || [];
  return [...new Set(found.map((url) => url.replace(/[.,;:]+$/, "")))];
}

function sourceLabel(url) {
  if (!url) return "LEARNINGS.md";
  try {
    if (url.includes("arxiv.org/abs/")) return `arXiv ${url.split("/abs/")[1]}`;
    if (url.includes("ssrn.com/abstract=")) return `SSRN ${url.split("abstract=")[1]}`;
    if (url.includes("doi.org/")) return `DOI ${url.split("doi.org/")[1]}`;
    if (url.includes("usenix.org/")) return "USENIX Security";
    return new URL(url).hostname;
  } catch {
    return "LEARNINGS.md";
  }
}

function pickEvidence(learnings, terms, max = 2) {
  const picked = [];
  const seen = new Set();
  for (const term of terms) {
    for (const block of learnings.blocks) {
      const lower = block.text.toLowerCase();
      if (!lower.includes(term.toLowerCase()) || seen.has(block.text)) continue;
      seen.add(block.text);
      picked.push({
        text: clipAround(plain(block.text.replace(/\s+/g, " ")), term),
        section: block.section,
        source: block.urls.length ? sourceLabel(block.urls[0]) : `LEARNINGS.md · ${block.section}`,
        urls: block.urls,
      });
      break;
    }
    if (picked.length >= max) break;
  }
  if (!picked.length) {
    picked.push({
      text: "The current LEARNINGS.md no longer contains the passage this card was built on. Re-read the file before acting on it.",
      section: "Missing evidence",
      source: "LEARNINGS.md",
      urls: [],
    });
  }
  return picked;
}

function clipAround(text, term, max = 720) {
  const index = text.toLowerCase().indexOf(term.toLowerCase());
  let start = index > 0 ? Math.max(0, index - 180) : 0;
  let end = Math.min(text.length, start + max);
  if (end - start < max && start > 0) start = Math.max(0, end - max);
  let out = text.slice(start, end).trim();
  if (start > 0) out = `…${out}`;
  if (end < text.length) out = `${out}…`;
  return out;
}

function plain(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|\s)\*(.+?)\*/g, "$1$2")
    .replace(/`(.+?)`/g, "$1");
}

function collectSources(evidence) {
  const out = [];
  for (const item of evidence) {
    for (const url of item.urls || []) {
      if (!out.some((source) => source.url === url)) {
        out.push({ label: sourceLabel(url), url });
      }
    }
  }
  if (!out.length) out.push({ label: "LEARNINGS.md", url: null });
  return out;
}

function adjustConfidence(base, found, expected) {
  if (found === 0) return "hypothesis";
  if (base === "strong" && found < Math.min(expected, 2)) return "moderate";
  return base;
}

function countKinds(cards) {
  const counts = {};
  for (const card of cards) counts[card.kind] = (counts[card.kind] || 0) + 1;
  return counts;
}

function parseCard(row) {
  return {
    id: row.card_id,
    rank: row.rank,
    title: row.title,
    kind: row.kind,
    kindLabel: KIND_STYLE[row.kind]?.label || row.kind,
    tone: KIND_STYLE[row.kind]?.tone || "measure",
    confidence: row.confidence,
    thesis: row.thesis,
    playbook: safeJson(row.playbook, []),
    evidence: safeJson(row.evidence, []),
    local: safeJson(row.local, {}),
    risk: safeJson(row.risk, []),
    sources: safeJson(row.sources, []),
  };
}

function safeJson(value, fallback) {
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function persist(root, snapshot) {
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  const db = new DatabaseSync(path.join(root, "data", "insights.db"));
  db.exec(SCHEMA);
  const insertRun = db.prepare(
    `INSERT INTO runs
       (started_at, finished_at, tokens, labels, learnings_hash, learnings_bytes, insight_count, metrics)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertCard = db.prepare(
    `INSERT INTO insight_cards
       (run_id, card_id, rank, title, kind, confidence, thesis, playbook, evidence, local, risk, sources)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.exec("BEGIN");
  try {
    const run = insertRun.run(
      snapshot.started,
      snapshot.finished,
      snapshot.tokens,
      snapshot.labels,
      snapshot.learnings.hash,
      snapshot.learnings.bytes,
      snapshot.cards.length,
      JSON.stringify(snapshot.metrics)
    );
    const runId = Number(run.lastInsertRowid);
    for (const card of snapshot.cards) {
      insertCard.run(
        runId,
        card.id,
        card.rank,
        card.title,
        card.kind,
        card.confidence,
        card.thesis,
        JSON.stringify(card.playbook),
        JSON.stringify(card.evidence),
        JSON.stringify(card.local),
        JSON.stringify(card.risk),
        JSON.stringify(card.sources)
      );
    }
    db.exec("COMMIT");
    snapshot.runId = runId;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    db.close();
  }
}

function measureLedger(db) {
  const tokens = db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(dev_buy), 0) AS devBuys,
              MIN(created_at) AS oldest,
              MAX(created_at) AS newest
       FROM tokens`
    )
    .get();
  const creators = db
    .prepare("SELECT COUNT(DISTINCT creator) AS n FROM tokens WHERE creator IS NOT NULL")
    .get().n;
  const repeatCreators = db
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT creator FROM tokens WHERE creator IS NOT NULL GROUP BY creator HAVING COUNT(*) > 1
       )`
    )
    .get().n;
  const repeatMints = db
    .prepare(
      `SELECT COUNT(*) AS n FROM tokens
       WHERE creator IS NOT NULL AND creator IN (
         SELECT creator FROM tokens WHERE creator IS NOT NULL GROUP BY creator HAVING COUNT(*) > 1
       )`
    )
    .get().n;
  const top10Creators = db
    .prepare(
      `SELECT COALESCE(SUM(n), 0) AS n FROM (
         SELECT COUNT(*) AS n FROM tokens WHERE creator IS NOT NULL GROUP BY creator ORDER BY n DESC LIMIT 10
       )`
    )
    .get().n;
  const topCreator = db
    .prepare(
      `SELECT creator, COUNT(*) AS n FROM tokens
       WHERE creator IS NOT NULL GROUP BY creator ORDER BY n DESC LIMIT 1`
    )
    .get() || { creator: null, n: 0 };
  const curve = db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(CASE WHEN CAST(real_sol_lamports AS INTEGER) < ? THEN 1 ELSE 0 END), 0) AS dust,
              COALESCE(SUM(CASE WHEN CAST(real_sol_lamports AS INTEGER) >= ? AND CAST(real_sol_lamports AS INTEGER) < ? THEN 1 ELSE 0 END), 0) AS low,
              COALESCE(SUM(CASE WHEN CAST(real_sol_lamports AS INTEGER) >= ? AND CAST(real_sol_lamports AS INTEGER) < ? THEN 1 ELSE 0 END), 0) AS mid,
              COALESCE(SUM(CASE WHEN CAST(real_sol_lamports AS INTEGER) >= ? AND CAST(real_sol_lamports AS INTEGER) <= ? THEN 1 ELSE 0 END), 0) AS plausible,
              COALESCE(SUM(CASE WHEN CAST(real_sol_lamports AS INTEGER) > ? AND CAST(real_sol_lamports AS INTEGER) <= ? THEN 1 ELSE 0 END), 0) AS band,
              COALESCE(SUM(CASE WHEN CAST(real_sol_lamports AS INTEGER) > ? THEN 1 ELSE 0 END), 0) AS absurd,
              COALESCE(SUM(CASE WHEN CAST(real_sol_lamports AS INTEGER) >= ? THEN 1 ELSE 0 END), 0) AS above5
       FROM snapshots
       WHERE checkpoint = '30m' AND real_sol_lamports IS NOT NULL`
    )
    .get(DUST, DUST, ONE_SOL, ONE_SOL, FIVE_SOL, FIVE_SOL, GRADUATION_BAND, GRADUATION_BAND, ABSURD, ABSURD, FIVE_SOL);
  const pairs = db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(CASE WHEN CAST(b.real_sol_lamports AS INTEGER) > CAST(a.real_sol_lamports AS INTEGER) THEN 1 ELSE 0 END), 0) AS rose,
              COALESCE(SUM(CASE WHEN CAST(b.real_sol_lamports AS INTEGER) < CAST(a.real_sol_lamports AS INTEGER) THEN 1 ELSE 0 END), 0) AS fell,
              COALESCE(SUM(CASE WHEN CAST(b.real_sol_lamports AS INTEGER) < ? THEN 1 ELSE 0 END), 0) AS dust30
       FROM snapshots a
       JOIN snapshots b ON b.mint = a.mint AND b.checkpoint = '30m'
       WHERE a.checkpoint = '5m'
         AND a.real_sol_lamports IS NOT NULL
         AND b.real_sol_lamports IS NOT NULL`
    )
    .get(DUST);
  const coverage = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM tokens) AS tokens,
              (SELECT COUNT(DISTINCT mint) FROM snapshots WHERE checkpoint = '5m') AS s5,
              (SELECT COUNT(DISTINCT mint) FROM snapshots WHERE checkpoint = '30m') AS s30,
              (SELECT COUNT(DISTINCT mint) FROM snapshots WHERE checkpoint = '48h') AS s48`
    )
    .get();
  const snapshots = {};
  for (const row of db.prepare("SELECT checkpoint, COUNT(*) AS n FROM snapshots GROUP BY checkpoint").all()) {
    snapshots[row.checkpoint] = Number(row.n) || 0;
  }
  const outcomes = db
    .prepare("SELECT label, COUNT(*) AS n FROM outcomes GROUP BY label ORDER BY n DESC")
    .all()
    .map((row) => ({ label: row.label, n: Number(row.n) || 0 }));
  const outcomeTotal = outcomes.reduce((sum, row) => sum + row.n, 0);
  const outcomeUnchecked = db
    .prepare("SELECT COUNT(*) AS n FROM outcomes WHERE cluster_unchecked = 1")
    .get().n;
  const investigations = db.prepare("SELECT COUNT(*) AS n FROM investigations").get().n;
  const clusters = db.prepare("SELECT COUNT(*) AS n FROM clusters").get().n;
  const wallets = db.prepare("SELECT COUNT(*) AS n FROM wallets").get().n;
  const paperSignals = db.prepare("SELECT COUNT(*) AS n FROM paper_signals").get().n;
  const gaps = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN ended_at IS NULL THEN 1 ELSE 0 END), 0) AS open
       FROM ingest_gaps`
    )
    .get();
  const symbols = db
    .prepare("SELECT COUNT(*) AS n FROM tokens WHERE symbol IS NOT NULL AND symbol <> ''")
    .get().n;
  const duplicateSymbols = db
    .prepare(
      `SELECT COALESCE(SUM(n), 0) AS mints, COUNT(*) AS groups FROM (
         SELECT symbol, COUNT(*) AS n FROM tokens
         WHERE symbol IS NOT NULL AND symbol <> ''
         GROUP BY symbol HAVING COUNT(*) > 1
       )`
    )
    .get();
  const repeatCurve = db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(CASE WHEN t.creator IN (
                SELECT creator FROM tokens WHERE creator IS NOT NULL GROUP BY creator HAVING COUNT(*) > 1
              ) THEN 1 ELSE 0 END), 0) AS repeat
       FROM tokens t
       JOIN snapshots s ON s.mint = t.mint AND s.checkpoint = '30m'
       WHERE CAST(s.real_sol_lamports AS INTEGER) >= ?`
    )
    .get(FIVE_SOL);
  const repeatPlausible = db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(CASE WHEN t.creator IN (
                SELECT creator FROM tokens WHERE creator IS NOT NULL GROUP BY creator HAVING COUNT(*) > 1
              ) THEN 1 ELSE 0 END), 0) AS repeat
       FROM tokens t
       JOIN snapshots s ON s.mint = t.mint AND s.checkpoint = '30m'
       WHERE CAST(s.real_sol_lamports AS INTEGER) >= ?
         AND CAST(s.real_sol_lamports AS INTEGER) <= ?`
    )
    .get(FIVE_SOL, GRADUATION_BAND);
  const completeMints = db
    .prepare("SELECT COUNT(DISTINCT mint) AS n FROM snapshots WHERE complete = 1")
    .get().n;
  const outcomeBands = db
    .prepare(
      `SELECT CASE WHEN CAST(s.real_sol_lamports AS INTEGER) >= ? THEN 'above5' ELSE 'below5' END AS band,
              COUNT(*) AS n,
              COALESCE(SUM(CASE WHEN o.label = 'alive' THEN 1 ELSE 0 END), 0) AS alive
       FROM outcomes o
       JOIN snapshots s ON s.mint = o.mint AND s.checkpoint = '30m'
       GROUP BY band`
    )
    .all(FIVE_SOL)
    .map((row) => ({ band: row.band, n: Number(row.n) || 0, alive: Number(row.alive) || 0 }));
  const oldest = tokens.oldest == null ? null : Number(tokens.oldest);
  const newest = tokens.newest == null ? null : Number(tokens.newest);
  return {
    tokens: Number(tokens.n) || 0,
    devBuys: Number(tokens.devBuys) || 0,
    creators: Number(creators) || 0,
    repeatCreators: Number(repeatCreators) || 0,
    repeatMints: Number(repeatMints) || 0,
    top10Creators: Number(top10Creators) || 0,
    topCreator: { creator: topCreator.creator || null, n: Number(topCreator.n) || 0 },
    oldest,
    newest,
    spanHours: oldest && newest ? (newest - oldest) / 3600 : 0,
    snapshots,
    curve: {
      n: Number(curve.n) || 0,
      dust: Number(curve.dust) || 0,
      low: Number(curve.low) || 0,
      mid: Number(curve.mid) || 0,
      plausible: Number(curve.plausible) || 0,
      band: Number(curve.band) || 0,
      absurd: Number(curve.absurd) || 0,
      above5: Number(curve.above5) || 0,
    },
    pairs: {
      n: Number(pairs.n) || 0,
      rose: Number(pairs.rose) || 0,
      fell: Number(pairs.fell) || 0,
      flat: (Number(pairs.n) || 0) - (Number(pairs.rose) || 0) - (Number(pairs.fell) || 0),
      dust30: Number(pairs.dust30) || 0,
    },
    coverage: {
      tokens: Number(coverage.tokens) || 0,
      s5: Number(coverage.s5) || 0,
      s30: Number(coverage.s30) || 0,
      s48: Number(coverage.s48) || 0,
    },
    outcomes,
    outcomeTotal,
    outcomeUnchecked: Number(outcomeUnchecked) || 0,
    investigations: Number(investigations) || 0,
    clusters: Number(clusters) || 0,
    wallets: Number(wallets) || 0,
    paperSignals: Number(paperSignals) || 0,
    gaps: { total: Number(gaps.total) || 0, open: Number(gaps.open) || 0 },
    symbols: {
      withSymbol: Number(symbols) || 0,
      duplicateMints: Number(duplicateSymbols.mints) || 0,
      duplicateGroups: Number(duplicateSymbols.groups) || 0,
    },
    repeatCurve: { n: Number(repeatCurve.n) || 0, repeat: Number(repeatCurve.repeat) || 0 },
    repeatPlausible: { n: Number(repeatPlausible.n) || 0, repeat: Number(repeatPlausible.repeat) || 0 },
    completeMints: Number(completeMints) || 0,
    outcomeBands,
  };
}

function buildRead(metrics) {
  const m = metrics || {};
  const tokens = Number(m.tokens) || 0;
  if (!tokens) {
    return "Current read: the ledger is empty. The cards below are a reading list, not a local result.";
  }
  const span = Number(m.spanHours) || 0;
  const devBuys = Number(m.devBuys) || 0;
  const repeatMints = Number(m.repeatMints) || 0;
  const curve = m.curve || {};
  const curveN = Number(curve.n) || 0;
  const curveText = curveN
    ? `${pct(Number(curve.dust) || 0, curveN)} of 30m readings are under 0.2 SOL; only ${Number(curve.plausible) || 0} sit in the plausible 5–85 SOL band.`
    : "No 30m curve readings exist yet.";
  const outcomes = Number(m.outcomeTotal) || 0;
  const investigations = Number(m.investigations) || 0;
  const evidenceText = outcomes
    ? `${outcomes} 48h labels and ${investigations} holder investigations are stored; the band test can run, but nothing here is an out-of-sample profit test yet.`
    : `No 48h labels are stored${investigations ? ` and only ${investigations} holder investigations exist` : " and the holder layer is empty"}, so no local rule has a measured profit or loss.`;
  return (
    `Current read: ${tokens} mints over ${span.toFixed(1)} h. ` +
    `${pct(devBuys, tokens)} carry a creator buy and ${pct(repeatMints, tokens)} come from repeat creators, ` +
    "so the dev buy is the norm and serial launching is the supply base. " +
    `${curveText} ${evidenceText} ` +
    "The useful output today is a loss filter — 5–85 SOL at 30 minutes, excluding dust and parse suspects — plus a measurement plan. It is not a buy signal."
  );
}

function buildCards(learnings, metrics) {
  const cards = INSIGHT_DEFS.map((def, index) => {
    const evidence = pickEvidence(learnings, def.evidenceTerms, def.maxEvidence || 2);
    const confidence = adjustConfidence(def.confidence, evidence.length, def.evidenceTerms.length);
    const local = def.local(metrics);
    const thesis = typeof def.thesis === "function" ? def.thesis(metrics, local) : def.thesis;
    return {
      id: def.id,
      rank: index,
      title: def.title,
      kind: def.kind,
      kindLabel: KIND_STYLE[def.kind].label,
      tone: KIND_STYLE[def.kind].tone,
      confidence: CONFIDENCE[confidence] || confidence,
      thesis,
      playbook: def.playbook,
      evidence,
      local,
      risk: def.risk,
      sources: collectSources(evidence),
    };
  });
  const dynamic = buildOutcomeCard(learnings, metrics, cards.length);
  if (dynamic) cards.push(dynamic);
  return cards;
}

function buildOutcomeCard(learnings, metrics, rank) {
  if (!metrics.outcomeBands.length || metrics.outcomeTotal < 10) return null;
  const above = metrics.outcomeBands.find((row) => row.band === "above5");
  const below = metrics.outcomeBands.find((row) => row.band === "below5");
  if (!above || !below || !above.n || !below.n) return null;
  const aboveRate = above.alive / above.n;
  const belowRate = below.alive / below.n;
  const lift = (aboveRate - belowRate) * 100;
  const separating = lift > 0;
  const evidence = pickEvidence(
    learnings,
    ["how full the bonding curve already is dominates", "Graduation, or a curve that is already filling"],
    1
  );
  return {
    id: "local-band-test",
    rank,
    title: separating
      ? "First local test: the 5 SOL band is separating survivors"
      : "First local test: the 5 SOL band is not separating survivors",
    kind: "measure",
    kindLabel: KIND_STYLE.measure.label,
    tone: KIND_STYLE.measure.tone,
    confidence: CONFIDENCE.hypothesis,
    thesis: separating
      ? `The first labeled sample puts a higher alive rate above 5 SOL than below it, a ${lift.toFixed(1)} point gap. That is a candidate for a paper rule, not a proof of profit.`
      : `The first labeled sample does not put a higher alive rate above 5 SOL. The gap is ${lift.toFixed(1)} points, so the band is not a separator yet.`,
    playbook: [
      "Log every 5+ SOL candidate in paper_signals at the 30-minute mark and exit at the 48-hour label.",
      "Include fees, failed RPC reads, and the selection made before the label was known.",
      "Do not trade the rule until the gap survives a second label cycle and a gap-free window.",
    ],
    evidence,
    local: {
      headline: `Alive rate: ${pct(above.alive, above.n)} above 5 SOL (${above.n} labeled) against ${pct(below.alive, below.n)} below 5 SOL (${below.n} labeled).`,
      points: [
        `${metrics.outcomeTotal} outcomes are stored; ${metrics.outcomeUnchecked} are cluster-unchecked.`,
        "Alive means the curve retained 5 SOL. It is not a buyer's profit.",
      ],
      readiness: above.n >= 30 && below.n >= 30 ? "partial" : "thin",
    },
    risk: [
      "The split is descriptive and selected after the data arrived. It is not a randomized comparison.",
      "Alive is a curve label, not an exit price. Fees and failed exits can erase the gap.",
    ],
    sources: collectSources(evidence),
  };
}

function pct(part, whole) {
  if (!whole) return "0.0%";
  return `${((Number(part) / Number(whole)) * 100).toFixed(1)}%`;
}

function share(part, whole) {
  if (!whole) return null;
  return (Number(part) / Number(whole)) * 100;
}

function shortWallet(wallet) {
  if (!wallet) return "unknown";
  return wallet.length > 10 ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : wallet;
}

function localSellSide(m) {
  return {
    headline: `${m.devBuys} of ${m.tokens} kept creates (${pct(m.devBuys, m.tokens)}) carry a creator buy. Repeat creators own ${m.repeatMints} mints (${pct(m.repeatMints, m.tokens)}); the top 10 creator wallets account for ${m.top10Creators} (${pct(m.top10Creators, m.tokens)}).`,
    points: [
      `The busiest creator wallet has ${m.topCreator.n} launches (${shortWallet(m.topCreator.creator)}).`,
      m.outcomeTotal
        ? `${m.outcomeTotal} 48h labels exist; ${m.outcomeUnchecked} are cluster-unchecked.`
        : "No 48h labels yet, so the sell-side footprint has no local P&L.",
    ],
    readiness: m.tokens >= 200 ? "ready" : "partial",
  };
}

function localFollower(m) {
  const base = share(m.repeatMints, m.tokens);
  const survivors = share(m.repeatPlausible.repeat, m.repeatPlausible.n);
  const lift = base == null || survivors == null ? null : survivors - base;
  return {
    headline: m.repeatPlausible.n
      ? `Proxy test on repeat creators (not clusters): they account for ${m.repeatPlausible.repeat} of ${m.repeatPlausible.n} plausible 5–85 SOL 30m curves (${pct(m.repeatPlausible.repeat, m.repeatPlausible.n)}), against a ${pct(m.repeatMints, m.tokens)} base rate. Lift ${lift == null ? "n/a" : `${lift >= 0 ? "+" : ""}${lift.toFixed(1)} points`}.`
      : "No plausible 5–85 SOL 30m curve exists yet, so the local follower test has no rows.",
    points: [
      `The wider 5+ SOL set has ${m.repeatCurve.repeat} of ${m.repeatCurve.n}; ${m.curve.absurd} readings above 105 SOL are treated as parse suspects.`,
      `${m.investigations} holder investigations and ${m.clusters} same-funder clusters are stored.`,
      m.investigations
        ? "A cluster flag can be read locally, but the follower-loss test still needs 48h labels."
        : "The local follower test cannot run until the holder layer exists.",
    ],
    readiness: m.investigations > 0 ? "partial" : "blocked",
  };
}

function localCurve(m) {
  return {
    headline: `${m.curve.dust} of ${m.curve.n} 30m readings (${pct(m.curve.dust, m.curve.n)}) are under 0.2 SOL; ${m.curve.above5} are at least 5 SOL; ${m.curve.plausible} sit in the 5–85 SOL band; ${m.curve.band} sit in 85–105 SOL; ${m.curve.absurd} read above 105 SOL.`,
    points: [
      `5m→30m across ${m.pairs.n} paired mints: ${m.pairs.rose} rose, ${m.pairs.fell} fell, ${m.pairs.flat} were flat; ${m.pairs.dust30} were already under 0.2 SOL.`,
      `${m.completeMints} mints show a completed curve; completion is not a survival label.`,
      `${m.outcomeTotal} 48h labels exist; the band's hit rate is not measured yet.`,
    ],
    readiness: m.curve.n >= 200 && m.pairs.n > 0 ? "ready" : "partial",
  };
}

function localWash(m) {
  return {
    headline: `${m.symbols.duplicateMints} of ${m.symbols.withSymbol} named mints (${pct(m.symbols.duplicateMints, m.symbols.withSymbol)}) share a symbol with another mint, across ${m.symbols.duplicateGroups} duplicate-symbol groups. This is a copycat proxy, not a wash measure.`,
    points: [
      `${m.investigations} holder investigations and ${m.wallets} wallets are stored; the ledger has no trade-level table.`,
      `${m.devBuys} of ${m.tokens} creates (${pct(m.devBuys, m.tokens)}) carry a dev buy, so a dev buy is the norm, not a differentiator.`,
    ],
    readiness: m.symbols.withSymbol > 0 ? "partial" : "blocked",
  };
}

function localHolder(m) {
  const level = m.investigations > 0 && m.outcomeTotal > 0 ? "ready" : m.investigations > 0 ? "partial" : "blocked";
  return {
    headline: `${m.investigations} investigations, ${m.clusters} same-funder clusters, ${m.wallets} wallets, and ${m.outcomeTotal} 48h labels are stored.`,
    points: [
      m.outcomeTotal
        ? `${m.outcomeUnchecked} of ${m.outcomeTotal} labels are cluster-unchecked.`
        : "No outcome rows exist, so every future alive label starts unchecked.",
      `${m.gaps.open} open ingest gaps out of ${m.gaps.total}; the holder lookup is the bottleneck.`,
    ],
    readiness: level,
  };
}

function localRepeat(m) {
  const base = share(m.repeatMints, m.tokens);
  const survivors = share(m.repeatPlausible.repeat, m.repeatPlausible.n);
  const lift = base == null || survivors == null ? null : survivors - base;
  const liftText = lift == null ? "n/a" : `${lift >= 0 ? "+" : ""}${lift.toFixed(1)} points`;
  const judgement =
    lift == null
      ? "No comparison yet."
      : Math.abs(lift) < 3
        ? "That is inside noise."
        : lift > 0
          ? "That is a candidate to test, not an edge yet."
          : "That is a negative signal.";
  return {
    headline: `${m.repeatCreators} of ${m.creators} creator wallets launched more than once; they account for ${m.repeatMints} of ${m.tokens} mints (${pct(m.repeatMints, m.tokens)}). Their share of plausible 5–85 SOL 30m curves is ${m.repeatPlausible.n ? pct(m.repeatPlausible.repeat, m.repeatPlausible.n) : "n/a"}, against a ${pct(m.repeatMints, m.tokens)} base rate.`,
    points: [
      `Top 10 creators account for ${m.top10Creators} mints (${pct(m.top10Creators, m.tokens)}); the busiest wallet has ${m.topCreator.n} launches.`,
      `Repeat-creator lift on the plausible band: ${liftText}. ${judgement}`,
      `The wider 5+ SOL set has ${m.repeatCurve.repeat} of ${m.repeatCurve.n}; ${m.curve.absurd} readings above 105 SOL are excluded from the plausible band as parse suspects.`,
    ],
    readiness: m.tokens >= 200 && m.creators > 0 ? "ready" : "partial",
  };
}

function localSample(m) {
  return {
    headline: `${m.tokens} mints over ${m.spanHours.toFixed(1)} h; ${m.coverage.s30} have a 30m snapshot, ${m.outcomeTotal} have a 48h label, and ${m.paperSignals} paper signals are logged.`,
    points: [
      `${m.gaps.total} ingest gaps (${m.gaps.open} open); the create span is short and has a stop in it.`,
      `${m.investigations} investigations saved; the buyer and shared-funder layer is still ${m.investigations ? "thin" : "empty"}.`,
    ],
    readiness: m.outcomeTotal >= 100 ? "ready" : m.outcomeTotal > 0 ? "partial" : "blocked",
  };
}

function repeatThesis(m) {
  const base = share(m.repeatMints, m.tokens);
  const survivors = share(m.repeatPlausible.repeat, m.repeatPlausible.n);
  const lift = base == null || survivors == null ? null : survivors - base;
  const comparison =
    lift == null
      ? "has no local survivor comparison yet"
      : Math.abs(lift) < 3
        ? `is only ${Math.abs(lift).toFixed(1)} points ${lift >= 0 ? "above" : "below"} their share of mints`
        : lift > 0
          ? `is ${lift.toFixed(1)} points above their share of mints`
          : `is ${Math.abs(lift).toFixed(1)} points below their share of mints`;
  return `Serial launching is the bulk of the file. Repeat creators account for ${pct(m.repeatMints, m.tokens)} of mints, and their share of plausible 5–85 SOL 30m curves ${comparison}. That is a supply map and a base-rate check, not a selection edge by itself.`;
}

function sampleThesis(m) {
  if (!m.outcomeTotal) {
    return "The ledger now holds thousands of mints, but no 48h labels, no holder investigations, and no paper signals. The papers are mostly descriptive and almost none estimate a causal trading edge. Any profit rule now would be fitted to a short, gappy window.";
  }
  return `The ledger has ${m.outcomeTotal} 48h labels and ${m.paperSignals} paper signals. That is a start, but a label is not an out-of-sample test until a rule written in advance is logged and then run on a later, gap-free window. Do not treat the first fit as an edge.`;
}

const INSIGHT_DEFS = [
  {
    id: "sell-side-seat",
    title: "The documented profit seat is the sell side",
    kind: "edge",
    confidence: "strong",
    thesis:
      "Across the papers, the participants who reliably take cash are the creator, the early inventory, the sniper, and the wash operator. The buyer who arrives after the signal is the exit liquidity. Profit, if it exists here, comes from selling attention or inventory — not from paying for it.",
    playbook: [
      "Treat every sharp move as a distribution event. Ask who is selling and whether their inventory is still locked.",
      "If you cannot be the creator or the first inventory, do not pay up for the signal. Use the ledger to find the sell-side footprint: dev buy, repeat creator, curve run-up, and later holder concentration.",
      "Track creator and top-holder behavior after the 30-minute snapshot. The sell side is visible before the price is.",
    ],
    evidenceTerms: [
      "Creators average about $104",
      "Known early-buyer groups buy earlier",
      "realized losses",
    ],
    risk: [
      "The creator, sniper, and wash profits are measured on other samples and often need capabilities this tool does not have: a wallet, launch infrastructure, or same-block execution.",
      "A sell-side footprint is not proof of a dump; creators can sell into real demand.",
    ],
    local: localSellSide,
  },
  {
    id: "follower-trap",
    title: "Following early-buyer clusters is a negative-edge trade",
    kind: "avoid",
    confidence: "strong",
    thesis:
      "Early-buyer groups buy earlier and take more cash than a matched placebo. A follower who buys the first group signal loses out of sample in all 32 cost and latency setups. The cluster proves the move already happened; it does not prove it continues.",
    playbook: [
      "Do not add a mint because a known cluster or fast wallet is in it.",
      "If you already hold, use a rising cluster share as an exit warning, not as a reason to add.",
      "Never infer “early” from a signal you can see; by then the group has the fill.",
    ],
    evidenceTerms: [
      "A follower who buys at the first group signal loses money",
      "Fast-wallet pools raise the chance of reaching 20 SOL",
      "Seeing an early-buyer cluster means you are early enough to buy",
    ],
    risk: [
      "The local test uses 30m SOL, not profit; labels are missing.",
      "The paper's 32 setups are from one 88-hour window and may not transfer.",
    ],
    local: localFollower,
  },
  {
    id: "curve-filter",
    title: "Curve level is a filter, not a forecast",
    kind: "filter",
    confidence: "strong",
    thesis:
      "Curve fullness dominates other predictors of graduation, but graduation is about 1% and 53% of launches never hold more than 1 SOL. The 30-minute curve is useful for discarding dead inventory cheaply. It is not a buy signal.",
    playbook: [
      "Run a two-stage funnel: keep mints with 5–85 SOL at 30 minutes; exclude readings above 105 SOL as parse suspects; do not treat 85+ as liquidity.",
      "Before any capital, require a 48h label and a holder report. The curve level only decides what deserves measurement.",
      "Track the 5m→30m change: rising curves are candidates; falling curves are exits, not bargains.",
    ],
    evidenceTerms: [
      "how full the bonding curve already is dominates",
      "53 percent of launches never hold more than 1 SOL",
      "1.02 percent of coins graduate",
    ],
    risk: [
      "The 5/85/105 lines are operational bands, not estimated optima.",
      "A short sample without 48h labels cannot tell whether the band has positive expectancy.",
    ],
    local: localCurve,
  },
  {
    id: "wash-copycat-camouflage",
    title: "Wash volume and copycats are camouflage, not demand",
    kind: "avoid",
    confidence: "strong",
    thesis:
      "Most tokens that multiplied showed wash trading, pool-price inflation, or concentrated ownership. Wash trades can raise graduation odds without raising buyer profit, and copycats are over 10% of coins. Volume is a cost of manufacturing attention, not evidence of a bid.",
    playbook: [
      "Use manipulation and copycat flags to size down or skip; never as a reason to enter.",
      "Treat a busy comment section, social link, or volume spike as unverified until holder concentration and cash flow confirm it.",
      "In this ledger, duplicate symbols are the available copycat proxy. Add trade-level wash detection before claiming a wash filter.",
    ],
    evidenceTerms: [
      "82.8 percent show wash trading",
      "Doubling the wash count is associated with about 19 percent higher graduation odds",
      "at least 1.5 million copycats",
      "A social link, a busy comment section, or wash volume means the coin has real demand",
    ],
    risk: [
      "Duplicate symbols catch lazy copies and miss renamed ones; symbols are not the paper's copycat definition.",
      "The ledger cannot yet measure wash trades, so it cannot apply the paper's filter.",
    ],
    local: localWash,
  },
  {
    id: "repeat-creator-supply",
    title: "Repeat creators are a supply map, not a proven edge",
    kind: "filter",
    confidence: "moderate",
    thesis: repeatThesis,
    playbook: [
      "Build a creator scorecard: launches, 30m survival, 48h alive rate, dev-buy share, cadence, and prior rugs. Down-rank creators with bad outcomes; do not up-rank on repeat status alone.",
      "Use creator cadence for scheduling research and for exit risk, not for entry.",
      "When outcomes arrive, test whether a creator's prior alive rate predicts the next mint. Until then, keep the label descriptive.",
    ],
    evidenceTerms: [
      "Once the curve's own level is known, the group label adds nothing",
      "Creators are 19.2 percent of the statistical winners",
      "Serial launching is already the bulk of this file",
    ],
    risk: [
      "The local comparison uses a 30m curve proxy, not profit.",
      "If repeat creators are overrepresented among eventual winners, the base-rate comparison would change; the 48h labels will tell.",
    ],
    local: localRepeat,
  },
  {
    id: "holder-blind-spot",
    title: "The missing holder layer is the biggest loss-prevention gap",
    kind: "measure",
    confidence: "strong",
    thesis:
      "On Solana a rug is usually a dump or a liquidity pull, not hidden contract code. Holder concentration and shared-funder bundles are the visible precursors. This ledger has no holder layer: zero investigations, zero clusters, zero wallets. An “alive” label is cluster-unchecked.",
    playbook: [
      "Do not increase size on a survivor until a holder report exists: top-10 share, largest same-funder cluster, creator prior launches, and whether the creator sold.",
      "Keep the label rule that requires a cluster under 20% when an investigation exists; expose cluster_unchecked on every card.",
      "If the public RPC keeps rejecting holder lookups, treat the gap as a hard stop, not a clean bill of health.",
    ],
    evidenceTerms: [
      "bundled accounts hold 36.5 percent",
      "Solana tokens share one token program",
      "top 10 wallets average 78 percent",
      "A top-10 holder share under 30 percent means the supply is distributed",
    ],
    risk: [
      "Shared funders are a lead, not proof of common control.",
      "A holder report can be wrong or stale; the RPC may fail precisely when a mint is moving.",
    ],
    local: localHolder,
  },
  {
    id: "sample-discipline",
    title: "The sample is not yet an out-of-sample test",
    kind: "measure",
    confidence: "strong",
    thesis: sampleThesis,
    playbook: [
      "Write the entry, exit, size, fee, and latency assumptions before looking at winners. Log every signal in paper_signals.",
      "Wait for at least one full 48h label cycle on a gap-free window; compare the rule's hit rate and expectancy with the base rate.",
      "Kill the rule if it does not survive costs and out-of-sample labels. A clean no-trade is a valid result.",
    ],
    evidenceTerms: [
      "None of this is a buy rule",
      "A classifier that avoids the next-hour dump is a tradable rule",
      "Almost none estimate a causal trading edge",
      "No 48-hour label exists yet",
    ],
    risk: [
      "Waiting has opportunity cost; the launch regime may change before labels arrive.",
      "A rule fitted to a short window is not evidence of profit.",
    ],
    local: localSample,
  },
];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const snapshot = runInsights(root);
  console.log(snapshot.line);
  console.log(
    `learnings ${snapshot.learnings.file} ${snapshot.learnings.bytes} bytes sha256:${snapshot.learnings.hash.slice(0, 12)}`
  );
  console.log(`\n${snapshot.read}`);
  for (const card of snapshot.cards) {
    console.log(`\n[${card.kind}] ${card.title}`);
    console.log(`  ${card.confidence} · local ${card.local.readiness}`);
    console.log(`  ${card.thesis}`);
    console.log(`  local: ${card.local.headline}`);
  }
}
