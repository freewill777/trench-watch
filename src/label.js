const FIVE_SOL = 5_000_000_000;
const ONE_SOL = 1_000_000_000;
const DUST = 200_000_000;

function num(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

export function labelDue(db) {
  const now = Math.floor(Date.now() / 1000);
  const due = db
    .prepare(
      `SELECT t.mint, t.created_at, t.mint_authority, t.freeze_authority, t.supply_raw
       FROM tokens t
       LEFT JOIN outcomes o ON o.mint = t.mint
       WHERE o.mint IS NULL AND t.created_at IS NOT NULL AND t.created_at <= ?
       LIMIT 200`
    )
    .all(now - 48 * 3600);

  const snaps = db.prepare(
    "SELECT checkpoint, real_sol_lamports, supply_raw, complete, observed_at FROM snapshots WHERE mint = ? ORDER BY observed_at"
  );
  const inv = db.prepare(
    "SELECT cluster_pct, top10_pct FROM investigations WHERE mint = ?"
  );
  const insert = db.prepare(
    `INSERT INTO outcomes(mint, label, rug_class, labeled_at, alive_48h, cluster_unchecked, peak_sol_lamports, last_sol_lamports)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let n = 0;
  for (const token of due) {
    const rows = snaps.all(token.mint);
    if (!rows.some((row) => row.checkpoint === "30m") && !rows.some((row) => row.checkpoint === "48h")) {
      insert.run(token.mint, "unknown", null, now, 0, 1, null, null);
      n += 1;
      continue;
    }
    const peak = rows.reduce((max, row) => Math.max(max, num(row.real_sol_lamports)), 0);
    const last = rows.length ? num(rows[rows.length - 1].real_sol_lamports) : 0;
    const firstSupply = rows.find((row) => row.supply_raw)?.supply_raw;
    const lastSupply = [...rows].reverse().find((row) => row.supply_raw)?.supply_raw;
    const investigation = inv.get(token.mint);

    let label = "faded";
    let rugClass = null;
    if (lastSupply && firstSupply && num(lastSupply) > num(firstSupply)) {
      label = "rugged";
      rugClass = "mint_inflation";
    } else if (token.freeze_authority === 1) {
      label = "rugged";
      rugClass = "freeze_or_blacklist";
    } else if (peak >= ONE_SOL && last <= peak * 0.05 && last < DUST) {
      label = "rugged";
      rugClass = "liquidity_pull";
    } else if (investigation?.cluster_pct != null && investigation.cluster_pct >= 20 && last < DUST) {
      label = "rugged";
      rugClass = "bundle_unwind";
    } else if (peak < ONE_SOL && last < DUST) {
      label = "abandoned";
    } else if (
      last >= FIVE_SOL &&
      token.mint_authority === 0 &&
      token.freeze_authority === 0 &&
      (investigation == null || investigation.cluster_pct == null || investigation.cluster_pct < 20)
    ) {
      label = "alive";
    }

    insert.run(
      token.mint,
      label,
      rugClass,
      now,
      label === "alive" ? 1 : 0,
      investigation ? 0 : 1,
      String(Math.round(peak)),
      String(Math.round(last))
    );
    n += 1;
  }
  return n;
}
