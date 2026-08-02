import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { eventsRouter } from './routes/events.js';
import { marketsRouter } from './routes/markets.js';
import { ordersRouter } from './routes/orders.js';
import { tradingStatusRouter } from './routes/trading-status.js';
import { tradesRouter } from './routes/trades.js';
import { swarmRouter } from './routes/swarm.js';
import { runsRouter } from './routes/runs.js';
import { startMarketAnalysisScheduler } from './jobs/market-analysis-scheduler.js';
import { analysisMemory, initAnalysisMemory } from './memory/index.js';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/health', healthRouter);
app.use('/api/events', eventsRouter);
app.use('/api/markets', marketsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/trading-status', tradingStatusRouter);
app.use('/api/trades', tradesRouter);
app.use('/api/swarm', swarmRouter);
app.use('/api/runs', runsRouter);

async function startServer(): Promise<void> {
  await initAnalysisMemory();

  app.listen(config.port, () => {
    console.log(`PMTrader API listening on http://localhost:${config.port}`);
    console.log(
      `Analysis runs stored in MongoDB (${config.mongodbDatabase}.${config.mongodbRunsCollection})`,
    );
    console.log(`Analysis memory driver: ${analysisMemory.driver}`);
    if (!config.jupiterApiKey) {
      console.warn('JUPITER_API_KEY is not set — requests use keyless rate limits (0.5 RPS).');
    }
    if (!config.llmConfigured) {
      console.warn(
        'OLLAMA_BASE_URL or OLLAMA_MODEL is not set — the swarm runs deterministically without LLM orchestration.',
      );
    }
    startMarketAnalysisScheduler();
  });
}

startServer().catch((error) => {
  console.error('Failed to start PMTrader API:', error);
  process.exit(1);
});
