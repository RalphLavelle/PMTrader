import {
  CategoryGroup,
  EventMarketGroup,
  MarketListItem,
  PredictionEvent,
} from '../models/market.model';
import { categoryLabel, subcategoryLabel } from './category-emoji';
import { compareMarketTitles } from './market-sort';

const CATEGORY_ORDER = [
  'crypto',
  'sports',
  'politics',
  'esports',
  'culture',
  'economics',
  'tech',
];

/** Group markets by event; filter open-only by default; sort markets within each event. */
export function buildEventGroups(
  events: PredictionEvent[],
  showClosed: boolean,
): EventMarketGroup[] {
  const groups: EventMarketGroup[] = [];

  for (const event of events) {
    const markets: MarketListItem[] = [];

    for (const market of event.markets ?? []) {
      const isOpen = market.status === 'open';
      if (!isOpen && !showClosed) {
        continue;
      }

      markets.push({
        marketId: market.marketId,
        marketTitle: market.title,
        eventId: event.eventId,
        eventTitle: event.metadata.title,
        category: event.category,
        subcategory: event.subcategory ?? 'general',
        status: market.status,
        buyYesPriceUsd: market.pricing?.buyYesPriceUsd,
        buyNoPriceUsd: market.pricing?.buyNoPriceUsd,
      });
    }

    if (markets.length === 0) {
      continue;
    }

    markets.sort((a, b) => compareMarketTitles(a.marketTitle, b.marketTitle));

    groups.push({
      eventId: event.eventId,
      eventTitle: event.metadata.title,
      category: event.category,
      subcategory: event.subcategory ?? 'general',
      markets,
    });
  }

  return groups;
}

/** Nest event groups into category → subcategory for the expandable markets UI. */
export function buildCategoryHierarchy(
  events: PredictionEvent[],
  showClosed: boolean,
): CategoryGroup[] {
  const eventGroups = buildEventGroups(events, showClosed);
  const categoryMap = new Map<string, Map<string, EventMarketGroup[]>>();

  for (const group of eventGroups) {
    const categoryKey = group.category.toLowerCase();
    const subcategoryKey = group.subcategory.toLowerCase();

    if (!categoryMap.has(categoryKey)) {
      categoryMap.set(categoryKey, new Map());
    }

    const subMap = categoryMap.get(categoryKey)!;
    if (!subMap.has(subcategoryKey)) {
      subMap.set(subcategoryKey, []);
    }

    subMap.get(subcategoryKey)!.push(group);
  }

  const categories: CategoryGroup[] = [];

  for (const [categoryKey, subMap] of categoryMap) {
    const subcategories = Array.from(subMap.entries())
      .map(([subcategoryKey, subEvents]) => {
        subEvents.sort((a, b) => a.eventTitle.localeCompare(b.eventTitle));
        const marketCount = subEvents.reduce((sum, event) => sum + event.markets.length, 0);

        return {
          subcategory: subcategoryKey,
          subcategoryLabel: subcategoryLabel(subcategoryKey),
          events: subEvents,
          eventCount: subEvents.length,
          marketCount,
        };
      })
      .sort((a, b) => a.subcategoryLabel.localeCompare(b.subcategoryLabel));

    const eventCount = subcategories.reduce((sum, sub) => sum + sub.eventCount, 0);
    const marketCount = subcategories.reduce((sum, sub) => sum + sub.marketCount, 0);

    categories.push({
      category: categoryKey,
      categoryLabel: categoryLabel(categoryKey),
      subcategories,
      eventCount,
      marketCount,
    });
  }

  categories.sort((a, b) => {
    const aIndex = CATEGORY_ORDER.indexOf(a.category);
    const bIndex = CATEGORY_ORDER.indexOf(b.category);
    const aRank = aIndex === -1 ? CATEGORY_ORDER.length : aIndex;
    const bRank = bIndex === -1 ? CATEGORY_ORDER.length : bIndex;
    if (aRank !== bRank) {
      return aRank - bRank;
    }
    return a.categoryLabel.localeCompare(b.categoryLabel);
  });

  return categories;
}
