---
name: guide
description: >-
  Create or refresh the PMTrader Guide — a set of plain-English documents in
  docs/Guide explaining how the app collects data, runs its agent swarm, paper
  trades, backtests, measures fitness, and learns via adaptive weights. Use when
  the user says "update the guide", "refresh the guide", "regenerate the guide",
  or asks for an up-to-date explanation of how the whole app works.
---

# Update the Guide

Regenerate the human-readable Guide in `docs/Guide/`. The reader is the
PMTrader operator: intelligent, but **not** a trader or a quant. The purpose of
the Guide is to let them see whether the app is actually learning to trade
[Jupiter Predict](https://jup.ag/prediction) markets profitably — what is
learning, what is working (even slowly), and what is not.

Finally, concatenate all the guide pages into one single file: 'full-guide.md' for convenience.

## Ground rules

- **Plain language.** No unexplained jargon. When a trading or ML term is
  unavoidable (e.g. "drawdown", "Brier score"), define it in one sentence the
  first time it appears in each document.
- **Truth over flattery.** If a mechanism exists but has no evidence yet (small
  samples, weights stuck at baseline), say so plainly. The operator needs to
  know what is *not* working.
- **Re-derive from code, not from the old Guide.** The app changes quickly.
  Before writing, explore the current source (paths below) and confirm
  intervals, defaults, and behaviour. Never copy stale claims forward.
- **Mention the front end.** Wherever a page in the Angular app shows the thing
  being explained, name the route (e.g. `/data/fitness`) in that section.
- **Each step feeds the next.** Every document ends with a short "Where this
  goes next" paragraph linking to the following document in the chain.
- Keep each document focused; split rather than exceed ~250 lines.

## The documents

Write these files into `docs/Guide/` (create the folder if missing). The order
is chronological through the learning loop — keep it:

| File | Topic | Primary source code |
|------|-------|--------------------|
| `00-overview.md` | How the whole learning loop fits together; reading order; a one-diagram summary | `README.md`, `docs/Analysis.md` |
| `01-data-collection.md` | What is gathered, how often, what the data looks like | `api/src/collector/` + `schedule.json`, `api/src/features/` |
| `02-the-agent-swarm.md` | Who the agents are, how they differ, how a decision is made | `api/src/agents/`, `api/src/swarm/` |
| `03-scheduled-jobs.md` | All background timers — when they run, cadences, parameters (collector, swarm, labeller, paper) | `api/src/index.ts`, `schedule.json`, `shared/watchlist.json`, `jobs/`, `labeller/`, `trading/live-runner.ts`, `.env.example` |
| `04-backtesting.md` | What backtesting is, when/how it is done | `api/src/backtest/` |
| `05-paper-trading.md` | What paper trading is, and how it runs constantly | `api/src/trading/` |
| `06-fitness.md` | What "fitness" means — grading the swarm and each specialist | `api/src/fitness/` |
| `07-adaptive-weights.md` | How weights are updated and used to teach the agents | `api/src/adaptive/` |
| `08-example-one-market.md` | One market followed end-to-end through every stage | All of the above |

`docs/Analysis.md` and the README are useful context, but the code is the
source of truth.

## Workflow

1. **Explore.** Confirm current behaviour of each subsystem: collector stream
   cadences (read the actual `schedule.json`), shared watchlist
   (`api/src/shared/watchlist.json`), agent list (`api/src/agents/registry.ts`),
   all four boot-time jobs and their env knobs, paper-trading cadence, fitness
   metrics, adaptive-weight formula and clamps, and the Angular routes in
   `web/src/app/app.routes.ts`. Parallel explore subagents are effective here.
2. **Write** each document using the template below.
3. **Cross-link.** Overview links to all; each document links to the next.
4. **Check honestly.** If live data is available (`GET
   http://localhost:3000/api/fitness/status`, `/api/paper/status`,
   `/api/data/overview`), reflect the current state of the evidence in
   `00-overview.md` — e.g. "weights are still at baseline because fewer than 30
   trades have completed". If the API is not running, say the Guide describes
   mechanisms, not current results.
5. **Report.** Tell the user what changed since the last Guide version (or that
   this is the first generation).

## Document template

```markdown
# NN — Title

**In one sentence:** <the whole topic in one plain sentence>

## What happens
<numbered or short-paragraph explanation of the mechanism>

## Why it matters for learning to trade
<how this step contributes to the app getting better (or where it can fail)>

## Where to see it
- Front end: <route(s), what the page shows>
- API: <endpoint(s)>
- Code: <folder(s)>

## Where this goes next
<one paragraph: how the output of this step feeds the next document's topic,
with a link like [next: fitness](06-fitness.md)>
```

`08-example-one-market.md` is different: pick one real market id from the
collector data if possible (e.g. via `GET /api/data/markets?limit=5`), otherwise
a realistic invented one, and narrate its journey: first sighting by the
`market_snapshots` stream → snapshots/orderbooks/trades accumulate → features computed on read →
a swarm run or paper decision → a fill in the paper book → the closed trade →
how fitness graded it → how the adaptive weight moved (or did not) → what the
agents will do differently next time. Name the front-end page at every stage.

## Do not

- Do not write for experts or use unexplained maths notation.
- Do not present hoped-for behaviour as achieved results.
- Do not leave any of the nine documents out, even if a subsystem is disabled —
  explain what it *would* do and how to enable it.
- Do not duplicate the README's setup/env-var reference; link to it instead.
