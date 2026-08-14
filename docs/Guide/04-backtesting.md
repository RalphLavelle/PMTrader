# 04 — Backtesting

**In one sentence:** Backtesting replays collected market history as if the agents were deciding then, so you can grade behaviour without waiting for brand-new live trades.

## What happens

A backtest is **on demand** — there is no timer and no Jupiter call. It reads Mongo and answers a question about the past. Last results live in RAM until the API restarts; run it again if you need the report back.

Two modes sit on `/data/backtest`:

| Mode | Button | What it grades |
|---|---|---|
| **Fixed-hold backtest** | Run backtest | At each decision point, pretend to enter, wait N minutes, exit at the later quote |
| **Paper replay** | Run paper replay | A chronological simulated book (buy → later sell, with costs) — the same shape live paper uses |

Both walk history at a **decision interval** (default **15 minutes**) so 2,880 near-identical polls are not counted as 2,880 independent tests. Only **Trend** and **Mean-reversion** are replayed. Semantic is excluded here.

Key knobs (env / query overrides; defaults in `api/src/config.ts`):

| Knob | Default | Meaning |
|---|---|---|
| `BACKTEST_MAX_MARKETS` | **50** | How many markets to replay |
| `BACKTEST_DECISION_INTERVAL_MINUTES` | **15** | Spacing between decision points |
| `BACKTEST_EXIT_HOLD_MINUTES` | same as interval if unset | How long the fixed-hold mode waits before looking for an exit quote |
| `BACKTEST_MIN_SNAPSHOTS` | **3** | Skip markets with almost no history |
| `BACKTEST_MAX_SNAPSHOTS_PER_MARKET` | **2000** | Memory cap on long-running markets |
| `requireOrderbook` | **false** on the backtest page; fitness forces **true** | Skip points with no stored depth |

Markets do **not** need a resolution label. They need enough open-path snapshots for an entry and a later exit quote.

Paper replay uses the conservative fill model (buy at the ask, sell at the bid, slippage, optional depth walk). Those closed cycles are what fitness treats as **primary** trading evidence. Fixed-hold backtest is **secondary** forecasting evidence.

## Why it matters for learning to trade

Backtests answer: “Did the signal logic even make sense on past books?” They do **not** by themselves prove paper or live trading will be profitable — especially when historical depth coverage is thin (live: price rows on ~20,000 markets, books on **32**).

A backtest you never feed into fitness does not change a single adaptive weight.

## Where to see it

- Front end: `/data/backtest`
- API: `GET /api/backtest/status`, `POST /api/backtest/run`, `POST /api/backtest/paper/run`
- Code: `api/src/backtest/`

## Where this goes next

The continuous cousin of backtesting is paper trading on live tips. [Next: paper trading](05-paper-trading.md).
