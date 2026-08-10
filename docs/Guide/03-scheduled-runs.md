# 03 — Scheduled runs (MarketAnalysisScheduler)

**In one sentence:** With one switch flipped, the app runs the full agent swarm
over a hand-picked list of markets every hour and saves each complete analysis
to the database, building up a diary of "what the swarm thought, and when".

## What a "run" is

A **run** is one complete pass of the [agent swarm](02-the-agent-swarm.md)
over one market at one moment: which agents took part, each specialist's
signal and confidence, the Risk Manager's verdict (approved or vetoed, and
why), the final recommendation (`buy_yes` / `buy_no` / `hold`), and the market
snapshot it was based on. Every run is stored in MongoDB (the `runs`
collection) whether it came from the scheduler, a manual API call, or a test.

## What the scheduler does

`MarketAnalysisScheduler` (`api/src/jobs/market-analysis-scheduler.ts`) is a
simple loop:

1. When the API starts with `AGENT_SCHEDULE_ENABLED=true`, it immediately
   analyses every market listed in `api/src/agents/markets.json`.
2. It then repeats on a timer — `AGENT_SCHEDULE_INTERVAL_MS`, default **1
   hour**.
3. Each pass calls the **full swarm** (LLM and Semantic Agent included, when
   Ollama is configured) and saves the resulting run. One market failing is
   logged and skipped; the loop carries on.

Note the watchlist here is *manual* — it is a separate list from the
collector's automatic order-book watchlist. To point the scheduler at the
markets with the richest data, copy ids from `GET /api/collector/status` into
`markets.json`.

## Why scheduled runs matter for learning

The scheduler is the only routine producer of runs that include the
**Semantic Agent** — the specialist that can't be replayed in backtests
because it reads prose with an LLM. Stored scheduled runs are therefore the
only evidence trail from which the Semantic Agent can ever be graded: once a
market in a stored run resolves (see the labeller below), the run's
recommendation can be marked right or wrong after the fact.

Two things have to be true for that grading to happen:

- Runs must exist *while markets are still open* (a prediction recorded after
  the outcome is worthless), which the hourly cadence provides.
- The market's final result must get recorded. That is the **outcome
  labeller**'s job (`api/src/labeller/`, `LABELLER_ENABLED=true`): every 10
  minutes it asks Jupiter for final YES/NO results and scores stored runs
  against them — preferring the "would an exit later have made money?"
  measure, and falling back to "did it pick the winner?" when only a
  resolution is available.

At the time this Guide was generated the labeller was **switched off**, which
is why no stored run has an outcome yet and the Semantic Agent remains
ungraded. Flipping `LABELLER_ENABLED=true` is the single cheapest way to get
more learning signal from runs that already exist.

## Where to see it

- **Front end:** no dedicated runs page yet. Runs appear as forecasting
  evidence in `/data/fitness` when "Include live swarm runs" is ticked.
- **API:** `GET /api/runs?limit=5` (newest runs, full payload),
  `GET /api/runs/:id`, `GET /api/labeller/status`,
  `POST /api/labeller/run` (label right now). The `analyse_run` skill produces
  a readable report of any run.
- **Code:** `api/src/jobs/market-analysis-scheduler.ts`, `api/src/memory/`
  (run storage), `api/src/labeller/`.

## Where this goes next

Scheduled runs answer "what did the swarm think at the time?". The next
question is "would those thoughts have made money?" — which needs history to
be replayed with strict honesty about what was knowable when —
[next: backtesting](04-backtesting.md).
