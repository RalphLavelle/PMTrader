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
