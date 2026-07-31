/** A filled trade from the Jupiter global trade feed. */
export interface Trade {
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

/** Paginated API response wrapper. */
export interface TradesResponse {
  data: Trade[];
  pagination?: {
    start: number;
    end: number;
    total: number;
    hasNext: boolean;
  };
}

/** Account history event (orders, fills, claims). */
export interface HistoryEvent {
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
  eventMetadata?: { title?: string; category?: string };
  marketMetadata?: { title?: string; status?: string };
}

export interface HistoryResponse {
  data: HistoryEvent[];
  pagination?: TradesResponse['pagination'];
}
