import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { eventsRouter } from './routes/events.js';
import { marketsRouter } from './routes/markets.js';
import { ordersRouter } from './routes/orders.js';
import { tradingStatusRouter } from './routes/trading-status.js';
import { tradesRouter } from './routes/trades.js';
import { analysisRouter } from './routes/analysis.js';
import { swarmRouter } from './routes/swarm.js';
import { startMarketAnalysisScheduler } from './jobs/market-analysis-scheduler.js';
import { analysisMemory } from './memory/index.js';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/health', healthRouter);
app.use('/api/events', eventsRouter);
app.use('/api/markets', marketsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/trading-status', tradingStatusRouter);
app.use('/api/trades', tradesRouter);
app.use('/api/analysis', analysisRouter);
app.use('/api/swarm', swarmRouter);

app.listen(config.port, () => {
  console.log(`PMTrader API listening on http://localhost:${config.port}`);
  console.log(`Analysis memory driver: ${analysisMemory.driver}`);
  if (!config.jupiterApiKey) {
    console.warn('JUPITER_API_KEY is not set — requests use keyless rate limits (0.5 RPS).');
  }
  if (!config.openAiApiKey) {
    console.warn(
      'OPENAI_API_KEY is not set — agent nodes use placeholders and the swarm runs deterministically.',
    );
  }
  startMarketAnalysisScheduler();
});
