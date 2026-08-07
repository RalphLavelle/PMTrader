# Scheduling and agent decision-making

How PMTrader decides *when* to run an analysis, and *how* the agents reach a
recommendation once a run starts.

> **Status at time of writing:** the swarm scheduler is switched off, so every
> analysis run so far has been a manual `curl` call.

## The three background jobs

PMTrader has three independent timers, each with its own switch. They are
separate on purpose: one is expensive and calls an LLM, two are cheap and do not.

| Job | Switch | Default cadence | Cost |
|-----|--------|-----------------|------|
| Swarm analysis | `AGENT_SCHEDULE_ENABLED` | 1 hour | Expensive — LLM + several Jupiter calls |
| Research collector | `COLLECTOR_ENABLED` | Per-stream, 5s–5m | Cheap — Jupiter only |
| Outcome labeller | `LABELLER_ENABLED` | 10 minutes | Cheap — a few Jupiter calls, then MongoDB |

The Phase 4 backtest (`api/src/backtest/`) and the Phase 5 fitness report
(`api/src/fitness/`) are deliberately **not** further timers. Neither makes Jupiter
calls, so neither can disturb the shared 60/min budget, and both produce a report a
human asks for rather than something the app acts on. They run only via
`POST /api/backtest/run` and `POST /api/fitness/run`, each guarded by an in-flight
flag so two heavy replays cannot overlap.

The rest of this document is mostly about the first one. The collector is
documented in [`docs/ResearchDataset.md`](./ResearchDataset.md).

## Where the schedule lives

Two files, one timer: `api/src/jobs/market-analysis-scheduler.ts` reads the
watchlist from [`api/src/agents/markets.json`](../api/src/agents/markets.json).

```typescript
export function startMarketAnalysisScheduler(): void {
  if (!config.agentScheduleEnabled) {
    return;
  }

  const marketIds = loadAgentMarketIds();
  if (marketIds.length === 0) {
    console.warn(
      `AGENT_SCHEDULE_ENABLED is true but ${agentMarketsFilePath()} has no ids — scheduler idle.`,
    );
    return;
  }
  // ... runBatch loops over every market id ...
  void runBatch();
  timer = setInterval(() => {
    void runBatch();
  }, config.agentScheduleIntervalMs);
}
```

It is kicked off once at API startup, inside the `app.listen` callback in
`api/src/index.ts`.

## Why it is currently doing nothing

`.env` has **no** `AGENT_SCHEDULE_ENABLED` line (so it defaults to off). The
config reads it like this (`api/src/config.ts`):

```typescript
agentScheduleEnabled: process.env['AGENT_SCHEDULE_ENABLED'] === 'true',
/** Interval between scheduled analysis runs in milliseconds. */
agentScheduleIntervalMs: Number(process.env['AGENT_SCHEDULE_INTERVAL_MS'] ?? 3_600_000),
```

Market ids are **not** in `.env`. Edit `api/src/agents/markets.json` instead:

```json
{
  "ids": ["POLY-1057883", "POLY-1163699"]
}
```

`undefined === 'true'` is `false`, so `startMarketAnalysisScheduler()` returns
early and never sets a timer.

## Turning it on

Add these lines to `.env`, edit the watchlist JSON, then restart the API:

```bash
AGENT_SCHEDULE_ENABLED=true
AGENT_SCHEDULE_INTERVAL_MS=3600000
```

Behaviour once enabled:

| Aspect | Behaviour |
|---|---|
| First run | Immediately at startup (`void runBatch()` before the interval) |
| Repeat | Every `AGENT_SCHEDULE_INTERVAL_MS` — default `3600000` ms = 1 hour |
| Markets | Every id in `api/src/agents/markets.json`, **sequentially** (awaited one at a time) |
| Failures | Logged per market; one failure does not stop the others |
| Mode | Always the swarm path (no `deterministic` flag), so Ollama is used |

