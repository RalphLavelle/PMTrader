import type { PaperMarketHistory } from '../backtest/index.js';
import type { AgentName, Stance } from '../schemas/index.js';
import type { CompletedFitnessTrade, TradeBehaviourStats } from './types.js';

/**
 * Behavioural diagnostics around coherent paper trades.
 *
 * These count *patterns*, not P&L: missed moves while flat, exits that left
 * money on the table, losers, and positions that overstayed a deep drawdown.
 */

/** Favourable move (in price points) that counts as a missed opportunity. */
const MISSED_MOVE = 0.05;
/** Favourable continuation after exit that counts as premature. */
const PREMATURE_MOVE = 0.05;
/** How many later decision steps to scan for missed / premature patterns. */
const LOOKAHEAD_STEPS = 4;
/**
 * A trade is "held too long" when MAE was worse than this share of stake and
 * the exit recovered to less than half that drawdown.
 */
const HELD_TOO_LONG_MAE_SHARE = 0.15;

function sidePrice(side: 'yes' | 'no', yes: number, no: number): number {
  return side === 'yes' ? yes : no;
}

function stanceSide(stance: Stance): 'yes' | 'no' | null {
  if (stance === 'yes' || stance === 'no') return stance;
  return null;
}

/**
 * Count moments the book was flat, the owner wanted a side, and that side then
 * moved favourably within the next few decision steps — without them being in.
 */
export function countMissedOpportunities(
  history: PaperMarketHistory,
  owner: AgentName | 'swarm',
): number {
  let missed = 0;

  for (let i = 0; i < history.decisions.length; i += 1) {
    const decision = history.decisions[i];
    if (!decision) continue;

    // Only score while flat after this step.
    if (decision.position) continue;

    let wanted: 'yes' | 'no' | null = null;
    if (owner === 'swarm') {
      if (decision.swarmRecommendation === 'buy_yes') wanted = 'yes';
      else if (decision.swarmRecommendation === 'buy_no') wanted = 'no';
    } else {
      const signal = decision.signals.find((entry) => entry.agent === owner);
      wanted = signal ? stanceSide(signal.stance) : null;
    }
    if (!wanted) continue;

    // Swarm "wanted" but risk rejected still counts as a miss for the blend.
    if (owner === 'swarm' && decision.approved && decision.appliedAction.startsWith('buy_')) {
      continue;
    }

    const entryPrice = sidePrice(wanted, decision.yesPriceUsd, decision.noPriceUsd);
    let moved = false;

    for (let j = i + 1; j < Math.min(history.decisions.length, i + 1 + LOOKAHEAD_STEPS); j += 1) {
      const later = history.decisions[j];
      if (!later) continue;
      const laterPrice = sidePrice(wanted, later.yesPriceUsd, later.noPriceUsd);
      if (laterPrice - entryPrice >= MISSED_MOVE) {
        moved = true;
        break;
      }
    }

    if (moved) missed += 1;
  }

  return missed;
}

/** Exits followed by further favourable movement in the same side. */
export function countPrematureExits(trades: CompletedFitnessTrade[], history: PaperMarketHistory): number {
  let premature = 0;

  for (const trade of trades) {
    const exitIndex = history.decisions.findIndex((d) => d.timestamp === trade.exitAt);
    if (exitIndex < 0) continue;

    for (
      let j = exitIndex + 1;
      j < Math.min(history.decisions.length, exitIndex + 1 + LOOKAHEAD_STEPS);
      j += 1
    ) {
      const later = history.decisions[j];
      if (!later) continue;
      const laterPrice = sidePrice(trade.side, later.yesPriceUsd, later.noPriceUsd);
      if (laterPrice - trade.exitPriceUsd >= PREMATURE_MOVE) {
        premature += 1;
        break;
      }
    }
  }

  return premature;
}

/** Positions that rode a deep adverse excursion and barely recovered by exit. */
export function countHeldTooLong(trades: CompletedFitnessTrade[]): number {
  let count = 0;
  for (const trade of trades) {
    const maeShare = trade.sizeUsd > 0 ? Math.abs(Math.min(0, trade.maeUsd)) / trade.sizeUsd : 0;
    if (maeShare < HELD_TOO_LONG_MAE_SHARE) continue;
    // Exit recovered less than half the peak adverse move.
    if (trade.netPnlUsd > trade.maeUsd * 0.5) continue;
    count += 1;
  }
  return count;
}

/**
 * Roll behaviour tallies for one owner across every paper-replayed market.
 */
export function summariseBehaviour(
  histories: PaperMarketHistory[],
  owner: AgentName | 'swarm',
  trades: CompletedFitnessTrade[],
  drawdownEvents: number,
): TradeBehaviourStats {
  let missedOpportunities = 0;
  let prematureExits = 0;

  for (const history of histories) {
    const mine = trades.filter((trade) => trade.marketId === history.marketId);
    missedOpportunities += countMissedOpportunities(history, owner);
    prematureExits += countPrematureExits(mine, history);
  }

  return {
    missedOpportunities,
    prematureExits,
    losingExits: trades.filter((trade) => trade.netPnlUsd < 0).length,
    heldTooLong: countHeldTooLong(trades),
    drawdownEvents,
  };
}
