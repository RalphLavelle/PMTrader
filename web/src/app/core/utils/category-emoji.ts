/** Map Jupiter event categories to display emojis. */
const CATEGORY_EMOJI: Record<string, string> = {
  crypto: '🪙',
  sports: '⚽',
  politics: '🏛️',
  esports: '🎮',
  culture: '🎭',
  economics: '📊',
  tech: '💻',
};

/** Return an emoji for a category, with a neutral fallback. */
export function categoryEmoji(category: string): string {
  return CATEGORY_EMOJI[category.toLowerCase()] ?? '📋';
}

/** Accessible label paired with the emoji for screen readers. */
export function categoryLabel(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}
