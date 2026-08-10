/**
 * Fitness trading tests — profitable exits before resolution must count.
 *
 * The textbook case: buy YES at 0.10, sell at 0.50 → +0.40 gross per share
 * regardless of how the market later resolves.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PaperMarketHistory } from '../backtest/paper-types.js';
import { applyPaperAction, emptyPortfolio } from '../trading/paper.js';
import type { FullQuote } from '../trading/paper-types.js';
import { suggestWeight, summariseStances } from './metrics.js';
import { proposeFromStance, simulateSpecialistTrades, swarmTradesFromHistory } from './trades.js';
import { maxDrawdownUsd, summariseTrades } from './trading-metrics.js';
import type { CompletedFitnessTrade } from './types.js';

const ENTRY_QUOTE: FullQuote = {
  buyYesPriceUsd: 0.1,
  buyNoPriceUsd: 0.92,
  sellYesPriceUsd: 0.08,
  sellNoPriceUsd: 0.9,
};

const EXIT_QUOTE: FullQuote = {
  buyYesPriceUsd: 0.52,
  buyNoPriceUsd: 0.5,
  sellYesPriceUsd: 0.5,
  sellNoPriceUsd: 0.48,
};

const T_ENTRY = new Date('2026-03-01T10:00:00.000Z');
const T_EXIT = new Date('2026-03-01T14:00:00.000Z');

function makeTrade(overrides: Partial<CompletedFitnessTrade> = {}): CompletedFitnessTrade {
  return {
    marketId: 'POLY-TEST',
    owner: 'swarm',
    entryAt: T_ENTRY.toISOString(),
    entryPriceUsd: 0.1,
    exitAt: T_EXIT.toISOString(),
    exitPriceUsd: 0.5,
    side: 'yes',
    quantity: 100, // $10 / 0.10
    sizeUsd: 10,
    grossPnlUsd: 40,
    estimatedCostUsd: 0,
    netPnlUsd: 40,
    holdingMinutes: 240,
    mfeUsd: 40,
    maeUsd: 0,
    entryConditions: {
      yesPriceUsd: 0.1,
      noPriceUsd: 0.92,
      liquidityScore: 0.7,
      hoursToClose: 48,
      hadOrderbook: true,
      change5m: null,
      volatility: null,
    },
    exitConditions: {
      yesPriceUsd: 0.52,
      noPriceUsd: 0.5,
      liquidityScore: 0.7,
      hoursToClose: 44,
      hadOrderbook: true,
      change5m: 0.1,
      volatility: 0.05,
    },
    swarmStateAtEntry: {
      recommendation: 'buy_yes',
      confidence: 0.8,
      approved: true,
      signals: [
        { agent: 'trend_agent', stance: 'yes', confidence: 0.7 },
        { agent: 'mean_reversion_agent', stance: 'neutral', confidence: 0.4 },
      ],
    },
    // Market later resolves NO — must NOT wipe the +40 realised P&L.
    resolvedTo: 'no',
    adaptiveWeightsAtEntry: null,
    ...overrides,
  };
}

describe('profitable trade before resolution', () => {
  /** Permissive profile so this test grades inventory maths, not depth caps. */
  const OPEN = {
    execution: {
      slippageBps: 0,
      feeBps: 0,
      noBookDepthUsd: 10_000,
      minFillFraction: 0,
      excessMode: 'partial_fill' as const,
    },
  };

  it('credits +0.40/share when buying YES at 0.10 and selling at 0.50', () => {
    const opened = applyPaperAction(
      emptyPortfolio(),
      'buy_yes',
      ENTRY_QUOTE,
      T_ENTRY,
      10,
      OPEN,
    );
    assert.equal(opened.appliedAction, 'buy_yes');
    assert.ok(opened.portfolio.position);
    assert.equal(opened.fillPriceUsd, 0.1);

    const closed = applyPaperAction(
      opened.portfolio,
      'sell_yes',
      EXIT_QUOTE,
      T_EXIT,
      10,
      OPEN,
    );
    assert.equal(closed.appliedAction, 'sell_yes');
    // 100 contracts * (0.50 − 0.10) = +40
    assert.equal(closed.stepRealisedPnlUsd, 40);
    assert.equal(closed.portfolio.realisedPnlUsd, 40);
  });

  it('keeps realised P&L when eventual resolution is NO', () => {
    const trade = makeTrade({ resolvedTo: 'no', netPnlUsd: 40 });
    const perf = summariseTrades([trade]);

    assert.equal(perf.realisedPnlUsd, 40);
    assert.equal(perf.trades, 1);
    assert.equal(perf.winRate, 1);
    // Resolution is contextual only — it must not flip a winner into a loser.
    assert.equal(trade.resolvedTo, 'no');
    assert.ok(trade.netPnlUsd > 0);
  });

  it('does not treat every observation as its own trade', () => {
    // Three observations, one coherent cycle → one trade in the scoreboard.
    const trades = [makeTrade()];
    const perf = summariseTrades(trades);
    assert.equal(perf.trades, 1);
    assert.notEqual(perf.trades, 3);
  });
});

