/** Orderbook depth from the API. */
export interface Orderbook {
  yes: Array<[number, number]>;
  no: Array<[number, number]>;
  yes_dollars: Array<[string, number]>;
  no_dollars: Array<[string, number]>;
}

/** Create order request sent to our API. */
export interface CreateOrderRequest {
  ownerPubkey: string;
  marketId: string;
  isYes: boolean;
  isBuy: boolean;
  depositAmount: string;
  depositMint: string;
}

/** Unsigned order returned by Jupiter via our API. */
export interface CreateOrderResponse {
  transaction: string;
  txMeta: {
    blockhash: string;
    lastValidBlockHeight: number;
  };
  order: {
    orderPubkey: string;
    positionPubkey: string;
    contractsMicro?: string;
    contractsDecimal?: string;
    requiredSigners: string[];
  };
}

export interface TradingStatus {
  trading_active: boolean;
}
