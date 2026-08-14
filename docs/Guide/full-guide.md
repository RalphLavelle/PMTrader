# PMTrader Guide (full)

This file is a convenience concatenation of every page in `docs/Guide/`, in reading order. For day-to-day browsing, start at [00-overview.md](00-overview.md). Regenerated with the Guide skill.

---

# 00 — Overview

**In one sentence:** PMTrader watches Jupiter prediction markets, lets specialist agents argue about each one, paper-trades the decisions, grades the results, and slowly turns each specialist’s volume up or down.

## What happens

Think of the app as a learning loop with six stages:

1. **Collect data** — prices, order books, trades, and eventual outcomes are stored in MongoDB.
2. **Run the agent swarm** — specialists look at a market and produce a recommendation (buy yes, buy no, or hold).
3. **Keep the heartbeat running** — four background jobs (collector, swarm timer, labeller, paper trading) drive the loop on schedules.
4. **Backtest** — replay stored history to see how agents would have done in the past.
5. **Paper trade** — continuously simulate trades on live data without spending real money (also a scheduled job).
6. **Measure fitness and adapt weights** — score who was helpful, then turn the volume up or down on each specialist.

No stage is “done” in isolation. Bad collection produces unfair grades. Unfair grades produce useless weight changes. The Guide walks the loop in that order so you can see where learning might stall.

```text
  Scheduled jobs (collector / swarm / labeller / paper)
                      ↓
              Swarm decisions + paper fills
                      ↓
              Fitness → Adaptive weights
                      ↓
             (next decisions use new weights)
```

The **end goal is not** “three good numbers in the `adaptive_weights` collection.” Those numbers are mixer knobs: how loudly Trend, Mean-Reversion, and Semantic count in the next blend. The specialists themselves do **not** rewrite their formulas. The durable lesson lives in **closed paper trades**; the knobs are a summary. Useful lessons also land in **code** (entry gate, stop-loss) when a human reads a report and changes a rule.

## Why it matters for learning to trade

The goal is evidence that the system chooses better trades over time — and, later, that this can work with real money. If weights never leave their starting value of 1.0, or if paper trades keep entering markets with no order-book data, the app is *not yet* learning from fair evidence — even if the code looks complete.

A mixer that mutes a coin-flip agent is working. That is not the same as the agent getting better at seeing the market.

## Where to see it

- Front end: start at `/data` for the research dataset; `/data/paper` and `/data/fitness` for learning.
- API: `GET /api/health`, `GET /api/data/overview`, `GET /api/paper/status`, `GET /api/fitness/status`
- Code: `README.md`, `api/src/` (collector → agents → trading → fitness → adaptive)

## Reading order

1. [Data collection](01-data-collection.md)
2. [The agent swarm](02-the-agent-swarm.md)
3. [Scheduled jobs](03-scheduled-jobs.md) — when each timer fires and which knobs it uses
4. [Backtesting](04-backtesting.md)
5. [Paper trading](05-paper-trading.md)
6. [Fitness](06-fitness.md)
7. [Adaptive weights](07-adaptive-weights.md)
8. [Example: one market](08-example-one-market.md)

A single concatenated copy of all nine pages: [full-guide.md](full-guide.md).

## Honest snapshot (checked live, 14 Aug 2026 ~05:55 UTC)

The API **is running**. Collector, labeller, and paper trading are **on**. The language model is in a **1-hour backoff** after a usage limit, so scheduled swarm batches currently take the deterministic path (same specialist maths, no LLM chat).

| Store | What is in it |
|---|---|
| Price snapshots | **~293,000** rows, **~20,000** distinct markets, since 8 Aug |
| Order books | **~27,500** rows on only **32** markets (depth is the expensive VIP camera) |
| Resolution labels | **154** settled markets |
| Shared watchlist | **12** ids in `api/src/shared/watchlist.json` |

Paper loop (60s, 15-minute decisions, max 12 markets): **12 open lots**, realised **−$2.32**, unrealised **−$0.93**. The latest pass considered 13 markets and skipped all 13 as **duplicate** observations — alive, but waiting for a new collector tip or a due decision. Ticket sizes are still a fraction of a **$100** ceiling (open lots from about **$7** to **$71**), not 1% of a bankroll.

