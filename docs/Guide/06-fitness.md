# 06 — Fitness

**In one sentence:** Fitness is the report card — it gathers every completed
practice trade from backtest replays and live paper trading and grades the
swarm and each individual specialist on whether they actually made (pretend)
money, how steadily, and at what risk.

## Trader first, forecaster second

Fitness deliberately separates two different talents:

- **Trading performance (primary).** Graded from *coherent trades* — complete
  buy→sell cycles with an entry price, an exit price, and a net result after
  realistic costs. This is the scoreboard that drives learning.
- **Forecasting performance (secondary).** When a market has a recorded final
  result, fitness also asks "did the agent lean toward the side that won?"
  using measures like the **Brier score** (the average squared gap between the
  stated confidence and what actually happened — 0 is perfect, 0.25 is what
  coin-flipping scores). Interesting context, but it does not move weights.

The order matters because they really are different skills: an agent can
predict final outcomes well but enter and exit at terrible prices, or trade
price swings profitably in markets whose final outcome it never got right.
PMTrader's goal is profitable *trading*, so trading is what counts.

## What gets measured

A fitness pass (`api/src/fitness/engine.ts`) replays history through the paper
book — the swarm's portfolio plus each specialist's fixed-stake ($10) unit
book — and can also fold in live paper trades and stored swarm runs. For the
swarm and each specialist it computes (`trading-metrics.ts`):

| Measure | Plain meaning |
|---------|---------------|
| Realised P&L (net and gross) | Pretend money made or lost on closed trades, after and before simulated costs |
| Win rate | Share of closed trades that made money |
| Profit factor | Total won ÷ total lost — above 1 means winners outweigh losers |
| Max drawdown | The worst peak-to-trough slide of the running total — how painful the bad stretch was |
| Average hold, best/worst trade | Behaviour of the book, not just the total |
| Behaviour tallies | Missed opportunities, exits taken too early, positions held too long |

Plus the secondary forecasting table: directional accuracy, Brier score,
whether the agent beat the market's own price as a predictor, and
**overconfidence** — did it claim more certainty than its results earned?

## Reading the report honestly

Two warnings the report itself makes, worth internalising:

- **Small samples lie.** A 70% win rate over 6 trades is noise. Weights only
  move once an agent has at least 30 completed trades
  (`FITNESS_MIN_SAMPLE_FOR_WEIGHT`), and the report's `warnings` array calls
  out degenerate evidence (e.g. every graded market having resolved the same
  way).
- **The Semantic Agent is barely graded.** It cannot be replayed offline, so
  its evidence can only come from stored live runs whose markets later
  resolve — which requires the labeller to be on. Until then, the agent
  supplying most of the swarm's directional opinion has no meaningful grade.

As of this Guide's generation, fitness has real (if unflattering) results:
Mean Reversion graded 36 trades at about −$188, Trend 42 trades at about
−$48. Both books lost pretend money — clear, sample-backed evidence, exactly
what the next step needs.

## Running it

Fitness runs **on demand** — from the dashboard's "Run fitness" button or
`POST /api/fitness/run`. Each pass rebuilds the report, saves it as the
"last report", and hands the per-specialist trade evidence to the adaptive
layer.

## Where to see it

- **Front end:** `/data/fitness` — adaptive weights table, swarm portfolio,
  equity and drawdown charts, per-market and per-trade tables (expand a trade
  to see each specialist's signal and the weights at entry), specialist
  trading and forecasting tables, per-agent drill-downs, and where the
  evidence came from.
- **API:** `GET /api/fitness/status`, `POST /api/fitness/run`,
  `GET /api/fitness/agents/:agent`, `GET /api/fitness/weights`.
- **Code:** `api/src/fitness/` (engine, trading-metrics, metrics, warnings).

## Where this goes next

A report card only matters if someone acts on it. The adaptive layer converts
each specialist's fitness into a trust weight that directly scales its voice
in the next decision — [next: adaptive weights](07-adaptive-weights.md).
