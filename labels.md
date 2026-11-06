# Outcome rules

These rules were fixed before the first label. Do not retune them after looking at which coins went up.

Times are measured from the create transaction's block time. Liquidity is the bonding curve's `real_sol_reserves`. Pump.fun revokes mint and freeze authority on a normal create, so those flags are recorded and almost never separate rugs from survivors.

## When a snapshot is taken

Every mint is snapshotted at 5 minutes and 30 minutes.

Later snapshots (2h, 6h, 24h, 48h) are taken only if the 30-minute reserve was at least 0.5 SOL, or the curve was already marked complete. A mint that never reached 0.5 SOL is labeled from its 30-minute snapshot once it is 48 hours old. That misses a rare revival. It keeps the public RPC inside its rate limit.

## Labels

`alive` — the latest reserve is at least 5 SOL, mint authority is none, and freeze authority is none. If a micro-investigation exists, the largest same-funder cluster among the top holders must also hold under 20% of supply. When no investigation exists, the label is `alive` and `cluster_unchecked` is true.

`rugged` — first matching class:

- `liquidity_pull`: peak reserve was at least 1 SOL, and the latest reserve is under 5% of that peak and under 0.2 SOL.
- `freeze_or_blacklist`: freeze authority is set on a mint that previously had none.
- `mint_inflation`: raw supply grew after the first snapshot.
- `dev_dump`: an investigation shows the creator wallet, or a cluster funded by the same source, sold below half of its earlier share. This class is only applied when that investigation exists.
- `bundle_unwind`: an investigation shows three or more top holders sharing a funder and that cluster's share fell by at least half. This class is only applied when that investigation exists.

`abandoned` — peak reserve never reached 1 SOL, and the latest reserve is under 0.2 SOL.

`faded` — a pool is still there, the latest reserve is under 5 SOL, and neither the rugged nor the abandoned rule matched. This is the bucket between "dead dust" and "still tradable."

`unknown` — the 30-minute snapshot is missing, or a mint that qualified for a 48-hour snapshot has none. Unknown is never treated as safe.

`graduated` is not a survival label. The `complete` flag is stored. A completed curve with no remaining SOL is not marked alive, because the AMM pool was not measured.

## What a micro-investigation is

Opened for at most 30 mints an hour.

- Survivor candidate: 30-minute reserve at least 5 SOL.
- Rug sample: 5-minute reserve at least 1 SOL and 30-minute reserve under 0.2 SOL.

The report records the top holders, how many of those wallets share a funding source, the creator's earlier launches in this database, and whether the creator bought in the create transaction. It does not produce a buy.

## What this ledger is not

A clean mint authority, a burned-looking curve, or an `alive` label is not a prediction that the price will rise. No signal is traded from this database until a separate paper-trade rule is written down before looking at winners.
