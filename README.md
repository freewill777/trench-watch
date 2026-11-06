# Trench watch

A local ledger of Pump.fun launches. It records each new mint, snapshots the bonding curve, and labels what is still tradable after 48 hours. It does not hold a wallet and it does not send transactions.

The Windows service and the status panel are described in [SERVICE.md](SERVICE.md). The panel is http://127.0.0.1:8787 while the service is running. The cross-research agent, the insights section, and the structure gallery are on that panel.

## Run

```powershell
cd C:\Users\krs\work\trench-watch
node src/watch.js
```

A short connectivity check that stores three live creates and exits:

```powershell
node src/watch.js --once --limit 3
```

Summary of the database:

```powershell
node src/report.js
```

The database is `data/trench.db`. Outcome rules are in `labels.md`. They stay fixed for the first two days of labels.

## Insights

The recorder reads `LEARNINGS.md`, measures the ledger, and builds profit-oriented cards at startup and every 10 minutes. The cards are stored in `data/insights.db` and shown on the panel under **Insights**. A **Current read** paragraph summarises the sample and says whether any measured profit exists yet. The cards separate documented profit seats, negative edges, loss filters, and items that still need data. They are hypotheses, not buy rules.

To build them by hand:

```powershell
node src/insights.js
```

The latest stored run is also available at http://127.0.0.1:8787/api/insights.

Optional environment variables: `SOLANA_RPC_URL`, `SOLANA_WS_URL`, `RPC_GAP_MS` (default 250).

## What it records

Creates come from the public Solana log stream for program `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`. Failed creates are ignored. Each saved mint keeps its creator, bonding curve, and whether the create transaction also contained a buy.

Snapshots read `real_sol_reserves` at 5 minutes and 30 minutes. Later snapshots run only if the 30-minute reserve was at least 0.5 SOL. Micro-investigations, capped at 30 an hour, run for curves still holding 5 SOL at 30 minutes and for curves that fell from 1 SOL to dust. Labels start once a mint is 48 hours old.

## What it does not do

It does not snipe, copy trades, or score a token as a buy. An `alive` label means the curve still held at least 5 SOL under the rules in `labels.md`. The insights section turns the literature and the ledger into profit hypotheses and loss filters; it does not turn them into a buy rule.
