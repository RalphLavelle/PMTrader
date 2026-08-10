import { lookupMarketDisplayMeta } from '../features/market-display.js';

/** Attach event question + category for dashboard market labels. */
export async function enrichMarketLabelFields<
  T extends { marketId: string; title: string },
>(rows: T[]): Promise<Array<T & { eventTitle?: string; category?: string }>> {
  if (rows.length === 0) {
    return [];
  }

  const meta = await lookupMarketDisplayMeta(rows.map((row) => row.marketId));

  return rows.map((row) => {
    const display = meta.get(row.marketId);
    return {
      ...row,
      title: display?.title ?? row.title,
      eventTitle: display?.eventTitle,
      category: display?.category,
    };
  });
}
