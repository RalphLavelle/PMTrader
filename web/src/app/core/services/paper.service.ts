import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  PaperRunResponse,
  PaperStatus,
  PaperTradesResponse,
} from '../models/paper.model';

/** Calls the PMTrader /api/paper endpoints (continuous live paper trading). */
@Injectable({ providedIn: 'root' })
export class PaperService {
  private readonly http = inject(HttpClient);

  /** Loop config, portfolio totals, open positions, and last pass. */
  getStatus(): Observable<PaperStatus> {
    return this.http.get<PaperStatus>('/api/paper/status');
  }

  /** Closed live paper trades (newest first). */
  getTrades(limit = 100): Observable<PaperTradesResponse> {
    const params = new HttpParams().set('limit', String(limit));
    return this.http.get<PaperTradesResponse>('/api/paper/trades', { params });
  }

  /** Trigger one paper-trading pass immediately. */
  runPass(): Observable<PaperRunResponse> {
    return this.http.post<PaperRunResponse>('/api/paper/run', null);
  }
}
