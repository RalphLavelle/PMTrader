import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Orderbook } from '../models/order.model';
import { EventsCatalogResponse, EventsResponse, MarketDetail } from '../models/market.model';

/** Calls PMTrader API endpoints for events and markets. */
@Injectable({ providedIn: 'root' })
export class MarketsService {
  private readonly http = inject(HttpClient);

  /** Full catalog with every category (MongoDB snapshot + background Jupiter refresh). */
  getCatalog(refresh = false): Observable<EventsCatalogResponse> {
    let params = new HttpParams();
    if (refresh) {
      params = params.set('refresh', 'true');
    }
    return this.http.get<EventsCatalogResponse>('/api/events/catalog', { params });
  }

  /** List events with nested markets from Jupiter. */
  getEvents(options?: {
    filter?: string;
    category?: string;
    start?: number;
    end?: number;
  }): Observable<EventsResponse> {
    let params = new HttpParams().set('includeMarkets', 'true');
    if (options?.filter) {
      params = params.set('filter', options.filter);
    }
    if (options?.category) {
      params = params.set('category', options.category);
    }
    if (options?.start !== undefined) {
      params = params.set('start', String(options.start));
    }
    if (options?.end !== undefined) {
      params = params.set('end', String(options.end));
    }
    return this.http.get<EventsResponse>('/api/events', { params });
  }

  /** Detailed market information including pricing and rules. */
  getMarket(marketId: string): Observable<MarketDetail> {
    return this.http.get<MarketDetail>(`/api/markets/${encodeURIComponent(marketId)}`);
  }

  /** Orderbook depth for a market. */
  getOrderbook(marketId: string): Observable<Orderbook> {
    return this.http.get<Orderbook>(
      `/api/markets/${encodeURIComponent(marketId)}/orderbook`,
    );
  }
}
