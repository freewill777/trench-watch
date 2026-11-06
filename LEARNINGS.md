# Learnings

What published work measures about meme-token behavior, and what this ledger has shown so far. Counts from `data\trench.db` were read on 6 November 2026. They describe the mints this watcher kept, not every Pump.fun launch.

None of this is a buy rule. The studies are mostly descriptive. A few use a short difference-in-differences or an out-of-sample check. Almost none estimate a causal trading edge.

The panel's Insights section reads this file, measures the live ledger, and stores profit-oriented cards in `data\insights.db`. The cards are hypotheses and loss filters, not buy rules either.

## Attention is manufactured, and it does not pay the crowd

Named attention moves the coin being named. Lennart Ante, "How Elon Musk's Twitter activity moves cryptocurrency markets," *Technological Forecasting and Social Change* 186 (2023), finds a 3.58 percent abnormal return within two minutes of a crypto-related Musk tweet and 4.79 percent within the hour. The average effect shows up for Dogecoin tweets. Bitcoin tweets cancel out because some are negative. https://doi.org/10.1016/j.techfore.2022.122112

On Pump.fun the same role is played by bots. Wenzhi Ding, Chen Lin, Yichen Luo, and Jiahua Xu, "Decompose Market Manipulation Strategies: Evidence from On-chain Meme Coin Market," SSRN 5953738 (written 10 September 2025), study 6,000 Pump.fun coins. A wash-trading bot raises trader participation by about 98 percent in the minute it starts, and a comment bot by about 116 percent. Average trader profit does not improve. Creators average about $104 per project, plus about $161 when they use a concealed same-block wallet. Wash bots, used in about 4 percent of projects, line up with about $432 more creator profit. Creators are 19.2 percent of the statistical winners and snipers 16.0 percent, against 4.4 percent of ordinary traders. https://ssrn.com/abstract=5953738

Social links are camouflage more often than they are a project. Jiaxin Chen and coauthors, "From Hype to Collapse: Investigating Rug Pull Scams on Solana," arXiv:2603.24625 (2026), label 76,469 tokens as rugs. Only 19 percent list an X account and 14 percent a website, and most of those links are dead, single-use, or borrowed. https://arxiv.org/abs/2603.24625

## Wash volume and copycats are the product, not a side effect

Alberto Maria Mongardini and Alessandro Mei, "A Midsummer Meme's Dream: Investigating Market Manipulations in the Meme Coin Ecosystem," USENIX Security 2026, follow 34,988 tokens on Ethereum, BNB, Solana, and Base. Of 707 tokens that returned more than 100 percent, 82.8 percent show wash trading, pool-price inflation, or concentrated ownership. In the concentrated half, the top 10 wallets average 78 percent of supply. They tie about $9.3 million of realized losses to more than 17,000 addresses. https://www.usenix.org/conference/usenixsecurity26/presentation/mongardini

Nicolas Szwajcok, Taro Tsuchiya, and coauthors, "Meme Coin Factories: Uncovering Large-Scale Manipulations on pump.fun," ACM CCS 2026, cover all 15.2 million Pump.fun coins from January 2024 to January 2026. A strict wash definition, the same address buying and selling the same amount inside one transaction, is 17 percent of trading transactions in their samples. Those trades cannot be placed through the website. Doubling the wash count is associated with about 19 percent higher graduation odds. That is an association with the platform's graduation flag, not with buyer profit. 1.02 percent of coins graduate. They also count at least 1.5 million copycats, over 10 percent of coins. https://arxiv.org/abs/2609.10246

Sihao Hu and coauthors, "MELT: A Behavioral Trace Dataset for High-Risk Memecoin Launch Detection," arXiv:2602.13480 (2026), look only at coins that migrated. Of the pre-migration transactions, 21.4 percent are same-transaction wash trades, and 98.7 percent of creates include a developer buy. https://arxiv.org/abs/2602.13480

## The people who hold the early inventory take the cash

