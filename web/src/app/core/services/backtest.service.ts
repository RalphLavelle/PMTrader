import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { BacktestStatus, BacktestSummary, PaperReplaySummary } from '../models/backtest.model';

/** Options a user can override from the dashboard before running a backtest. */
export interface BacktestRunOptions {
  markets?: number;
  intervalMinutes?: number;
  exitHoldMinutes?: number;
  requireOrderbook?: boolean;
  /** Sweep the approval threshold without changing production config. */
  minConfidence?: number;
}

/** Calls the PMTrader /api/backtest endpoints (Phase 4 offline evaluation). */
@Injectable({ providedIn: 'root' })
export class BacktestService {
  private readonly http = inject(HttpClient);

  /** Whether a run is in flight, plus the last result and how much answer key exists. */
  getStatus(): Observable<BacktestStatus> {
    return this.http.get<BacktestStatus>('/api/backtest/status');
  }

  /**
   * Start a replay over markets with enough open-path history.
   *
   * POST because it is a deliberate, expensive action. It can take a while on a
   * large dataset, so the caller should show a busy state rather than assume
   * it returns immediately.
   */
  run(options?: BacktestRunOptions): Observable<BacktestSummary> {
    let params = new HttpParams();
    if (options?.markets !== undefined) {
      params = params.set('markets', String(options.markets));
    }
    if (options?.intervalMinutes !== undefined) {
      params = params.set('intervalMinutes', String(options.intervalMinutes));
    }
    if (options?.exitHoldMinutes !== undefined) {
      params = params.set('exitHoldMinutes', String(options.exitHoldMinutes));
    }
    if (options?.minConfidence !== undefined) {
      params = params.set('minConfidence', String(options.minConfidence));
    }
    if (options?.requireOrderbook) {
      params = params.set('requireOrderbook', 'true');
    }
    return this.http.post<BacktestSummary>('/api/backtest/run', null, { params });
  }

  /**
   * Chronological paper replay with a stateful portfolio.
   *
   * Fills use ask/bid (never mid), depth, slippage, and fees — see PAPER_* env.
   */
  runPaperReplay(options?: BacktestRunOptions): Observable<PaperReplaySummary> {
    let params = new HttpParams();
    if (options?.markets !== undefined) {
      params = params.set('markets', String(options.markets));
    }
    if (options?.intervalMinutes !== undefined) {
      params = params.set('intervalMinutes', String(options.intervalMinutes));
    }
    if (options?.minConfidence !== undefined) {
      params = params.set('minConfidence', String(options.minConfidence));
    }
    if (options?.requireOrderbook) {
      params = params.set('requireOrderbook', 'true');
    }
    return this.http.post<PaperReplaySummary>('/api/backtest/paper/run', null, { params });
  }
}
