# 05 — Paper trading

**In one sentence:** Paper trading is trading with pretend money against real,
live prices — the app runs it continuously in the background, entering and
exiting simulated positions on the markets the collector is watching, with no
real order ever placed.

## Why paper trade when we can backtest?

A [backtest](04-backtesting.md) is a rehearsal against the past; paper
trading is a dress rehearsal against the present. It proves the whole pipeline
works *forward in time* — data arrives, a decision is made on the newest tip
of the data, a simulated fill happens, a position sits open bearing real price
risk (in pretend dollars), and eventually closes. It also generates a steady
drip of completed practice trades, which is the fuel the learning loop burns.

It is **paper only** by design: `api/src/trading/` contains no code path that
submits a real Jupiter order.

## The loop

Switched on with `PAPER_TRADING_ENABLED=true` (the collector should be on
too). The runner (`api/src/trading/live-runner.ts`) then:

1. **Every 60 seconds** wakes up and picks up to **24 open markets** — the
   collector's watchlist plus other tracked open markets, always including any
   market where a paper position is already open.
2. For each, builds the same as-of-now `MarketContext` the backtest would
   build, from the freshest collected data (the "tip").
3. Runs the same deterministic decision engine — Trend, Mean Reversion, Risk
   Manager, with the **current adaptive weights** applied.
4. Rate-limits itself sensibly: a market only gets a fresh decision every
   **15 minutes**, duplicate data is skipped, and if the collector's tip is
   older than 15 minutes the market is marked *stale* and left alone rather
   than traded on old news.
5. Maps the recommendation onto the paper book: enter, add, reduce, exit, or
   hold. Fills are simulated conservatively — buy at the ask, sell at the bid,
   walk the order-book depth, 10 basis points of slippage, partial fills when
   depth is thin. Never at the flattering mid-price.
6. Persists everything to MongoDB (portfolio, every decision, every closed
   trade), so the paper book survives restarts.

Alongside the swarm's book, each specialist also runs a **unit book**: a small
fixed-stake account that trades purely on that one agent's signal. This is
what makes *individual* grading possible — the swarm book tells you how the
team did; the unit books tell you who on the team deserves credit or blame.

## The feedback moment

When a paper position closes, the loop does something none of the earlier
steps do: **it learns immediately**. Closed specialist trades are appended to
the fitness evidence and the [adaptive weights](07-adaptive-weights.md) are
recomputed on the spot, so the very next decision — possibly one minute
later — already uses the updated trust levels. This is the live edge of the
learning loop.

A market does not need to resolve for any of this: a buy at $0.10 exited at
$0.50 is a completed, gradeable trade while the market is still open.

## Reading the dashboard honestly

At `/data/paper` you'll see the last pass summary — e.g. "24 markets
considered, 2 processed, 18 skipped as duplicates, 2 risk vetoes, 0 entries".
A long streak of holds and vetoes is not a malfunction; it means the Risk
Manager is not seeing a trade worth taking (and given both quant agents'
records so far, its caution has been justified). Watch **closed trades** and
the **equity curve** (running total of pretend profit) for the real story.

## Where to see it

- **Front end:** `/data/paper` — portfolio cards, open positions, last-pass
  summary, adaptive weights, equity and drawdown charts, closed trades.
- **API:** `GET /api/paper/status`, `GET /api/paper/trades`,
  `POST /api/paper/run` (force one pass now).
- **Code:** `api/src/trading/` (`live-runner.ts`, `live-engine.ts`,
  `live-specialists.ts`, `fill-model.ts`, `paper.ts`). Logs are prefixed
  `[paper]`.

## Where this goes next

Paper trading produces the raw record — completed practice trades with real
entry and exit prices. Turning that record into a fair grade for the swarm and
for each specialist is the job of [next: fitness](06-fitness.md).
