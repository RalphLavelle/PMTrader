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
