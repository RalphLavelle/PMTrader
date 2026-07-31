import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { HistoryResponse, TradesResponse } from '../models/trade.model';

/** Calls the PMTrader API, which proxies Jupiter Prediction endpoints. */
@Injectable({ providedIn: 'root' })
export class TradesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/trades';

  /** Platform-wide recent filled trades. */
  getRecentTrades(): Observable<TradesResponse> {
    return this.http.get<TradesResponse>(this.baseUrl);
  }

  /** Wallet-specific transaction history. */
  getHistory(ownerPubkey?: string): Observable<HistoryResponse> {
    const params = ownerPubkey ? { ownerPubkey } : undefined;
    return this.http.get<HistoryResponse>(`${this.baseUrl}/history`, { params });
  }
}
