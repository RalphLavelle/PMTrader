# PMTrader

A Node/TypeScript + Angular app for trading on [Jupiter Prediction Markets](https://developers.jup.ag/docs/prediction) — binary YES/NO markets on Solana for real-world events.

This is an early scaffold: the API proxies Jupiter for trade and market data, and the Angular UI lets you browse markets, view details, and place buy orders via Phantom wallet.

## Project structure

| Folder | Purpose |
|--------|---------|
| `api/` | Express API — connects to Jupiter Prediction API |
| `web/` | Angular frontend (Less) — home, trades, and markets |
| `docs/` | Specs, run reports, and design notes (including the research dataset plan) |

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
| `OWNER_PUBKEY` | Your Solana wallet public key — auto-connects Phantom on load |
| `PORT` | API server port (default: `3000`) |
| `SOLANA_RPC_URL` | Optional Solana RPC (fallback only; Phantom submits transactions by default) |
| `OLLAMA_BASE_URL` | Ollama OpenAI-compatible API URL (e.g. `http://127.0.0.1:11434/v1`) |
| `OLLAMA_API_KEY` | Ollama Cloud API key (optional for local Ollama) |
| `OLLAMA_MODEL` | Chat model for swarm and semantic analysis (e.g. `gemma4:31b-cloud`) |
| `AGENT_SCHEDULE_ENABLED` | Set `true` to run scheduled swarm analysis |
| `AGENT_SCHEDULE_ENABLED` | Set `true` to run periodic swarm analysis on the watchlist in `api/src/agents/markets.json` |
| `AGENT_SCHEDULE_INTERVAL_MS` | Scheduler interval in ms (default: `3600000` = 1 hour) |
| `COLLECTOR_ENABLED` | Set `true` to start the research-dataset collector |
| `COLLECTOR_SCHEDULE_PATH` | Optional path to `collector-schedule.json` (default: repo root) |
| `COLLECTOR_CATEGORIES` | Default Jupiter categories to collect, e.g. `crypto` (overridden by schedule JSON) |
| `LABELLER_ENABLED` | Set `true` to start the outcome labeller |
| `LABELLER_INTERVAL_MS` | Gap between labelling passes (default: `600000` = 10 minutes) |
| `LABELLER_MARKET_BATCH_SIZE` | Markets checked per pass — one Jupiter call each (default: `5`) |
| `LABELLER_RUN_BATCH_SIZE` | Unscored runs examined per pass (default: `100`) |
| `BACKTEST_MAX_MARKETS` | Resolved markets replayed per backtest (default: `50`) |
| `BACKTEST_DECISION_INTERVAL_MINUTES` | Gap between decision points in one market's history (default: `15`) |
| `BACKTEST_MIN_SNAPSHOTS` | Fewest snapshots before a market is worth replaying (default: `3`) |
| `BACKTEST_MAX_SNAPSHOTS_PER_MARKET` | Memory cap on snapshots loaded per market (default: `2000`) |
| `FITNESS_MAX_RUNS` | Stored swarm runs examined per fitness pass (default: `500`) |
| `FITNESS_MIN_SAMPLE_FOR_WEIGHT` | Graded stances needed before a suggested weight leaves 1.0 (default: `30`) |
| `MONGODB_URI` | MongoDB connection string (default: `mongodb://127.0.0.1:27017/`) |
| `MONGODB_DATABASE` | Database for stored analysis runs (default: `PRMTrade`) |
| `MONGODB_RUNS_COLLECTION` | Collection for stored analysis runs (default: `runs`) |
| `MONGODB_MARKET_SNAPSHOTS_COLLECTION` | Wide-sweep price rows (default: `market_snapshots`) |
| `MONGODB_ORDERBOOK_SNAPSHOTS_COLLECTION` | Orderbook captures (default: `orderbook_snapshots`) |
| `MONGODB_TRADES_COLLECTION` | Global trade fills (default: `trades`) |
| `MONGODB_MARKET_LABELS_COLLECTION` | Resolution labels (default: `market_labels`) |
| `SWARM_MAX_POSITION_USD` | Largest stake the Risk Manager will recommend (default: `100`) |
| `SWARM_MIN_POSITION_USD` | Smallest stake worth placing (default: `5`) |
| `SWARM_MIN_CONFIDENCE` | Confidence a trade must clear for approval (default: `0.55`) |
| `SWARM_RECURSION_LIMIT` | Cap on LangGraph steps per swarm run (default: `40`) |

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/events` | List prediction events (supports Jupiter query params) |
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
| `GET` | `/api/backtest/status` | Backtest defaults, in-flight flag, resolved-market count, last result |
| `POST` | `/api/backtest/run` | Replay resolved markets now (`?markets=`, `?intervalMinutes=`, `?minConfidence=`, `?requireOrderbook=`) |
| `GET` | `/api/backtest/markets/:marketId` | Every graded decision for one resolved market |
| `GET` | `/api/fitness/status` | Agent fitness defaults, in-flight flag, resolved-market count, last report |
| `POST` | `/api/fitness/run` | Grade every specialist now (`?markets=`, `?intervalMinutes=`, `?maxRuns=`, `?minSample=`, `?requireOrderbook=`, `?includeLiveRuns=false`) |
| `GET` | `/api/fitness/weights` | Suggested confidence weight per agent — the Phase 6 contract |
| `GET` | `/api/fitness/agents/:agent` | Full drill-down for one specialist from the last pass |
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
| `api/src/features/` | Phase 2 Feature Builder (on-read joins over collected data) |
| `api/src/labeller/` | Phase 3 outcome labeller (market labels + run scoring) |
| `api/src/backtest/` | Phase 4 offline evaluation (replay stored history through the agent logic) |
| `api/src/fitness/` | Phase 5 agent fitness (grade each specialist's stance, suggest a weight) |
| `api/src/jobs/` | Optional swarm analysis scheduler |

Business logic never imports LangGraph. Each agent's `logic.ts` is a set of pure functions taking a
snapshot and returning a validated signal, which makes the strategies directly unit-testable and
lets the deterministic runner reuse them unchanged.

Prompts live in `api/src/agents/prompts.ts`, separate from the agent code, so they can be reviewed
and versioned on their own.

### Running an analysis

```bash
curl -X POST http://localhost:3000/api/swarm/analysis/POLY-3013350
```

Without `OLLAMA_BASE_URL` and `OLLAMA_MODEL` the swarm falls back to a **deterministic** run: the same business logic
executed in a fixed order, with no LLM. Add `?deterministic=true` to force that path even when a key
is configured, which is useful for comparing the two.

Optional scheduling: set `AGENT_SCHEDULE_ENABLED=true` and edit the market ids in
[`api/src/agents/markets.json`](api/src/agents/markets.json). Scheduled runs use the
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
- An adaptive Risk Manager that weights specialists by their measured fitness (Phase 6, see [docs/ResearchDataset.md](docs/ResearchDataset.md)) — blocked on collecting markets *while open*, not on code

## Research dataset (Phases 1–5)

### Collector (Phase 1)

When `COLLECTOR_ENABLED=true`, the API:

1. Runs an **initial fetch** of all four enabled streams (smoke test).
2. Then follows intervals in [`api/src/collector/collector-schedule.json`](api/src/collector/collector-schedule.json).

Edit that JSON to change any stream's cadence (`every.value` + `every.unit` of `seconds` or `minutes`), pause a stream (`enabled: false`), or change `marketIds` used for orderbook + labels. The API rewrites `lastFetchAt` / `lastError` after each attempt.

Wide-sweep options (under `streams.wideSweep.options`):

| Option | Default | Meaning |
|--------|---------|---------|
| `maxPages` | `2` | How many `/events` pages per sweep |
| `pageSize` | `50` | Events per page |
| `openMarketsOnly` | `true` | Skip non-open markets |
| `watchlistOnly` | `false` | Only store `marketIds` from the schedule |
| `categories` | `[]` | Jupiter categories to collect, e.g. `["crypto"]` — uses `/events?category=crypto` |
| `autoWatchlistSize` | `0` | After each sweep, set `marketIds` to the top N open markets by volume (for orderbook + labels) |

The checked-in schedule defaults to **crypto-only** ingestion with `autoWatchlistSize: 12`, so short-horizon markets like *"Will Bitcoin be up in the next hour?"* get price history, order books, and labels without collecting every politics or sports market on the venue. Copy ids from the collector's auto watchlist (`GET /api/collector/status`) into [`api/src/agents/markets.json`](api/src/agents/markets.json) when you want the swarm scheduler to analyse the same markets.

When a category filter is active, the global `/trades` feed only persists fills for tracked crypto market ids, and the labeller only scores crypto snapshots.

| Stream | Jupiter source | MongoDB collection |
|--------|----------------|--------------------|
| `wideSweep` | `GET /events?includeMarkets=true` | `market_snapshots` |
| `orderbook` | `GET /orderbook/{id}` per `marketIds` | `orderbook_snapshots` |
| `trades` | `GET /trades` | `trades` |
| `labels` | `GET /markets/{id}` when resolved | `market_labels` |

### Feature Builder + /data UI (Phase 2)

Features are computed **on read** (never written back) in `api/src/features/`: price momentum, binary orderbook mid/spread, and trade-flow windows, joined as-of each snapshot.

Browse them in the Angular app at **`/data`** (Overview, Markets, Order books, Trades, Features, Backtest, Fitness). The header nav has a **Data** link.

```bash
# Enable collector in .env, then:
npm run dev:api
npm run dev:web
curl http://localhost:3000/api/data/overview
# Open http://localhost:4200/data
```

### Outcome labeller (Phase 3)

Collecting prices only becomes useful once you know how each market ended. When `LABELLER_ENABLED=true`,
`api/src/labeller/` runs every `LABELLER_INTERVAL_MS` and does two things per pass:

1. **Labels markets.** Folds `market_snapshots` down to the latest state per market, picks the ones that
   look settled (past close, status no longer `open`, or closed but not yet adjudicated), and asks Jupiter
   what happened. Each check costs one request, so only `LABELLER_MARKET_BATCH_SIZE` are made per pass.
2. **Scores runs.** Finds stored swarm runs still carrying `outcome: null`, looks up their market's label,
   and records whether the recommendation was right plus the profit or loss it would have produced.

```bash
curl http://localhost:3000/api/labeller/status     # what is outstanding
curl -X POST http://localhost:3000/api/labeller/run # run a pass now
curl http://localhost:3000/api/data/labelled       # markets with a known answer
```

Scoring rules worth knowing:

| Situation | `wasCorrect` | `realizedPnlUsd` |
|-----------|--------------|------------------|
| Recommendation matched the resolution | `true` | `stake × (1 − entry) / entry` |
| Recommendation was wrong | `false` | `−stake` |
| Recommendation was `hold` | `null` — declining to bet proves nothing | `0` |
| Entry price unusable (pre-Phase-0 run) | as above | `null` rather than a guess |

The labeller is **not** the collector. The collector's `labels` stream re-checks only the handful of ids in
`collector-schedule.json`; the labeller covers everything the wide sweep collected, at a slower cadence.

### Offline backtest (Phase 4)

Once markets have resolved, `api/src/backtest/` can replay their stored history through the swarm's own
decision logic and grade it. There is **no enable flag** — it makes no Jupiter calls and never runs on a
timer, so it is on demand only.

```bash
curl http://localhost:3000/api/backtest/status
curl -X POST "http://localhost:3000/api/backtest/run?intervalMinutes=15"
curl "http://localhost:3000/api/backtest/markets/POLY-3013350"
# Or open http://localhost:4200/data/backtest
```

What the report contains, and why:

| Section | Question it answers |
|---------|--------------------|
| Accuracy | Of the bets it placed, how many picked the winning side? |
| Return on stake | Profit per dollar risked — comparable across different bet sizes |
| Versus the favourite | Would just buying whichever side the market favoured have done better? |
| Calibration | When it said "70% likely YES", did roughly 70% resolve YES? |
| Veto tally | If nothing was graded, which Risk Manager rule stopped it? |

Three design rules keep the numbers honest:

1. **No look-ahead.** A decision at time T sees only rows captured at or before T, including the order
   book. Every agent is called with `now = snapshot.capturedAt`, so `hoursToClose` is measured from the
   past rather than from today's clock.
2. **One decision per interval.** Grading every 30-second snapshot would turn one opinion into thousands
   of fake "independent" tests, so decisions are thinned to `intervalMinutes` apart.
3. **The Semantic Agent sits out.** It is non-deterministic, slow, and its input prose was never
   collected — so only the quantitative core (Trend, Mean Reversion, Risk Manager) is replayed.

Scoring reuses the labeller's `deriveWasCorrect` / `estimateRealizedPnlUsd`, so a backtested decision and
a live scored run are graded identically.

Overrides go on the query string: `markets`, `intervalMinutes`, `minSnapshots`, `requireOrderbook`, and
`minConfidence` — the last one lets you sweep the approval threshold without editing `.env` and
restarting. Nothing is persisted; a backtest is a derived view, recomputed on demand.

**Current finding:** every replayed decision comes back `hold`, and the veto tally explains why. Trend and
Mean Reversion are designed as opposites, and the blend multiplies confidence by agreement — on a *synthetic*
market at 78% YES their confidences of 0.639 and 0.627 cancel to **0.006** against a 0.55 bar. See
[docs/Analysis.md](docs/Analysis.md) for what that implies.

### Agent fitness (Phase 5)

Grading the *blend* says little when the blend nearly always holds. `api/src/fitness/` grades each
**specialist's own stance** instead — whether or not the Risk Manager acted on it — and suggests how much
each one's confidence should count. Also on demand, also MongoDB only.

```bash
curl http://localhost:3000/api/fitness/status
curl -X POST "http://localhost:3000/api/fitness/run?markets=50"
curl http://localhost:3000/api/fitness/weights
curl http://localhost:3000/api/fitness/agents/trend_agent
# Or open http://localhost:4200/data/fitness
```

What the report contains, and why:

| Section | Question it answers |
|---------|--------------------|
| Brier score | How wrong were the stated probabilities? (0.25 = always said 50/50) |
| Skill vs market | Did the agent know something the market price did not? |
| Overconfidence | Does it claim more certainty than it delivers? |
| By regime | Where does it earn its keep — thin books, near expiry, genuine toss-ups? |
| Head-to-head | When two specialists disagreed, which one turned out to be right? |
| Suggested weight | The confidence multiplier Phase 6 would apply — measured, not applied |
| Warnings | Why you should not believe the numbers above yet |

Three things make it honest rather than flattering:

1. **A stance is scored as a forecast, not a vote.** Stance and confidence are converted to a probability
   using `signalToYesProbability` — the Risk Manager's own function — then scored with the Brier score,
   which is *proper*: it is minimised only by stating what you honestly believe, so an agent cannot improve
   its score by exaggerating.
2. **The benchmark is the market price, not a coin flip.** Favourites usually win, so an agent that looks
   accurate by following the crowd has added nothing you could not get for free by reading the price.
3. **Small samples get no weight.** Below `FITNESS_MIN_SAMPLE_FOR_WEIGHT` stances the suggested weight is
   pinned at 1.0, because acting on a lucky streak is worse than doing nothing.

Two evidence sources feed it, reported separately: replayed backtest decisions (plentiful, but the semantic
agent cannot be replayed) and stored swarm runs the labeller has scored (few, but the only way to grade the
semantic agent). Pre-Phase-0 runs whose prices were all 0 or 1 are excluded rather than averaged in.

**Current finding:** all 40 graded stances come back *neutral* — not a disagreement that cancelled out, but
no opinion at all. Every graded market was first collected after it stopped trading, so the implied
probability fell back to 0.5 and the specialists correctly declined to call a direction. The sample is
degenerate, not the agents, and what unblocks Phase 6 is collector coverage of markets **while they are
open, with order books** rather than any change to the maths.

Design notes: [docs/ResearchDataset.md](docs/ResearchDataset.md).

## References

- [Jupiter Prediction docs](https://developers.jup.ag/docs/prediction)
- Local copy: `docs/Jupiter/`
- [Research dataset design](docs/ResearchDataset.md) — how to collect Jupiter time-series + orderbook data, and how often to refresh it