Last fitness pass (05:15 UTC): **266** coherent trades, **309** forecasting stances, **32** markets.

| Specialist | Coherent trades | Realised P&L | Win rate | Published weight |
|---|---:|---:|---:|---:|
| Trend | 70 | **−$7.20** | 21% | **0.90** |
| Mean-reversion | 137 | **−$353.45** | 2% | **0.63** |
| Semantic | 0 | $0 | — | **1.00** (no exam papers — not a gold star) |

Swarm blended book: **59** trades, **−$44.10**, 27% wins. Mean-reversion’s recent live closes are often **trailing-stop** cuts after ~65 minutes (just after the 60-minute grace) on cheap YES tickets that never went green. The mixer is correctly turning that agent down. The *formula* that buys the cheap side has not changed.

Weights start at **1.0** and can only move between **0.25** and **1.5**. Trend’s recent 10 trades are slightly green (**+$5**), which is why its knob sits higher than Mean-reversion’s despite both being net losers overall.

## Where this goes next

Everything starts with what gets stored. [Next: data collection](01-data-collection.md) explains the four streams, their cadences, and why prices are gathered broadly while order books stay narrow.

---

# 01 — Data collection

**In one sentence:** The collector repeatedly asks Jupiter for market data and stores it in MongoDB so agents and paper trading can look at history instead of guessing from a single quote.

## What happens

When `COLLECTOR_ENABLED=true`, the API starts a background job that:

1. Runs each enabled stream once (a smoke test).
2. Then follows intervals in [`api/src/collector/schedule.json`](../../api/src/collector/schedule.json).

**Important naming rule:** each stream key is the **same name as the MongoDB collection it writes to**. That avoids “code says X, database says Y” confusion.

| Stream / collection | What it stores | Cadence in the checked-in schedule |
|---|---|---|
| `market_snapshots` | Price quotes, volume, status for many markets | every **5 minutes** |
| `orderbook_snapshots` | Depth ladders for the short watchlist | every **30 seconds** |
| `trades` | Recent fills from the global trade feed | every **30 seconds** |
| `market_labels` | Resolution outcomes for watched markets | every **5 minutes** |

A **1-second tick** re-reads the JSON and runs any stream whose `every` interval has elapsed. Top-level `"enabled": false` in the JSON parks the whole collector without changing `.env`.

### Broad prices, narrow depth

`market_snapshots` pages Jupiter `/events` (checked-in: up to **60 pages × 100** events, open markets only). That is relatively cheap because each page returns many markets.

Order books are expensive: one HTTP call **per market**. So `orderbook_snapshots` and the fast label checks only cover ids in [`api/src/shared/watchlist.json`](../../api/src/shared/watchlist.json).

After every successful price sweep, `autoWatchlistSize` (currently **12**) may rewrite that file. Stickiness still wins: an open market is not dropped just because volume dipped. Closed or vanished ids leave immediately. Empty slots refill using learning-oriented tests, not “loudest volume wins”:

- **Quote gate** — buy-yes + buy-no must be ≤ **`PAPER_MAX_ENTRY_QUOTE_SUM`** (default **1.05**), the same rule as the paper entry gate.
- **Horizon** — prefer markets that close in **6 hours–14 days**. At most **2** seats for markets more than **30 days** out.
- **Diversity** — at most **2** ids that share the same event question (so one Bitcoin bucket does not eat the whole camera).
- **Lottery filter** — YES prices below **$0.08** or above **$0.92** are skipped when filling.
- **Soft-evict** — a sticky dud needs **6** consecutive failing sweeps, and at most **2** evictions per sweep, so the camera does not empty all at once.

The swarm scheduler and paper trader read that **same file**. Neither job owns the other.

### Features are not stored

Raw rows live in Mongo. Features (spreads, recent change, liquidity score, and so on) are computed later when something needs them (`api/src/features/`). Feature definitions can improve without re-collecting history.

**Liquidity score** (0 = untradeable, 1 = deep) is an agent/paper number, not a column on the stored snapshot. **Implied yes** on the research pages is `buyYes / (buyYes + buyNo)`.

### Categories

