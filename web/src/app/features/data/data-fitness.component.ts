import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { FitnessReport, FitnessStatus, TradingPerformance, AdaptiveWeightTable } from '../../core/models/fitness.model';
import { FitnessService } from '../../core/services/fitness.service';
import {
  fixedOrDash,
  humaniseAgent,
  percentOrDash,
  signedPercentOrDash,
} from '../../core/utils/format-stats';
import { DataNavComponent } from './data-nav.component';
import { FitnessAdaptiveWeightsComponent } from './fitness-adaptive-weights.component';
import { FitnessAgentDetailComponent } from './fitness-agent-detail.component';
import { FitnessContextComponent } from './fitness-context.component';
import { FitnessEquityChartsComponent } from './fitness-equity-charts.component';
import { FitnessMarketsTableComponent } from './fitness-markets-table.component';
import { FitnessTradesTableComponent } from './fitness-trades-table.component';

/**
 * Phase 5 dashboard: trading performance first, forecasting second.
 *
 * Primary signal: coherent paper trades from intramarket replay.
 * Secondary: resolution / Brier forecasting diagnostics.
 */
@Component({
  selector: 'app-data-fitness',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DataNavComponent,
    DecimalPipe,
    FitnessAdaptiveWeightsComponent,
    FitnessAgentDetailComponent,
    FitnessContextComponent,
    FitnessEquityChartsComponent,
    FitnessMarketsTableComponent,
    FitnessTradesTableComponent,
    ReactiveFormsModule,
  ],
  template: `
    <section class="page data" aria-labelledby="data-fitness-heading">
      <header class="page__header">
        <div>
          <h1 id="data-fitness-heading">🏆 Agent fitness</h1>
          <p class="page__subtitle">
            Primary scoreboard: coherent paper trades (entry → exit while open).
            Secondary: resolution Brier / calibration — good forecaster ≠ good trader.
          </p>
        </div>
      </header>

      <app-data-nav />

      <form class="data__controls" [formGroup]="form" (ngSubmit)="run()" aria-label="Fitness options">
        <label for="fit-markets">Markets</label>
        <input id="fit-markets" type="number" min="1" max="500" formControlName="markets" />

        <label for="fit-interval">Minutes between decisions</label>
        <input id="fit-interval" type="number" min="1" max="1440" formControlName="intervalMinutes" />

        <label for="fit-sample">Trades needed for a weight</label>
        <input id="fit-sample" type="number" min="1" max="10000" formControlName="minSample" />

        <label for="fit-book">
          <input id="fit-book" type="checkbox" formControlName="requireOrderbook" />
          Only where depth was captured
        </label>

        <label for="fit-runs">
          <input id="fit-runs" type="checkbox" formControlName="includeLiveRuns" />
          Include live swarm runs (forecasting)
        </label>

        <button type="submit" class="page__action" [disabled]="running()">
          {{ running() ? 'Measuring…' : 'Measure fitness' }}
        </button>
      </form>

      @if (error(); as message) {
        <p class="page__status page__status--error" role="alert">{{ message }}</p>
      }

      @if (status(); as s) {
        <p class="data__hint" role="status">
          Trading fitness is paper-trade P&amp;L; {{ s.resolvedMarkets | number }} resolved
          markets also feed secondary Brier calibration.
          @if (s.resolvedMarkets === 0) {
            Resolution labels are optional — keep the collector running for exit quotes.
          }
        </p>
      }

      @if (running()) {
        <p class="page__status" role="status">Paper-replaying markets and grading trades…</p>
      }

      @if (report(); as rep) {
        <app-fitness-adaptive-weights [table]="adaptiveTable()" />

        <h2 class="data__section-title">📈 Trading performance (primary)</h2>
        <p class="data__hint">
          Overall simulated portfolio from the swarm paper book. Gross is mid→mid;
          net is after ask/bid fills, slippage, and fees.
        </p>

        <div class="data__cards" role="list">
          <article class="data__card" role="listitem">
            <h2>🔄 Completed trades</h2>
            <p class="data__metric">{{ rep.completedTrades | number }}</p>
          </article>
          <article class="data__card" role="listitem">
            <h2>💰 Swarm net P&amp;L</h2>
            <p class="data__metric">{{ money(rep.swarm.realisedPnlUsd) }}</p>
          </article>
          <article class="data__card" role="listitem">
            <h2>💵 Swarm gross P&amp;L</h2>
            <p class="data__metric">{{ money(gross(rep.swarm)) }}</p>
          </article>
          <article class="data__card" role="listitem">
            <h2>📉 Max drawdown</h2>
            <p class="data__metric">{{ money(rep.swarm.maxDrawdownUsd) }}</p>
          </article>
          <article class="data__card" role="listitem">
            <h2>🌐 Markets covered</h2>
            <p class="data__metric">{{ rep.marketsCovered | number }}</p>
          </article>
          <article class="data__card" role="listitem">
            <h2>⚖️ Reliable weights</h2>
            <p class="data__metric">{{ reliableWeights() | number }}</p>
          </article>
        </div>

        @if (rep.warnings.length > 0) {
          <div class="data__sparse" role="status">
            <h2 class="data__section-title">⚠️ Read these first</h2>
            <ul class="data__warnings">
              @for (warning of rep.warnings; track warning) {
                <li>{{ warning }}</li>
              }
            </ul>
          </div>
        }

        <h2 class="data__section-title">🐝 Swarm portfolio</h2>
        <p class="data__hint">
          One chronological book per market — not a separate trade for every observation.
        </p>
        <div class="page__table-wrap">
          <table class="page__table">
            <caption class="visually-hidden">Swarm trading performance scoreboard</caption>
            <thead>
              <tr>
                <th scope="col">Trades</th>
                <th scope="col">Win rate</th>
                <th scope="col">Avg trade</th>
                <th scope="col">Gross</th>
                <th scope="col">Net</th>
                <th scope="col">Profit factor</th>
                <th scope="col">Best</th>
                <th scope="col">Worst</th>
                <th scope="col">Max DD</th>
                <th scope="col">Avg hold</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{{ rep.swarm.trades | number }}</td>
                <td>{{ percent(rep.swarm.winRate) }}</td>
                <td>{{ moneyOrDash(rep.swarm.avgTradePnlUsd) }}</td>
                <td>{{ money(gross(rep.swarm)) }}</td>
                <td>{{ money(rep.swarm.realisedPnlUsd) }}</td>
                <td>{{ fixed(rep.swarm.profitFactor) }}</td>
                <td>{{ moneyOrDash(rep.swarm.largestWinnerUsd) }}</td>
                <td>{{ moneyOrDash(rep.swarm.largestLoserUsd) }}</td>
                <td>{{ money(rep.swarm.maxDrawdownUsd) }}</td>
                <td>{{ fixed(rep.swarm.avgHoldingMinutes) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <app-fitness-equity-charts [trades]="rep.swarmTrades ?? []" title="Swarm" />

        <h3 class="data__subheading">Individual markets (swarm)</h3>
        <app-fitness-markets-table
          [trades]="rep.swarmTrades ?? []"
          caption="Swarm trading performance by market"
        />

        <h3 class="data__subheading">Individual trades (swarm)</h3>
        <p class="data__hint">
          Expand a row for entry signals and adaptive weights. Resolution is context only.
        </p>
        <app-fitness-trades-table
          [trades]="rep.swarmTrades ?? []"
          caption="Swarm coherent paper trades"
        />

        <h2 class="data__section-title">🎯 Specialists (trading)</h2>
        <p class="data__hint">
          Each specialist’s unit-stake paper book. Adaptive weights from Phase 6 scale
          influence in live aggregation when evidence is strong enough.
        </p>
        <div class="page__table-wrap">
          <table class="page__table">
            <caption class="visually-hidden">Specialist trading performance</caption>
            <thead>
              <tr>
                <th scope="col">Specialist</th>
                <th scope="col">Weight</th>
                <th scope="col">Trades</th>
                <th scope="col">Win rate</th>
                <th scope="col">Net P&amp;L</th>
                <th scope="col">Gross</th>
                <th scope="col">Avg trade</th>
                <th scope="col">Max DD</th>
              </tr>
            </thead>
            <tbody>
              @for (agent of rep.agents; track agent.agent) {
                <tr>
                  <th scope="row">{{ humanise(agent.agent) }}</th>
                  <td>
                    {{ agent.weight.weight | number: '1.2-2' }}
                    @if (!agent.weight.reliable) {
                      <span class="data__tag">too few samples</span>
                    }
                  </td>
                  <td>{{ agent.trading.trades | number }}</td>
                  <td>{{ percent(agent.trading.winRate) }}</td>
                  <td>{{ money(agent.trading.realisedPnlUsd) }}</td>
                  <td>{{ money(gross(agent.trading)) }}</td>
                  <td>{{ moneyOrDash(agent.trading.avgTradePnlUsd) }}</td>
                  <td>{{ money(agent.trading.maxDrawdownUsd) }}</td>
                </tr>
              } @empty {
                <tr><td colspan="8">No specialist had any gradable trades.</td></tr>
              }
            </tbody>
          </table>
        </div>

        <h2 class="data__section-title">🔮 Forecasting performance (secondary)</h2>
        <p class="data__hint">
          Brier / skill vs market / head-to-head use resolution labels. Useful for
          calibration — not the trading scoreboard above.
        </p>
        <div class="page__table-wrap">
          <table class="page__table">
            <caption class="visually-hidden">Secondary forecasting diagnostics per specialist</caption>
            <thead>
              <tr>
                <th scope="col">Specialist</th>
                <th scope="col">Brier</th>
                <th scope="col">Forecast skill</th>
                <th scope="col">Overconfidence</th>
              </tr>
            </thead>
            <tbody>
              @for (agent of rep.agents; track agent.agent) {
                <tr>
                  <th scope="row">{{ humanise(agent.agent) }}</th>
                  <td>{{ fixed(agent.forecasting.brierScore) }}</td>
                  <td>{{ signed(agent.forecasting.skillVsMarket) }}</td>
                  <td>{{ signed(agent.forecasting.overconfidence) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <app-fitness-context [headToHead]="rep.headToHead" [sources]="rep.sources" />

        <h2 class="data__section-title">🔍 Per specialist drill-down</h2>
        @for (agent of rep.agents; track agent.agent) {
          <app-fitness-agent-detail [agent]="agent" />
        }
      }
    </section>
  `,
  styleUrl: './data-shared.less',
})
export class DataFitnessComponent implements OnInit {
  private readonly fitness = inject(FitnessService);
  private readonly fb = inject(FormBuilder);