It is a plain `setInterval`, not cron — so "every hour" means "one hour after the
last batch *started*", not on the hour.

## How the agents decide what to do

There are two separate decision layers, and only one of them involves the LLM.

### Layer 1 — Routing (LLM decides)

There is **no supervisor**. Each agent is given handoff tools and its prompt tells
it who to pass control to. The graph of who *may* talk to whom is declared in
`api/src/agents/registry.ts`:

```mermaid
graph LR
    MA[Market Analyst] --> TR[Trend]
    MA --> SE[Semantic]
    TR --> MR[Mean Reversion]
    TR --> RM[Risk Manager]
    MR --> SE
    MR --> RM
    SE --> RM
    SE --> TR
    RM -.data missing.-> MA
```

The Market Analyst always starts (`DEFAULT_ACTIVE_AGENT`). The Risk Manager has no
forward edge, which is what makes it the natural end of a run.
`SWARM_RECURSION_LIMIT=40` caps total steps so a handoff loop cannot spin forever.

In practice, Ollama often *skips* these tool calls entirely — that produces the
`model skipped specialist tools — filled 3 signal(s) deterministically` warning in
the console. The app then runs the specialist logic itself.

### Layer 2 — The actual trade decision (pure TypeScript, no LLM)

Once signals exist, the maths is fully deterministic.

**Step 1 — Blend the opinions** (`api/src/agents/risk-manager/aggregate.ts`). Each
signal becomes a Yes-probability, weighted by its own confidence. Disagreement is
priced in directly:

```typescript
const confidence = clamp01(meanConfidence * agreement);
```

Two equally confident, opposing agents produce near-zero final confidence. Neutral
signals contribute no weight at all — which is why all-neutral runs land on 0%.

**Step 2 — Pick a side** only if the blend is off-centre by more than
`DECISION_MARGIN` (0.03) *and* confidence is above zero. Otherwise `hold`.

**Step 3 — Apply veto rules** (`api/src/agents/risk-manager/logic.ts`). Any one of
these blocks the trade:

- Market is not `open`
- Blend came back `hold`
- Confidence below `SWARM_MIN_CONFIDENCE` (0.55)
- Liquidity score below 0.15
- Past close time
- Sized position below `SWARM_MIN_POSITION_USD` ($5)

**Step 4 — Size it.** `maxPositionUsd × convictionScale × liquidityScore`, where
conviction is measured *above* the 0.55 threshold, so a barely-approved trade
stakes small (floor of 25%).

So the LLM shapes *narrative and routing*; money decisions are governed entirely by
explicit, testable rules.

## Notes and known issues

**The design strength:** the LLM never decides whether to risk money. Every veto
carries a human-readable reason, and the rules live in pure functions with injected
limits (`RiskLimits`) so they can be unit-tested without env vars.

**Two things to watch:**

1. **`setInterval` does not wait for the batch to finish.** If a swarm run takes
   longer than the interval (observed: 65 seconds for a single market), batches can
   overlap. A `setTimeout` that reschedules *after* `runBatch()` resolves would be
   safer.

   The Phase 3 labeller in `api/src/labeller/runner.ts` already does exactly that,
   so it is worth copying when this gets fixed:

   ```typescript
   function scheduleNextPass(): void {
     timer = setTimeout(() => {
       void runLabellerPass()
         .catch(/* log */)
         .finally(() => {
           if (scheduled) {
             scheduleNextPass();
           }
         });
     }, config.labellerIntervalMs);
   }
   ```

   Because the next delay is only queued once the current pass settles, overlap is
   structurally impossible rather than merely unlikely.

2. **Stale config in `.env`.** `MEMORY_DRIVER` and `MEMORY_FILE_PATH` are no longer
   read by anything since the MongoDB switch. `MONGODB_URI` also uses `localhost`;
   the code rewrites it to `127.0.0.1` automatically, but writing `127.0.0.1`
   directly avoids the IPv6 connection problem entirely.
