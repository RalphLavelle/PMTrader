# 07 — Adaptive weights

**In one sentence:** Adaptive weights quietly turn each specialist’s volume up or down based on graded paper-trade evidence — slowly, and within hard limits — so better agents count more in the next decision.

## What happens

After a fitness pass (and when live paper closes specialist trades), the adaptive layer publishes a weight table. Think **mixer knobs**, not a trained neural network.

- **Baseline** for everyone: **1.0**
- **Floor / ceiling:** **0.25** … **1.5** (nobody vanishes; nobody dominates)
- **Minimum sample:** about **`FITNESS_MIN_SAMPLE_FOR_WEIGHT` (30)** coherent trades before a weight can leave baseline at full strength; fewer trades shrink the move (“reliability”)
- **Sensitivity:** how hard a ±1 fitness score pushes the weight (default **0.4**)
- **Inertia:** blend toward the previous published weight (default **0.6**) so one bad day does not flip the dial overnight
- **Recent window:** last **10** trades get extra attention in the score blend

In plain English: take the report card, trust it more as the sample grows, move the knob a little, remember yesterday’s knob so you do not yank it.

Weights are inspectable: each agent row includes sample counts, recent vs long-term P&L, drawdown (worst dip from a peak), an evidence level (`none` / `low` / `moderate` / `high`), and a short rationale string.

**Only Trend and Mean-reversion paper trades move the knobs.** Swarm-owned rows feed dashboards. Semantic with **zero** coherent trades stays at **1.0** with `evidenceLevel: none` — that is “no exam papers,” not “this agent is trusted.”

The specialists **do not learn**. Trend still scores with hardcoded constants (`WEIGHT_EXTREMITY = 0.35`, and so on). Fitness never rewrites those files. After 70 Trend trades, Trend is the same formula; only its **volume** in the blend moved.

If Mongo’s adaptive snapshot was cleared (for example after deleting unfair bookless trades), restart the API or run fitness again so memory and disk agree. Until then, an old in-memory table can linger across a cleanup.

You can ask “how did this agent do when the market looked like this?” via `GET /api/fitness/weights` with regime query params. That **does not overwrite** the published table.

### What is stored where

| Thing | Where | Survives restart? |
|---|---|---|
| Closed paper trades | Mongo `paper_closed_trades` | **Yes** — the vault |
| Weight table + trade evidence used to build it | Mongo `adaptive_weights` (`_id: current`) | **Yes** — a cache |
| Last fitness report | API RAM | **No** |
| Agent scoring formulas | Git (`trend/logic.ts`, …) | Yes, but they do not auto-update |
| House rules (entry gate, stops) | Git + `.env` | Yes — human memory |

Wipe the knobs, keep the trades, run fitness → knobs come back. Wipe the trades, keep the knobs → a rumour.

## Why it matters for learning to trade

This is the automatic “teaching” step that actually changes the **next blend**. Collecting data and grading trades only help if aggregation uses those grades.

It is **not** the whole brain. A perfectly tuned mixer still loses money if every specialist is a coin flip. Turning Mean-reversion from 1.0 toward 0.63 mutes a leaking book; it does not stop that agent buying cheap YES. Changing *that* still means a human (or a future Learning Agent) edits a rule.

## Honest snapshot (checked live)

Published **14 Aug 2026, 05:15 UTC**:

| Agent | Weight | Trades | Long-term P&L | Recent 10 P&L | Evidence |
|---|---:|---:|---:|---:|---|
| Trend | **0.903** | 70 | −$7.20 | **+$5.00** | high |
| Mean-reversion | **0.634** | 137 | −$353.45 | −$26.26 | high |
| Semantic | **1.000** | 0 | $0 | $0 | **none** |

Fitness also prints a separate “suggested weight” on the report card (Trend ~0.71, Mean-reversion ~0.52). The **published** knobs sit higher because of **inertia** — they walk, they do not jump. That is working as designed.

The next paper blend will therefore listen to Trend a bit more than Mean-reversion. Semantic still counts at full baseline in any path that includes it, despite having no paper trades.

## Where to see it

- Front end: `/data/fitness` (weights section) and `/data/paper` (status includes adaptive snapshot when present)
- API: `GET /api/fitness/weights`
- Code: `api/src/adaptive/`

## Where this goes next

Put the whole loop on one concrete market id. [Next: example — one market](08-example-one-market.md).
