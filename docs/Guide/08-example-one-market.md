# 08 — One market, end to end

**In one sentence:** This document follows a single real market —
`POLY-3290754`, the "1,900–2,000" bracket of *"Ethereum price on August 9?"* —
through every stage of PMTrader, from first sighting to the moment its trades
change what the agents do next.

`POLY-3290754` is a real market from the collector's database at the time this
Guide was generated: 123 price snapshots, open, with YES trading around $0.82
(the crowd thinks Ethereum finishing August 9 in the $1,900–2,000 band is
about 82% likely). The specific decisions below are illustrative — your
database will show this market's actual rows.

## Stage 1 — First sighting (data collection)

Some time on August 8, the collector's **wide sweep** (running every 60
seconds against Jupiter's crypto category) sees `POLY-3290754` for the first
time and writes its first row into `market_snapshots`: event question, bracket
title, YES/NO prices, volume, and the `capturedAt` timestamp. From then on, a
new row lands every time the prices change — 123 rows and counting.

If this market's volume ranks it among the top open crypto markets, the
**auto-watchlist** adopts it, and two more streams switch on: the full
order-book ladder every 30 seconds into `orderbook_snapshots`, and its trades
from the global feed into `trades`. Watchlist membership is sticky — it keeps
its slot until it closes.

**See it:** `/data/markets` (search "Ethereum"), then `/data/markets/POLY-3290754`
for the price chart; `/data/orderbooks` if it made the watchlist.
*(Details: [01 — Data collection](01-data-collection.md).)*

## Stage 2 — Features on demand

Nothing else happens *to* the stored rows. But whenever any consumer asks
about this market "as of" some moment T, the Feature Builder computes, from
rows at or before T only: price momentum over 1/5/10 minutes, volatility, the
bid-ask spread and depth imbalance from the latest order book, and whether
recent trades lean buy or sell. This bundle — the `MarketContext` — is the
exact same object every decision-maker below receives.

**See it:** `/data/features` with market id `POLY-3290754` — the latest
feature row also appears on the market's `/data/markets/:id` page.

## Stage 3 — A decision (live paper trading pass)

At 10:15 the paper-trading loop wakes for its minute pass. `POLY-3290754` is
open, in the universe, its data is fresh, and 15 minutes have passed since its
last decision — so it gets a fresh one:

- **Trend Agent** sees YES drifting up over the last 10 minutes with buy-side
  depth: it signals YES, confidence 0.62.
- **Mean Reversion Agent** sees a price already at $0.82 that has run up
  quickly: it signals NO — bet on a pullback — confidence 0.58.
- **Risk Manager** multiplies each confidence by the current adaptive weights
  (Trend ×0.79, Mean Reversion ×0.62 — both discounted because both have been
  losing at practice). Trend's weighted voice now outweighs the contrarian's,
  but the two disagree, so the blended confidence is heavily discounted. Say
  it lands at 0.57 — just over the 0.55 bar, and no risk rule objects
  (liquidity is fine, hours remain before close).

Recommendation: **buy_yes**, sized modestly. Note the counterfactual: with
both weights still at 1.0, the near-equal disagreement would have cancelled to
roughly zero and this would have been a hold. The weights — learned from past
losses — changed this decision. *(Details:
[02 — The agent swarm](02-the-agent-swarm.md),
[05 — Paper trading](05-paper-trading.md).)*

## Stage 4 — The paper fill

The fill model buys YES **at the ask** (the real price a buyer pays), walking
the stored order-book ladder if the top level is too thin, then applies a
10-basis-point slippage haircut. Say $20 of pretend money fills at $0.828. An
open position now exists in MongoDB: entry price, size, timestamps. On every
later pass it is marked to the latest quote — unrealised profit and loss,
best and worst moments so far.

Meanwhile each specialist's **unit book** also acts on its own signal alone:
Trend's book buys YES for its fixed $10 stake; Mean Reversion's buys NO. They
now hold opposite positions in the same market — which is the whole point, as
one of them is about to be proven right.

**See it:** `/data/paper` — the position appears in the open-positions table.

## Stage 5 — The exit, and three graded trades

An hour later Ethereum's price firms and YES reaches $0.87. Suppose the swarm's
next decision flips to reduce/exit (or the market simply closes and forces the
book flat). The position sells **at the bid**, and a **closed trade** is
written: entry $0.828, exit ~$0.86 net of costs, roughly +$0.78 on $20 — a
small win for the swarm's book. Trend's unit book banks a similar win;
Mean Reversion's NO position closes at a loss.

No resolution was needed — the market is still open. Three coherent buy→sell
cycles now exist, each with a net result.

**See it:** `/data/paper` closed-trades table and equity curve tick.

## Stage 6 — Grading (fitness)

The closed specialist trades join the fitness evidence. On the next fitness
pass (button on `/data/fitness`, or automatically in miniature the moment the
live trades closed), Trend's record becomes 43 trades with slightly less bad
P&L; Mean Reversion's becomes 37 trades, slightly worse. Win rates, profit
factors, and drawdowns update; the per-trade table on `/data/fitness` shows
this trade with both specialists' signals and the weights that were in force
at entry. *(Details: [06 — Fitness](06-fitness.md).)*

## Stage 7 — Learning (adaptive weights)

The adaptive layer rescores both agents. One trade barely moves anything —
by design: the score is blended with recent form, dampened by inertia
(60% of the old weight is kept), and clamped to 0.25–1.5. Perhaps Trend nudges
0.79 → 0.80 and Mean Reversion 0.62 → 0.61. The updated table is saved to
MongoDB, and the **very next decision on any market uses it**. If Trend keeps
winning for dozens of trades, its voice steadily recovers toward and past 1.0;
if Mean Reversion keeps losing, it drifts toward the 0.25 floor where it can
flag caution but never steer. *(Details:
[07 — Adaptive weights](07-adaptive-weights.md).)*

## Stage 8 — The wider record

In parallel, and independent of the paper book:

- If `POLY-3290754` were added to `api/src/agents/markets.json`, the hourly
  **scheduler** would run the *full* swarm on it — including the Semantic
  Agent reading the market's wording — and store each run in `runs`
  ([03 — Scheduled runs](03-scheduled-runs.md)).
- When the market closes and resolves, the **labeller** (once enabled) records
  the final YES/NO in `market_labels` and scores any stored runs against it —
  the only route by which the Semantic Agent ever gets graded.
- Any time you like, a **backtest** can replay this market's 123 snapshots
  from the beginning at `/data/backtest`, grading a decision every 15 minutes
  of its recorded life ([04 — Backtesting](04-backtesting.md)).

## The loop, seen from one market

One market's journey touches every mechanism in this Guide: collected minute
by minute, distilled into features, argued over by opposed specialists,
filtered by a Risk Manager using learned trust, practised on with honest
pretend fills, graded as completed trades, and finally fed back into the trust
scores that shape the next market's decision. Multiply by the ~1,450 markets
in the database and repeat every minute — that is PMTrader learning to trade.

*Back to the [overview](00-overview.md).*
