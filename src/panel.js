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
import { ArenaError, ASSUMPTIONS, act, baselineCached, startRun } from "./arena.js";
import { networkStatus } from "./network.js";
import { handleIdentity } from "./routes-identity.js";

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
<title>Trench Watch · Command Post</title>
<style>
  :root {
    color-scheme: dark;
    --bg:#0b0f0c; --field:#101812; --card:#151e17; --card-2:#1c2720;
    --ink:#ece4c8; --muted:#9fa68a; --brass:#7d6a3c; --gold:#e2b558;
    --line:#2e3c2e; --ok:#8fd16a; --bad:#e0715f; --warn:#e8b84d; --scout:#6fa6d9;
    --display:Bahnschrift, "Segoe UI Semibold", "Segoe UI", sans-serif;
    --body:"Segoe UI", sans-serif;
  }
  * { box-sizing:border-box; }
  body {
    margin:0; min-height:100vh; font:15px/1.45 var(--body); color:var(--ink);
    background:
      radial-gradient(ellipse at 50% -15%, rgba(226,181,88,.14), transparent 60%),
      repeating-linear-gradient(0deg, rgba(143,209,106,.04) 0 1px, transparent 1px 44px),
      repeating-linear-gradient(90deg, rgba(143,209,106,.04) 0 1px, transparent 1px 44px),
      var(--bg);
  }
  header, main { width:min(1140px, calc(100% - 32px)); margin:0 auto; }
  header { padding:24px 0 16px; display:flex; justify-content:space-between; gap:20px; align-items:flex-end; flex-wrap:wrap; border-bottom:2px solid var(--brass); }
  .kicker { font:600 11px/1 var(--display); letter-spacing:.24em; text-transform:uppercase; color:var(--gold); }
  h1 { font:650 36px/1.05 var(--display); letter-spacing:.05em; text-transform:uppercase; margin:8px 0 4px; }
  h2 { display:flex; align-items:center; gap:12px; font:600 14px/1 var(--display); letter-spacing:.16em; text-transform:uppercase; color:var(--gold); margin:30px 0 12px; }
  h2::after { content:""; flex:1; height:1px; background:linear-gradient(90deg, var(--brass), transparent); }
  p { color:var(--muted); margin:6px 0; }
  a { color:var(--gold); }
  .hud { display:grid; gap:10px; width:min(360px, 100%); }
  .chips { display:flex; gap:8px; flex-wrap:wrap; }
  .chip { border:1px solid var(--brass); background:var(--card); padding:5px 9px; font:600 12px/1.2 var(--display); letter-spacing:.08em; text-transform:uppercase; }
  .ok { color:var(--ok); } .bad { color:var(--bad); } .warn { color:var(--warn); }
  .chip.net-ok { border-color:var(--ok); color:var(--ok); }
  .chip.net-bad { border-color:var(--bad); color:var(--bad); background:rgba(224,113,95,.12); }
  .chip.net-warn { border-color:var(--warn); color:var(--warn); }
  .devnet-banner { background:rgba(111,166,217,.10); border:1px solid var(--scout); border-left:4px solid var(--scout); padding:8px 12px; margin:14px 0 0; font:600 12px/1.4 var(--display); letter-spacing:.08em; text-transform:uppercase; color:var(--ink); display:none; }
  .devnet-banner.show { display:block; }
  .devnet-banner.bad { border-color:var(--bad); border-left-color:var(--bad); background:rgba(224,113,95,.12); }
  .devnet-banner span { color:var(--muted); font-weight:400; letter-spacing:.02em; text-transform:none; }
  .turn-row { display:flex; justify-content:space-between; gap:12px; font:600 12px/1 var(--display); letter-spacing:.14em; text-transform:uppercase; color:var(--muted); }
  .turn-row b { color:var(--gold); font-weight:600; }
  .turn-bar { height:6px; margin-top:8px; background:var(--card-2); border:1px solid var(--line); overflow:hidden; }
  .turn-bar i { display:block; height:100%; width:0; background:linear-gradient(90deg, var(--brass), var(--gold)); animation:turn 5s linear infinite; }
  @keyframes turn { from { width:0; } to { width:100%; } }
  .mission { margin-top:18px; background:var(--card); border:1px solid var(--line); border-left:4px solid var(--gold); padding:12px 16px; }
  .mission p { margin:4px 0 0; color:var(--ink); }
  .grid { display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; }
  .stat { background:var(--card); border:1px solid var(--line); border-top:2px solid var(--brass); padding:12px 14px; box-shadow:inset 0 1px 0 rgba(226,181,88,.08); }
  .stat b { display:block; font:600 24px/1.2 var(--display); font-variant-numeric:tabular-nums; }
  .stat span { display:block; color:var(--muted); font:600 11px/1.3 var(--display); letter-spacing:.12em; text-transform:uppercase; }
  table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; font-size:13px; }
  th { color:var(--gold); font:600 12px/1.3 var(--display); letter-spacing:.12em; text-transform:uppercase; background:var(--card-2); }
  td { color:var(--ink); }
  code { font-family:Consolas, monospace; font-size:12px; color:var(--muted); }
  .log { white-space:pre-wrap; font:12px/1.4 Consolas, monospace; color:var(--muted); background:var(--field); border:1px solid var(--line); padding:12px; max-height:280px; overflow:auto; }
  .learnings, .cross { background:var(--card); border:1px solid var(--line); border-top:2px solid var(--brass); padding:4px 16px 12px; }
  .learnings li, .cross li { margin:8px 0; color:var(--ink); }
  .learnings li::marker, .cross li::marker { color:var(--gold); }
  .insights { display:grid; gap:12px; }
  .insight { background:var(--card); border:1px solid var(--line); border-left:4px solid var(--line); padding:14px 16px; }
  .insight.edge { border-left-color:var(--gold); }
  .insight.avoid { border-left-color:var(--bad); }
  .insight.filter { border-left-color:var(--warn); }
  .insight.measure { border-left-color:var(--scout); }
  .insight-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap; }
  .insight h3 { margin:0; font:600 17px/1.25 var(--display); letter-spacing:.04em; text-transform:uppercase; color:var(--ink); }
  .insight h4 { margin:0 0 4px; font:600 11px/1.3 var(--display); letter-spacing:.14em; text-transform:uppercase; color:var(--gold); }
  .insight p { margin:6px 0; }
  .insight-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:10px; }
  .insight ul { margin:4px 0 0 18px; padding:0; }
  .insight li { margin:4px 0; color:var(--ink); font-size:13px; }
  .insight details { margin-top:10px; }
  .insight summary { cursor:pointer; color:var(--gold); font-size:13px; }
  .insight .evidence { border-top:1px solid var(--line); margin-top:10px; padding-top:8px; }
  .insight .evidence p { font-size:13px; }
  .insight .muted { color:var(--muted); }
  .insight-read { background:var(--card-2); border:1px solid var(--line); border-left:4px solid var(--gold); padding:12px 14px; color:var(--ink); margin:0 0 10px; }
  tbody tr:hover td { background:rgba(226,181,88,.05); }
  @media (max-width:800px) { .grid { grid-template-columns:1fr 1fr; } .insight-grid { grid-template-columns:1fr; } h1 { font-size:28px; } header { flex-direction:column; align-items:flex-start; } }
