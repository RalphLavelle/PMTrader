import { config } from '../config.js';
import type {
  JupiterEvent,
  JupiterHistoryEvent,
  JupiterMarketDetail,
  JupiterTrade,
  PaginatedResponse,
} from './types.js';

/** HTTP client for the Jupiter Prediction Market API. */
export class JupiterClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl = config.jupiterBaseUrl, apiKey = config.jupiterApiKey) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  /** True when an API key is configured (required for production rate limits). */
  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  private async request<T>(path: string, query?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== '') {
          url.searchParams.set(key, value);
        }
      }
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      const body = await response.text();
      throw new JupiterApiError(response.status, body);
    }

    return response.json() as Promise<T>;
  }

  /** Recent filled trades across all markets. */
  getTrades(): Promise<PaginatedResponse<JupiterTrade>> {
    return this.request<PaginatedResponse<JupiterTrade>>('/trades');
  }

  /** Transaction history for a wallet (orders, fills, claims, etc.). */
  getHistory(
    ownerPubkey: string,
    start?: number,
    end?: number,
  ): Promise<PaginatedResponse<JupiterHistoryEvent>> {
    const query: Record<string, string> = { ownerPubkey };
    if (start !== undefined) {
      query['start'] = String(start);
    }
    if (end !== undefined) {
      query['end'] = String(end);
    }
    return this.request<PaginatedResponse<JupiterHistoryEvent>>('/history', query);
  }

  /** List prediction events, optionally including nested markets. */
  getEvents(query: Record<string, string>): Promise<PaginatedResponse<JupiterEvent>> {
    return this.request<PaginatedResponse<JupiterEvent>>('/events', query);
  }

  /** Detailed market information including current pricing. */
  getMarket(marketId: string): Promise<JupiterMarketDetail> {
    return this.request<JupiterMarketDetail>(`/markets/${encodeURIComponent(marketId)}`);
  }
}

export class JupiterApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Jupiter API error ${status}: ${body}`);
    this.name = 'JupiterApiError';
  }
}
