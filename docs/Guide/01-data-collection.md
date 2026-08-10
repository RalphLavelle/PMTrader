# 01 — Data collection

**In one sentence:** A background "collector" polls Jupiter every 30–60 seconds
and files away prices, order books, and trades into a local MongoDB database, so
that every later step has a faithful minute-by-minute record of what the markets
actually did.

## Why collect at all?

Jupiter only tells you what a market looks like *right now*. To test whether a
trading decision was good, you need to know what happened *afterwards* — and to
make a decision honestly, you must only use what was knowable *before*. Both
require a time-stamped history that Jupiter itself does not provide. The
collector builds that history.

## The four streams

The collector (code in `api/src/collector/`, switched on with
`COLLECTOR_ENABLED=true`) runs four independent polling loops. Their cadences
live in `api/src/collector/collector-schedule.json` and can be edited there:

| Stream | How often | What it grabs | Stored in (MongoDB) |
|--------|-----------|---------------|---------------------|
| Wide sweep | every 5 min | Every open market on the venue (all categories): YES/NO prices, volume, status | `market_snapshots` |
| Order book | every 30 s | Full depth ladder (all resting buy/sell offers) for the ~12 watchlist markets | `orderbook_snapshots` |
| Trades | every 30 s | Actual fills from Jupiter's global trade feed | `trades` |
| Labels | every 5 min | Final YES/NO results for watchlist markets that have resolved | `market_labels` |

The sweep collects **every category** by default — crypto, sports, politics,
and the rest — because intramarket analysis does not need markets to resolve
quickly, and a wider mix gives the agents a more rounded view of market
behaviour. To narrow it again, list categories in
`collector-schedule.json` (or `COLLECTOR_CATEGORIES` in `.env`). The full
venue is ~5,000 events, so the sweep paginates through roughly 51 pages per
pass; a 5-minute cadence keeps that inside Jupiter's rate limits.

### The auto-watchlist

Order books are expensive to poll, so only a rotating **watchlist of 12
markets** gets depth coverage. After each sweep the collector keeps any
watchlist market that is still open ("sticky"), drops ones that closed, and
fills empty slots with the highest-volume open markets. The current list is
visible via `GET /api/collector/status`.

This matters later: markets *without* order-book history give the agents much
less to work with (two of their three main inputs go missing), so the
watchlist markets are where learning is richest.

## What a data point looks like

A `market_snapshots` row is essentially: market id, event question ("Ethereum
price on August 9?"), the bracket or outcome title, status, YES and NO buy/sell
prices, volume, and `capturedAt` — the moment *we observed it*. That
observation clock is what lets every later step replay history in true order.
Duplicate polls (nothing changed) are skipped via a content hash, so the
database stores changes, not noise.

## Features: numbers computed on read

Raw rows are deliberately kept raw. When any later step needs *derived*
numbers — "how much did the price move in the last 5 minutes?", "how wide is
the gap between buyers and sellers?", "are recent trades mostly buys?" — the
**Feature Builder** (`api/src/features/`) computes them on the fly from the
stored history, joined "as of" a chosen moment T using only observations at or
before T. Nothing computed is ever written back, and future data can never
leak into a past decision (unit tests guard this: `npm run test:api`).

The same code also assembles the **MarketContext**: the complete
as-of-T picture (price path, latest order book, recent trade flow) handed to
the agents. Live decisions, backtests, and paper trading all build it the same
way, so they are all judged on identical information.

## Where to see it

- **Front end:** `/data` (collection counts, stream health, last-fetch times),
  `/data/markets` (every collected market, searchable), `/data/markets/:id`
  (price chart + latest feature row), `/data/orderbooks` (depth and spread
  charts), `/data/trades` (collected fills), `/data/features` (the feature
  table for one market).
- **API:** `GET /api/data/overview`, `GET /api/collector/status`,
  `GET /api/data/markets`, `GET /api/data/features/:marketId`
- **Code:** `api/src/collector/`, `api/src/features/`

One practical note: every Jupiter call in the whole app — collector, agents,
UI — goes through a single rate-limiter queue (`api/src/jupiter/rate-limiter.ts`)
spacing calls ~1.1 s apart, so the streams above never trip Jupiter's limits.

## Where this goes next

The collected history is the raw material for everything else. The first
consumer is the agent swarm, which reads a market's current snapshot and
features and turns them into a trade/no-trade decision —
[next: the agent swarm](02-the-agent-swarm.md).