</style>
</head>
<body>
<header>
  <div>
    <div class="kicker">Command post · Pump.fun front</div>
    <h1>Trench Watch</h1>
    <p id="sub">Local ledger of Pump.fun launches. No wallet. No trades.</p>
  </div>
  <div class="hud">
    <div class="chips" id="chips"></div>
    <div class="chips" id="netchips" aria-label="Network"></div>
    <div class="turn-row"><span>Turn <b id="turn">0</b></span><span>Scan every 5 s</span></div>
    <div class="turn-bar"><i></i></div>
  </div>
</header>
<main>
  <div class="devnet-banner" id="netbanner" role="status"></div>
  <section class="mission">
    <div class="kicker">Standing orders</div>
    <p>Record Pump.fun creates as they stream in, read each bonding curve at 5 and 30 minutes, and label which coins are still tradable after 48 hours. The panel reports the ground. It places no orders.</p>
  </section>
  <h2>Territory · ledger totals</h2>
  <section class="grid" id="stats"></section>
  <h2>Strongholds · largest 30-minute curve readings</h2>
  <div id="top"></div>
  <h2>Frontier · newest mints</h2>
  <div id="recent"></div>
  <h2>Fog of war · recent ingest gaps</h2>
  <div id="gaps"></div>
  <h2>Intel · learnings</h2>
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
  <h2>Battle plans · insights</h2>
  <div class="insights" id="insights"></div>
  <h2>Arena · sniper game on real launches</h2>
  <div class="cross" id="arena-box">
    <p>A game on the ledger's real pump.fun launches. Each round shows the 5-minute bonding-curve reading. You snipe for 1 SOL or pass, and the same coin's 30-minute reading settles the trade. Hypothetical fills only. No wallet, no transactions.</p>
    <p id="arena-base">Loading the ledger baseline…</p>
    <p><a href="/arena" target="_blank" rel="noreferrer">Open the arena in its own tab</a> · <a href="/login" target="_blank" rel="noreferrer">Sign in with a wallet</a></p>
    <iframe src="/arena" title="Sniper arena" style="width:100%;height:900px;border:1px solid var(--line);background:#080711;"></iframe>
  </div>
  <h2>Recon · cross-research</h2>
  <div class="cross" id="cross">
    <p>The agent reads this ledger against the papers. It runs inside the recorder, once at startup and every 10 minutes. It does not send trades.</p>
  </div>
  <h2>Dispatch log</h2>
  <div class="log" id="log"></div>
  <p>Readings above about 85 SOL are past the usual Pump.fun graduation level. Treat those as unchecked account parses, not as liquidity you can exit.</p>
