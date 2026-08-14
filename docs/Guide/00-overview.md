# 00 — Overview

**In one sentence:** PMTrader watches Jupiter prediction markets, lets specialist agents argue about each one, paper-trades the decisions, grades the results, and slowly turns each specialist’s volume up or down.

## What happens

Think of the app as a learning loop with six stages:

1. **Collect data** — prices, order books, trades, and eventual outcomes are stored in MongoDB.
2. **Run the agent swarm** — specialists look at a market and produce a recommendation (buy yes, buy no, or hold).
3. **Keep the heartbeat running** — four background jobs (collector, swarm timer, labeller, paper trading) drive the loop on schedules.
4. **Backtest** — replay stored history to see how agents would have done in the past.
5. **Paper trade** — continuously simulate trades on live data without spending real money (also a scheduled job).
6. **Measure fitness and adapt weights** — score who was helpful, then turn the volume up or down on each specialist.

No stage is “done” in isolation. Bad collection produces unfair grades. Unfair grades produce useless weight changes. The Guide walks the loop in that order so you can see where learning might stall.

```text
  Scheduled jobs (collector / swarm / labeller / paper)
                      ↓
              Swarm decisions + paper fills
                      ↓
              Fitness → Adaptive weights
                      ↓
             (next decisions use new weights)
```

The **end goal is not** “three good numbers in the `adaptive_weights` collection.” Those numbers are mixer knobs: how loudly Trend, Mean-Reversion, and Semantic count in the next blend. The specialists themselves do **not** rewrite their formulas. The durable lesson lives in **closed paper trades**; the knobs are a summary. Useful lessons also land in **code** (entry gate, stop-loss) when a human reads a report and changes a rule.

## Why it matters for learning to trade

The goal is evidence that the system chooses better trades over time — and, later, that this can work with real money. If weights never leave their starting value of 1.0, or if paper trades keep entering markets with no order-book data, the app is *not yet* learning from fair evidence — even if the code looks complete.

A mixer that mutes a coin-flip agent is working. That is not the same as the agent getting better at seeing the market.

## Where to see it

- Front end: start at `/data` for the research dataset; `/data/paper` and `/data/fitness` for learning.
- API: `GET /api/health`, `GET /api/data/overview`, `GET /api/paper/status`, `GET /api/fitness/status`
- Code: `README.md`, `api/src/` (collector → agents → trading → fitness → adaptive)

## Reading order

1. [Data collection](01-data-collection.md)
2. [The agent swarm](02-the-agent-swarm.md)
3. [Scheduled jobs](03-scheduled-jobs.md) — when each timer fires and which knobs it uses
4. [Backtesting](04-backtesting.md)
5. [Paper trading](05-paper-trading.md)
6. [Fitness](06-fitness.md)
7. [Adaptive weights](07-adaptive-weights.md)
8. [Example: one market](08-example-one-market.md)

A single concatenated copy of all nine pages: [full-guide.md](full-guide.md).

## Honest snapshot (checked live, 14 Aug 2026 ~05:55 UTC)

The API **is running**. Collector, labeller, and paper trading are **on**. The language model is in a **1-hour backoff** after a usage limit, so scheduled swarm batches currently take the deterministic path (same specialist maths, no LLM chat).

| Store | What is in it |
|---|---|
| Price snapshots | **~293,000** rows, **~20,000** distinct markets, since 8 Aug |
| Order books | **~27,500** rows on only **32** markets (depth is the expensive VIP camera) |
| Resolution labels | **154** settled markets |
| Shared watchlist | **12** ids in `api/src/shared/watchlist.json` |

Paper loop (60s, 15-minute decisions, max 12 markets): **12 open lots**, realised **−$2.32**, unrealised **−$0.93**. The latest pass considered 13 markets and skipped all 13 as **duplicate** observations — alive, but waiting for a new collector tip or a due decision. Ticket sizes are still a fraction of a **$100** ceiling (open lots from about **$7** to **$71**), not 1% of a bankroll.

Last fitness pass (05:15 UTC): **266** coherent trades, **309** forecasting stances, **32** markets.

| Specialist | Coherent trades | Realised P&L | Win rate | Published weight |
|---|---:|---:|---:|---:|
| Trend | 70 | **−$7.20** | 21% | **0.90** |
| Mean-reversion | 137 | **−$353.45** | 2% | **0.63** |
| Semantic | 0 | $0 | — | **1.00** (no exam papers — not a gold star) |

Swarm blended book: **59** trades, **−$44.10**, 27% wins. Mean-reversion’s recent live closes are often **trailing-stop** cuts after ~65 minutes (just after the 60-minute grace) on cheap YES tickets that never went green. The mixer is correctly turning that agent down. The *formula* that buys the cheap side has not changed.

Weights start at **1.0** and can only move between **0.25** and **1.5**. Trend’s recent 10 trades are slightly green (**+$5**), which is why its knob sits higher than Mean-reversion’s despite both being net losers overall.

## Where this goes next

Everything starts with what gets stored. [Next: data collection](01-data-collection.md) explains the four streams, their cadences, and why prices are gathered broadly while order books stay narrow.
