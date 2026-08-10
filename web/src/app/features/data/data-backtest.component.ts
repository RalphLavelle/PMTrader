import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { DataNavComponent } from './data-nav.component';
import { BacktestService } from '../../core/services/backtest.service';
import { BacktestStatus, BacktestSummary, PaperReplaySummary, PerformanceStats } from '../../core/models/backtest.model';
import { moneyUsd, percentOrDash } from '../../core/utils/format-stats';
import { OutcomeBadgeComponent } from '../../shared/outcome-badge.component';
import { MarketLabelComponent } from '../../shared/market-label.component';

/** One row of the strategy-versus-baseline comparison table. */
interface ComparisonRow {
  label: string;
  strategy: string;
  baseline: string;
  hint: string;
}

@Component({
  selector: 'app-data-backtest',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataNavComponent, DecimalPipe, ReactiveFormsModule, OutcomeBadgeComponent, MarketLabelComponent],
  template: `
    <section class="page data" aria-labelledby="data-backtest-heading">
      <header class="page__header">
        <div>
          <h1 id="data-backtest-heading">⏪ Backtest</h1>
          <p class="page__subtitle">
            Replays collected history through the trend, mean-reversion, and risk logic,
            then grades each decision as an intramarket trade (enter, hold, exit) —
            resolution is optional context, not the scoreboard.
          </p>
        </div>
      </header>

      <app-data-nav />

      <form class="data__controls" [formGroup]="form" (ngSubmit)="run()" aria-label="Backtest options">
        <label for="bt-markets">Markets</label>
        <input id="bt-markets" type="number" min="1" max="500" formControlName="markets" />

        <label for="bt-interval">Minutes between decisions</label>
        <input id="bt-interval" type="number" min="1" max="1440" formControlName="intervalMinutes" />

        <label for="bt-hold">Exit hold (minutes)</label>
        <input id="bt-hold" type="number" min="1" max="1440" formControlName="exitHoldMinutes" />

        <label for="bt-confidence">Confidence bar</label>
        <input
          id="bt-confidence"
          type="number"
          min="0"
          max="1"
          step="0.05"
          formControlName="minConfidence"
        />

        <label for="bt-book">
          <input id="bt-book" type="checkbox" formControlName="requireOrderbook" />
          Only where depth was captured
        </label>

        <button type="submit" class="page__action" [disabled]="running()">
          {{ running() ? 'Running…' : 'Run backtest' }}
        </button>

        <button
          type="button"
          class="page__action"
          [disabled]="paperRunning()"
          (click)="runPaper()"
        >
          {{ paperRunning() ? 'Paper replay…' : 'Run paper replay' }}
        </button>
      </form>

      @if (error(); as message) {
        <p class="page__status page__status--error" role="alert">{{ message }}</p>
      }

      @if (status(); as s) {
        <p class="data__hint" role="status">
          {{ tradableCount(s) | number }} markets have enough open-path history to grade
          entry→exit trades ({{ s.resolvedMarkets | number }} also have a resolution label
          for calibration).
          @if (tradableCount(s) === 0) {
            Enable the collector and leave it running while markets are open.
          }
        </p>
      }

      @if (running()) {
        <p class="page__status" role="status">Replaying history — this can take a minute…</p>
      }

      @if (summary(); as sum) {
        <div class="data__cards" role="list">
          <article class="data__card" role="listitem">
            <h2>🎯 Decisions graded</h2>
            <p class="data__metric">{{ sum.strategy.decisions | number }}</p>
          </article>
          <article class="data__card" role="listitem">
            <h2>🚀 Profitable share</h2>
            <p class="data__metric">{{ percent(sum.strategy.accuracy) }}</p>
          </article>
          <article class="data__card" role="listitem">
            <h2>💰 Return on stake</h2>
            <p class="data__metric">{{ percent(sum.strategy.returnOnStake) }}</p>
          </article>
          <article class="data__card" role="listitem">
            <h2>🌐 Markets replayed</h2>
            <p class="data__metric">{{ sum.marketsEvaluated | number }}</p>
          </article>
        </div>

        @if (sum.strategy.directionalDecisions === 0) {
          <p class="data__sparse" role="status">
            Every decision was a hold, so there is nothing to grade. The Risk Manager
            vetoes low-confidence, illiquid, and closed markets — try a dataset with
            orderbook coverage, or lower <code>SWARM_MIN_CONFIDENCE</code>.
          </p>
        }

        <h2 class="data__section-title">⚔️ Versus buying the favourite</h2>
        <p class="data__hint">
          Both columns use the same exit hold. Return on stake is the comparison that
          matters — resolution accuracy is secondary context only.
        </p>
        <div class="page__table-wrap">
          <table class="page__table">
            <caption class="visually-hidden">Strategy compared with the follow-the-favourite baseline</caption>
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col">Swarm logic</th>
                <th scope="col">Favourite</th>
                <th scope="col">What it means</th>
              </tr>
            </thead>
            <tbody>
              @for (row of comparison(); track row.label) {
                <tr>
                  <th scope="row">{{ row.label }}</th>
                  <td>{{ row.strategy }}</td>
                  <td>{{ row.baseline }}</td>
                  <td class="data__hint">{{ row.hint }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <h2 class="data__section-title">🎯 Calibration</h2>
        <p class="data__hint">
          When the swarm said "{{ '70%' }} likely YES", did roughly {{ '70%' }} of those
          markets resolve YES? Predicted and observed should track each other.
        </p>
        <div class="page__table-wrap">
          <table class="page__table">
            <caption class="visually-hidden">Predicted versus observed YES rate by probability band</caption>
            <thead>
              <tr>
                <th scope="col">Band</th>
                <th scope="col">Decisions</th>
                <th scope="col">Mean predicted</th>
                <th scope="col">Observed YES</th>
              </tr>
            </thead>
            <tbody>
              @for (bucket of sum.calibration; track bucket.lowerBound) {
                <tr>
                  <th scope="row">{{ percent(bucket.lowerBound) }}–{{ percent(bucket.upperBound) }}</th>
                  <td>{{ bucket.decisions | number }}</td>
                  <td>{{ percent(bucket.meanPredicted) }}</td>
                  <td>{{ percent(bucket.observedYesRate) }}</td>
                </tr>
              } @empty {
                <tr><td colspan="4">No decisions to calibrate.</td></tr>
              }
            </tbody>
          </table>
        </div>

        <h2 class="data__section-title">🛑 Why decisions were not taken</h2>
        <p class="data__hint">
          The Risk Manager can veto for several reasons at once, so these counts
          overlap. Numbers in the messages are blanked to <code>N</code> so one
          recurring cause does not appear as hundreds of separate rows.
        </p>
        <div class="page__table-wrap">
          <table class="page__table">
            <caption class="visually-hidden">Risk Manager veto reasons by frequency</caption>
            <thead>
              <tr>
                <th scope="col">Reason</th>
                <th scope="col">Decisions</th>
              </tr>
            </thead>
            <tbody>
              @for (veto of sum.vetoes; track veto.reason) {
                <tr>
                  <th scope="row">{{ veto.reason }}</th>
                  <td>{{ veto.decisions | number }}</td>
                </tr>
              } @empty {
                <tr><td colspan="2">Nothing was vetoed.</td></tr>
              }
            </tbody>
          </table>
        </div>

        <h2 class="data__section-title">🗺️ By market</h2>
        <div class="page__table-wrap">
          <table class="page__table">
            <caption class="visually-hidden">Performance for each replayed market</caption>
            <thead>
              <tr>
                <th scope="col">Market</th>
                <th scope="col">Resolved</th>
                <th scope="col">Decisions</th>
                <th scope="col">Directional</th>
                <th scope="col">Profitable</th>
                <th scope="col">PnL (USD)</th>
              </tr>
            </thead>
            <tbody>
              @for (market of sum.markets; track market.marketId) {
                <tr>
                  <td>
                    <app-market-label
                      [marketId]="market.marketId"
                      [title]="market.title"
                      [eventTitle]="market.eventTitle"
                      [category]="market.category"
                    />
                  </td>
                  <td><app-outcome-badge [value]="market.result" /></td>
                  <td>{{ market.stats.decisions | number }}</td>
                  <td>{{ market.stats.directionalDecisions | number }}</td>
                  <td>{{ percent(market.stats.accuracy) }}</td>
                  <td>{{ market.stats.totalPnlUsd | number: '1.2-2' }}</td>
                </tr>
              } @empty {
                <tr><td colspan="6">No markets had enough history to replay.</td></tr>
              }
            </tbody>
          </table>
        </div>

        <p class="data__hint">
          {{ sum.decisionsWithExit | number }} of {{ sum.strategy.decisions | number }}
          decisions had an intramarket exit;
          {{ sum.decisionsWithOrderbook | number }} had a stored order book.
          Skipped {{ sum.skipped.length | number }} market(s) for thin history.
        </p>
      }

      <h2 class="data__section-title">📝 Paper replay (stateful book)</h2>
      <p class="data__hint">
        Chronological paper trading with one open position per market. Fills use
        <strong>ask for buys</strong> and <strong>bid for sells</strong> — never mid.
        Depth, slippage, partial fills, and fees come from <code>PAPER_*</code> env
        knobs. Net P&amp;L is after costs; gross is mid→mid for comparison.
      </p>

      @if (paperRunning()) {
        <p class="page__status" role="status">Paper-replaying markets with conservative fills…</p>
      }

      @if (paperSummary(); as paper) {
        <div class="data__cards" role="list">
          <article class="data__card" role="listitem">
            <h2>🌐 Markets replayed</h2>
            <p class="data__metric">{{ paper.marketsReplayed | number }}</p>
          </article>
          <article class="data__card" role="listitem">
            <h2>💰 Total net P&amp;L</h2>
            <p class="data__metric">{{ paperNetPnl(paper) }}</p>
          </article>
          <article class="data__card" role="listitem">
            <h2>⏭️ Skipped</h2>
            <p class="data__metric">{{ paper.skipped.length | number }}</p>
          </article>
        </div>

        <div class="page__table-wrap">
          <table class="page__table">
            <caption class="visually-hidden">Paper replay results by market</caption>
            <thead>
              <tr>
                <th scope="col">Market</th>
                <th scope="col">Decisions</th>
                <th scope="col">Net P&amp;L</th>
                <th scope="col">Unrealised</th>
                <th scope="col">Resolution (context)</th>
              </tr>
            </thead>
            <tbody>
              @for (market of paper.markets; track market.marketId) {
                <tr>
                  <th scope="row">
                    <app-market-label
                      [marketId]="market.marketId"
                      [title]="market.title"
                      [eventTitle]="market.eventTitle"
                      [category]="market.category"
                    />
                  </th>
                  <td>{{ market.decisions | number }}</td>
                  <td>{{ money(market.totalRealisedPnlUsd) }}</td>
                  <td>{{ moneyOrDash(market.finalUnrealisedPnlUsd) }}</td>
                  <td>
                    @if (market.resolvedTo; as result) {
                      <app-outcome-badge [value]="result" />
                    } @else {
                      <span class="data__muted">—</span>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="5">No markets produced a paper history.</td></tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
  styleUrl: './data-shared.less',
})
export class DataBacktestComponent implements OnInit {
  private readonly backtest = inject(BacktestService);
  private readonly fb = inject(FormBuilder);

  protected readonly running = signal(false);
  protected readonly paperRunning = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly status = signal<BacktestStatus | null>(null);
  protected readonly summary = signal<BacktestSummary | null>(null);
  protected readonly paperSummary = signal<PaperReplaySummary | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    markets: [50],
    intervalMinutes: [15],
    exitHoldMinutes: [15],
    minConfidence: [0.55],
    requireOrderbook: [false],
  });

  /** Side-by-side rows comparing the strategy with the reference baseline. */
  protected readonly comparison = computed<ComparisonRow[]>(() => {
    const sum = this.summary();
    if (!sum) {
      return [];
    }

    return [
      {
        label: 'Directional bets',
        strategy: this.count(sum.strategy),
        baseline: this.count(sum.baseline),
        hint: 'The swarm can decline to bet; the baseline never does.',
      },
      {
        label: 'Profitable share',
        strategy: this.percent(sum.strategy.accuracy),
        baseline: this.percent(sum.baseline.accuracy),
        hint: 'Share of directional bets with positive mark-to-market PnL at exit.',
      },
      {
        label: 'Return on stake',
        strategy: this.percent(sum.strategy.returnOnStake),
        baseline: this.percent(sum.baseline.returnOnStake),
        hint: 'Profit per dollar risked — the comparison that is not distorted by bet size.',
      },
      {
        label: 'Profit / loss',
        strategy: this.money(sum.strategy.totalPnlUsd),
        baseline: this.money(sum.baseline.totalPnlUsd),
        hint: 'Hypothetical intramarket PnL: PMTrader never places these orders.',
      },
      {
        label: 'Resolution accuracy',
        strategy: this.percent(sum.strategy.resolutionAccuracy),
        baseline: this.percent(sum.baseline.resolutionAccuracy),
        hint: 'Secondary: share that matched the eventual YES/NO when known.',
      },
    ];
  });

  ngOnInit(): void {
    this.loadStatus();
  }

  /** Fetch how much history exists, and any result from an earlier run. */
  protected loadStatus(): void {
    this.backtest.getStatus().subscribe({
      next: (data) => {
        this.status.set(data);
        this.form.patchValue({
          markets: data.defaults.maxMarkets,
          intervalMinutes: data.defaults.decisionIntervalMinutes,
          exitHoldMinutes: data.defaults.exitHoldMinutes,
          minConfidence: data.defaults.minConfidence,
        });
        if (data.lastRun) {
          this.summary.set(data.lastRun);
        }
        if (data.lastPaperRun) {
          this.paperSummary.set({
            startedAt: data.lastPaperRun.startedAt,
            finishedAt: data.lastPaperRun.finishedAt,
            durationMs: 0,
            marketsConsidered: data.lastPaperRun.marketsReplayed,
            marketsReplayed: data.lastPaperRun.marketsReplayed,
            skipped: [],
            markets: data.lastPaperRun.markets,
          });
        }
      },
      error: (err: unknown) => this.error.set(this.message(err, 'Failed to load status')),
    });
  }

  protected run(): void {
    this.running.set(true);
    this.error.set(null);

    this.backtest.run(this.form.getRawValue()).subscribe({
      next: (result) => {
        this.summary.set(result);
        this.running.set(false);
      },
      error: (err: unknown) => {
        this.error.set(this.message(err, 'Backtest failed'));
        this.running.set(false);
      },
    });
  }

  protected runPaper(): void {
    this.paperRunning.set(true);
    this.error.set(null);
    const { markets, intervalMinutes, minConfidence, requireOrderbook } =
      this.form.getRawValue();

    this.backtest
      .runPaperReplay({ markets, intervalMinutes, minConfidence, requireOrderbook })
      .subscribe({
        next: (result) => {
          this.paperSummary.set(result);
          this.paperRunning.set(false);
        },
        error: (err: unknown) => {
          this.error.set(this.message(err, 'Paper replay failed'));
          this.paperRunning.set(false);
        },
      });
  }

  protected paperNetPnl(paper: PaperReplaySummary): string {
    const total = paper.markets.reduce((sum, row) => sum + row.totalRealisedPnlUsd, 0);
    return this.money(total);
  }

  protected money(value: number): string {
    return moneyUsd(value);
  }

  protected moneyOrDash(value: number | null): string {
    if (value === null) {
      return '—';
    }
    return this.money(value);
  }

  /** Null means "not enough data to say", which is different from zero. */
  protected percent(value: number | null): string {
    return percentOrDash(value);
  }

  protected tradableCount(status: BacktestStatus): number {
    return status.tradableMarkets ?? status.nextMarkets.length;
  }

  private count(stats: PerformanceStats): string {
    return `${stats.directionalDecisions} of ${stats.decisions}`;
  }

  private message(err: unknown, fallback: string): string {
    return err instanceof Error ? err.message : fallback;
  }
}