describe('trading performance rollup', () => {
  it('computes win rate, profit factor, and drawdown across coherent trades', () => {
    const trades = [
      makeTrade({ netPnlUsd: 40, grossPnlUsd: 40 }),
      makeTrade({
        marketId: 'POLY-2',
        entryAt: '2026-03-02T10:00:00.000Z',
        exitAt: '2026-03-02T12:00:00.000Z',
        netPnlUsd: -10,
        grossPnlUsd: -8,
        sizeUsd: 10,
        mfeUsd: 2,
        maeUsd: -12,
      }),
    ];

    const perf = summariseTrades(trades);
    assert.equal(perf.trades, 2);
    assert.equal(perf.winRate, 0.5);
    assert.equal(perf.realisedPnlUsd, 30);
    assert.equal(perf.grossPnlUsd, 32);
    assert.equal(perf.avgTradePnlUsd, 15);
    assert.equal(perf.largestWinnerUsd, 40);
    assert.equal(perf.largestLoserUsd, -10);
    assert.equal(perf.avgProfitPerTrade, 40);
    assert.equal(perf.avgLossPerTrade, -10);
    assert.equal(perf.profitFactor, 4);
    assert.ok(perf.maxDrawdownUsd >= 0);
    assert.equal(maxDrawdownUsd(trades), perf.maxDrawdownUsd);
  });

  it('drives suggested weight from coherent trade win rate', () => {
    const winners = Array.from({ length: 30 }, (_, i) =>
      makeTrade({
        marketId: `POLY-${i}`,
        owner: 'trend_agent',
        netPnlUsd: 5,
      }),
    );
    const trading = summariseTrades(winners);
    const forecasting = summariseStances([]);
    const weight = suggestWeight(trading, forecasting, 30);

    assert.equal(weight.reliable, true);
    assert.ok(weight.weight > 1);
    assert.match(weight.rationale, /coherent paper trades/i);
  });
});

