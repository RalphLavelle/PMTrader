# PMTrader

A Node/TypeScript + Angular app for trading on [Jupiter Prediction Markets](https://developers.jup.ag/docs/prediction) — binary YES/NO markets on Solana for real-world events.

This is an early scaffold: the API proxies Jupiter for trade and market data, and the Angular UI lets you browse markets and view recent activity. Trading, positions, and LangGraph automation come in later tasks.

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

Open [http://localhost:4200](http://localhost:4200) for the home page. From there you can navigate to **Trades** (`/trades`) or **Markets** (`/markets`). The markets page groups outcomes by event (click a heading to expand), sorts markets numerically or alphabetically within each event, shows category emojis, and hides closed markets by default with an optional toggle to reveal them in grey.

### Environment variables

| Variable | Description |
|----------|-------------|
| `JUPITER_API_KEY` | Jupiter Portal API key (optional for prototyping) |
| `JUPITER_BASE_URL` | Prediction API base URL (default: `https://api.jup.ag/prediction/v1`) |
| `OWNER_PUBKEY` | Your Solana wallet public key — enables "My history" tab |
| `PORT` | API server port (default: `3000`) |

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/events` | List prediction events (supports Jupiter query params) |
| `GET` | `/api/markets/:marketId` | Market details with pricing |
| `GET` | `/api/trades` | Global recent trades (Jupiter `/trades`) |
| `GET` | `/api/trades/history` | Wallet history (Jupiter `/history`) |

## Build

```bash
npm run build
```

Builds both `api/dist` and `web/dist`.

## What's next

- Open/close positions via Jupiter order endpoints
- Human-in-the-loop controls in the UI
- LangGraph agent pipeline (separate task)

## References

- [Jupiter Prediction docs](https://developers.jup.ag/docs/prediction)
- Local copy: `docs/Jupiter/`
