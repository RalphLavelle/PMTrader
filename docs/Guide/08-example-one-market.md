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
