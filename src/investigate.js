import fs from "node:fs";
import path from "node:path";

const FIVE_SOL = 5_000_000_000n;
const ONE_SOL = 1_000_000_000n;
const DUST = 200_000_000n;

function big(value) {
  try {
    return BigInt(value || 0);
  } catch {
    return 0n;
  }
}

async function tokenOwners(rpc, mint) {
  const largest = await rpc.call("getTokenLargestAccounts", [mint]);
  const rows = largest?.value || [];
  const accounts = rows.slice(0, 10).map((row) => row.address);
  if (!accounts.length) return [];
  const infos = await rpc.call("getMultipleAccounts", [accounts, { encoding: "base64" }]);
  return rows.slice(0, 10).map((row, i) => {
    const info = infos?.value?.[i];
    let owner = null;
    if (info?.data?.[0]) {
      const buf = Buffer.from(info.data[0], "base64");
      if (buf.length >= 64) owner = encodeBase58(buf.subarray(32, 64));
    }
    return {
      tokenAccount: row.address,
      amount: row.amount,
      uiAmount: row.uiAmount,
      owner,
    };
  });
}

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const digits = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

async function fundingSource(rpc, wallet) {
  let before;
  let oldest = null;
  for (let page = 0; page < 3; page++) {
    const opts = { limit: 1000 };
    if (before) opts.before = before;
    const sigs = await rpc.call("getSignaturesForAddress", [wallet, opts]);
    if (!sigs?.length) break;
    oldest = sigs[sigs.length - 1];
    if (sigs.length < 1000) break;
    before = oldest.signature;
  }
  if (!oldest?.signature) return { funder: null, fundedAt: oldest?.blockTime || null };
  const tx = await rpc.call("getTransaction", [
    oldest.signature,
    { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed" },
  ]);
  let funder = null;
  const instructions = tx?.transaction?.message?.instructions || [];
  for (const ix of instructions) {
    const parsed = ix.parsed;
    if (!parsed || parsed.type !== "transfer") continue;
    if (parsed.info?.destination === wallet) funder = parsed.info.source || null;
  }
  return { funder, fundedAt: oldest.blockTime || tx?.blockTime || null };
}

export async function runInvestigations(db, rpc, root, limitPerHour = 30) {
  const hourAgo = Math.floor(Date.now() / 1000) - 3600;
  const opened = db.prepare("SELECT COUNT(*) AS n FROM investigations WHERE opened_at >= ?").get(hourAgo).n;
  let budget = Math.max(0, limitPerHour - opened);
  if (!budget) return 0;

  const survivors = db
    .prepare(
      `SELECT t.mint, t.creator, t.created_at, s.real_sol_lamports
       FROM tokens t
       JOIN snapshots s ON s.mint = t.mint AND s.checkpoint = '30m'
       LEFT JOIN investigations i ON i.mint = t.mint
       WHERE i.mint IS NULL AND CAST(s.real_sol_lamports AS INTEGER) >= ?
       ORDER BY CAST(s.real_sol_lamports AS INTEGER) DESC
       LIMIT ?`
    )
    .all(Number(FIVE_SOL), budget);

  budget -= survivors.length;
  const rugs =
    budget > 0
      ? db
          .prepare(
            `SELECT t.mint, t.creator, t.created_at, s30.real_sol_lamports
             FROM tokens t
             JOIN snapshots s5 ON s5.mint = t.mint AND s5.checkpoint = '5m'
             JOIN snapshots s30 ON s30.mint = t.mint AND s30.checkpoint = '30m'
             LEFT JOIN investigations i ON i.mint = t.mint
             WHERE i.mint IS NULL
               AND CAST(s5.real_sol_lamports AS INTEGER) >= ?
               AND CAST(s30.real_sol_lamports AS INTEGER) < ?
             ORDER BY CAST(s5.real_sol_lamports AS INTEGER) DESC
             LIMIT ?`
          )
          .all(Number(ONE_SOL), Number(DUST), budget)
      : [];

  const jobs = [
    ...survivors.map((row) => ({ ...row, reason: "survivor_candidate" })),
    ...rugs.map((row) => ({ ...row, reason: "rug_sample" })),
  ];

  const day = new Date().toISOString().slice(0, 10);
  const dir = path.join(root, "data", "reports", day);
  fs.mkdirSync(dir, { recursive: true });
  let done = 0;

  for (const job of jobs) {
    try {
      const holders = await tokenOwners(rpc, job.mint);
      const mintSupply = Number(db.prepare("SELECT supply_raw FROM tokens WHERE mint = ?").get(job.mint)?.supply_raw || 0) / 1e6;
      const top10Pct = mintSupply > 0 ? (holders.reduce((s, r) => s + Number(r.uiAmount || 0), 0) / mintSupply) * 100 : null;

      const owners = [];
      for (const holder of holders) {
        if (!holder.owner) continue;
        const known = db.prepare("SELECT funder, funded_at FROM wallets WHERE address = ?").get(holder.owner);
        let funder = known?.funder || null;
        let fundedAt = known?.funded_at || null;
        if (!known) {
          const found = await fundingSource(rpc, holder.owner);
          funder = found.funder;
          fundedAt = found.fundedAt;
          db.prepare(
            "INSERT INTO wallets(address, funder, funded_at, first_seen) VALUES (?, ?, ?, ?)"
          ).run(holder.owner, funder, fundedAt, Math.floor(Date.now() / 1000));
        }
        owners.push({ ...holder, funder, fundedAt });
      }

      const byFunder = new Map();
      for (const row of owners) {
        if (!row.funder) continue;
        const bucket = byFunder.get(row.funder) || { wallets: [], ui: 0 };
        bucket.wallets.push(row.owner);
        bucket.ui += Number(row.uiAmount || 0);
        byFunder.set(row.funder, bucket);
      }
      let best = null;
      for (const [funder, bucket] of byFunder) {
        if (bucket.wallets.length < 3) continue;
        const pct = mintSupply > 0 ? (bucket.ui / mintSupply) * 100 : null;
        if (!best || bucket.wallets.length > best.wallets.length) {
          best = { funder, wallets: bucket.wallets, pct };
        }
      }
      if (best) {
        db.prepare(
          "INSERT INTO clusters(mint, funding_root, wallet_count, supply_pct, note) VALUES (?, ?, ?, ?, ?)"
        ).run(job.mint, best.funder, best.wallets.length, best.pct, "shared funding source among top holders");
      }

      const prior = db
        .prepare("SELECT COUNT(*) AS n FROM tokens WHERE creator = ? AND created_at < ?")
        .get(job.creator, job.created_at).n;

      const report = {
        mint: job.mint,
        reason: job.reason,
        creator: job.creator,
        creatorPriorLaunches: prior,
        realSolLamports: job.real_sol_lamports,
        top10Pct,
        holders: owners.map((row) => ({
          owner: row.owner,
          uiAmount: row.uiAmount,
          funder: row.funder,
          fundedAt: row.fundedAt,
        })),
        cluster: best
          ? { fundingRoot: best.funder, wallets: best.wallets.length, supplyPct: best.pct }
          : null,
        note: "Shared funder means the oldest observed transfer into the wallet came from the same address. It is a lead, not proof of common control.",
      };
      const reportPath = path.join(dir, `${job.mint}.json`);
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      db.prepare(
        `INSERT INTO investigations(mint, opened_at, reason, report_path, creator_prior_launches, top10_pct, cluster_pct, cluster_wallets)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        job.mint,
        Math.floor(Date.now() / 1000),
        job.reason,
        reportPath,
        prior,
        top10Pct,
        best?.pct ?? null,
        best?.wallets.length ?? 0
      );
      done += 1;
    } catch (err) {
      console.error(`[investigate] ${job.mint} ${err.message}`);
    }
  }
  return done;
}