</main>
<script>
const fmt = (sec) => sec ? new Date(sec * 1000).toLocaleString() : "—";
const sol = (n) => n == null ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
function chip(text, cls) { return '<span class="chip ' + cls + '">' + text + '</span>'; }
function table(headers, rows) {
  const head = '<tr>' + headers.map(h => '<th>' + h + '</th>').join('') + '</tr>';
  const body = rows.length ? rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + headers.length + '">No contacts yet</td></tr>';
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
let turn = 0;
let lastInsightsKey = "";
async function tick() {
  turn += 1;
  document.getElementById('turn').textContent = String(turn);
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
    [db.tokens, 'Mints kept'],
    [db.spanHours.toFixed(1) + ' h', 'Span of creates'],
    [snapN, 'Curve snapshots'],
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
async function arenaBaseline() {
  const line = document.getElementById('arena-base');
  try {
    const b = ((await (await fetch('/api/arena')).json()).baseline) || {};
    line.textContent = b.launches
      ? 'Ledger baseline: sniping every playable launch (' + b.launches + ') finished above cost ' + Number(b.shareAboveCostPct).toFixed(1) + '% of the time. Median snipe ' + Number(b.medianPnlSol).toFixed(3) + ' SOL, mean ' + Number(b.meanPnlSol).toFixed(3) + ' SOL. Hypothetical, before any priority fee.'
      : 'No playable launches in the ledger yet.';
  } catch (err) {
    line.textContent = 'Arena baseline unavailable: ' + err.message;
  }
}
arenaBaseline();
setInterval(arenaBaseline, 60000);

// Each network is its own badge, named by the genesis hash its RPC reports. A banner appears only when devnet is verified.
function netChip(badge) {
  const cls = badge.tone === 'ok' ? 'net-ok' : badge.tone === 'bad' ? 'net-bad' : 'net-warn';
  const el = document.createElement('span');
  el.className = 'chip ' + cls;
  el.title = badge.detail;
  el.textContent = badge.label;
  return el;
}
async function networkBadges() {
  const chips = document.getElementById('netchips');
  const banner = document.getElementById('netbanner');
  try {
    const net = await (await fetch('/api/network')).json();
    if (net.error) throw new Error(net.error);
    const badges = net.badges || {};
    const game = net.activeNetwork || 'devnet';
    const gameName = game.toUpperCase();
    chips.replaceChildren(netChip(badges.game || { tone: 'warn', label: gameName + ' unknown', detail: '' }), netChip(badges.ledger || { tone: 'warn', label: 'Ledger unknown', detail: '' }));
    const verified = net.game && net.game.network === game;
    if (verified) {
      banner.className = 'devnet-banner show';
      banner.textContent = gameName + ' · the RPC reports the ' + game + ' genesis hash. Test SOL on ' + game + ' has no value. ';
      const note = document.createElement('span');
      note.textContent = 'The pump.fun ledger is still read from mainnet-beta; it is not ' + game + '.';
      banner.appendChild(note);
    } else {
      banner.className = 'devnet-banner bad show';
      banner.textContent = gameName + ' is not verified: ' + ((badges.game && badges.game.detail) || 'unknown network') + '. Do not send transactions until this reads ' + gameName + '.';
    }
  } catch (err) {
    chips.replaceChildren(netChip({ tone: 'warn', label: 'Network status unavailable', detail: err.message }));
    banner.className = 'devnet-banner bad show';
    banner.textContent = 'Network status unavailable: ' + err.message + '. Treat the chain as unverified.';
  }
}
networkBadges();
setInterval(networkBadges, 30000);
tick();
setInterval(tick, 5000);
</script>
</body>
</html>`;
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new ArenaError(413, "request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function sendArenaError(res, err) {
  const status = err instanceof ArenaError ? err.status : err instanceof SyntaxError ? 400 : 500;
  sendJson(res, status, { error: err.message });
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
    if (url.pathname === "/arena" || url.pathname === "/arena/") {
      try {
        const page = fs.readFileSync(path.join(root, "arena", "index.html"));
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(page);
      } catch (err) {
        sendJson(res, 500, { error: "arena page unavailable: " + err.message });
      }
      return;
    }
    if (await handleIdentity(req, res, url, { sendJson, readBody })) return;
    if (url.pathname === "/api/network" && req.method === "GET") {
      try {
        sendJson(res, 200, await networkStatus());
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return;
    }
    if (url.pathname === "/api/arena" && req.method === "GET") {
      try {
        sendJson(res, 200, { assumptions: ASSUMPTIONS, baseline: baselineCached(root) });
      } catch (err) {
        sendArenaError(res, err);
      }
      return;
    }
    if (url.pathname === "/api/arena/start" && req.method === "POST") {
      try {
        await readBody(req);
        sendJson(res, 200, startRun(root));
      } catch (err) {
        sendArenaError(res, err);
      }
      return;
    }
    if (url.pathname === "/api/arena/act" && req.method === "POST") {
      try {
        const body = JSON.parse((await readBody(req)) || "{}");
        sendJson(res, 200, act(String(body.runId || ""), String(body.action || "")));
      } catch (err) {
        sendArenaError(res, err);
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
