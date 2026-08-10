import type { MarketSnapshotDoc, TradeDoc } from '../collector/types.js';
import { getMarketSnapshots, getTrades } from '../collector/store.js';

/** Human-readable fields for market labels in dashboards and tables. */
export interface MarketDisplayMeta {
  title: string;
  eventTitle?: string;
  category?: string;
}

type SnapshotMetaRow = {
  _id: string;
  title: string;
  category?: string;
  eventTitle?: string;
  eventId?: string;
};

type TradeTitleRow = {
  _id: string;
  eventTitle?: string;
  marketTitle?: string;
};

/** Resolve event questions shared by many strike markets on one event. */
async function lookupEventTitlesByEventId(
  eventIds: string[],
): Promise<Map<string, string>> {
  const uniqueEventIds = [...new Set(eventIds.filter(Boolean))];
  const titles = new Map<string, string>();
  if (uniqueEventIds.length === 0) {
    return titles;
  }

  const [fromSnapshots, fromTrades] = await Promise.all([
    getMarketSnapshots()
      .aggregate<{ _id: string; eventTitle: string }>([
        {
          $match: {
            eventId: { $in: uniqueEventIds },
            eventTitle: { $exists: true, $ne: '' },
          },
        },
        { $sort: { capturedAt: -1 } },
        { $group: { _id: '$eventId', eventTitle: { $first: '$eventTitle' } } },
      ])
      .toArray(),
    getTrades()
      .aggregate<{ _id: string; eventTitle: string }>([
        {
          $match: {
            eventId: { $in: uniqueEventIds },
            eventTitle: { $exists: true, $ne: '' },
          },
        },
        { $sort: { timestamp: -1 } },
        { $group: { _id: '$eventId', eventTitle: { $first: '$eventTitle' } } },
      ])
      .toArray(),
  ]);

  for (const row of fromSnapshots) {
    titles.set(row._id, row.eventTitle);
  }
  for (const row of fromTrades) {
    if (!titles.has(row._id)) {
      titles.set(row._id, row.eventTitle);
    }
  }

  return titles;
}

function resolveEventTitle(
  row: SnapshotMetaRow,
  trade: TradeTitleRow | undefined,
  eventTitles: Map<string, string>,
): string | undefined {
  if (row.eventTitle) {
    return row.eventTitle;
  }
  if (trade?.eventTitle) {
    return trade.eventTitle;
  }
  if (row.eventId) {
    return eventTitles.get(row.eventId);
  }
  return undefined;
}

/** Load title, event question, and category for a set of market ids. */
export async function lookupMarketDisplayMeta(
  marketIds: string[],
): Promise<Map<string, MarketDisplayMeta>> {
  const uniqueIds = [...new Set(marketIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const snapshotRows = await getMarketSnapshots()
    .aggregate<SnapshotMetaRow>([
      { $match: { marketId: { $in: uniqueIds } } },
      { $sort: { capturedAt: -1 } },
      {
        $group: {
          _id: '$marketId',
          title: { $first: '$title' },
          category: { $first: '$category' },
          eventTitle: { $first: '$eventTitle' },
          eventId: { $first: '$eventId' },
        },
      },
    ])
    .toArray();

  const tradeRows = await getTrades()
    .aggregate<TradeTitleRow>([
      {
        $match: {
          marketId: { $in: uniqueIds },
          $or: [
            { eventTitle: { $exists: true, $ne: '' } },
            { marketTitle: { $exists: true, $ne: '' } },
          ],
        },
      },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$marketId',
          eventTitle: { $first: '$eventTitle' },
          marketTitle: { $first: '$marketTitle' },
        },
      },
    ])
    .toArray();

  const tradeByMarket = new Map(tradeRows.map((row) => [row._id, row]));
  const eventIdsMissingTitle = snapshotRows
    .filter((row) => !row.eventTitle && !tradeByMarket.get(row._id)?.eventTitle && row.eventId)
    .map((row) => row.eventId!);
  const eventTitles = await lookupEventTitlesByEventId(eventIdsMissingTitle);

  const map = new Map<string, MarketDisplayMeta>();

  for (const row of snapshotRows) {
    const trade = tradeByMarket.get(row._id);
    map.set(row._id, {
      title: row.title || trade?.marketTitle || row._id,
      eventTitle: resolveEventTitle(row, trade, eventTitles),
      category: row.category,
    });
  }

  for (const row of tradeRows) {
    if (!map.has(row._id)) {
      map.set(row._id, {
        title: row.marketTitle || row._id,
        eventTitle: row.eventTitle,
      });
    }
  }

  for (const id of uniqueIds) {
    if (!map.has(id)) {
      map.set(id, { title: id });
    }
  }

  return map;
}

/** Display meta for one market detail page. */
export async function loadMarketDisplayMeta(
  marketId: string,
  latestSnapshot?: MarketSnapshotDoc | null,
  trades?: TradeDoc[],
): Promise<MarketDisplayMeta> {
  const tradeWithTitles = trades?.find((t) => t.eventTitle || t.marketTitle);
  let eventTitle = latestSnapshot?.eventTitle ?? tradeWithTitles?.eventTitle;

  if (!eventTitle && latestSnapshot?.eventId) {
    const byEvent = await lookupEventTitlesByEventId([latestSnapshot.eventId]);
    eventTitle = byEvent.get(latestSnapshot.eventId);
  }

  return {
    title: latestSnapshot?.title || tradeWithTitles?.marketTitle || marketId,
    eventTitle,
    category: latestSnapshot?.category,
  };
}
