/**
 * Sort market titles within an event.
 * Uses numeric order when titles contain numbers (e.g. "↓ 60,000"),
 * otherwise falls back to alphabetical order.
 */
export function compareMarketTitles(a: string, b: string): number {
  const keyA = extractSortKey(a);
  const keyB = extractSortKey(b);

  if (keyA.type === 'numeric' && keyB.type === 'numeric') {
    return keyA.value - keyB.value;
  }

  return keyA.sortText.localeCompare(keyB.sortText, undefined, { sensitivity: 'base' });
}

function extractSortKey(title: string): { type: 'numeric' | 'alpha'; value: number; sortText: string } {
  // Match the first number in the title (handles "↓ 60,000", "$500k", etc.).
  const match = title.match(/(\d[\d,]*(?:\.\d+)?)/);
  if (match) {
    const value = Number.parseFloat(match[1].replace(/,/g, ''));
    if (!Number.isNaN(value)) {
      return { type: 'numeric', value, sortText: title.toLowerCase() };
    }
  }

  return { type: 'alpha', value: 0, sortText: title.toLowerCase() };
}

export function sortMarketTitles(titles: string[]): string[] {
  return [...titles].sort(compareMarketTitles);
}
