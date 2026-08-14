# Question
Given I'm collecting from all the market now, why do I need the 'marketIds' property in the @api/src/collector/collector-schedule.json object? Also, you say 'improve order-book collection', but how how do I improve it?

# Answer 
Both questions have concrete answers in the collector code. Here's what I found.

## Why `marketIds` still matters even though you sweep every market

The key is that the collector gathers **two different depths of data**, and `marketIds` controls the expensive one.

The `wideSweep` stream is what "collects from all markets" — it paginates the whole Jupiter `/events` venue and stores shallow **price snapshots** (quotes, volume, status) for ~4,800 markets. That only costs ~60 API calls per pass, because each page returns 100 markets at once.

Order books are different. There is no bulk endpoint — capturing depth costs **one API call per market** (`GET /orderbook/{id}`), and your `orderbook` stream runs every 30 seconds. Doing that for all 4,800 markets would be ~9,600 calls a minute, which the rate limit would never allow. So the collector keeps a short **watchlist**, and that's exactly what `marketIds` is. Three things read it:

```404:412:api/src/collector/streams.ts
export async function fetchOrderbooks(
  schedule: CollectorScheduleFile,
): Promise<StreamFetchResult> {
  const marketIds = schedule.marketIds;
  if (marketIds.length === 0) {
    return {
      stream: 'orderbook',
      ok: true,
      message: 'No marketIds in collector-schedule.json — skipped orderbook fetch',
```

- `fetchOrderbooks` — depth snapshots only for watchlist markets
- `fetchLabels` — fast resolution-labelling for watchlist markets
- `resolvePaperUniverse` in `live-engine.ts` — the paper trader visits watchlist markets *first*

Also worth knowing: **you don't maintain this list by hand.** Because `autoWatchlistSize` is 12, the `maybeRefreshWatchlist` function rewrites `marketIds` after every sweep — markets stay "sticky" until they close, then free slots are refilled with the highest-volume open markets. So the property isn't a filter you configured; it's working state the collector manages for you. If you deleted it, the orderbook and labels streams would simply skip until the next sweep repopulated it.

## How to actually improve order-book collection

The report's "37% of stances had an order book" problem has a specific, visible cause — a **size mismatch between two settings**:

- The paper trader considers up to **24** markets (`paperTradingMaxMarkets`)
- Order books are only collected for **12** markets (`autoWatchlistSize`)

Looking at `resolvePaperUniverse`, the watchlist goes first, but the remaining ~12 slots are filled from open tracked markets that get *no depth collection at all*. Every one of your 16 losing trades had `hadOrderbook: false` — they were trades in that uncovered half.

Two clean ways to fix it (pick one; both make the numbers agree):

1. **Widen collection to match trading:** set `autoWatchlistSize` from 12 to 24 in `collector-schedule.json`. Cost: the orderbook pass goes from 12 to 24 API calls per 30 seconds. If that presses on your rate limit, change the orderbook stream's `every` to 60 seconds at the same time — same API budget, twice the coverage.

2. **Narrow trading to match collection:** set `PAPER_TRADING_MAX_MARKETS=12` in `.env` (I won't touch `.env` myself). Then the paper trader only ever trades markets whose depth is being captured, which also means the entry gate's liquidity check is working from real data instead of a score of 0.

Given your goal is *learning quality* — trades whose costs are measured against a real book — option 2 is the more conservative experiment, and option 1 is better once you want more trade volume. I'd start with 2, confirm `hadOrderbook: true` starts appearing on new trades, then widen.

One more small thing: coverage also depends on the sweep keeping markets sticky until close (which it does), so the earlier a market enters the watchlist in its life, the more complete its depth history. Raising `autoWatchlistSize` helps there too, since more markets get adopted earlier.

## Suggested follow-up

After changing either setting, you can verify the fix cheaply: let a few paper trades close, then check `GET /api/paper/trades` and look at `entryConditions.hadOrderbook` — it should flip to `true` on new entries. That single field is your before/after test.