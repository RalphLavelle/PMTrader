# 07 — Adaptive weights

**In one sentence:** Each specialist carries a trust score — its adaptive
weight — that starts at a neutral 1.0, rises with proven profitable trading,
falls with proven losses, and directly scales how loudly that specialist's
opinion counts in every decision; this is the mechanism by which PMTrader
actually *learns*.

## The idea in one line of maths

When the Risk Manager blends the specialists' signals, each one's voice is:

```
influence = confidence × adaptiveWeight
```

A weight of 1.0 means "listen normally". 0.6 means "this agent has been losing
at practice — take it at 60% volume". 1.3 would mean "this agent has earned
extra say". The agents' internal logic and prompts never change — only how
much the final decision listens to each of them. That keeps the learning
transparent: you can always see exactly who was trusted how much, and why.

## How a weight is computed

After each [fitness](06-fitness.md) pass — and immediately whenever a live
paper trade closes — the adaptive layer (`api/src/adaptive/`) recomputes each
specialist's weight from its completed trades:

1. **A fitness score between −1 and +1** blends four ingredients: win rate
   (with a statistical prior so one lucky trade can't dominate), average
   return on the money staked, consistency (steady small wins beat wild
   swings), and a drawdown penalty. If the agent's stated confidence ran ahead
   of its actual results, an overconfidence penalty is subtracted.
2. **Recent form counts extra.** The last 10 trades get up to half the say, so
   an agent that improves (or deteriorates) is noticed without erasing its
   long-term record.
3. **Evidence controls movement.** With fewer than 30 trades the weight is
   pinned near 1.0 — no verdicts on thin evidence. Full evidence allows the
   fitness score, scaled by a sensitivity of 0.4, to push the weight away
   from baseline.
4. **Inertia smooths the path.** Each new weight is blended 60/40 with the
   previous one, so no single pass can whipsaw the system.
5. **Hard limits.** The final weight is clamped between **0.25 and 1.5** — an
   agent can never be silenced entirely nor handed the megaphone.

The resulting table is saved to MongoDB (`adaptive_weights`), survives
restarts, and is picked up by the live swarm, the backtest replay, and the
paper-trading loop alike. An optional "regime" query can ask how an agent has
done specifically in conditions like the current ones (liquidity, time to
close, price level).

## Is it working? How to tell

This is the single best place to check whether PMTrader is learning:

- **All weights at 1.00** → the machinery is idle: not enough completed
  trades yet, or fitness hasn't run.
- **Weights moving away from 1.00** → learning is happening. Right now Mean
  Reversion sits near **0.62** and Trend near **0.79**, because both lost
  pretend money over 36 and 42 trades respectively. The system has learned
  distrust — a real, evidence-backed lesson, even though the lesson so far is
  "these two strategies aren't winning here yet".
- **A weight rising above 1.00 and staying there** → the milestone to watch
  for: an agent demonstrating a repeatable edge.

Each row in the weights table shows its own justification — trade count,
recent and long-term P&L, drawdown, and a one-line rationale — so a weight is
never a mystery number.

## What it cannot do yet

The weight table currently covers the replayable specialists (Trend, Mean
Reversion). The Semantic Agent has no weight evidence until stored runs
resolve (see [scheduled runs](03-scheduled-runs.md) — the labeller needs to
be on). And weights can only redistribute trust among existing strategies;
if no specialist has an edge, down-weighting everyone leads to holding, not
to profits. Inventing better strategies remains the operator's job — the
weights just make sure a bad strategy can't keep steering.

## Where to see it

- **Front end:** the adaptive weights table appears on both `/data/fitness`
  and `/data/paper` (weight, baseline, samples, evidence level, P&L, drawdown,
  rationale). Expanded trade rows on `/data/fitness` show the weights that
  were in force at entry.
- **API:** `GET /api/fitness/weights` (add
  `?liquidityScore=…&hoursToClose=…&marketYes=…&hadOrderbook=…` for a
  regime-conditioned view).
- **Code:** `api/src/adaptive/` (`score.ts`, `weights.ts`, `store.ts`,
  `regime.ts`); applied in `api/src/agents/risk-manager/aggregate.ts`.

## Where this goes next

The loop is closed: the next decision — live paper pass, scheduled run, or
backtest — blends its signals with these weights, produces new trades, which
produce new grades, which move the weights again. To watch one market travel
the entire circuit, read [next: one market, end to end](08-example-one-market.md).
