# Trench Watch on Windows

Trench Watch records new Pump.fun token launches into a local database and shows that database in a browser panel. It does not hold a wallet and it does not send trades.

The Windows service is the recorder. It survives closing the terminal. The panel is a page on this PC only.

## Where the harvested data lives

Nothing in the service install deletes or rebuilds the ledger.

| Path | What it is |
|---|---|
| `C:\Users\krs\work\trench-watch\data\trench.db` | The database: mints, curve snapshots, gaps, investigations, and later 48-hour labels. |
| `data\trench.db-wal` | Appears while the recorder is writing. Keep it next to `trench.db` if you copy the file. |
| `data\watch.log` | Recorder log: creates, snapshots, reconnects. |
| `data\insights.db` | Derived insight cards and their history. Deleting it rebuilds it on the next pass. |
| `data\reports\` | One JSON file per micro-investigation, when a holder lookup succeeds. |
| `data\service\` | Logs from the Windows service wrapper, separate from the recorder log. |

The first recorded run, from 2026-11-05, is in `trench.db`. The panel shows the current totals for mints, snapshots, repeat creators, investigations, and labels. Investigations from that run were not saved, because the public RPC rejected the holder lookup before a report could be written.

## The panel

When the service is running, open:

http://127.0.0.1:8787

The page refreshes every 5 seconds. It shows whether the recorder and the service are up, the mint count, the span of the sample, snapshot totals, repeat creators, dev-buys on the create transaction, saved investigations, 48-hour labels, the largest 30-minute curve readings, the newest mints, recent ingest gaps, the insights section, the cross-research agent, and the tail of `watch.log`.

Curve readings above about 85 SOL are marked. Pump.fun curves usually graduate around that level, so a much larger number is an account parse to recheck, not a pool you can sell into.

To view the database while the service is stopped:

```powershell
cd C:\Users\krs\work\trench-watch
node src/panel.js
```

That process only reads the database. Do not run it at the same time as the service. Both want port 8787.

A text summary is still available with `node src/report.js`.

## Install the service

The install script downloads the WinSW 2.12 wrapper into `tools\`, registers a service named **Trench Watch**, and starts it. The service runs `node src\watch.js`, which records launches and serves the panel. Start mode is automatic, with a delayed start, and the wrapper restarts the process 15 seconds after a crash.

Open PowerShell as Administrator:

```powershell
cd C:\Users\krs\work\trench-watch
powershell -ExecutionPolicy Bypass -File .\scripts\install-service.ps1
```

Confirm:

```powershell
Get-Service TrenchWatch
```

`Status` should be `Running`. Then open http://127.0.0.1:8787.

Stop and start later with:

```powershell
Stop-Service TrenchWatch
Start-Service TrenchWatch
```

Remove the service without deleting the database:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-service.ps1
```

Run that from an Administrator shell too.

## Cross-research

The recorder also runs a cross-research pass at startup and every 10 minutes. The pass reads `trench.db` and writes `data\crossref.db`. It does not change the harvested ledger, and it does not send trades.

Each pass lays the live counts against the paper claims. The current rule is the receiving gauge: a ledger rate meets a paper rate only when they share a quantity, a population, and a definition, and the sample is large enough. The earlier rule, the open comparator, weighed any two percentages and weighed a missing rate as zero. That figure stays in the gallery.

Open the gallery from the panel, or directly:

http://127.0.0.1:8787/gallery

`data\crossref.db` is derived. Deleting it only drops the agent's history. The next pass builds it again. Do not delete `data\trench.db`.

A pass can also be run by hand:

```powershell
cd C:\Users\krs\work\trench-watch
node src/crossref.js
```

The figures are rebuilt with `node figures/v1/build.mjs` and `node figures/v2/build.mjs`. Rebuilding reads the ledger and refreshes the gallery index. Old figure files are left in place when a new structure is added beside them.

## Learnings

The economics and measurement papers, and what this database has shown so far, are in [LEARNINGS.md](LEARNINGS.md). The same section is on the panel under Learnings.

## Insights

The recorder reads `LEARNINGS.md` at startup and every 10 minutes, measures `trench.db`, and stores profit-oriented cards in `data\insights.db`. The panel's **Insights** section shows the latest run. A **Current read** line summarises the ledger in one paragraph: sample size, creator-buy share, repeat-creator share, the 30-minute curve distribution, and whether any label or holder data can support a rule yet. Each card names the profit angle, the evidence from `LEARNINGS.md`, the live ledger reading, the risks, and whether the local data is ready, partial, blocked, or thin.

The four card kinds:

- **Profit edge** — where the literature says the cash is taken.
- **Negative edge** — a signal that looks useful but loses money when followed.
- **Loss filter** — a screen that can reject bad inventory before capital is committed.
- **Measure first** — a gap that must be filled before the ledger can support a rule.

The cards are hypotheses and filters, not buy rules. The recorder still holds no wallet and sends no trades.

Build the cards by hand:

```powershell
cd C:\Users\krs\work\trench-watch
node src/insights.js
```

The latest stored run is also available at http://127.0.0.1:8787/api/insights.

## What the recorder does

It listens to the public Solana log stream for Pump.fun creates, stores each successful mint, and reads the bonding curve at 5 minutes and 30 minutes. Later snapshots run only if the 30-minute reserve was at least 0.5 SOL. Outcome rules are fixed in `labels.md` and are applied once a mint is 48 hours old. Those labels require the service to be running when the checkpoint comes due.

The public RPC drops calls. A quiet panel with an old "newest create" means the feed stalled or the service is stopped. The gap table on the panel lists those breaks.

## What this is not

The service does not snipe, copy wallets, or score a mint as a buy. An investigation row appears only after the holder lookup succeeds. A clean 48-hour label means the curve still held at least 5 SOL under the rules in `labels.md`.
