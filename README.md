# PMTrader

A Node/TypeScript + Angular app for trading on [Jupiter Prediction Markets](https://developers.jup.ag/docs/prediction) — binary YES/NO markets on Solana for real-world events.

This is an early scaffold: the API proxies Jupiter for trade and market data, and the Angular UI lets you browse markets, view details, and place buy orders via Phantom wallet.

## Project structure

| Folder | Purpose |
|--------|---------|
| `api/` | Express API — connects to Jupiter Prediction API |
| `web/` | Angular frontend (Less) — home, trades, and markets |
| `docs/` | Specs, run reports, and design notes (including the research dataset plan) |
| `docs/Guide/` | **The Guide** — plain-English explanation of the whole learning loop (start at [00-overview.md](docs/Guide/00-overview.md)) |

## The Guide

New to the app, or need a refresher on how the learning loop works? Read
[docs/Guide/00-overview.md](docs/Guide/00-overview.md) — nine short documents
covering data collection, the agent swarm, scheduled runs, backtesting, paper
trading, fitness, adaptive weights, and one market followed end to end. It is
written for non-experts and regenerated from the current code by the
`update-guide` skill: just say **"update the guide"** in chat.

## Prerequisites

- Node.js 22+ (24.15+ recommended for Angular CLI 22)
- npm 8+

## Setup

1. Copy environment variables:

   ```bash
   cp .env.example .env
   ```

2. Optionally add a [Jupiter API key](https://developers.jup.ag/portal) to `.env` for higher rate limits:

   ```
   JUPITER_API_KEY=your-key-here
   ```

3. Install dependencies from the repo root:

   ```bash
   npm install
   ```

## Development

Run the API and frontend in separate terminals:

```bash
# Terminal 1 — API on http://localhost:3000
npm run dev:api

# Terminal 2 — Angular on http://localhost:4200 (proxies /api to the backend)
npm run dev:web
```

Open [http://localhost:4200](http://localhost:4200) for the home page. Browse **Markets** (`/markets`), click a market (route uses its `POLY-*` id, e.g. `/markets/POLY-3013350`), and view full details plus orderbook depth. To trade, connect **Phantom**, choose Yes/No and deposit amount (min $5 JupUSD or USDC), and sign the order transaction in your wallet.

The **Markets** listing loads open markets from a MongoDB snapshot (`events_catalog`) so repeat visits render immediately. When the snapshot is older than five minutes, the API returns the cached list right away and refreshes from Jupiter in the background — the UI shows “Fetching updated markets…” until the new snapshot is saved. The first visit with an empty database still waits for Jupiter once; after that, loads are fast. Use **Refresh** to force a background update without clearing the current list.


### Mongo Database
Use the _PRTrader_ database in the local instance to save data. The URI is the value of the env MONGODB_URI key. 

### Trading requirements

- [Phantom](https://phantom.app/) browser extension with the account matching `OWNER_PUBKEY` in `.env`
- Solana wallet funded with **JupUSD** or **USDC**
- [Jupiter API key](https://developers.jup.ag/portal) in `.env` (required for order creation)
- Market must be **open** and exchange trading active

On app load, PMTrader auto-connects Phantom using `OWNER_PUBKEY`. A **green light** in the header means connected; **red** means a problem (hover for details). No manual connect step on the market page.

### Environment variables

| Variable | Description |
|----------|-------------|
| `JUPITER_API_KEY` | Jupiter Portal API key (optional for prototyping) |
| `JUPITER_BASE_URL` | Prediction API base URL (default: `https://api.jup.ag/prediction/v1`) |
| `JUPITER_MIN_REQUEST_INTERVAL_MS` | Min gap between all Jupiter HTTP calls process-wide (default `1100` with a key, `2000` keyless) |
| `JUPITER_429_MAX_RETRIES` | Retries after HTTP 429 before surfacing the error (default `2`) |
| `JUPITER_429_RETRY_DELAY_MS` | Base backoff after 429 in ms, multiplied per attempt (default `5000`) |
| `OWNER_PUBKEY` | Your Solana wallet public key — auto-connects Phantom on load |
| `PORT` | API server port (default: `3000`) |
| `SOLANA_RPC_URL` | Optional Solana RPC (fallback only; Phantom submits transactions by default) |
| `OLLAMA_BASE_URL` | Ollama OpenAI-compatible API URL (e.g. `http://127.0.0.1:11434/v1`) |
| `OLLAMA_API_KEY` | Ollama Cloud API key (optional for local Ollama) |
| `OLLAMA_MODEL` | Chat model for swarm and semantic analysis (e.g. `gemma4:31b-cloud`) |
| `LLM_BACKOFF_MS` | After an LLM 429 / usage limit, skip the model for this many ms (default: `3600000` = 1 hour) |
| `AGENT_SCHEDULE_ENABLED` | Set `true` to run scheduled swarm analysis |
| `AGENT_SCHEDULE_ENABLED` | Set `true` to run periodic swarm analysis on ids in `api/src/shared/watchlist.json` |
| `AGENT_SCHEDULE_INTERVAL_MS` | Scheduler interval in ms (default: `3600000` = 1 hour) |
| `COLLECTOR_ENABLED` | Set `true` to start the research-dataset collector |
| `COLLECTOR_SCHEDULE_PATH` | Optional path to `schedule.json` (default: `api/src/collector/schedule.json`) |
| `COLLECTOR_CATEGORIES` | Default Jupiter categories to collect, e.g. `crypto` (overridden by schedule JSON) |
| `LABELLER_ENABLED` | Set `true` to start the outcome labeller |
| `LABELLER_INTERVAL_MS` | Gap between labelling passes (default: `600000` = 10 minutes) |
| `LABELLER_MARKET_BATCH_SIZE` | Markets checked per pass — one Jupiter call each (default: `5`) |
| `LABELLER_RUN_BATCH_SIZE` | Unscored runs examined per pass (default: `100`) |
| `BACKTEST_MAX_MARKETS` | Markets replayed per backtest (default: `50`) |
| `BACKTEST_DECISION_INTERVAL_MINUTES` | Minutes between decision points (default: `15`) |
| `BACKTEST_EXIT_HOLD_MINUTES` | Minutes to hold before exiting; defaults to the decision interval |
| `BACKTEST_MIN_SNAPSHOTS` | Fewest snapshots before a market is replayed (default: `3`) |
| `BACKTEST_MAX_SNAPSHOTS_PER_MARKET` | Memory cap per market (default: `2000`) |
| `FITNESS_MAX_RUNS` | Stored swarm runs examined per fitness pass (default: `500`) |
| `FITNESS_MIN_SAMPLE_FOR_WEIGHT` | Completed paper trades needed before a suggested weight leaves 1.0 (default: `30`) |
| `FITNESS_SPECIALIST_STAKE_USD` | Unit stake when simulating each specialist's paper book (default: `10`) |
| `ADAPTIVE_SENSITIVITY` | How hard ±1 fitness may move a weight from baseline (default: `0.4`) |
| `ADAPTIVE_RECENT_WINDOW` | Most-recent trades defining “recent” fitness (default: `10`) |
| `ADAPTIVE_INERTIA` | Blend toward previous weight each pass — `0` jumps, `1` freezes (default: `0.6`) |
| `ADAPTIVE_WIN_RATE_PRIOR` | Pseudocounts on wins/losses so one trade cannot dominate (default: `1`) |
| `PAPER_TRADING_ENABLED` | Set `true` to start the continuous live paper-trading loop (PAPER ONLY) |
| `PAPER_TRADING_INTERVAL_MS` | Gap between paper passes (default: `60000`) |
| `PAPER_TRADING_DECISION_INTERVAL_MINUTES` | Min minutes between decisions per market (default: `15`) |
| `PAPER_TRADING_STALE_MS` | Skip decisions when collector tip is older than this (default: `900000`) |
| `PAPER_TRADING_MAX_MARKETS` | Max open markets per pass (default: `12`, match `autoWatchlistSize`) |
| `MONGODB_URI` | MongoDB connection string (default: `mongodb://127.0.0.1:27017/`) |
| `MONGODB_DATABASE` | Database for stored analysis runs (default: `PRMTrade`) |
| `MONGODB_RUNS_COLLECTION` | Collection for stored analysis runs (default: `runs`) |
| `MONGODB_MARKET_SNAPSHOTS_COLLECTION` | Price snapshot rows (default: `market_snapshots`) |
| `MONGODB_ORDERBOOK_SNAPSHOTS_COLLECTION` | Orderbook captures (default: `orderbook_snapshots`) |
| `MONGODB_TRADES_COLLECTION` | Global trade fills (default: `trades`) |
| `MONGODB_MARKET_LABELS_COLLECTION` | Resolution labels (default: `market_labels`) |
| `MONGODB_PAPER_PORTFOLIOS_COLLECTION` | Live paper portfolios (default: `paper_portfolios`) |
| `MONGODB_PAPER_DECISIONS_COLLECTION` | Live paper decision audit (default: `paper_decisions`) |
| `MONGODB_PAPER_CLOSED_TRADES_COLLECTION` | Live closed paper trades (default: `paper_closed_trades`) |
| `MONGODB_ADAPTIVE_WEIGHTS_COLLECTION` | Persisted adaptive weight snapshot (default: `adaptive_weights`) |
| `SWARM_MAX_POSITION_USD` | Largest stake the Risk Manager will recommend (default: `100`) |
| `SWARM_MIN_POSITION_USD` | Smallest stake worth placing (default: `5`) |
| `SWARM_MIN_CONFIDENCE` | Confidence a trade must clear for approval (default: `0.55`) |
| `SWARM_RECURSION_LIMIT` | Cap on LangGraph steps per swarm run (default: `40`) |

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/events` | List prediction events (supports Jupiter query params) |
| `GET` | `/api/events/catalog` | Full markets catalog for `/markets` — MongoDB snapshot with background Jupiter refresh (`?refresh=true`) |
| `GET` | `/api/markets/:marketId` | Market details with pricing |
| `GET` | `/api/markets/:marketId/orderbook` | Orderbook depth |
| `GET` | `/api/trading-status` | Whether the exchange is accepting trades |
| `POST` | `/api/orders` | Create buy order (returns unsigned transaction) |
| `GET` | `/api/trades` | Global recent trades (Jupiter `/trades`) |
| `GET` | `/api/trades/history` | Wallet history (Jupiter `/history`) |
| `POST` | `/api/swarm/analysis/:marketId` | Run the multi-agent swarm (`?deterministic=true` to skip the LLM) |
| `GET` | `/api/runs` | List stored runs with full payload (`?marketId=`, `?limit=`) |
| `GET` | `/api/runs/:id` | Fetch one stored run (`record`, `snapshot`, `features`) |
| `GET` | `/api/collector/status` | Research collector enabled flag + schedule / last fetch times |
| `GET` | `/api/data/overview` | Dataset coverage + collector schedule health |
| `GET` | `/api/data/markets` | Markets in `market_snapshots` (`?search=`, `?limit=`) |
| `GET` | `/api/data/markets/:marketId` | Price series + joined feature rows for one market |
| `GET` | `/api/data/orderbooks` | Markets with orderbook captures |
| `GET` | `/api/data/orderbooks/:marketId` | Latest depth ladder + spread/imbalance series |
| `GET` | `/api/data/trades` | Collected fills (`?marketId=`, `?limit=`) |
| `GET` | `/api/data/features/:marketId` | Flat Feature Builder table |
| `GET` | `/api/data/labelled` | Markets with a decisive yes/no outcome (`?limit=`) |
| `GET` | `/api/labeller/status` | Outcome labeller config, last pass, and outstanding work |
| `POST` | `/api/labeller/run` | Run one labelling pass immediately |
| `GET` | `/api/backtest/status` | Backtest defaults, in-flight flag, tradable-market preview, last result |
| `POST` | `/api/backtest/run` | Replay markets now (`?markets=`, `?intervalMinutes=`, `?exitHoldMinutes=`, `?minConfidence=`, `?requireOrderbook=`) |
| `GET` | `/api/backtest/markets/:marketId` | Every graded decision for one market |
| `POST` | `/api/backtest/paper/run` | Chronological paper-trading replay across markets (stateful portfolio) |
| `GET` | `/api/backtest/paper/markets/:marketId` | Full paper-trading history for one market (`?includeContext=true` for full MarketContext) |
| `GET` | `/api/fitness/status` | Agent fitness defaults, in-flight flag, last report, adaptive table |
| `POST` | `/api/fitness/run` | Grade specialists now and refresh adaptive weights |
| `GET` | `/api/fitness/weights` | Adaptive weights + evidence (`?liquidityScore=&hoursToClose=&marketYes=&hadOrderbook=` for regime) |
| `GET` | `/api/fitness/agents/:agent` | Full drill-down for one specialist from the last pass |
| `GET` | `/api/paper/status` | Live paper portfolio, open positions, last pass, adaptive weights |
| `GET` | `/api/paper/trades` | Closed live paper trades (`?limit=`) |
| `POST` | `/api/paper/run` | Run one live paper-trading pass immediately (PAPER ONLY) |
| `GET` | `/api/swarm/analyses` | List stored analysis records (`?marketId=`, `?limit=`) |
| `GET` | `/api/swarm/analyses/:id` | Fetch one stored analysis |
| `PATCH` | `/api/swarm/analyses/:id/outcome` | Record how a market resolved by hand |

## Build

```bash
npm run build
```

Builds both `api/dist` and `web/dist`.

## Agent swarm (LangGraph Swarm)

The API's analysis path is a multi-agent swarm built with
[`@langchain/langgraph-swarm`](https://www.npmjs.com/package/@langchain/langgraph-swarm). There is no
supervisor: agents pass control to each other through handoff tools, and the swarm remembers which
agent was last active.

### The agents

| Agent | Responsibility |
|-------|----------------|
| `market_analyst` | Fetches market data and computes derived features. Never recommends trades. |
| `trend_agent` | Scores trend-following opportunities. |
| `mean_reversion_agent` | Scores reversal opportunities — deliberately the counterweight to trend. |
| `semantic_agent` | Real-world reasoning over market title and resolution rules. |
| `risk_manager` | Aggregates all signals, sizes the position, and can veto. |

Typical route through the swarm, though agents choose their own handoffs:

```
market_analyst → trend_agent → mean_reversion_agent → semantic_agent → risk_manager
```

### Code layout

| Folder | Contents |
|--------|----------|
| `api/src/llm/` | Shared Ollama chat model factory |
| `api/src/semantic/` | Semantic narrative generation used by the Semantic Agent |
| `api/src/schemas/` | Zod contracts (the TypeScript equivalent of Pydantic models) |
| `api/src/agents/` | One folder per agent: pure business logic plus the registry and prompts |
| `api/src/swarm/` | LangGraph glue — shared state, tools, swarm assembly, runner |
| `api/src/memory/` | MongoDB persistence for completed swarm runs |
| `api/src/collector/` | Phase 1 research-dataset collector (four streams + JSON schedule) |
| `api/src/features/` | Phase 2 Feature Builder + canonical `MarketContext` (as-of-T joins, no look-ahead) |
| `api/src/labeller/` | Phase 3 outcome labeller (market labels + intramarket/resolution run scoring) |
| `api/src/trading/` | Paper fills/PnL + continuous live paper-trading loop (Mongo-backed, PAPER ONLY) |
| `api/src/backtest/` | Phase 4 offline evaluation + chronological paper-replay engine |
| `api/src/fitness/` | Phase 5 agent fitness (paper-trade P&L primary; Brier secondary) |
| `api/src/adaptive/` | Phase 6 adaptive weights — feed trading fitness into aggregation |
| `api/src/jobs/` | Optional swarm analysis scheduler |

Business logic never imports LangGraph. Each agent's `logic.ts` is a set of pure functions taking a
snapshot (and now an optional canonical `MarketContext`) and returning a validated signal, which makes
the strategies directly unit-testable and lets the deterministic runner reuse them unchanged.

The swarm and offline backtest share **`buildMarketContextAt`**: at decision time T it joins collector
history (prices, order books, trades) using only observations at or before T. Resolution labels are
never included — that would leak the answer key into the decision. Agent *scoring* still uses the
existing snapshot + `DerivedFeatures` contract; the richer trajectory / trade-flow fields are available
on the context for the next iteration.

Look-ahead bias is guarded by unit tests:

```bash
npm run test:api
```

Prompts live in `api/src/agents/prompts.ts`, separate from the agent code, so they can be reviewed
and versioned on their own.

### Running an analysis

```bash
curl -X POST http://localhost:3000/api/swarm/analysis/POLY-3013350
```

Without `OLLAMA_BASE_URL` and `OLLAMA_MODEL` the swarm falls back to a **deterministic** run: the same business logic
executed in a fixed order, with no LLM. Add `?deterministic=true` to force that path even when a key
is configured, which is useful for comparing the two.

If the model returns HTTP **429** (for example Ollama Cloud “session usage limit”), the API **backs off
for one hour** (`LLM_BACKOFF_MS`, default `3600000`) and uses that same deterministic path so the
scheduler does not spam a failed analysis for every watchlist market. Paper trading and backtests
never needed the LLM. `GET /api/health` reports `llmBackingOffUntil` while the cooldown is active.

Optional scheduling: set `AGENT_SCHEDULE_ENABLED=true` and edit the market ids in
[`api/src/shared/watchlist.json`](api/src/shared/watchlist.json) (shared with the
collector’s orderbook/labels streams and paper trading). Scheduled runs use the
full swarm path (Ollama when configured) and persist results to MongoDB.

Every run is risk-checked. If the agents finish without calling `assess_risk`, the runner applies the
Risk Manager's rules directly rather than returning an unreviewed recommendation.

### Memory

Each completed run is stored in MongoDB (`PRMTrade.runs` by default) with its timestamp, market id,
participating agents, individual confidence scores, final recommendation, and an optional trade outcome.
Retrieve full runs (including market snapshot and features) via `/api/runs`:

```bash
curl "http://localhost:3000/api/runs?limit=5"
curl "http://localhost:3000/api/runs?marketId=POLY-3013350&limit=1"
```

To generate a plain-English markdown summary of a run (for non-expert readers), use the
`analyse_run` skill or run:

```bash
npx tsx scripts/analyse-run.ts
```

Reports are saved under `docs/<marketId>/<run-id>.md`.

```bash
curl "http://localhost:3000/api/swarm/analyses?marketId=POLY-3013350&limit=5"
```

Once a market resolves, the run is scored so the prediction can be graded. With
`LABELLER_ENABLED=true` this happens automatically (see **Outcome labeller** below). To record an
outcome by hand — for a market the collector never saw, or to correct one:

```bash
curl -X PATCH http://localhost:3000/api/swarm/analyses/<id>/outcome \
  -H 'Content-Type: application/json' \
  -d '{"resolved":true,"resolvedTo":"yes"}'
```

`wasCorrect` and `realizedPnlUsd` are derived automatically when omitted, using the same scoring the
labeller applies. `AnalysisMemoryStore` is a six-method interface, so SQLite, PostgreSQL, or a vector
database can be substituted without touching agent code.

### Adding an agent

Future specialists — Portfolio Manager, Execution Agent, Volatility Agent, Learning Agent, Regime
Detection Agent — follow the same three steps:

1. Add `api/src/agents/<name>/logic.ts` with pure functions returning a schema-validated result.
2. Wrap it in a tool under `api/src/swarm/tools/`.
3. Append one entry to `AGENT_SPECS` in `api/src/agents/registry.ts`.

The swarm is assembled from that table, so no orchestration code changes.

## What's next

- Sell/close positions and claim payouts
- Human-in-the-loop approval before the swarm's recommendation reaches an order
- Surface swarm recommendations and stored analyses in the Angular UI
- Keep collecting markets *while open* (with order books) so adaptive weights leave the baseline — Phase 6 code is done; evidence is the bottleneck

## Research dataset (Phases 1–6)

### Collector (Phase 1)

When `COLLECTOR_ENABLED=true`, the API:

1. Runs an **initial fetch** of all four enabled streams (smoke test).
2. Then follows intervals in [`api/src/collector/schedule.json`](api/src/collector/schedule.json).

Edit that JSON to change any stream's cadence (`every.value` + `every.unit` of `seconds` or `minutes`) or pause a stream (`enabled: false`). Market ids for orderbook_snapshots, market_labels, the swarm scheduler, and paper trading live in [`api/src/shared/watchlist.json`](api/src/shared/watchlist.json) — not in the schedule. Stream keys match the MongoDB collections they write to. The API rewrites `lastFetchAt` / `lastError` after each attempt.

**Jupiter rate limiter:** every HTTP call to Jupiter (collector, swarm, labeller, UI proxy) goes through one process-wide queue in `api/src/jupiter/rate-limiter.ts`. Default spacing is **1100 ms** between calls when `JUPITER_API_KEY` is set (~54/min — under the usual 60/min free-tier cap). On HTTP **429**, the client waits and retries up to **`JUPITER_429_MAX_RETRIES`** times before failing. Tune with `JUPITER_MIN_REQUEST_INTERVAL_MS` if your portal tier allows a higher sustained rate.

`market_snapshots` options (under `streams.market_snapshots.options`):

| Option | Default | Meaning |
|--------|---------|---------|
| `maxPages` | `2` | How many `/events` pages per sweep |
| `pageSize` | `50` | Events per page |
| `openMarketsOnly` | `true` | Skip *new* non-open markets; already-tracked markets still get a final close/resolution row |
| `watchlistOnly` | `false` | Only store ids from `shared/watchlist.json` |
| `categories` | `[]` | Jupiter categories to collect, e.g. `["crypto"]` — uses `/events?category=crypto` |
| `autoWatchlistSize` | `0` | Refresh `shared/watchlist.json`: sticky until close; fill with gated, nearer-term, diverse markets |
| `lifecycleFollowUpBatch` | `10` | Max `GET /markets/{id}` follow-ups per sweep for open markets missing from `/events` pages |

The checked-in schedule defaults to **all-market** ingestion: `categories: []` with `maxPages: 60` × `pageSize: 100` paginates the entire Jupiter `/events` venue (~5,000 events), and the sweep runs every **5 minutes** so the ~51 page calls fit inside the shared rate-limit budget alongside the 30-second orderbook_snapshots stream. Every market is tracked from first sighting through close: price history (with durable change-hash dedupe), order books on a sticky `autoWatchlistSize: 12` watchlist (written to `shared/watchlist.json`), trades, and labels. Open (unresolved) markets stay queryable as partial history — resolution is not required for intramarket replay. The swarm scheduler and paper trader read that same watchlist file, so there is only one list of deep-watched markets.

To narrow collection back down, set `categories` in the schedule JSON (e.g. `["crypto"]`) or `COLLECTOR_CATEGORIES` in `.env` — the schedule wins when both are set, and an empty list means everything. When a category filter is active, the global `/trades` feed only persists fills for tracked market ids in those categories, and the labeller only scores matching snapshots.

| Stream (Mongo collection) | Jupiter source | MongoDB collection |
|--------|----------------|--------------------|
| `market_snapshots` | `GET /events?includeMarkets=true` (+ optional lifecycle `GET /markets/{id}`) | `market_snapshots` |
| `orderbook_snapshots` | `GET /orderbook/{id}` per shared watchlist | `orderbook_snapshots` |
| `trades` | `GET /trades` | `trades` |
| `market_labels` | `GET /markets/{id}` when resolved | `market_labels` |

Snapshot and orderbook rows use `capturedAt` as the **observation** clock for chronological replay. Trades use Jupiter's fill `timestamp`. Duplicate polls are skipped via `contentHash` (snapshots + books) and unique trade `id`.

### Feature Builder + /data UI (Phase 2)

Features are computed **on read** (never written back) in `api/src/features/`: price momentum, binary orderbook mid/spread, and trade-flow windows, joined as-of each snapshot. The same joins power the canonical **`MarketContext`** object the live swarm and Phase 4 backtest pass to deterministic agents at time T.

Browse them in the Angular app at **`/data`** (Overview, Markets, Order books, Trades, Features, Backtest, Fitness). The header nav has a **Data** link.

Market rows use a shared **`app-market-label`** component: category emoji, strike/outcome title, event question underneath (e.g. “Will Solana hit $200?”), and a link to `/data/markets/:id`. The collector stores `eventTitle` on each `market_snapshots` row; older rows inherit the question from sibling markets on the same event or from collected trades.

```bash
# Enable collector in .env, then:
npm run dev:api
npm run dev:web
curl http://localhost:3000/api/data/overview
# Open http://localhost:4200/data
```

### Outcome labeller (Phase 3)

When `LABELLER_ENABLED=true`, `api/src/labeller/` runs every `LABELLER_INTERVAL_MS` and does two things:

1. **Labels markets.** Asks Jupiter for decisive YES/NO results (secondary context / calibration).
2. **Scores runs.** Prefers an **intramarket** outcome when a later snapshot exists after the hold
   window (entry → exit mark-to-market). Falls back to hold-to-settlement PnL only when a resolution
   label exists and no exit quote is available yet.

```bash
curl http://localhost:3000/api/labeller/status
curl -X POST http://localhost:3000/api/labeller/run
```

Primary PnL (intramarket): `stake × (exit − entry) / entry` on the recommended side.  
Secondary (`wasCorrect`): whether the recommendation matched eventual resolution.

### Offline backtest (Phase 4)

`api/src/backtest/` replays collected history through Trend, Mean Reversion, and the Risk Manager, then
grades each decision as an **entry → hold → exit** trade. Markets do **not** need to have resolved —
they need enough open-path snapshots for an exit quote. There is no enable flag; it is on demand only.

```bash
curl http://localhost:3000/api/backtest/status
curl -X POST "http://localhost:3000/api/backtest/run?intervalMinutes=15&exitHoldMinutes=15"
curl "http://localhost:3000/api/backtest/markets/POLY-3013350"
# Or open http://localhost:4200/data/backtest
```

| Section | Question it answers |
|---------|--------------------|
| Profitable share | Of directional bets, how many had positive mark-to-market PnL at exit? |
| Return on stake | Profit per dollar risked |
| Versus the favourite | Same exit policy, buying whichever side the market already favoured |
| Resolution accuracy | Secondary: matched eventual YES/NO when a label exists |
| Calibration | Secondary: when it said "70% YES", did ~70% resolve YES? |
| Veto tally | If nothing was graded, which Risk Manager rule stopped it? |

Overrides: `markets`, `intervalMinutes`, `exitHoldMinutes`, `minSnapshots`, `requireOrderbook`, `minConfidence`.

### Paper replay (stateful intramarket book)

Phase 4 grades each decision as an independent hypothetical trade. **Paper replay** keeps one
simulated position open across time and writes a chronological paper-trading history.

It reuses the same decision thinning + as-of `MarketContext` + deterministic agents, then:

1. Walks observations oldest → newest
2. Marks open inventory (unrealised PnL, MFE/MAE) using only the quote at T
3. Maps swarm recommendations onto paper actions (`buy_yes` / `buy_no` / `sell_yes` / `sell_no` / `hold`)
4. Applies fills with guards (no selling inventory you do not have, no exit before entry, no unusable prices)
5. Continues until the series ends — **resolution is not required**

**Fill model (conservative, configurable — not tuned to flatter history):**

| Action | Fill price |
|--------|------------|
| BUY YES / BUY NO | Ask — depth walk when a book exists, else top-of-book `buy*PriceUsd` |
| SELL YES / SELL NO | Bid — depth walk when a book exists, else top-of-book `sell*PriceUsd` |

Mid is **never** used as an execution price (only for **gross** P&L reporting).

| Knob | Default | Meaning |
|------|---------|---------|
| `PAPER_EXCESS_MODE` | `partial_fill` | `partial_fill` or `reject_excess` when depth is thin |
| `PAPER_SLIPPAGE_BPS` | `10` | Extra adverse move after the fill |
| `PAPER_FEE_BPS` | `0` | Flat fee on filled notional per leg |
| `PAPER_NO_BOOK_DEPTH_USD` | `25` | Max notional at top-of-book when no ladder at T |
| `PAPER_MIN_FILL_FRACTION` | `0.25` | Reject dust fills below this fraction of the request |

**Gross vs net:** `grossPnlUsd` is mid→mid; `netPnlUsd` is after ask/bid fills, slippage, and fees; `estimatedCostUsd = gross − net`.

Flips (approved opposite recommendation) close the open side; markets that leave `open` (or the last decision point) force-close remaining inventory when a bid exists. Partial exits emit a closed-trade slice and keep any residual lot open.

```bash
curl -X POST "http://localhost:3000/api/backtest/paper/run?markets=10&intervalMinutes=15"
curl "http://localhost:3000/api/backtest/paper/markets/POLY-3013350"
npm run test:api   # includes look-ahead + fill-model + impossible-fill tests
```

### Agent fitness (Phase 5)

Primary signal: **coherent paper trades** from intramarket replay (swarm book +
per-specialist unit books). Credit for profitable exits before resolution
(e.g. buy YES at $0.10, sell at $0.50 → +$0.40). Resolution Brier stays secondary.

The `/data/fitness` dashboard separates **trading performance** from **forecasting
performance**. Trading views cover the swarm portfolio, each specialist, individual
markets, individual trades (entry/exit, signals, adaptive weights at entry), equity
and drawdown curves, and regime breakdowns — with gross vs net P&L. Resolution on
a trade row is labelled as context only.

```bash
curl http://localhost:3000/api/fitness/status
curl -X POST "http://localhost:3000/api/fitness/run?markets=50"
curl http://localhost:3000/api/fitness/weights
# Or open http://localhost:4200/data/fitness
```

| Section | Question it answers |
|---------|--------------------|
| Swarm / agent realised P&L | Primary trading scoreboard from coherent buy→sell cycles |
| Equity / drawdown curves | Performance over time from closed trades |
| Markets + trades tables | Per-market and per-trade drill-down (gross vs net) |
| Win rate, profit factor, hold, best/worst | Paper-book behaviour — not one trade per observation |
| Behaviour tallies | Missed opportunities, premature / losing exits, held too long |
| Brier / resolution accuracy | Secondary — good forecaster vs good trader |
| Adaptive weight | Applied influence from Phase 6 (`GET /api/fitness/weights`) |

Small samples stay pinned near baseline 1.0 (`FITNESS_MIN_SAMPLE_FOR_WEIGHT`).
Specialist unit stake: `FITNESS_SPECIALIST_STAKE_USD` (default $10).

Design notes: [docs/ResearchDataset.md](docs/ResearchDataset.md).

### Adaptive Risk Manager (Phase 6)

After each fitness pass, a **deterministic** weight table is published and used by
`aggregateSignals` (live swarm + offline replay). Influence is
`confidence × adaptiveWeight` — the weight is a bounded composite fitness score
(shrunk win rate, return on capital, consistency, drawdown penalty, confidence
calibration), **not** raw win rate.

Conservatism: minimum samples, baseline of 1.0 when evidence is thin, hard clamps
(0.25–1.5), inertia across passes, and Beta pseudocounts so one lucky trade cannot
dominate. Optional regime query on `/api/fitness/weights` answers “how has this
agent done when the market looked like this?”.

```bash
curl -X POST "http://localhost:3000/api/fitness/run?markets=50"
curl "http://localhost:3000/api/fitness/weights"
curl "http://localhost:3000/api/fitness/weights?liquidityScore=0.7&hoursToClose=2&marketYes=0.55&hadOrderbook=true"
```

LLM prompts are unchanged — only the deterministic aggregation maths adapts.

### Live paper trading (continuous loop)

When `PAPER_TRADING_ENABLED=true`, the API runs a **paper-only** loop over open
markets the collector is watching:

1. Load the latest collector tip and build the same canonical `MarketContext` used by historical replay
2. Run `replayDecision` (same engine as backtests) with current adaptive weights
3. Map the recommendation onto enter / hold / add / reduce / exit via the paper book
4. Simulate fills with the conservative ask/bid + depth model (never mid, never real orders)
5. Persist positions, decisions, and closed trades in MongoDB (survives restarts)
6. On close, feed specialist trades into fitness evidence and refresh adaptive weights for the next decision

Markets do **not** need to resolve for a paper trade to complete. The loop also
handles closing/disappearing markets (force-close), stale tips, duplicate
observations, partial fills, and collector gaps.

```bash
# Enable in .env (collector should be running too)
PAPER_TRADING_ENABLED=true
COLLECTOR_ENABLED=true

curl http://localhost:3000/api/paper/status
curl -X POST http://localhost:3000/api/paper/run
curl http://localhost:3000/api/paper/trades
```

Logs are prefixed `[paper]` for entry, exit, P&L, rejected trade, stale data,
risk veto, and adaptive-weight updates.

**Web dashboard:** [http://localhost:4200/data/paper](http://localhost:4200/data/paper)
— open positions, closed trades, equity curve, and adaptive weights.
Related: [http://localhost:4200/data/fitness](http://localhost:4200/data/fitness) (offline
fitness) and [http://localhost:4200/data/backtest](http://localhost:4200/data/backtest)
(paper replay button for historical conservative fills).

## References

- [Jupiter Prediction docs](https://developers.jup.ag/docs/prediction)
- Local copy: `docs/Jupiter/`
- [Research dataset design](docs/ResearchDataset.md) — how to collect Jupiter time-series + orderbook data, and how often to refresh it
