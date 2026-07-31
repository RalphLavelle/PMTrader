/** Jupiter Prediction API shared pagination wrapper. */
export interface PaginatedResponse<T> {
  data: T[];
  pagination?: {
    start: number;
    end: number;
    total: number;
    hasNext: boolean;
  };
}

/** A filled trade from the global trade feed (GET /trades). */
export interface JupiterTrade {
  id: number | string;
  ownerPubkey: string;
  marketId: string;
  message: string;
  timestamp: number;
  action: 'buy' | 'sell';
  side: 'yes' | 'no';
  eventTitle: string;
  marketTitle: string;
  amountUsd: string;
  priceUsd: string;
  eventImageUrl?: string;
  eventId: string;
}

/** History event from GET /history (user account activity). */
export interface JupiterHistoryEvent {
  id: number;
  eventType: string;
  signature: string;
  timestamp: number;
  ownerPubkey: string;
  marketId: string;
  isBuy?: boolean;
  isYes?: boolean;
  filledContracts?: string;
  avgFillPriceUsd?: string;
  totalCostUsd?: string;
  feeUsd?: string | null;
  realizedPnl?: string | null;
  eventMetadata?: {
    title?: string;
    category?: string;
  };
  marketMetadata?: {
    title?: string;
    status?: string;
  };
}

/** Market pricing from Jupiter events/markets endpoints. */
export interface JupiterMarketPricing {
  buyYesPriceUsd: number;
  buyNoPriceUsd: number;
  sellYesPriceUsd: number;
  sellNoPriceUsd: number;
  volume: number;
}

/** A binary market nested under an event. */
export interface JupiterMarketSummary {
  marketId: string;
  eventId?: string;
  provider: string;
  title: string;
  status: string;
  result: 'yes' | 'no' | null;
  openTime: number;
  closeTime: number;
  pricing?: JupiterMarketPricing;
  outcomes?: string[];
}

/** Prediction event with optional nested markets. */
export interface JupiterEvent {
  eventId: string;
  category: string;
  subcategory?: string;
  isActive: boolean;
  isLive: boolean;
  volumeUsd?: string;
  metadata: {
    title: string;
    subtitle?: string;
    imageUrl?: string;
    closeTime?: string;
  };
  markets?: JupiterMarketSummary[];
}

/** Full market detail from GET /markets/{marketId}. */
export interface JupiterMarketDetail extends JupiterMarketSummary {
  rulesPrimary?: string;
  rulesSecondary?: string;
  resolveAt?: string | null;
  imageUrl?: string | null;
  isTeamMarket?: boolean;
}