`market_snapshots.options.categories` in the schedule **overrides** `COLLECTOR_CATEGORIES` in `.env` when the JSON list is non-empty. An empty JSON list means “do not override,” so the env value applies. Live check: schedule categories are `[]` and env is `crypto`, so the collector is filtering to crypto even though the JSON looks like “everything.”

## Why it matters for learning to trade

Paper trading and fitness can only grade what was actually observed. If a trade enters a market with no stored order book, costs are guessed and the learning signal is noisy. The intended funnel is:

**look at many markets → watch depth on a few → trade only where depth exists.**

Live: ~**20,000** markets have price rows; only **32** have ever had an order book stored. That gap is why the watchlist exists.

## Where to see it

- Front end: `/data`, `/data/markets`, `/data/orderbooks`, `/data/trades`, `/data/features`
- API: `GET /api/collector/status`, `GET /api/data/overview`
- Code: `api/src/collector/` (especially `schedule.json`, `streams.ts`, `watchlist-refresh.ts`, `runner.ts`)

## Where this goes next

Collected snapshots become the inputs specialists reason about. [Next: the agent swarm](02-the-agent-swarm.md) explains who those specialists are and how a recommendation is formed.

---

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

---

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

---

# 04 — Backtesting

**In one sentence:** Backtesting replays collected market history as if the agents were deciding then, so you can grade behaviour without waiting for brand-new live trades.

## What happens

A backtest is **on demand** — there is no timer and no Jupiter call. It reads Mongo and answers a question about the past. Last results live in RAM until the API restarts; run it again if you need the report back.

Two modes sit on `/data/backtest`:

| Mode | Button | What it grades |
|---|---|---|
| **Fixed-hold backtest** | Run backtest | At each decision point, pretend to enter, wait N minutes, exit at the later quote |
| **Paper replay** | Run paper replay | A chronological simulated book (buy → later sell, with costs) — the same shape live paper uses |

Both walk history at a **decision interval** (default **15 minutes**) so 2,880 near-identical polls are not counted as 2,880 independent tests. Only **Trend** and **Mean-reversion** are replayed. Semantic is excluded here.

Key knobs (env / query overrides; defaults in `api/src/config.ts`):

| Knob | Default | Meaning |
|---|---|---|
| `BACKTEST_MAX_MARKETS` | **50** | How many markets to replay |
| `BACKTEST_DECISION_INTERVAL_MINUTES` | **15** | Spacing between decision points |
| `BACKTEST_EXIT_HOLD_MINUTES` | same as interval if unset | How long the fixed-hold mode waits before looking for an exit quote |
| `BACKTEST_MIN_SNAPSHOTS` | **3** | Skip markets with almost no history |
| `BACKTEST_MAX_SNAPSHOTS_PER_MARKET` | **2000** | Memory cap on long-running markets |
| `requireOrderbook` | **false** on the backtest page; fitness forces **true** | Skip points with no stored depth |

Markets do **not** need a resolution label. They need enough open-path snapshots for an entry and a later exit quote.

Paper replay uses the conservative fill model (buy at the ask, sell at the bid, slippage, optional depth walk). Those closed cycles are what fitness treats as **primary** trading evidence. Fixed-hold backtest is **secondary** forecasting evidence.

## Why it matters for learning to trade

Backtests answer: “Did the signal logic even make sense on past books?” They do **not** by themselves prove paper or live trading will be profitable — especially when historical depth coverage is thin (live: price rows on ~20,000 markets, books on **32**).

A backtest you never feed into fitness does not change a single adaptive weight.

## Where to see it

- Front end: `/data/backtest`
- API: `GET /api/backtest/status`, `POST /api/backtest/run`, `POST /api/backtest/paper/run`
- Code: `api/src/backtest/`

## Where this goes next

The continuous cousin of backtesting is paper trading on live tips. [Next: paper trading](05-paper-trading.md).

---

# 05 — Paper trading

**In one sentence:** Paper trading is a continuous simulated book on live collected data — no real Jupiter orders — so the agents can earn or lose money under realistic cost and stop-loss rules, and those closed trades become the fitness scoreboard.

## What happens

When `PAPER_TRADING_ENABLED=true`, a loop wakes about every **`PAPER_TRADING_INTERVAL_MS`** (default **60 seconds**). It is **paper only**: it never submits a real order.