  protected readonly running = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly status = signal<FitnessStatus | null>(null);
  protected readonly report = signal<FitnessReport | null>(null);
  protected readonly adaptiveTable = signal<AdaptiveWeightTable | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    markets: [50],
    intervalMinutes: [15],
    minSample: [30],
    requireOrderbook: [false],
    includeLiveRuns: [true],
  });

  /** How many weights rest on enough evidence to be worth acting on. */
  protected readonly reliableWeights = computed(
    () => this.report()?.agents.filter((agent) => agent.weight.reliable).length ?? 0,
  );

  ngOnInit(): void {
    this.loadStatus();
  }

  protected loadStatus(): void {
    this.fitness.getStatus().subscribe({
      next: (data) => {
        this.status.set(data);
        this.form.patchValue({
          markets: data.defaults.backtest.maxMarkets,
          intervalMinutes: data.defaults.backtest.decisionIntervalMinutes,
          minSample: data.defaults.minSampleForWeight,
          includeLiveRuns: data.defaults.includeLiveRuns,
        });
        if (data.lastRun) {
          this.report.set(data.lastRun);
        }
        this.adaptiveTable.set(data.adaptive ?? null);
      },
      error: (err: unknown) => this.error.set(this.message(err, 'Failed to load status')),
    });
  }

  protected run(): void {
    this.running.set(true);
    this.error.set(null);

    this.fitness.run(this.form.getRawValue()).subscribe({
      next: (result) => {
        this.report.set(result);
        this.running.set(false);
        this.fitness.getWeights().subscribe({
          next: (table) => this.adaptiveTable.set(table),
          error: () => {
            /* weights may not exist yet */
          },
        });
      },
      error: (err: unknown) => {
        this.error.set(this.message(err, 'Fitness pass failed'));
        this.running.set(false);
      },
    });
  }

  protected humanise(agent: string): string {
    return humaniseAgent(agent);
  }

  protected percent(value: number | null): string {
    return percentOrDash(value);
  }

  protected signed(value: number | null): string {
    return signedPercentOrDash(value);
  }

  protected fixed(value: number | null): string {
    return fixedOrDash(value);
  }

  protected money(value: number): string {
    const sign = value > 0 ? '+' : '';
    return `${sign}$${value.toFixed(2)}`;
  }

  protected moneyOrDash(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '—';
    }
    return this.money(value);
  }

  /** Older reports may omit grossPnlUsd — fall back to net. */
  protected gross(perf: TradingPerformance): number {
    return perf.grossPnlUsd ?? perf.realisedPnlUsd;
  }

  private message(err: unknown, fallback: string): string {
    return err instanceof Error ? err.message : fallback;
  }
}
