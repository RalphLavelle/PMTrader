import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { eventsRouter } from './routes/events.js';
import { marketsRouter } from './routes/markets.js';
import { tradesRouter } from './routes/trades.js';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/health', healthRouter);
app.use('/api/events', eventsRouter);
app.use('/api/markets', marketsRouter);
app.use('/api/trades', tradesRouter);

app.listen(config.port, () => {
  console.log(`PMTrader API listening on http://localhost:${config.port}`);
  if (!config.jupiterApiKey) {
    console.warn('JUPITER_API_KEY is not set — requests use keyless rate limits (0.5 RPS).');
  }
});
