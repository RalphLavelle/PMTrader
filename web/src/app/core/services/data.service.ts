import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  DatasetOverview,
  FeaturesDataResponse,
  MarketCoverage,
  MarketDetailData,
  OrderbookCoverage,
  OrderbookDetailData,
  TradesDataResponse,
} from '../models/data.model';

/** Calls PMTrader /api/data endpoints for the research-dataset dashboards. */
@Injectable({ providedIn: 'root' })
export class DataService {
  private readonly http = inject(HttpClient);

  /** Collection coverage + collector schedule health. */
  getOverview(): Observable<DatasetOverview> {
    return this.http.get<DatasetOverview>('/api/data/overview');
  }

  /** Markets present in market_snapshots. */
  getMarkets(options?: {
    search?: string;
    limit?: number;
    category?: string;
  }): Observable<{ data: MarketCoverage[] }> {
    let params = new HttpParams();
    if (options?.search) {
      params = params.set('search', options.search);
    }
    if (options?.limit !== undefined) {
      params = params.set('limit', String(options.limit));
    }
    if (options?.category) {
      params = params.set('category', options.category);
    }
    return this.http.get<{ data: MarketCoverage[] }>('/api/data/markets', { params });
  }

  /** Price series + joined features for one market. */
  getMarketDetail(marketId: string): Observable<MarketDetailData> {
    return this.http.get<MarketDetailData>(
      `/api/data/markets/${encodeURIComponent(marketId)}`,
    );
  }

  /** Markets with orderbook captures. */
  getOrderbookMarkets(limit = 50): Observable<{ data: OrderbookCoverage[] }> {
    const params = new HttpParams().set('limit', String(limit));
    return this.http.get<{ data: OrderbookCoverage[] }>('/api/data/orderbooks', { params });
  }

  /** Latest ladder + spread series for one market. */
  getOrderbookDetail(marketId: string): Observable<OrderbookDetailData> {
    return this.http.get<OrderbookDetailData>(
      `/api/data/orderbooks/${encodeURIComponent(marketId)}`,
    );
  }

  /** Recent collected fills (not the live Jupiter proxy). */
  getTrades(options?: { marketId?: string; limit?: number }): Observable<TradesDataResponse> {
    let params = new HttpParams();
    if (options?.marketId) {
      params = params.set('marketId', options.marketId);
    }
    if (options?.limit !== undefined) {
      params = params.set('limit', String(options.limit));
    }
    return this.http.get<TradesDataResponse>('/api/data/trades', { params });
  }

  /** Flat feature table for the explorer. */
  getFeatures(marketId: string): Observable<FeaturesDataResponse> {
    return this.http.get<FeaturesDataResponse>(
      `/api/data/features/${encodeURIComponent(marketId)}`,
    );
  }
}
