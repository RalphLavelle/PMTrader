import { matchesCategory, effectiveCategories } from '../collector/category-filter.js';
import { loadSchedule } from '../collector/schedule.js';
import { getMarketLabels, getMarketSnapshots } from '../collector/store.js';
import type { LabelCandidate, LabelCandidateReason } from './types.js';

/**
 * Deciding which markets are worth asking Jupiter about.
 *
 * The collector's `labels` stream only checks the handful of ids in
 * `schedule.json`, but the market_snapshots stream collects price history for
 * hundreds of markets. Without discovery, almost none of that history would ever
 * get an outcome label — which is exactly the gap Phase 3 closes.
 *
 * Every candidate costs one Jupiter request, so the selection is deliberately
 * narrow: only markets that plausibly settled, never anything still trading.
 */

/** Latest known state of one market, folded down from its snapshot history. */
interface LatestMarketState {
  _id: string;
  title: string;
  status: string;
  result: 'yes' | 'no' | null;
  closeTime: number | null;
  lastSeenAt: Date;
  category?: string;
}

/**
 * Fold `market_snapshots` down to one row per market: the newest values seen.
 *
 * `$sort` before `$group` lets `$first` mean "most recent". The sort is served
 * by the `{ marketId: 1, capturedAt: -1 }` index created in the collector store,
 * so this stays cheap as snapshot history grows.
 */
async function loadLatestMarketStates(): Promise<LatestMarketState[]> {
  return getMarketSnapshots()
    .aggregate<LatestMarketState>([
      { $sort: { capturedAt: -1 } },
      {
        $group: {
          _id: '$marketId',
          title: { $first: '$title' },
          status: { $first: '$status' },
          result: { $first: '$result' },
          closeTime: { $first: '$closeTime' },
          lastSeenAt: { $first: '$capturedAt' },
          category: { $first: '$category' },
        },
      },
    ])
    .toArray();
}

/** Every market that already has a label, mapped to whether it is decisive. */
async function loadLabelledMarkets(): Promise<Map<string, boolean>> {
  const labels = await getMarketLabels()
    .find({}, { projection: { marketId: 1, result: 1 } })
    .toArray();

  return new Map(
    labels.map((label) => [label.marketId, label.result === 'yes' || label.result === 'no']),
  );
}

/**
 * Why this market is worth a Jupiter call, or null to leave it alone.
 *
 * Note the ordering: a market already labelled as closed-but-undecided is still
 * worth re-checking, because Jupiter often publishes the winning side minutes or
 * hours after trading stops.
 */
function candidateReason(
  state: LatestMarketState,
  hasLabel: boolean,
  nowSeconds: number,
): LabelCandidateReason | null {
  if (hasLabel) {
    return 'awaiting-result';
  }
  if (state.status !== 'open' || state.result !== null) {
    return 'status-changed';
  }
  if (state.closeTime !== null && state.closeTime > 0 && state.closeTime <= nowSeconds) {
    return 'past-close';
  }
  return null;
}

/**
 * Markets that look settled but have no decisive label yet.
 *
 * Ordered by close time, oldest first, so the markets most likely to have
 * resolved are checked before newer ones when the batch size bites.
 */
export async function findLabelCandidates(now: Date = new Date()): Promise<LabelCandidate[]> {
  const [states, labelled] = await Promise.all([
    loadLatestMarketStates(),
    loadLabelledMarkets(),
  ]);

  const schedule = await loadSchedule();
  const allowedCategories = effectiveCategories(schedule.streams.market_snapshots.options);
  const filteredStates =
    allowedCategories.length > 0
      ? states.filter((state) => matchesCategory(state.category, allowedCategories))
      : states;

  const nowSeconds = Math.floor(now.getTime() / 1_000);
  const candidates: LabelCandidate[] = [];

  for (const state of filteredStates) {
    // A decisive label is final — never spend a request re-confirming it.
    if (labelled.get(state._id) === true) {
      continue;
    }

    const reason = candidateReason(state, labelled.has(state._id), nowSeconds);
    if (!reason) {
      continue;
    }

    candidates.push({
      marketId: state._id,
      title: state.title,
      status: state.status,
      closeTime: state.closeTime,
      reason,
    });
  }

  // Markets with no close time sort last: we have least reason to expect them.
  candidates.sort((a, b) => (a.closeTime ?? Infinity) - (b.closeTime ?? Infinity));

  return candidates;
}

/** How many collected markets carry a decisive yes/no label. */
export async function countResolvedMarkets(): Promise<number> {
  return getMarketLabels().countDocuments({ result: { $in: ['yes', 'no'] } });
}