Fail Gafarov, "Early-Buyer Groups and Fast-Wallet Teams on a Bonding-Curve Launchpad," arXiv:2610.39458 (30 October 2026), uses a complete 88-hour window: 200,443 launches and 15.9 million curve trades. Known early-buyer groups buy earlier than other buyers of the same token and take more cash than a matched placebo. Late buyers' net cash flow is negative. In that window, 53 percent of launches never hold more than 1 SOL on the curve. A follower who buys at the first group signal loses money out of sample in all 32 cost and latency setups. Fast-wallet pools raise the chance of reaching 20 SOL and do not raise graduation. Once the curve's own level is known, the group label adds nothing. https://arxiv.org/abs/2610.39458

His companion paper, "Serial Rug-Pull-Like Exits on Pump.fun," arXiv:2610.41597 (30 October 2026), finds that collapse-and-sell episodes cluster in a few groups, and that most are a single creator wallet. The sign of those groups' cash flow flips when the screen, the group definition, the window, or a 2 percent fee changes. Serial selling is visible. A stable profit number is not. https://arxiv.org/abs/2610.41597

## Rugs on Solana are dumps, not hidden contract code

Ethereum token contracts are custom, so a rug can be a honeypot, a tax, or a mint. Pengcheng Xia and coauthors, "Trade or Trick?," arXiv:2109.00229 (2021), found scam pools in about half of Uniswap listings in their window. https://arxiv.org/abs/2109.00229

Solana tokens share one token program. The issuer cannot hide a unique transfer function. What remains is behavior: freeze authority, pulling liquidity, or selling a bag bought at the create. Chen and coauthors, on 100,063 new Orca, Raydium, and Meteora tokens in the first half of 2025, label 76 percent as rugs, mostly pump-and-dumps. Median life is under an hour. They do not include Pump.fun tokens that never open a public pool. https://arxiv.org/abs/2603.24625

Giulio Marino, Manuel Naviglio, Francesco Tarantelli, and Fabrizio Lillo, "Predicting the success of new crypto-tokens: the Pump.fun case," arXiv:2602.14860 (2026), find that how full the bonding curve already is dominates every other predictor of graduation. Paths with a high share of bot-like flow have lower graduation odds once that level is known. https://arxiv.org/abs/2602.14860

Holder lists hide the same person. MELT links wallets that co-sign, share a funder, or share a bundle. At migration those bundled accounts hold 36.5 percent of supply on average. Merging them raises the top-10 share by 24 points on high-risk coins and 6 points on low-risk coins.

## What this ledger has shown

Read on 6 November 2026 from `data\trench.db`.

- **701 mints** are stored. Create timestamps span about 20 hours, with a long stop in between, so this is not a full day of the firehose.
- **673 of 701** creates, 96 percent, include a buy by the creator in the same transaction. That matches MELT's finding that a developer buy is the normal launch, not a special case.
- **400** creator wallets appear. **107** of them launched more than once. Those repeat creators account for **408** of the 701 mints, about 58 percent. Serial launching is already the bulk of this file.
- Of **590** tokens with a 30-minute curve snapshot, **9** still read at or above 5 SOL. Four of those nine sit at or below the usual graduation band (about 85 SOL): 73, 47, 31, and 6.8 SOL. The other five read 133 to about 19,800 SOL, which is past graduation and should not be treated as real curve liquidity until the account layout is checked.
- **No investigation report has been saved.** The gate has opened. The public RPC has been rejecting the holder lookup, so the buyer and shared-funder layer is still empty.
- **No 48-hour label exists yet.** The oldest mints are not old enough, and the recorder was stopped through part of the window.

## What the papers do not support

- A social link, a busy comment section, or wash volume means the coin has real demand. Those raise the headcount. They do not raise the average entrant's profit.
- Seeing an early-buyer cluster means you are early enough to buy. Following that signal loses in every setup Gafarov reports.
- A top-10 holder share under 30 percent means the supply is distributed. Bundled wallets are invisible in that list, and the list still flags most tokens that actually multiplied.
- Graduation, or a curve that is already filling, is a forecast of a later gain. It is a description of the curve right now. Across the factory paper, only about 1 percent of Pump.fun coins graduate at all.
- A classifier that avoids the next-hour dump is a tradable rule. MELT's result is scored on coins that already migrated, against their own label, inside that same hour.

Lottery-preference and meme-stock papers (Bali, Hirshleifer, Peng, Tang, and Wang, NBER Working Paper 29543) are about stocks or about crypto as a class. They were not used here as evidence on who buys a Pump.fun mint.
