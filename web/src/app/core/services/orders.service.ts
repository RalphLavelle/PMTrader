import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  CreateOrderRequest,
  CreateOrderResponse,
  TradingStatus,
} from '../models/order.model';

/** Calls PMTrader order and trading-status endpoints. */
@Injectable({ providedIn: 'root' })
export class OrdersService {
  private readonly http = inject(HttpClient);

  getTradingStatus(): Observable<TradingStatus> {
    return this.http.get<TradingStatus>('/api/trading-status');
  }

  /** Request an unsigned buy-order transaction from Jupiter. */
  createOrder(body: CreateOrderRequest): Observable<CreateOrderResponse> {
    return this.http.post<CreateOrderResponse>('/api/orders', body);
  }
}
