# 02 — The agent swarm

**In one sentence:** Several specialist agents examine the same market from different angles, then a Risk Manager decides whether a trade is allowed and how large it should be.

## What happens

The swarm is a small team of named agents (see `api/src/agents/registry.ts`). There is no central boss: each agent may hand work to listed teammates. A typical path starts at the Market Analyst and ends at the Risk Manager.

| Agent | Job in plain English | Hands off to |
|---|---|---|
| **Market Analyst** | Pulls / organises market context. Does **not** recommend a trade. | Trend, Semantic |
| **Trend agent** | Looks for continuation — “the move may keep going.” | Mean-reversion, Risk Manager |
| **Mean-reversion agent** | Looks for a snap-back — “the crowd may have overdone it.” | Semantic, Risk Manager |
| **Semantic agent** | Looks at wording, real-world clues, and resolution rules. | Risk Manager, Trend |
| **Risk Manager** | Reviews the combined picture, can **veto**, and sizes the stake. Natural end of a run. | Market Analyst only (if data is missing) |

The final output is a recommendation such as **buy yes**, **buy no**, or **hold**, plus a confidence score and a suggested stake in dollars.

**Hold** means “do nothing — no trade worth taking.”  
**Confidence** is conviction, not a guarantee of being right.

### Two ways a run can execute

- **LLM path** — when `OLLAMA_BASE_URL` and `OLLAMA_MODEL` are set, and the model is not in quota backoff. LangGraph agents choose handoffs. If the model skips a specialist tool, the deterministic maths still fills in.
- **Deterministic path** — no model, `deterministic: true`, or after an LLM **429 / session limit** (`LLM_BACKOFF_MS`, default **1 hour**). Fixed order: Trend → Mean-reversion → Semantic → Risk Manager. Same business logic, no chat.

Without a working model, Semantic **always** returns neutral with confidence 0. Trend and Mean-reversion still run (they are pure maths).

Paper trading and backtests replay **only Trend + Mean-reversion**. Semantic is left out of those classrooms (cost, non-determinism, missing historical rules). Scheduled swarm runs **do** include Semantic when the model is available — that diary is how Semantic can ever be graded.

### How the blend picks a side

When Trend says yes and Mean-reversion says no (they often disagree), the default policy is **`follow_heavier`**: follow the specialist with the higher adaptive weight. An exact tie becomes an honest hold. Set `PAPER_DISAGREEMENT_POLICY=average` to restore the old “blend until confidence collapses” behaviour.

The blended probability must sit at least **3 cents** away from 50/50 (`DECISION_MARGIN = 0.03`) before a side is taken.

Adaptive weights (later in the Guide) change how loudly each specialist counts — but they do **not** change Trend’s or Mean-reversion’s internal scoring constants. Those stay hardcoded.

### How large is the stake?

The Risk Manager sizes from a **fixed ceiling**, not from a wallet:

> stake = `SWARM_MAX_POSITION_USD` (default **$100**) × conviction scale × liquidity score

A barely-approved trade still takes 25% of the ceiling. Under **$5** is vetoed (Jupiter’s order minimum). Paper uses a lower confidence floor (**0.35**) than the real-money / swarm floor (**0.55**) so the classroom can gather trades.

This is **not** “1% of the Solana balance.” That idea is documented as a future bankroll recipe; it is not wired yet.

## Why it matters for learning to trade

Different agents make different mistakes. If one is consistently wrong in liquid markets, the app can turn that agent down. If they all stay at weight 1.0 because there is no fair evidence yet, the swarm is still running on equal guessing, not learned trust.

Muting a weak agent is useful. It does not teach that agent a new trick. Teaching a new trick still means changing code (or, someday, a Learning Agent that does not exist yet).

## Where to see it

- Front end: market detail on `/markets/:marketId` (manual analysis); research views under `/data/markets/:marketId`
- API: `POST /api/swarm/analysis/:marketId`, stored runs under `GET /api/runs`
- Code: `api/src/agents/`, `api/src/swarm/`

## Where this goes next

You can run the swarm by hand, or on a timer over the shared watchlist. [Next: scheduled jobs](03-scheduled-jobs.md) covers that timer and the other heartbeats (collector, labeller, paper).