Each pass:

1. Chooses a universe of markets (prefer the shared watchlist of **12** ids; also keep any market that already has an open paper position).
2. Builds context from the latest snapshots (and order books when present).
3. Runs specialist logic + swarm-style aggregation (with adaptive weights when published). Semantic is **not** in this replay.
4. Applies an **entry gate** before opening a position.
5. Simulates a fill with a conservative model (buy at the ask, sell at the bid; extra slippage; walk the book when depth exists).
6. While a position is open, applies an **exit gate** (stop-loss / trailing stop / time-stop) in addition to the older “flip or market close” rules.

There are **two books** per market:

| Book | Who | Stake | Confidence floor |
|---|---|---|---|
| **Swarm book** | Blended Trend + Mean-reversion | Risk Manager size, ceiling **$100** | **0.35** (paper learning floor) |
| **Specialist books** | Trend and Mean-reversion each get their own | Always **$10** (`FITNESS_SPECIALIST_STAKE_USD`) | **0.55** (swarm floor) |

The $10 books are a **ruler** so fitness can compare the two specialists fairly. Keep them at $10 even if you later change the swarm ceiling.

### Entry gate (shared with fitness)

Before a new paper entry:

- Reject if buy-yes + buy-no quote sum exceeds **`PAPER_MAX_ENTRY_QUOTE_SUM`** (default **1.05**). In a healthy binary market those two prices add up to about **$1.00**; anything much higher is spread paid to a hypothetical market maker.
- Reject if liquidity score is below **`PAPER_MIN_ENTRY_LIQUIDITY`** (default **0.05**).

Paper’s **0.35** confidence floor is deliberately lower than the live swarm floor (**0.55**) so the system can gather learning trades.

### Exit gate (the seatbelt)

A **stop-loss** is a safety rule on an open position: “get out even if the agents still like the story.” It is **not** a fourth agent. The recipe is chosen **at fill** from the entry price, then **frozen on that lot**. Changing `.env` later does not rewrite a trade that is already open.

| Fill price | Typical trade | Seatbelt |
|---|---|---|
| **$0.50 or cheaper** | Cheap side (often mean-reversion) | **Trailing stop** — floor starts below entry, then may only move *up* with the best bid |
| **Above $0.50** | Expensive side (often trend on the favourite) | **Fixed −30%** — that floor never moves |

Worked numbers (defaults: `PAPER_STOP_LOSS_PCT=0.30`, `PAPER_TRAIL_PCT=0.40`, `PAPER_TRAIL_GRACE_MINUTES=60`):

- **Fixed.** Buy YES at **$0.80** with $10. Floor = $0.80 × 0.70 = **$0.56**. If the sell bid prints $0.56, the engine sells. Loss is capped near **−$3**.
- **Trailing.** Buy YES at **$0.40** with $10. Trail distance = 40% of $0.40 = **$0.16**, so the floor starts at **$0.24**. The trail **cannot fire for the first 60 minutes**. After that, if the bid runs to **$0.60**, the floor ratchets to **$0.44**. A pullback to $0.44 sells. The floor never walks back down.

There is also a **time-stop**: if the lot is still not in profit after **`PAPER_TIME_STOP_MINUTES`** (default **1440** = 24 hours), it sells. A winner is left alone so the trail or a swarm flip can finish the job.

Exit order, in plain English:

1. Market settling / closed → dump the position (`exitReason: market_close`).
2. Seatbelt hit → sell, even if the swarm still likes the side. This can fire **between** the 15-minute decision chats (`stop_loss`, `trailing_stop`, or `time_stop`).
3. Approved **flip** → sell (`flip`).
4. Otherwise hold.

Lots opened before stops existed have no frozen recipe and keep the old flip-or-settle exit until they close. Set `PAPER_STOP_ENABLED=false` only if you need that old behaviour back. Defaults are on.

Honest warning from today’s closed trades: several Mean-reversion **$10** cheap-YES lots hit `trailing_stop` at about **65 minutes** — just after grace — with maximum favourable excursion of **$0**. The seatbelt is firing; on that sample it is also **chopping** trades that never got room to work.

