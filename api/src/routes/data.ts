import { Router } from 'express';
import { config } from '../config.js';
import { loadSchedule, scheduleFilePath } from '../collector/index.js';
import { connectMongo } from '../memory/mongodb.client.js';
import { loadWatchlist, watchlistFilePath } from '../shared/watchlist.js';
import {
  buildFeatureRows,
  countLabels,
  deriveOrderbookFeatures,
  listLabelledMarkets,
  listMarketCoverage,
  listOrderbookCoverage,
  loadCollectionCoverage,
  loadLabel,
  loadMarketOrderbooks,
  loadMarketSnapshots,
  loadTrades,
  loadMarketDisplayMeta,
  lookupMarketDisplayMeta,
  toDepthLadder,
} from '../features/index.js';
import { countResolvedMarkets } from '../labeller/index.js';
import { parseOptionalInt } from './jupiter-error.js';

export const dataRouter = Router();

/** Ensure Mongo is connected before any read (safe if already open). */
async function ensureDb(): Promise<void> {
  await connectMongo();
}

/** Dataset overview: collection coverage + collector and labeller health. */
dataRouter.get('/overview', async (_req, res) => {
  try {
    await ensureDb();
    const [collections, labelledMarkets, resolvedMarkets, schedule, marketIds] =
      await Promise.all([
        loadCollectionCoverage(),
        countLabels(),
        countResolvedMarkets(),
        loadSchedule(),
        loadWatchlist(),
      ]);
    const marketSnap = collections.find(
      (c) => c.collection === config.mongodbMarketSnapshotsCollection,
    );
    res.json({
      collections,
      totalDistinctMarkets: marketSnap?.distinctMarkets ?? 0,
      labelledMarkets,
      resolvedMarkets,
      collectorEnabled: config.collectorEnabled,
      labellerEnabled: config.labellerEnabled,
      collectorCategories: config.collectorCategories,
      schedulePath: scheduleFilePath(),
      watchlistPath: watchlistFilePath(),
      marketIds,
      schedule,
    });
  } catch (error) {
    console.error('[data] overview failed:', error);
    res.status(500).json({ error: 'Failed to load dataset overview.' });
  }
});

/**
 * Markets with a decisive outcome — the supervised slice of the dataset.
 *
 * This is what Phase 4 backtesting will replay: history whose answer is known.
 */
dataRouter.get('/labelled', async (req, res) => {
  try {
    await ensureDb();
    const limit = parseOptionalInt(req.query['limit']) ?? 50;
    const data = await listLabelledMarkets(limit);
    res.json({ count: data.length, data });
  } catch (error) {
    console.error('[data] labelled markets failed:', error);
    res.status(500).json({ error: 'Failed to list labelled markets.' });
  }
});

/** Markets present in market_snapshots. Query: search, limit, category. */
dataRouter.get('/markets', async (req, res) => {
  try {
    await ensureDb();
    const search = typeof req.query['search'] === 'string' ? req.query['search'] : undefined;
    const limit = parseOptionalInt(req.query['limit']);
    const category =
      typeof req.query['category'] === 'string' ? req.query['category'] : undefined;
    const markets = await listMarketCoverage({ search, limit, category });
    res.json({ data: markets });
  } catch (error) {
    console.error('[data] markets list failed:', error);
    res.status(500).json({ error: 'Failed to list markets.' });
  }
});

/** Price series + joined features + label for one market. */
dataRouter.get('/markets/:marketId', async (req, res) => {
  const marketId = req.params['marketId'];
  if (!marketId) {
    res.status(400).json({ error: 'marketId is required' });
    return;
  }

  try {
    await ensureDb();
    const [snapshots, orderbooks, trades, label] = await Promise.all([
      loadMarketSnapshots(marketId),
      loadMarketOrderbooks(marketId),
      loadTrades({ marketId, limit: 1_000, ascending: true }),
      loadLabel(marketId),
    ]);

    if (snapshots.length === 0) {
      res.status(404).json({
        error: `No market_snapshots found for ${marketId}`,
        hint: 'Run the collector or pick a market from GET /api/data/markets',
      });
      return;
    }

    const features = buildFeatureRows({ snapshots, orderbooks, trades, label });
    const series = snapshots.map((s) => ({
      at: s.capturedAt.toISOString(),
      buyYesPriceUsd: s.buyYesPriceUsd,
      buyNoPriceUsd: s.buyNoPriceUsd,
      sellYesPriceUsd: s.sellYesPriceUsd,
      sellNoPriceUsd: s.sellNoPriceUsd,
      impliedYes:
        s.buyYesPriceUsd + s.buyNoPriceUsd > 0
          ? s.buyYesPriceUsd / (s.buyYesPriceUsd + s.buyNoPriceUsd)
          : 0.5,
      volumeUsd: s.volumeUsd,
      status: s.status,
      openTime: s.openTime ?? null,
      closeTime: s.closeTime,
    }));

    const latest = snapshots[snapshots.length - 1];
    const display = await loadMarketDisplayMeta(marketId, latest, trades);
    res.json({
      marketId,
      title: display.title,
      eventTitle: display.eventTitle,
      category: display.category,
      status: latest?.status ?? 'unknown',
      openTime: latest?.openTime ?? null,
      closeTime: latest?.closeTime ?? null,
      snapshotCount: snapshots.length,
      orderbookCount: orderbooks.length,
      tradeCount: trades.length,
      label,
      series,
      features,
    });
  } catch (error) {
    console.error('[data] market detail failed:', error);
    res.status(500).json({ error: 'Failed to load market detail.' });
  }
});

