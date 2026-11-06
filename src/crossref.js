import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { openReadOnly } from "./db.js";
import {
  CLAIMS,
  JOINTS,
  STRUCTURES,
  measureLedger,
  pct,
  presentStructure,
  verdictLabel,
} from "./structures.js";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS structure_versions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  object_name TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  retired_reason TEXT,
  figure_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  citation TEXT NOT NULL,
  url TEXT,
  quantity_id TEXT NOT NULL,
  population_id TEXT NOT NULL,
  definition_id TEXT NOT NULL,
  value REAL,
  sample_note TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  tokens INTEGER,
  structure_id TEXT NOT NULL,
  error TEXT
);

CREATE TABLE IF NOT EXISTS measurements (
  run_id INTEGER NOT NULL,
  measurement_id TEXT NOT NULL,
  quantity_id TEXT NOT NULL,
  population_id TEXT NOT NULL,
  definition_id TEXT NOT NULL,
  value REAL,
  n INTEGER NOT NULL,
  note TEXT,
  PRIMARY KEY (run_id, measurement_id)
);

CREATE TABLE IF NOT EXISTS joints (
  id TEXT PRIMARY KEY,
  structure_id TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  measurement_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  min_n INTEGER NOT NULL,
  title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verdicts (
  run_id INTEGER NOT NULL,
  joint_id TEXT NOT NULL,
  structure_id TEXT NOT NULL,
  verdict TEXT NOT NULL,
  local_value REAL,
  claim_value REAL,
  delta REAL,
  reason TEXT NOT NULL,
  detail TEXT NOT NULL,
  PRIMARY KEY (run_id, joint_id)
);
`;

export function runCrossref(root) {
  const started = Math.floor(Date.now() / 1000);
  const trench = openReadOnly(path.join(root, "data", "trench.db"));
  let measured;
  try {
    measured = measureLedger(trench);
  } finally {
    trench.close();
  }
  const snapshot = buildSnapshot(measured, started);
  persist(root, snapshot);
  writeGallery(root, snapshot);
  return snapshot;
}

export function buildSnapshot(measured, started = Math.floor(Date.now() / 1000)) {
  const structures = STRUCTURES.map((structure) => ({
    ...structure,
    figure: `/gallery/${structure.id}/figure.html`,
    joints: presentStructure(structure.id, measured),
  }));
  const current = structures.find((structure) => structure.status === "current");
  const counts = countVerdicts(current.joints);
  return {
    started,
    tokens: measured.tokens,
    extra: measured.extra,
    structures,
    current: current.id,
    line: `${current.id} ${Object.entries(counts).map(([name, n]) => `${name}=${n}`).join(" ")} tokens=${measured.tokens}`,
  };
}

function countVerdicts(joints) {
  const counts = { agree: 0, diverge: 0, thin: 0, incomparable: 0 };
  for (const joint of joints) counts[joint.verdict] = (counts[joint.verdict] || 0) + 1;
  return counts;
}

function persist(root, snapshot) {
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  const db = new DatabaseSync(path.join(root, "data", "crossref.db"));
  db.exec(SCHEMA);
  const insertStructure = db.prepare(
    `INSERT INTO structure_versions (id, title, object_name, status, summary, retired_reason, figure_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       object_name = excluded.object_name,
       status = excluded.status,
       summary = excluded.summary,
       retired_reason = excluded.retired_reason,
       figure_path = excluded.figure_path,
       created_at = excluded.created_at`
  );
  const insertClaim = db.prepare(
    `INSERT INTO claims (id, citation, url, quantity_id, population_id, definition_id, value, sample_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       citation = excluded.citation,
       url = excluded.url,
       quantity_id = excluded.quantity_id,
       population_id = excluded.population_id,
       definition_id = excluded.definition_id,
       value = excluded.value,
       sample_note = excluded.sample_note`
  );
  const insertJoint = db.prepare(
    `INSERT INTO joints (id, structure_id, claim_id, measurement_id, mode, min_n, title)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       structure_id = excluded.structure_id,
       claim_id = excluded.claim_id,
       measurement_id = excluded.measurement_id,
       mode = excluded.mode,
       min_n = excluded.min_n,
       title = excluded.title`
  );
  const insertRun = db.prepare(
    `INSERT INTO runs (started_at, finished_at, tokens, structure_id, error) VALUES (?, ?, ?, ?, NULL)`
  );
  const insertMeasurement = db.prepare(
    `INSERT INTO measurements (run_id, measurement_id, quantity_id, population_id, definition_id, value, n, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertVerdict = db.prepare(
    `INSERT INTO verdicts (run_id, joint_id, structure_id, verdict, local_value, claim_value, delta, reason, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  db.exec("BEGIN");
  try {
    for (const structure of snapshot.structures) {
      insertStructure.run(
        structure.id,
        structure.title,
        structure.objectName,
        structure.status,
        structure.summary,
        structure.retiredReason,
        `gallery/${structure.id}/figure.html`,
        structure.created
      );
    }
    for (const claim of Object.values(CLAIMS)) {
      insertClaim.run(
        claim.id,
        claim.citation,
        claim.url,
        claim.quantityId,
        claim.populationId,
        claim.definitionId,
        claim.value,
        claim.sampleNote
      );
    }
    for (const item of JOINTS) {
      insertJoint.run(item.id, item.structureId, item.claimId, item.measurementId, item.mode, item.minN, item.title);
    }
    const run = insertRun.run(snapshot.started, snapshot.started, snapshot.tokens, snapshot.current);
    const runId = Number(run.lastInsertRowid);
    const seen = new Set();
    for (const structure of snapshot.structures) {
      for (const joint of structure.joints) {
        if (!seen.has(joint.measurementId)) {
          seen.add(joint.measurementId);
          insertMeasurement.run(
            runId,
            joint.measurementId,
            joint.quantityId,
            joint.populationId,
            joint.definitionId,
            joint.localMissing ? null : joint.local,
            joint.n,
            joint.note
          );
        }
        insertVerdict.run(
          runId,
          joint.id,
          joint.structureId,
          joint.verdict,
          joint.localMissing ? null : joint.local,
          joint.claim,
          joint.delta,
          joint.reason,
          JSON.stringify(joint)
        );
      }
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

export function readLatest(root) {
  const file = path.join(root, "data", "crossref.db");
  if (!fs.existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true, timeout: 5000 });
  try {
    const run = db.prepare("SELECT id, started_at, finished_at, tokens, structure_id, error FROM runs ORDER BY id DESC LIMIT 1").get();
    if (!run) return null;
    const verdicts = db
      .prepare(
        `SELECT structure_id, verdict, detail FROM verdicts WHERE run_id = ? ORDER BY joint_id`
      )
      .all(run.id)
      .map((row) => ({ structureId: row.structure_id, verdict: row.verdict, joint: JSON.parse(row.detail) }));
    const order = new Map(JOINTS.map((item, index) => [item.id, index]));
    const byStructure = new Map();
    for (const row of verdicts) {
      if (!byStructure.has(row.structureId)) byStructure.set(row.structureId, []);
      byStructure.get(row.structureId).push(row.joint);
    }
    for (const list of byStructure.values()) {
      list.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }
    const structures = STRUCTURES.map((structure) => ({
      ...structure,
      figure: `/gallery/${structure.id}/figure.html`,
      joints: byStructure.get(structure.id) || [],
    }));
    const current = structures.find((structure) => structure.status === "current") || structures[0];
    return {
      runId: run.id,
      started: run.started_at,
      tokens: run.tokens,
      error: run.error,
      structures,
      current: current.id,
      line: `${current.id} tokens=${run.tokens}`,
    };
  } finally {
    db.close();
  }
}

export function writeGallery(root, snapshot) {
  const dir = path.join(root, "gallery");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), galleryHtml(snapshot), "utf8");
}

function galleryHtml(snapshot) {
  const when = new Date(snapshot.started * 1000).toLocaleString();
  const ordered = [...snapshot.structures].sort((a, b) => {
    if (a.status === "current") return -1;
    if (b.status === "current") return 1;
    return a.created < b.created ? 1 : -1;
  });
  const cards = ordered.map((structure) => structureCard(structure)).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Structure gallery</title>
<style>
  :root { color-scheme: dark; --bg:#12140f; --card:#1c2118; --ink:#e7efe0; --muted:#9aa892; --line:#31382c; --ok:#b6e37a; --warn:#e6c36a; }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.5 "Segoe UI", sans-serif; background:var(--bg); color:var(--ink); }
  main { width:min(920px, calc(100% - 32px)); margin:0 auto; padding:32px 0 64px; }
  a { color:var(--ok); }
  h1 { font-size:28px; letter-spacing:-0.03em; margin:0 0 8px; }
  h2 { font-size:18px; margin:0; }
  p { color:var(--muted); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px 18px 18px; margin:16px 0; }
  .row { display:flex; justify-content:space-between; gap:12px; align-items:baseline; flex-wrap:wrap; }
  .chip { border:1px solid var(--line); border-radius:999px; padding:2px 8px; font-size:12px; color:var(--muted); }
  .chip.current { color:var(--ok); }
  table { width:100%; border-collapse:collapse; margin-top:12px; }
  th, td { text-align:left; padding:6px 8px; border-top:1px solid var(--line); vertical-align:top; font-size:13px; }
  th { color:var(--muted); font-weight:600; }
  .links { display:flex; gap:14px; margin-top:12px; }
</style>
</head>
<body>
<main>
  <p><a href="/">Trench Watch</a></p>
  <h1>Structure gallery</h1>
  <p>Each card is a rule for laying this ledger against the papers. The current rule is the one the agent runs. When a rule is replaced, its figure stays here. Last run ${escapeText(when)}, ${snapshot.tokens} mints in the ledger.</p>
  ${cards}
  <p>The figures are instruments. Hover a figure to move from claim to claim. The numbers are the agent's last comparison. Nothing on this page is a buy rule.</p>
</main>
</body>
</html>`;
}

function structureCard(structure) {
  const rows = structure.joints
    .map(
      (joint) => `<tr>
        <td>${escapeText(joint.title)}</td>
        <td>${escapeText(verdictLabel(joint.verdict))}</td>
        <td>${escapeText(pct(joint.localMissing ? null : joint.local))}</td>
        <td>${escapeText(pct(joint.claim))}</td>
        <td>${escapeText(joint.reason)}</td>
      </tr>`
    )
    .join("");
  const retired = structure.retiredReason
    ? `<p>${escapeText(structure.retiredReason)}</p>`
    : "";
  return `<article class="card">
    <div class="row">
      <h2>${escapeText(structure.objectName)}</h2>
      <span class="chip ${structure.status === "current" ? "current" : ""}">${structure.status === "current" ? "Current" : "Kept"} · ${escapeText(structure.id)} · ${escapeText(structure.created)}</span>
    </div>
    <p>${escapeText(structure.summary)}</p>
    ${retired}
    <table>
      <tr><th>Stop</th><th>Verdict</th><th>Ledger</th><th>Paper</th><th>Why</th></tr>
      ${rows}
    </table>
    <div class="links">
      <a href="${escapeText(structure.id)}/figure.html">Open the figure</a>
      <a href="${escapeText(structure.id)}/figure-light.html">Light</a>
    </div>
  </article>`;
}

function escapeText(value) {
  return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const snapshot = runCrossref(root);
  console.log(snapshot.line);
  for (const structure of snapshot.structures) {
    console.log(`\n${structure.id} ${structure.status}`);
    for (const joint of structure.joints) {
      console.log(`  ${joint.title}: ${joint.verdict} ledger=${pct(joint.localMissing ? null : joint.local)} paper=${pct(joint.claim)}`);
    }
  }
}
