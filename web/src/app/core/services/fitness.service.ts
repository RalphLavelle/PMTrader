import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AdaptiveWeightTable,
  AgentFitness,
  FitnessReport,
  FitnessStatus,
} from '../models/fitness.model';

/** Options a user can override from the dashboard before running a pass. */
export interface FitnessRunOptions {
  markets?: number;
  intervalMinutes?: number;
  maxRuns?: number;
  minSample?: number;
  requireOrderbook?: boolean;
  /** Live runs are included by default; only send this to turn them off. */
  includeLiveRuns?: boolean;
}

/** Calls the PMTrader /api/fitness endpoints (Phase 5 agent fitness). */
@Injectable({ providedIn: 'root' })
export class FitnessService {
  private readonly http = inject(HttpClient);

  /** Whether a pass is in flight, plus the last report and how much answer key exists. */
  getStatus(): Observable<FitnessStatus> {
    return this.http.get<FitnessStatus>('/api/fitness/status');
  }

  /**
   * Grade every specialist against markets that have already resolved.
   *
   * POST because it replays the whole dataset. On a large archive this takes a
   * while, so callers should show a busy state rather than assume it is quick.
   */
  run(options?: FitnessRunOptions): Observable<FitnessReport> {
    let params = new HttpParams();
    if (options?.markets !== undefined) {
      params = params.set('markets', String(options.markets));
    }
    if (options?.intervalMinutes !== undefined) {
      params = params.set('intervalMinutes', String(options.intervalMinutes));
    }
    if (options?.maxRuns !== undefined) {
      params = params.set('maxRuns', String(options.maxRuns));
    }
    if (options?.minSample !== undefined) {
      params = params.set('minSample', String(options.minSample));
    }
    if (options?.requireOrderbook) {
      params = params.set('requireOrderbook', 'true');
    }
    if (options?.includeLiveRuns === false) {
      params = params.set('includeLiveRuns', 'false');
    }
    return this.http.post<FitnessReport>('/api/fitness/run', null, { params });
  }

  /** Full drill-down for one specialist from the last completed pass. */
  getAgent(agent: string): Observable<AgentFitness> {
    return this.http.get<AgentFitness>(`/api/fitness/agents/${encodeURIComponent(agent)}`);
  }

  /**
   * Current adaptive weights with evidence.
   *
   * Optional regime query re-blends toward "how did this agent do when the
   * market looked like this?"
   */
  getWeights(options?: {
    liquidityScore?: number;
    hoursToClose?: number;
    marketYes?: number;
    hadOrderbook?: boolean;
  }): Observable<AdaptiveWeightTable & { regimeQuery?: unknown }> {
    let params = new HttpParams();
    if (options?.liquidityScore !== undefined) {
      params = params.set('liquidityScore', String(options.liquidityScore));
    }
    if (options?.hoursToClose !== undefined) {
      params = params.set('hoursToClose', String(options.hoursToClose));
    }
    if (options?.marketYes !== undefined) {
      params = params.set('marketYes', String(options.marketYes));
    }
    if (options?.hadOrderbook) {
      params = params.set('hadOrderbook', 'true');
    }
    return this.http.get<AdaptiveWeightTable & { regimeQuery?: unknown }>(
      '/api/fitness/weights',
      { params },
    );
  }
}
