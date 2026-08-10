# 02 — The agent swarm

**In one sentence:** Five specialist "agents" — think of them as a small trading
desk with different personalities — pass a market between them, each adds its
opinion, and a Risk Manager makes the final call on whether to trade.

## What an "agent" is here

An agent is a piece of software with one job and one point of view. Each one
takes the same market information (the snapshot and features from
[data collection](01-data-collection.md)) and produces a **signal**: a
direction (YES, NO, or neutral) plus a **confidence** between 0 and 1 saying
how strongly it believes it.

The five, defined in `api/src/agents/registry.ts`:

| Agent | Personality | What it looks at |
|-------|-------------|------------------|
| **Market Analyst** | The librarian | Fetches data and computes features. Never expresses a trading opinion. |
| **Trend Agent** | The momentum follower | "The price has been moving one way — it will probably keep going." Uses price changes and order-book imbalance. |
| **Mean Reversion Agent** | The contrarian | "The price has moved too far, too fast — it will probably snap back." Deliberately the opposite instinct to Trend. |
| **Semantic Agent** | The reader | The only one that uses an LLM. Reads the market's actual question and resolution rules and reasons about the real world. |
| **Risk Manager** | The adult in the room | Combines everyone's signals, decides position size, and can **veto** the whole trade. Always has the last word. |

Trend and Mean Reversion being opposites is intentional: when they *agree*,
that agreement is informative. When they disagree — which contradictory
instincts often do — their combined confidence collapses toward zero and the
swarm holds. That caution is a design choice, and (as
[fitness](06-fitness.md) later measures) also a reason the quantitative core
rarely trades on its own.

## How a decision is made

The swarm is built with LangGraph Swarm (`api/src/swarm/`). There is no boss
agent: each agent finishes its work and *hands the market to whichever
colleague it thinks should look next* (usually Analyst → Trend → Mean
Reversion → Semantic → Risk Manager, but the routing is the agents' choice).
The LLM decides the routing and reads prose; **every number — each signal's
maths, the blend, the position size, the veto — is plain deterministic
TypeScript**, so the same inputs always give the same figures.

The Risk Manager's blend (`aggregateSignals` in
`api/src/agents/risk-manager/aggregate.ts`) works roughly like this:

1. Each specialist's confidence is multiplied by its **adaptive weight** —
   the learned trust score from [adaptive weights](07-adaptive-weights.md).
2. The weighted opinions are combined into one YES-likelihood, discounted by
   how much the specialists disagreed.
3. If the combined view clears the confidence bar (default 0.55) and no risk
   rule objects (too little liquidity, market about to close, stake limits),
   the recommendation is **buy_yes** or **buy_no** with a dollar size;
   otherwise it is **hold**.

"Hold" is the most common outcome and means "no edge seen", not "error".

## Two ways to run the swarm

- **Full swarm** (needs Ollama configured): LLM routing plus the Semantic
  Agent's real-world reasoning.
- **Deterministic** (no LLM, or `?deterministic=true`): the same specialist
  maths executed in fixed order, minus the Semantic Agent. This mode is what
  [backtesting](04-backtesting.md) and [paper trading](05-paper-trading.md)
  use, because it is repeatable and free.

That split has a consequence worth remembering: the Semantic Agent supplies
most of the swarm's *directional* opinions, but it is exactly the part that
cannot be replayed historically — so it is the hardest to grade.

## Where to see it

- **Front end:** there is no run-by-run swarm browser yet. Swarm results
  surface inside `/data/fitness` (swarm portfolio, per-trade specialist
  signals, "include live swarm runs" toggle) and `/data/backtest` (swarm logic
  vs the crowd favourite).
- **API:** `POST /api/swarm/analysis/:marketId` (run one now),
  `GET /api/runs` (stored runs). The `analyse_run` skill turns a stored run
  into a plain-English report.
- **Code:** `api/src/agents/` (one folder per agent — the pure logic),
  `api/src/swarm/` (the LangGraph wiring), `api/src/agents/prompts.ts`
  (the LLM prompts, versioned separately).

## Where this goes next

A swarm run is a one-off analysis. To generate a steady record of decisions —
the raw material for grading — the swarm is run automatically on a timer over a
watchlist of markets — [next: scheduled runs](03-scheduled-runs.md).
