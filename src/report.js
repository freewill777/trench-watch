import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";
import { lamportsToSol } from "./parse.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = openDb(path.join(root, "data", "trench.db"));

const tokens = db.prepare("SELECT COUNT(*) AS n FROM tokens").get().n;
const newest = db.prepare("SELECT MAX(created_at) AS t FROM tokens").get().t;
const oldest = db.prepare("SELECT MIN(created_at) AS t FROM tokens").get().t;
const snaps = db.prepare("SELECT COUNT(*) AS n FROM snapshots").get().n;
const investigations = db.prepare("SELECT COUNT(*) AS n FROM investigations").get().n;
const gaps = db.prepare("SELECT COUNT(*) AS n FROM ingest_gaps WHERE ended_at IS NULL").get().n;
const outcomes = db.prepare("SELECT label, COUNT(*) AS n FROM outcomes GROUP BY label ORDER BY n DESC").all();
const rugs = db.prepare(
  "SELECT rug_class, COUNT(*) AS n FROM outcomes WHERE label = 'rugged' GROUP BY rug_class ORDER BY n DESC"
).all();
const repeatCreators = db.prepare(
  "SELECT COUNT(*) AS n FROM (SELECT creator FROM tokens WHERE creator IS NOT NULL GROUP BY creator HAVING COUNT(*) > 1)"
).get().n;

const ageHours = oldest && newest ? ((newest - oldest) / 3600).toFixed(2) : "0";
console.log(`tokens ${tokens}`);
console.log(`span_hours ${ageHours}`);
console.log(`newest ${newest ? new Date(newest * 1000).toISOString() : "-"}`);
console.log(`snapshots ${snaps}`);
console.log(`investigations ${investigations}`);
console.log(`open_gaps ${gaps}`);
console.log(`repeat_creators ${repeatCreators}`);
if (!outcomes.length) console.log("outcomes none yet (labels start at 48h)");
for (const row of outcomes) console.log(`outcome ${row.label} ${row.n}`);
for (const row of rugs) console.log(`rug ${row.rug_class || "unclassified"} ${row.n}`);

const sample = db.prepare(
  `SELECT t.symbol, t.mint, s.real_sol_lamports
   FROM tokens t JOIN snapshots s ON s.mint = t.mint AND s.checkpoint = '30m'
   ORDER BY CAST(s.real_sol_lamports AS INTEGER) DESC LIMIT 5`
).all();
for (const row of sample) {
  console.log(`top30m ${row.symbol || "?"} ${lamportsToSol(row.real_sol_lamports)?.toFixed(3)} SOL ${row.mint}`);
}
