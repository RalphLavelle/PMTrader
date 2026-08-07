/** Market pricing from Jupiter. Amounts are in micro-USD (1_000_000 = $1). */
export interface MarketPricing {
  buyYesPriceUsd: number;
  buyNoPriceUsd: number;
  sellYesPriceUsd: number;
  sellNoPriceUsd: number;
  volume: number;
}

/** Market summary nested under an event. */
export interface MarketSummary {
  marketId: string;
  eventId?: string;
  provider: string;
  title: string;
  status: string;
  result: 'yes' | 'no' | null;
  openTime: number;
  closeTime: number;
  pricing?: MarketPricing;
  outcomes?: string[];
}

/** Prediction event with nested markets. */
export interface PredictionEvent {
  eventId: string;
  category: string;
  subcategory?: string;
  isActive: boolean;
  isLive: boolean;
  metadata: {
    title: string;
    subtitle?: string;
    imageUrl?: string;
  };
  markets?: MarketSummary[];
}

export interface EventsResponse {
  data: PredictionEvent[];
  pagination?: {
    start: number;
    end: number;
    total: number;
    hasNext: boolean;
  };
}

/** Flattened row for the markets list table. */
export interface MarketListItem {
  marketId: string;
  marketTitle: string;
  eventId: string;
  eventTitle: string;
  category: string;
  status: string;
  buyYesPriceUsd?: number;
  buyNoPriceUsd?: number;
}

/** Markets grouped under one event for the list UI. */
export interface EventMarketGroup {
  eventId: string;
  eventTitle: string;
  category: string;
  markets: MarketListItem[];
}

/** Full market detail from GET /markets/{marketId}. */
export interface MarketDetail extends MarketSummary {
  rulesPrimary?: string;
  rulesSecondary?: string;
  resolveAt?: string | null;
  imageUrl?: string | null;
  isTeamMarket?: boolean;
  marketOptions?: Array<{ label: string; buyYes: boolean }>;
  clobTokenIds?: string[];
  marketResultPubkey?: string | null;
  team?: string | null;
  sportsMarketType?: string | null;
  sportsLine?: string | null;
  gameNumber?: number | null;
}

/** Label/value pair for rendering all market fields. */
export interface MarketDetailField {
  label: string;
  value: string;
  /** When set, render as a coloured Yes/No badge instead of plain text. */
  outcome?: 'yes' | 'no' | boolean | null;
}
