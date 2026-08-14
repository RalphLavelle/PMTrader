# 03 — Scheduled jobs (the heartbeat)

**In one sentence:** Four background jobs start when the API boots; together they collect data, analyse markets, label outcomes, and paper-trade — each on its own timer and switch.

## What happens

When the API process starts (`api/src/index.ts`), it tries to start these loops **in this order**:

1. Swarm analysis scheduler
2. Research collector
3. Outcome labeller
4. Live paper trading

Each job has its own **on/off switch** in `.env`. Turning one off does not stop the others. Cadences for collector *streams* live in JSON; most other intervals live in `.env`.

They all share one Jupiter HTTP rate limiter (default about **1100 ms** between calls when an API key is set, ~**54/min**). If everything is aggressive at once, expect queues and occasional 429 retries — that is normal, not a broken job.

### At-a-glance (code defaults; `.env.example` may differ)

| Job | Switch (must be `true`) | How often | Markets / scope | Config home |
|---|---|---|---|---|
| **Collector** | `COLLECTOR_ENABLED` | Per stream (see below) | Broad prices; depth on shared watchlist | `schedule.json` + `.env` categories |
| **Swarm scheduler** | `AGENT_SCHEDULE_ENABLED` | Code default **1 hour**; `.env.example` shows **5 minutes** | Every id in shared watchlist, one after another | `.env` + `watchlist.json` |
| **Labeller** | `LABELLER_ENABLED` | Default **10 minutes** | Up to **5** markets + **100** unscored runs per pass | `.env` |
| **Paper trading** | `PAPER_TRADING_ENABLED` | Default **60 seconds** | Up to `PAPER_TRADING_MAX_MARKETS` (**12**) | `.env` + watchlist |

**Not on a timer:** backtest (`POST /api/backtest/run`) and fitness (`POST /api/fitness/run`). You ask for those reports; they do not wake themselves.

Live check: collector, labeller, and paper are **on**. The language model is in backoff, so the swarm scheduler (if enabled) is running the **deterministic** path until the backoff expires.

### Shared watchlist

Deep work (order books, fast labels, swarm timer, paper preference) uses one file:

[`api/src/shared/watchlist.json`](../../api/src/shared/watchlist.json) → `{ "marketIds": ["POLY-…", …] }`

Currently **12** ids. The collector can rewrite this list when `autoWatchlistSize` is set (sticky until close; fill by quote gate, horizon, and diversity — see [data collection](01-data-collection.md)). The swarm scheduler **reloads the file every batch**, so rotations show up without restarting the API. Markets that already have an open paper lot stay in the paper universe even after they leave the watchlist.

---

## 1. Research collector

**Code:** `api/src/collector/runner.ts`  
**Schedule file:** `api/src/collector/schedule.json`  
**Status:** `GET /api/collector/status`, front end `/data`

- Starts only if `COLLECTOR_ENABLED=true`.
- On start: one **initial fetch** of every *enabled* stream.
- Then a **1-second tick** runs any stream whose interval has elapsed since `lastFetchAt`.

| Stream (= Mongo collection) | Interval | Main parameters |
|---|---|---|
| `market_snapshots` | **every 5 minutes** | `maxPages: 60`, `pageSize: 100`, `openMarketsOnly: true`, `watchlistOnly: false`, `autoWatchlistSize: 12`, `lifecycleFollowUpBatch: 10` |
| `orderbook_snapshots` | **every 30 seconds** | One `GET /orderbook/{id}` per watchlist id |
| `trades` | **every 30 seconds** | Global `GET /trades` (filtered if categories are active) |
| `market_labels` | **every 5 minutes** | Resolution check for watchlist ids only |

**Operator tip:** leave `COLLECTOR_SCHEDULE_PATH` empty to use `api/src/collector/schedule.json`. An old path such as `collector-schedule.json` will break the collector after the rename.

If the JSON `categories` list is empty, `COLLECTOR_CATEGORIES` from `.env` applies. Live: env is `crypto`.

---

## 2. Swarm analysis scheduler

**Code:** `api/src/jobs/market-analysis-scheduler.ts`  
**Status:** stored runs via `/api/runs` (no dedicated UI page)

- Starts only if `AGENT_SCHEDULE_ENABLED=true`.
- Runs a full batch **immediately at startup**, then every `AGENT_SCHEDULE_INTERVAL_MS`.
- Code default is **3,600,000 ms (1 hour)**. `.env.example` currently writes **300,000 (5 minutes)** — check the value you actually run with.
- Uses `setInterval`: a slow batch can overlap the next tick in theory; failures are logged per market and do not stop the rest.

Each finished run is written to Mongo (`runs` by default). That diary is secondary fitness evidence — especially important for the semantic agent, which paper replay cannot grade.

If the model hits a session limit, the batch logs that it is **deterministic until `llmBackingOffUntil`**.

---

## 3. Outcome labeller

**Code:** `api/src/labeller/runner.ts`  
**Status:** `GET /api/labeller/status` (and labelled counts on `/data`)

- Starts only if `LABELLER_ENABLED=true`.
- Self-rescheduling `setTimeout` (no overlap). Default gap **10 minutes**. First pass waits that gap (not immediate at boot).

What one pass does:

1. Find markets that look settled; ask Jupiter for up to **5** and write `market_labels`.
2. Attach outcomes to up to **100** unscored swarm runs (Mongo only — no Jupiter).

The collector’s `market_labels` stream is the high-frequency check for the **watchlist only**. This job is the slower, broader path. Live: **154** labelled / resolved markets.

---

## 4. Live paper trading

**Code:** `api/src/trading/live-runner.ts`  
**Status:** `/data/paper`, `GET /api/paper/status`

- Starts only if `PAPER_TRADING_ENABLED=true`.
- Self-rescheduling `setTimeout`. Default gap **60 seconds**.
- Restores adaptive weights from Mongo on start so a restart does not reset everyone to 1.0.

Details of gates, stops, and fills belong in [paper trading](05-paper-trading.md). The heartbeat facts: 15-minute decision spacing, 15-minute stale skip, max **12** markets, paper-only (never a real Jupiter order).

---

## How the heartbeat fits together

```text
 every ~5m          every 30s           every 10m
 market_snapshots → orderbooks/trades → labeller (outcomes)
        ↓                  ↓
   watchlist.json  ←───────┘
        ↓
 swarm batches (env interval)     every 60s paper loop
        ↓                                ↓
     Mongo runs                  closed paper trades
                ↘              ↙
            fitness / adaptive weights  (on demand)
```

If the collector stops, paper and swarm starve for fresh tips. If the watchlist empties, depth, swarm batches, and preferred paper markets all go quiet together.

## Why it matters for learning to trade

Learning needs a steady stream of **fair** observations and closed paper trades. These jobs are that stream. A missing switch, a wrong `COLLECTOR_SCHEDULE_PATH`, or a watchlist/trading size mismatch looks like “the agents are dumb” when the heartbeat is simply not delivering usable evidence.

## Where to see it

- Front end: `/data` (collector overview), `/data/paper`, `/data/orderbooks`
- API: `GET /api/collector/status`, `GET /api/labeller/status`, `GET /api/paper/status`, `GET /api/runs`
- Code: `api/src/index.ts` (startup), `schedule.json`, `shared/watchlist.json`, `.env` / `.env.example`
- Full env reference: [README](../../README.md)

## Where this goes next

Timers produce history; backtests replay that history offline. [Next: backtesting](04-backtesting.md).
