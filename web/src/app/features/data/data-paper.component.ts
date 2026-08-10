import { DecimalPipe, UpperCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { PaperClosedTrade, PaperStatus } from '../../core/models/paper.model';
import { PaperService } from '../../core/services/paper.service';
import { humaniseAgent } from '../../core/utils/format-stats';
import { OutcomeBadgeComponent } from '../../shared/outcome-badge.component';
import { DataNavComponent } from './data-nav.component';
import { FitnessAdaptiveWeightsComponent } from './fitness-adaptive-weights.component';
import { FitnessEquityChartsComponent } from './fitness-equity-charts.component';
import { CompletedFitnessTrade } from '../../core/models/fitness.model';

/**
 * Live paper-trading dashboard (Phase 7).
 *
 * PAPER ONLY — shows the continuous loop's portfolio, open positions, closed
 * trades, and adaptive weights. Never places real Jupiter orders.
 */
@Component({
  selector: 'app-data-paper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DataNavComponent,
    DecimalPipe,
    UpperCasePipe,
    OutcomeBadgeComponent,
    FitnessAdaptiveWeightsComponent,
    FitnessEquityChartsComponent,
  ],
  template: `
    <section class="page data" aria-labelledby="data-paper-heading">
      <header class="page__header">
        <div>
          <h1 id="data-paper-heading">📝 Live paper trading</h1>
          <p class="page__subtitle">
            Continuous simulated trading over collector tips — same decision engine
            as backtests. <strong>Paper only</strong>; no real orders are placed.
          </p>
        </div>
      </header>

      <app-data-nav />

      <div class="data__controls">
        <button
          type="button"
          class="page__action"
          [disabled]="running() || !status()?.enabled"
          (click)="runPass()"
        >
          {{ running() ? 'Running pass…' : 'Run one pass now' }}
        </button>
        <button type="button" class="page__action" (click)="refresh()">
          Refresh status
        </button>
      </div>

      @if (error(); as message) {
        <p class="page__status page__status--error" role="alert">{{ message }}</p>
      }

      @if (status(); as s) {
        @if (!s.enabled) {
          <p class="data__sparse" role="status">
            Live paper trading is disabled. Set <code>PAPER_TRADING_ENABLED=true</code>
            in <code>.env</code> and restart the API. The collector should also be
            running so fresh market tips exist.
          </p>
        } @else {
          <p class="data__hint" role="status">
            Loop every {{ (s.intervalMs / 1000) | number: '1.0-0' }}s —
            decision cadence {{ s.decisionIntervalMinutes }} min —
            stale after {{ (s.staleMs / 60000) | number: '1.0-0' }} min.
            @if (s.running) { A pass is running now. }
          </p>
        }

        <div class="data__cards" role="list">
          <article class="data__card" role="listitem">
            <h2>📍 Markets tracked</h2>
            <p class="data__metric">{{ s.portfolio.markets | number }}</p>
          </article>
          <article class="data__card" role="listitem">
            <h2>📂 Open positions</h2>
            <p class="data__metric">{{ s.portfolio.openPositions | number }}</p>
          </article>
          <article class="data__card" role="listitem">
            <h2>💰 Realised P&amp;L</h2>
            <p class="data__metric">{{ money(s.portfolio.realisedPnlUsd) }}</p>
          </article>
          <article class="data__card" role="listitem">
            <h2>📈 Unrealised P&amp;L</h2>
            <p class="data__metric">{{ money(s.portfolio.unrealisedPnlUsd) }}</p>
          </article>
        </div>

        @if (s.lastPass; as pass) {
          <p class="data__hint">
            Last pass {{ shortTime(pass.finishedAt) }} —
            {{ pass.marketsProcessed }}/{{ pass.marketsConsidered }} markets,
            {{ pass.entries }} entries, {{ pass.exits }} exits,
            {{ pass.closedTrades }} closed trade(s),
            {{ pass.rejects }} rejected, {{ pass.riskVetoes }} risk vetoes.
            @if (pass.errors.length > 0) {
              {{ pass.errors.length }} error(s).
            }
          </p>
        }

        <app-fitness-adaptive-weights [table]="s.adaptive" />

        <h2 class="data__section-title">📂 Open positions</h2>
        <div class="page__table-wrap">
          <table class="page__table">
            <caption class="visually-hidden">Simulated open paper positions</caption>
            <thead>
              <tr>
                <th scope="col">Market</th>
                <th scope="col">Side</th>
                <th scope="col">Size</th>
                <th scope="col">Entry</th>
                <th scope="col">Unrealised</th>
                <th scope="col">Realised</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              @for (row of s.openPositions; track row.marketId) {
                <tr>
                  <th scope="row">
                    {{ row.title }}<br /><code>{{ row.marketId }}</code>
                  </th>
                  <td>{{ row.side | uppercase }}</td>
                  <td>{{ moneyOrDash(row.sizeUsd) }}</td>
                  <td>
                    @if (row.entryPriceUsd !== null) {
                      {{ row.entryPriceUsd | number: '1.2-4' }}
                      <span class="data__muted">{{ shortTime(row.entryAt ?? '') }}</span>
                    } @else {
                      —
                    }
                  </td>
                  <td>{{ moneyOrDash(row.unrealisedPnlUsd) }}</td>
                  <td>{{ money(row.realisedPnlUsd) }}</td>
                  <td>{{ row.marketStatus }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="7">No open simulated positions.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <h2 class="data__section-title">✅ Closed trades</h2>
        <p class="data__hint">
          Coherent buy→sell cycles from the live loop. Gross is mid→mid; net is
          after ask/bid fills, slippage, and fees. Resolution is context only.
        </p>

        <app-fitness-equity-charts [trades]="fitnessTrades()" title="Live paper" />

        <div class="page__table-wrap">
          <table class="page__table">
            <caption class="visually-hidden">Closed live paper trades</caption>
            <thead>
              <tr>
                <th scope="col">Market</th>
                <th scope="col">Owner</th>
                <th scope="col">Side</th>
                <th scope="col">Entry</th>
                <th scope="col">Exit</th>
                <th scope="col">Hold</th>
                <th scope="col">Gross</th>
                <th scope="col">Net</th>
                <th scope="col">Resolution</th>
              </tr>
            </thead>
            <tbody>
              @for (trade of trades(); track trade.id) {
                <tr>
                  <th scope="row">{{ trade.marketId }}</th>
                  <td>{{ humanise(trade.owner) }}</td>
                  <td>{{ trade.side | uppercase }}</td>
                  <td>
                    {{ trade.entryPriceUsd | number: '1.2-4' }}
                    <span class="data__muted">{{ shortTime(trade.entryAt) }}</span>
                  </td>
                  <td>
                    {{ trade.exitPriceUsd | number: '1.2-4' }}
                    <span class="data__muted">{{ shortTime(trade.exitAt) }}</span>
                  </td>
                  <td>{{ trade.holdingMinutes | number: '1.0-1' }} min</td>
                  <td>{{ money(trade.grossPnlUsd) }}</td>
                  <td>{{ money(trade.netPnlUsd) }}</td>
                  <td>
                    @if (trade.resolvedTo; as result) {
                      <app-outcome-badge [value]="result" />
                    } @else {
                      <span class="data__muted">—</span>
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="9">No closed live paper trades yet.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
  styleUrl: './data-shared.less',
})
export class DataPaperComponent implements OnInit {
  private readonly paper = inject(PaperService);

  protected readonly running = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly status = signal<PaperStatus | null>(null);
  protected readonly trades = signal<PaperClosedTrade[]>([]);

  /** Reuse fitness equity charts — same coherent-trade shape. */
  protected readonly fitnessTrades = computed((): CompletedFitnessTrade[] =>
    this.trades().map((trade) => ({
      marketId: trade.marketId,
      owner: trade.owner,
      entryAt: trade.entryAt,
      entryPriceUsd: trade.entryPriceUsd,
      exitAt: trade.exitAt,
      exitPriceUsd: trade.exitPriceUsd,
      side: trade.side,
      quantity: trade.quantity,
      sizeUsd: trade.sizeUsd,
      grossPnlUsd: trade.grossPnlUsd,
      estimatedCostUsd: trade.estimatedCostUsd,
      netPnlUsd: trade.netPnlUsd,
      holdingMinutes: trade.holdingMinutes,
      mfeUsd: trade.mfeUsd,
      maeUsd: trade.maeUsd,
      entryConditions: {
        yesPriceUsd: 0,
        noPriceUsd: 0,
        liquidityScore: 0,
        hoursToClose: null,
        hadOrderbook: false,
        change5m: null,
        volatility: null,
      },
      exitConditions: {
        yesPriceUsd: 0,
        noPriceUsd: 0,
        liquidityScore: 0,
        hoursToClose: null,
        hadOrderbook: false,
        change5m: null,
        volatility: null,
      },
      swarmStateAtEntry: {
        recommendation: 'hold',
        confidence: 0,
        approved: false,
        signals: [],
      },
      resolvedTo: trade.resolvedTo,
      adaptiveWeightsAtEntry: trade.adaptiveWeightsAtEntry,
    })),
  );

  ngOnInit(): void {
    this.refresh();
  }

  protected refresh(): void {
    this.error.set(null);
    this.paper.getStatus().subscribe({
      next: (data) => this.status.set(data),
      error: (err: unknown) => this.error.set(this.message(err, 'Failed to load status')),
    });
    this.paper.getTrades(200).subscribe({
      next: (data) => this.trades.set(data.trades),
      error: () => {
        /* trades may be empty before first close */
      },
    });
  }

  protected runPass(): void {
    this.running.set(true);
    this.error.set(null);
    this.paper.runPass().subscribe({
      next: () => {
        this.running.set(false);
        this.refresh();
      },
      error: (err: unknown) => {
        this.error.set(this.message(err, 'Paper pass failed'));
        this.running.set(false);
      },
    });
  }

  protected humanise(owner: string): string {
    if (owner === 'swarm') {
      return 'Swarm';
    }
    return humaniseAgent(owner);
  }

  protected money(value: number): string {
    const sign = value > 0 ? '+' : '';
    return `${sign}$${value.toFixed(2)}`;
  }

  protected moneyOrDash(value: number | null): string {
    if (value === null) {
      return '—';
    }
    return this.money(value);
  }

  protected shortTime(iso: string): string {
    if (!iso) {
      return '';
    }
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) {
      return iso;
    }
    return new Date(ms).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private message(err: unknown, fallback: string): string {
    return err instanceof Error ? err.message : fallback;
  }
}
