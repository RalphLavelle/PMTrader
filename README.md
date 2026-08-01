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
| `OPENAI_API_KEY` | OpenAI key for LangGraph agent nodes (optional — placeholders without it) |
| `OPENAI_MODEL` | Chat model for agent pipeline (default: `gpt-4o-mini`) |
| `AGENT_SCHEDULE_ENABLED` | Set `true` to run scheduled market analysis |
| `AGENT_MARKET_IDS` | Comma-separated market ids for the scheduler (e.g. `POLY-3013350`) |
| `AGENT_SCHEDULE_INTERVAL_MS` | Scheduler interval in ms (default: `3600000` = 1 hour) |

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
| `POST` | `/api/analysis/:marketId` | Run LangGraph market reasoning pipeline |

## Build

```bash
npm run build
```

Builds both `api/dist` and `web/dist`.

## Agent pipeline (LangGraph)

The API includes a scaffolded [LangGraph](https://langchain-ai.github.io/langgraphjs/) reasoning chain under `api/src/agent/`. On demand (or on a schedule), it:

1. **Fetches** market metadata and orderbook from Jupiter
2. **Technical analysis** — data-driven pass over pricing and depth (placeholder logic today)
3. **Semantic analysis** — real-world pass over title and resolution rules (placeholder logic today)
4. **Synthesizes** a yes/no likelihood estimate

Trigger manually:

```bash
curl -X POST http://localhost:3000/api/analysis/POLY-3013350
```

With `OPENAI_API_KEY` set, analysis nodes call the configured model. Without it, the graph still runs using scaffold placeholders so you can develop the pipeline structure first.

Optional scheduling: set `AGENT_SCHEDULE_ENABLED=true` and list markets in `AGENT_MARKET_IDS`.

## What's next

- Sell/close positions and claim payouts
- Human-in-the-loop controls in the UI
- Flesh out technical and semantic analysis nodes; surface results in the Angular UI

## References

- [Jupiter Prediction docs](https://developers.jup.ag/docs/prediction)
- Local copy: `docs/Jupiter/`
