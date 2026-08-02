# PMTrader

A Node/TypeScript + Angular app for trading on [Jupiter Prediction Markets](https://developers.jup.ag/docs/prediction) — binary YES/NO markets on Solana for real-world events.

This is an early scaffold: the API proxies Jupiter for trade and market data, and the Angular UI lets you browse markets, view details, and place buy orders via Phantom wallet.

## Project structure

| Folder | Purpose |
|--------|---------|
| `api/` | Express API — connects to Jupiter Prediction API |
| `web/` | Angular frontend (Less) — home, trades, and markets |
| `docs/` | Jupiter docs and task specs |

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
| `AGENT_MARKET_IDS` | Comma-separated market ids for the scheduler (e.g. `POLY-3013350`) |
| `AGENT_SCHEDULE_INTERVAL_MS` | Scheduler interval in ms (default: `3600000` = 1 hour) |
| `MONGODB_URI` | MongoDB connection string (default: `mongodb://127.0.0.1:27017/`) |
| `MONGODB_DATABASE` | Database for stored analysis runs (default: `PRMTrade`) |
| `MONGODB_RUNS_COLLECTION` | Collection for stored analysis runs (default: `runs`) |
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
| `GET` | `/api/swarm/analyses` | List stored analysis records (`?marketId=`, `?limit=`) |
| `GET` | `/api/swarm/analyses/:id` | Fetch one stored analysis |
| `PATCH` | `/api/swarm/analyses/:id/outcome` | Record how a market resolved |

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

Optional scheduling: set `AGENT_SCHEDULE_ENABLED=true` and list markets in `AGENT_MARKET_IDS`. Scheduled
runs use the swarm and persist results to MongoDB.

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

Once a market resolves, close the loop so the prediction can be scored:

```bash
curl -X PATCH http://localhost:3000/api/swarm/analyses/<id>/outcome \
  -H 'Content-Type: application/json' \
  -d '{"resolved":true,"resolvedTo":"yes","realizedPnlUsd":12.5}'
```

`wasCorrect` is derived automatically when omitted. `AnalysisMemoryStore` is a five-method interface,
so SQLite, PostgreSQL, or a vector database can be substituted without touching agent code.

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
- A Learning Agent that scores stored outcomes and tunes the strategies

## References

- [Jupiter Prediction docs](https://developers.jup.ag/docs/prediction)
- Local copy: `docs/Jupiter/`