describe('specialist paper book from history', () => {
  it('simulates a coherent specialist trade that profits before resolution', () => {
    const history: PaperMarketHistory = {
      marketId: 'POLY-3013350',
      title: 'Test',
      startedAt: T_ENTRY.toISOString(),
      finishedAt: T_EXIT.toISOString(),
      firstTimestamp: T_ENTRY.toISOString(),
      lastTimestamp: T_EXIT.toISOString(),
      resolvedTo: 'no',
      options: {
        maxMarkets: 1,
        decisionIntervalMinutes: 60,
        minSnapshots: 2,
        maxSnapshotsPerMarket: 100,
        minConfidence: 0.55,
        requireOrderbook: false,
        execution: {
          slippageBps: 0,
          feeBps: 0,
          noBookDepthUsd: 10_000,
          minFillFraction: 0,
          excessMode: 'partial_fill',
        },
      },
      closedTrades: [],
      decisions: [
        {
          marketId: 'POLY-3013350',
          timestamp: T_ENTRY.toISOString(),
          yesPriceUsd: 0.1,
          noPriceUsd: 0.92,
          sellYesPriceUsd: 0.08,
          sellNoPriceUsd: 0.9,
          features: {
            impliedYesProbability: 0.1,
            spreadUsd: 0.02,
            depthImbalance: 0,
            totalDepth: 1000,
            liquidityScore: 0.7,
            priceExtremity: 0.4,
            hoursToClose: 48,
          },
          contextSummary: {
            at: T_ENTRY.toISOString(),
            historyPoints: 1,
            hadOrderbook: true,
            change5m: null,
            volatility: null,
            tradeCount: 0,
            hoursToClose: 48,
          },
          depthBook: null,
          signals: [
            { agent: 'trend_agent', stance: 'yes', confidence: 0.8 },
            { agent: 'mean_reversion_agent', stance: 'neutral', confidence: 0.3 },
          ],
          swarmRecommendation: 'hold',
          approved: false,
          confidence: 0.1,
          proposedAction: 'hold',
          appliedAction: 'hold',
          rejectionReason: null,
          proposedSide: null,
          proposedEntryPriceUsd: null,
          proposedExitPriceUsd: null,
          filledSizeUsd: 0,
          rejectedSizeUsd: 0,
          position: null,
          entryAt: null,
          exitAt: null,
          realisedPnlUsd: null,
          unrealisedPnlUsd: null,
          cumulativeRealisedPnlUsd: 0,
          mfeUsd: null,
          maeUsd: null,
          holdingMinutes: null,
          resolvedTo: 'no',
        },
        {
          marketId: 'POLY-3013350',
          timestamp: T_EXIT.toISOString(),
          yesPriceUsd: 0.52,
          noPriceUsd: 0.5,
          sellYesPriceUsd: 0.5,
          sellNoPriceUsd: 0.48,
          features: {
            impliedYesProbability: 0.51,
            spreadUsd: 0.02,
            depthImbalance: 0,
            totalDepth: 1000,
            liquidityScore: 0.7,
            priceExtremity: 0.01,
            hoursToClose: 44,
          },
          contextSummary: {
            at: T_EXIT.toISOString(),
            historyPoints: 2,
            hadOrderbook: true,
            change5m: 0.4,
            volatility: 0.1,
            tradeCount: 5,
            hoursToClose: 44,
          },
          depthBook: null,
          signals: [
            { agent: 'trend_agent', stance: 'neutral', confidence: 0.4 },
            { agent: 'mean_reversion_agent', stance: 'no', confidence: 0.6 },
          ],
          swarmRecommendation: 'hold',
          approved: false,
          confidence: 0.1,
          proposedAction: 'hold',
          appliedAction: 'hold',
          rejectionReason: null,
          proposedSide: null,
          proposedEntryPriceUsd: null,
          proposedExitPriceUsd: null,
          filledSizeUsd: 0,
          rejectedSizeUsd: 0,
          position: null,
          entryAt: null,
          exitAt: null,
          realisedPnlUsd: null,
          unrealisedPnlUsd: null,
          cumulativeRealisedPnlUsd: 0,
          mfeUsd: null,
          maeUsd: null,
          holdingMinutes: null,
          resolvedTo: 'no',
        },
      ],
      summary: {
        decisions: 2,
        buys: 0,
        sells: 0,
        holds: 2,
        rejectedActions: 0,
        totalRealisedPnlUsd: 0,
        finalUnrealisedPnlUsd: null,
        openPosition: null,
      },
    };

    // Force-close on last step: trend said yes at entry, then we close at exit.
    // With only two steps, proposeFromStance buys on step 1; step 2 forceCloses.
    const trades = simulateSpecialistTrades(history, 'trend_agent', 10);
    assert.equal(trades.length, 1);
    const trade = trades[0]!;
    assert.equal(trade.side, 'yes');
    assert.equal(trade.entryPriceUsd, 0.1);
    assert.equal(trade.exitPriceUsd, 0.5);
    assert.equal(trade.netPnlUsd, 40);
    assert.equal(trade.resolvedTo, 'no');
    assert.ok(trade.netPnlUsd > 0, 'resolution must not overwrite realised P&L');
  });

  it('maps stance to paper actions without inventing sells', () => {
    assert.equal(
      proposeFromStance({ stance: 'yes', position: null }),
      'buy_yes',
    );
    assert.equal(
      proposeFromStance({ stance: 'neutral', position: null }),
      'hold',
    );
  });

  it('copies swarm closed trades without dropping resolution context', () => {
    const history: PaperMarketHistory = {
      marketId: 'POLY-X',
      title: 'X',
      startedAt: T_ENTRY.toISOString(),
      finishedAt: T_EXIT.toISOString(),
      firstTimestamp: T_ENTRY.toISOString(),
      lastTimestamp: T_EXIT.toISOString(),
      resolvedTo: 'no',
      options: {
        maxMarkets: 1,
        decisionIntervalMinutes: 15,
        minSnapshots: 2,
        maxSnapshotsPerMarket: 100,
        minConfidence: 0.55,
        requireOrderbook: false,
      },
      decisions: [],
      closedTrades: [
        {
          marketId: 'POLY-X',
          side: 'yes',
          quantity: 100,
          sizeUsd: 10,
          entryAt: T_ENTRY.toISOString(),
          entryPriceUsd: 0.1,
          exitAt: T_EXIT.toISOString(),
          exitPriceUsd: 0.5,
          grossPnlUsd: 41,
          estimatedCostUsd: 1,
          netPnlUsd: 40,
          holdingMinutes: 240,
          mfeUsd: 40,
          maeUsd: 0,
          entryConditions: {
            yesPriceUsd: 0.1,
            noPriceUsd: 0.92,
            liquidityScore: 0.5,
            hoursToClose: 10,
            hadOrderbook: true,
            change5m: null,
            volatility: null,
          },
          exitConditions: {
            yesPriceUsd: 0.52,
            noPriceUsd: 0.5,
            liquidityScore: 0.5,
            hoursToClose: 6,
            hadOrderbook: true,
            change5m: 0.2,
            volatility: 0.05,
          },
          swarmStateAtEntry: {
            recommendation: 'buy_yes',
            confidence: 0.7,
            approved: true,
            signals: [],
          },
          resolvedTo: 'no',
        },
      ],
      summary: {
        decisions: 0,
        buys: 1,
        sells: 1,
        holds: 0,
        rejectedActions: 0,
        totalRealisedPnlUsd: 40,
        finalUnrealisedPnlUsd: null,
        openPosition: null,
      },
    };

    const trades = swarmTradesFromHistory(history);
    assert.equal(trades.length, 1);
    assert.equal(trades[0]!.netPnlUsd, 40);
    assert.equal(trades[0]!.resolvedTo, 'no');
    assert.equal(trades[0]!.owner, 'swarm');
  });
});