/** Markets that have orderbook captures. */
dataRouter.get('/orderbooks', async (req, res) => {
  try {
    await ensureDb();
    const limit = parseOptionalInt(req.query['limit']) ?? 50;
    const data = await listOrderbookCoverage(limit);
    res.json({ data });
  } catch (error) {
    console.error('[data] orderbooks list failed:', error);
    res.status(500).json({ error: 'Failed to list orderbooks.' });
  }
});

/** Latest depth ladder + spread/imbalance time series for one market. */
dataRouter.get('/orderbooks/:marketId', async (req, res) => {
  const marketId = req.params['marketId'];
  if (!marketId) {
    res.status(400).json({ error: 'marketId is required' });
    return;
  }

  try {
    await ensureDb();
    const books = await loadMarketOrderbooks(marketId);
    if (books.length === 0) {
      res.status(404).json({
        error: `No orderbook_snapshots found for ${marketId}`,
        hint: 'Add the marketId to api/src/shared/watchlist.json and enable the orderbook_snapshots stream.',
      });
      return;
    }

    const latest = books[books.length - 1]!;
    const features = deriveOrderbookFeatures(latest);
    const display = await loadMarketDisplayMeta(marketId);
    const series = books.map((book) => {
      const f = deriveOrderbookFeatures(book);
      return {
        at: book.capturedAt.toISOString(),
        spread: f.spread,
        mid: f.mid,
        depthImbalance: f.depthImbalance,
        totalDepth: f.totalDepth,
      };
    });

    res.json({
      marketId,
      title: display.title,
      eventTitle: display.eventTitle,
      category: display.category,
      snapshotCount: books.length,
      latest: {
        capturedAt: latest.capturedAt.toISOString(),
        features,
        yesLadder: toDepthLadder(latest.yesDollars),
        noLadder: toDepthLadder(latest.noDollars),
      },
      series,
    });
  } catch (error) {
    console.error('[data] orderbook detail failed:', error);
    res.status(500).json({ error: 'Failed to load orderbook detail.' });
  }
});

/** Recent collected trades + simple flow summary. Query: marketId, limit. */
dataRouter.get('/trades', async (req, res) => {
  try {
    await ensureDb();
    const marketId = typeof req.query['marketId'] === 'string' ? req.query['marketId'] : undefined;
    const limit = parseOptionalInt(req.query['limit']) ?? 100;
    const trades = await loadTrades({ marketId, limit });

    let buyNotionalUsd = 0;
    let sellNotionalUsd = 0;
    for (const trade of trades) {
      const amount = Number.parseFloat(trade.amountUsd);
      const usd = Number.isFinite(amount) && amount > 1_000 ? amount / 1_000_000 : amount || 0;
      if (trade.action === 'buy') {
        buyNotionalUsd += usd;
      } else {
        sellNotionalUsd += usd;
      }
    }
    const total = buyNotionalUsd + sellNotionalUsd;
    const meta = await lookupMarketDisplayMeta(trades.map((t) => t.marketId));

    res.json({
      data: trades.map((t) => {
        const display = meta.get(t.marketId);
        return {
          ...t,
          timestamp: t.timestamp.toISOString(),
          marketTitle: t.marketTitle || display?.title,
          eventTitle: t.eventTitle || display?.eventTitle,
          category: display?.category,
        };
      }),
      summary: {
        tradeCount: trades.length,
        buyNotionalUsd,
        sellNotionalUsd,
        buySellImbalance: total > 0 ? (buyNotionalUsd - sellNotionalUsd) / total : 0,
      },
    });
  } catch (error) {
    console.error('[data] trades failed:', error);
    res.status(500).json({ error: 'Failed to load trades.' });
  }
});

/** Flat feature table for the feature explorer. */
dataRouter.get('/features/:marketId', async (req, res) => {
  const marketId = req.params['marketId'];
  if (!marketId) {
    res.status(400).json({ error: 'marketId is required' });
    return;
  }

  try {
    await ensureDb();
    const [snapshots, orderbooks, trades, label] = await Promise.all([
      loadMarketSnapshots(marketId),
      loadMarketOrderbooks(marketId),
      loadTrades({ marketId, limit: 1_000, ascending: true }),
      loadLabel(marketId),
    ]);

    if (snapshots.length === 0) {
      res.status(404).json({ error: `No snapshots for ${marketId}` });
      return;
    }

    const features = buildFeatureRows({ snapshots, orderbooks, trades, label });
    res.json({
      marketId,
      title: snapshots[snapshots.length - 1]?.title ?? marketId,
      rowCount: features.length,
      features,
    });
  } catch (error) {
    console.error('[data] features failed:', error);
    res.status(500).json({ error: 'Failed to build features.' });
  }
});
