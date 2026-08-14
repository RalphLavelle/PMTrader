# 06 — Fitness

**In one sentence:** Fitness is the grading pass that asks “who made money under fair rules?” and “who forecasted better than a coin flip?” then hands those grades to the weight updater.

## What happens

Fitness is **on demand** (`POST /api/fitness/run`) — not a silent background job. The last report lives in **RAM only**; a restart costs one re-run, not the underlying trades. A successful pass also **refreshes adaptive weights** and writes them to Mongo.

A pass gathers evidence from:

1. **Primary:** coherent paper trades (buy → sell cycles with costs) — live closes plus an offline paper replay.
2. **Secondary:** backtest and live-run stances (forecasting / calibration style metrics). Live swarm runs are the only way to grade Semantic on forecasts.

By default only trades that **had a stored order book at entry** move weights (`FITNESS_REQUIRE_ORDERBOOK`, default **true**). Bookless history measures venue costs, not agent skill. Escape hatch: `?requireOrderbook=false`.

Each specialist also gets its own **$10** unit-stake paper book so Trend and Mean-reversion can be compared fairly. Swarm-owned rows feed the dashboard; **only specialist-owned trades move mixer knobs**.

### Trading numbers (the scoreboard)

For each specialist (and the blended swarm book) it summarises:

- **Realised P&L** — profit and loss after costs (net). Gross is the mid-to-mid reporting number.
- **Win rate** — winning trades ÷ (wins + losses).
- **Profit factor** — total wins ÷ total losses. Below 1 means losses outweigh wins.
- **Drawdown** — how far the running P&L fell from a peak (“worst dip from a high point”).
- **Holding time** and behaviour flags (held too long, losing exits, premature exits).

### Forecasting extras (secondary)

- **Accuracy** — did the stance match the eventual YES/NO resolution?
- **Skill versus the market price** — did the agent beat simply trusting the quoted probability?
- **Brier score** — when available, how well probability-style forecasts matched outcomes. Lower is better (0 is perfect; 0.25 is a coin flip).
- **Overconfidence** — stated confidence minus how often the agent was actually right / profitable.

Good forecaster ≠ good trader. The UI on `/data/fitness` says so for a reason.

### Warnings you should not ignore

- Too few coherent swarm trades → suggested weights stay near 1.0
- Low share of stances with a stored order book → depth-driven inputs were mostly zero
- Semantic agent never took a side → nothing to grade on trading
- Agent states high confidence but rarely profits

Knobs: `FITNESS_MIN_SAMPLE_FOR_WEIGHT` (**30**), `FITNESS_SPECIALIST_STAKE_USD` (**10**), `FITNESS_MAX_RUNS` (**500**).

## Why it matters for learning to trade

Fitness is where honesty shows up. If the scoreboard is built from bookless, incoherent entries, “learning” just encodes venue costs. After the entry gate and stops, the next fair exam is a fitness pass on **new** closed trades — not a re-read of the 12 Aug pre-gate losses.

The report card is not the brain. Closed trades are. The mixer knobs are a summary. You changing a rule in git (entry gate, trail percent, watchlist policy) is a third kind of memory — and so far the one that changed behaviour the most.

## Honest snapshot (checked live)

Last pass **14 Aug 2026, 05:15 UTC** (about 4 seconds of work): **266** completed trades, **309** forecasting stances, **32** markets. Warnings: Semantic never took a side across **103** forecasting stances; Mean-reversion’s average confidence (~37%) far exceeds how often its secondary grades were profitable (~10%).

| Book | Trades | Realised P&L | Win rate | Profit factor | Avg hold |
|---|---:|---:|---:|---:|---:|
| Swarm (blended) | 59 | **−$44.10** | 27% | 0.51 | ~25 hours |
| Trend | 70 | **−$7.20** | 21% | 0.61 | ~24 hours |
| Mean-reversion | 137 | **−$353.45** | 2% | 0.01 | ~10 hours |
| Semantic | 0 | $0 | — | — | — |

Trend’s recent 10 trades are slightly green (**+$5**). Mean-reversion’s recent 10 are **−$26**. Swarm behaviour flags include **43** losing exits. This is not “the classroom is broken”; it is “the agents are still losing, and the grader noticed.”

## Where to see it

- Front end: `/data/fitness`
- API: `GET /api/fitness/status`, `POST /api/fitness/run`, `GET /api/fitness/weights`, `GET /api/fitness/agents/:agent`
- Code: `api/src/fitness/`

## Where this goes next

Fitness numbers become influence multipliers. [Next: adaptive weights](07-adaptive-weights.md).
