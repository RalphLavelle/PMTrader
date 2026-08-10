# 04 — Backtesting

**In one sentence:** Backtesting replays the collected market history through
the agents' own decision logic and asks, for each decision, "if we had bought
then and sold a little later, would we have made money?" — all without waiting
for real time to pass.

## The idea

[Data collection](01-data-collection.md) gives us a time-stamped record of
what every market did. A backtest walks back through that record, stops at
regular decision points (default: every 15 minutes of a market's life), shows
the agents *only what was knowable at that moment*, and records what they
would have decided. Because we also know what happened next, each decision can
be graded immediately.

The honesty rule is absolute: at decision time T the agents get the
as-of-T `MarketContext` — price path, order book, trade flow up to T and not
one second later — and resolution results are never included. Unit tests
(`npm run test:api`) exist specifically to catch "look-ahead" leaks.

## How a decision is graded

Each directional decision is treated as an **intramarket trade**:

1. **Enter** at the price available at decision time.
2. **Hold** for a configured window (default 15 minutes).
3. **Exit** at the price available then.
4. Profit or loss = stake × (exit − entry) / entry, on the recommended side.

The key insight: the market **does not need to have resolved**. A market
graded this way just needs enough snapshots while open for an exit quote to
exist. That means learning doesn't have to wait days for outcomes — the crypto
markets the collector watches produce gradeable decisions within the hour.
"Did the swarm eventually pick the winning side?" is still computed when a
resolution label exists, but as a secondary, after-the-fact check.

## What the backtest can and cannot test

It replays the **deterministic core**: Trend, Mean Reversion, and the Risk
Manager. The Semantic Agent is deliberately excluded — it is an LLM reading
prose, so it is non-repeatable, costly, and the prose it would have read was
not collected. So a backtest measures the *quantitative half* of the swarm,
and (as `docs/Analysis.md` documented) that half is structurally cautious:
two opposite specialists rarely agree, so most decisions come out "hold" and
the veto tally often tells the more interesting story.

## Two flavours

- **Plain backtest** (`/data/backtest`, "Run backtest"): grades every decision
  as an independent enter-hold-exit bet. Good for questions like "what share
  of decisions was profitable?" and "are the confidence numbers honest?"
  (calibration — when it said 70%, did roughly 70% happen?). It also compares
  everything against a dumb benchmark: just buying whichever side the crowd
  already favoured.
- **Paper replay** (same page, "Run paper replay"): runs the same decisions
  through a *stateful* simulated trading book, oldest to newest — one position
  at a time per market, realistic fills at the worse side of the spread, a
  slippage haircut, partial fills when the order book is thin, forced closes
  when a market shuts. This is the strict version: it produces coherent
  buy→sell trade cycles with **net** (after-cost) profit and loss, and those
  closed trades are exactly what [fitness](06-fitness.md) grades.

Backtests run **on demand only** — there is no background loop. Defaults
(50 markets, 15-minute intervals) live in `.env` (`BACKTEST_*` variables) and
can be overridden per run.

## Where to see it

- **Front end:** `/data/backtest` — run controls, headline metric cards,
  swarm-vs-favourite comparison, calibration bands, risk-veto reasons,
  per-market P&L; paper replay adds net/unrealised P&L and per-market fills.
- **API:** `GET /api/backtest/status`, `POST /api/backtest/run`,
  `GET /api/backtest/markets/:marketId`, `POST /api/backtest/paper/run`.
- **Code:** `api/src/backtest/` (engine, replay, paper-engine),
  `api/src/trading/fill-model.ts` (the realistic fill rules).

## Where this goes next

Backtesting practises on the past. The same decision engine, the same fill
model, and the same honesty rules also run continuously against the *live*
market feed, keeping a persistent pretend-money portfolio —
[next: paper trading](05-paper-trading.md).