### Matching collection to trading

Keep **`PAPER_TRADING_MAX_MARKETS`** equal to `autoWatchlistSize` (**12**). If trading considers more markets than you collect books for, new trades will again show `hadOrderbook: false`.

Decisions on the same market are spaced by **15 minutes**. Mark-to-market (and ratcheting a trailing floor) still runs when a new observation arrives. If the latest collector tip is older than **15 minutes**, new entries and flips are skipped; a stop that already hit can still sell.

### Fills (why net P&L is harsher than “the mid moved”)

- **Gross** P&L uses the midpoint of bid and ask — a reporting number, never an execution price.
- **Net** P&L is what the simulated book actually did: buy at the ask, sell at the bid, plus **`PAPER_SLIPPAGE_BPS`** (default **10**) and fees (default **0**). When no order-book ladder exists at that moment, size is capped at **`PAPER_NO_BOOK_DEPTH_USD`** (default **$25**).

## Why it matters for learning to trade

This is the main *trading* classroom. Fitness and adaptive weights prefer coherent closed paper trades (a buy, then a later sell, with costs). Empty books, or long stretches with zero entries, mean the agents are not generating new evidence yet — which can be healthy (gates working) or stuck (universe too quiet, or stale data). Check rejects, vetoes, and stale/duplicate skips on the status endpoint before loosening gates.

Closed trades are the **vault**. Adaptive weights are a **summary** of those trades. Wipe the knobs, keep the trades, run fitness — the knobs come back.

## Honest snapshot (checked live)

The paper loop **is running** (60s, 15-minute decisions, max 12 markets). A recent pass considered **13** markets (watchlist plus an extra open lot) and skipped all **13** as **duplicate** observations.

**12** swarm lots are open. Realised **−$2.32**, unrealised **−$0.93**. Sizes run from about **$7** to **$71** (fraction of the $100 ceiling × conviction × liquidity). One cheap-side lot (`POLY-3542084-1` YES at ~$0.46, **$70.50**) is **+$12.17** unrealised; its pair on the “Up” contract is **−$15.17**.

Recent specialist closes on `/api/paper/trades` already store **`exitReason: trailing_stop`**. The `/data/paper` table may still hide that column; the API and Mongo do not.

## Where to see it

- Front end: `/data/paper` — loop status, open positions, closed trades, equity chart, current adaptive weights
- API: `GET /api/paper/status`, `GET /api/paper/trades`, `POST /api/paper/run`
- Code: `api/src/trading/` (`live-engine.ts`, `entry-gate.ts`, `exit-gate.ts`, `fill-model.ts`, `live-store.ts`)
- Knobs: [`.env.example`](../../.env.example) (full list also in the [README](../../README.md))

## Where this goes next

Closed paper trades — including *why* they closed — become a report card. [Next: fitness](06-fitness.md).

---

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

---

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

---

# 08 — Example: one market end-to-end

**In one sentence:** Follow a single market from first price snapshot through depth, a paper decision, a closed trade, fitness, and a weight change — so the learning loop feels concrete.

This walkthrough uses a **real watchlist id** from the live API on 14 Aug 2026: **`POLY-3542084-1`**.

It is the **Down** contract on the event **“Bitcoin Up or Down on August 14?”** (category `crypto`, status `open`). Substitute any id from `GET /api/collector/status` → `marketIds`, or open `api/src/shared/watchlist.json`.

## 1. First sighting — `market_snapshots`

The `market_snapshots` stream pages Jupiter `/events` and writes a row when the quote/volume/status hash changes. This market currently has **77** stored snapshots.

See it on `/data/markets` and `/data/markets/POLY-3542084-1`.

## 2. Depth arrives — `orderbook_snapshots`

Because the id is on the sticky watchlist (`autoWatchlistSize` **12**), the `orderbook_snapshots` stream polls its book about every **30 seconds**. This market already has **448** stored books — it is being filmed properly.

Coverage appears under `/data/orderbooks`. A late snapshot still showed `buyNoPriceUsd: 0` on the *price* row (which would make “implied yes” look like 100%). The **order book** told the truth: best YES bid **$0.54**, best NO bid **$0.44**, mid **$0.55**, spread about **$0.02**, huge depth. Features prefer the book when it exists. Without this step, paper conditions would show `hadOrderbook: false`.

## 3. Fills and labels — `trades` / `market_labels`

The global `trades` feed had **0** collected fills for this id at the time of writing (not every market prints in the 30-second global sample). The market is still **open**, so there is no resolution label yet. When it settles, `market_labels` (and the slower labeller job) will record the outcome used as an answer key. Front end: `/data/trades`, labelled counts on `/data`.

## 4. Features on read

Opening `/data/features` (or a swarm/paper pass) builds spreads, recent change, liquidity, and so on from the stored rows — features are not a fifth collector stream. Latest joined row: ~**10 hours** to close, deep book, small depth imbalance.

## 5. Swarm or paper decision

- Scheduled/manual swarm: a stored run under `/api/runs` with specialist stances and a Risk Manager verdict. While the language model is in backoff, that run is **deterministic**.
- Live paper: `/data/paper` shows the market in the universe. Entry requires the gate (coherent quotes + minimum liquidity) and paper confidence floor **0.35**.

On an earlier fill, Trend said **YES** (confidence **0.62**) and Mean-reversion said **NO**. Default policy is **follow the heavier specialist**. Trend’s weight was higher, so the swarm book bought YES.

## 6. Simulated fill and exit

A first swarm lot opened **13 Aug 23:33 UTC**: YES, **$13.57** at **$0.47** (cheap side → trailing stop, 60-minute grace). It had **`hadOrderbook: false`** at entry (liquidity score 0.24 — still above the 0.05 gate). About **91 minutes** later it sold at **$0.39** with `exitReason: **trailing_stop**`, net **−$2.32**. By exit, a book *was* stored. That closed row lives in Mongo `paper_closed_trades` and on `GET /api/paper/trades`.

A **new** swarm lot is open now: YES **$70.50** at **$0.46**, unrealised about **+$12.17** (the YES price later printed near **$0.56**). Size **$70** is the Risk Manager using a large fraction of the **$100** ceiling, not 1% of a bankroll. See the open row on `/data/paper`.

## 7. Fitness grades the trade

`POST /api/fitness/run` (last pass **05:15 UTC**) folded coherent closes into the scoreboard. View the report on `/data/fitness`.

Across the classroom, not just this id:

- Swarm book: **59** trades, **−$44.10**
- Trend: **70** trades, **−$7.20**
- Mean-reversion: **137** trades, **−$353.45**
- Semantic: **0** paper trades

This market’s −$2.32 trailing-stop close is one swarm exam paper in that pile. Mean-reversion’s own $10 book on similar cheap YES tickets has been getting chopped by the same seatbelt just after the 60-minute grace.

## 8. Adaptive weight moves (or does not)

Published knobs after that pass (`GET /api/fitness/weights`, also on `/data/fitness`):

- Trend **0.90** (70 trades, recent 10 actually **+$5**)
- Mean-reversion **0.63** (137 trades, still leaking)
- Semantic **1.00** with **no** paper trades — missing evidence, not praise

On the −$2.32 fill, the mixer photo at entry was already Trend **0.73** / Mean-reversion **0.62**. The knobs have since walked, not jumped (inertia **0.6**).

## 9. Next time

The next paper pass on this market (or its sibling **Up** contract `POLY-3542084-0`, which is open YES **$70.78** and **−$15.17** unrealised) blends specialist voices using those weights. Trend is a little louder; Mean-reversion is quieter. Neither formula has changed. The seatbelt on the open cheap lot can still sell between 15-minute chats if the trail prints.

That is the loop closing: **observe → decide → simulate → grade → reweight → decide again**.

## Where to see the whole path

| Stage | Front end |
|---|---|
| Prices | `/data/markets/POLY-3542084-1` |
| Depth | `/data/orderbooks` |
| Features | `/data/features` |
| Paper book | `/data/paper` |
| Grades / weights | `/data/fitness` |

## Where this goes next

Return to the [overview](00-overview.md) when you want the map again, or re-check `/data/paper` and `/data/fitness` after the API has been running long enough for new closed trades. A single concatenated copy of every Guide page also lives in [full-guide.md](full-guide.md).
