import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { DataNavComponent } from './data-nav.component';
import { DataService } from '../../core/services/data.service';
import { ChartPoint, MarketDetailData } from '../../core/models/data.model';
import { LineChartComponent } from '../../shared/line-chart.component';
import { OutcomeBadgeComponent } from '../../shared/outcome-badge.component';
import { MarketLabelComponent } from '../../shared/market-label.component';

@Component({
  selector: 'app-data-market-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DataNavComponent,
    RouterLink,
    DecimalPipe,
    LineChartComponent,
    OutcomeBadgeComponent,
    MarketLabelComponent,
  ],
  template: `
    <section class="page data" aria-labelledby="data-market-detail-heading">
      <header class="page__header">
        <div>
          <p class="data__hint">
            <a class="page__link" routerLink="/data/markets">← Markets</a>
          </p>
          <h1 id="data-market-detail-heading">
            @if (detail(); as d) {
              <app-market-label
                [marketId]="marketId"
                [title]="d.title"
                [eventTitle]="d.eventTitle"
                [category]="d.category"
                linkTo="none"
                [heading]="true"
              />
            } @else {
              {{ marketId }}
            }
          </h1>
        </div>
        <button type="button" class="page__refresh" (click)="load()">Refresh</button>
      </header>

      <app-data-nav />

      @if (loading()) {
        <p class="page__status" role="status">Loading market…</p>
      } @else if (error()) {
        <p class="page__status page__status--error" role="alert">{{ error() }}</p>
      } @else if (detail(); as d) {
        @if (d.snapshotCount < 5) {
          <p class="data__sparse" role="status">
            Sparse coverage: only {{ d.snapshotCount }} snapshot(s). Momentum and
            volatility features need more history to become meaningful.
          </p>
        }

        <dl class="data__stats">
          <div>
            <dt>Status</dt>
            <dd>{{ d.status }}</dd>
          </div>
          <div>
            <dt>Snapshots</dt>
            <dd>{{ d.snapshotCount }}</dd>
          </div>
          <div>
            <dt>Order books</dt>
            <dd>{{ d.orderbookCount }}</dd>
          </div>
          <div>
            <dt>Collected trades</dt>
            <dd>{{ d.tradeCount }}</dd>
          </div>
          <div>
            <dt>Label</dt>
            <dd>
              @if (d.label?.result; as result) {
                <app-outcome-badge [value]="result" />
              } @else {
                <span class="outcome outcome--neutral">Unresolved</span>
              }
            </dd>
          </div>
        </dl>

        <h2 class="data__section-title">📈 Implied YES over time</h2>
        <app-line-chart
          [points]="impliedSeries()"
          ariaLabel="Implied YES probability over time"
          caption="Buy-yes / (buy-yes + buy-no) at each snapshot"
          emptyMessage="Need at least two snapshots to chart implied YES."
        />

        <h2 class="data__section-title">🔬 Latest feature row</h2>
        @if (latestFeature(); as f) {
          <div class="page__table-wrap">
            <table class="page__table">
              <tbody>
                <tr>
                  <th scope="row">Implied YES</th>
                  <td>{{ f.price.impliedYesProbability | number: '1.3-3' }}</td>
                </tr>
                <tr>
                  <th scope="row">Change 1m / 5m / 10m</th>
                  <td>
                    {{ fmt(f.price.change1m) }} /
                    {{ fmt(f.price.change5m) }} /
                    {{ fmt(f.price.change10m) }}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Volatility (10m)</th>
                  <td>{{ fmt(f.price.volatility) }}</td>
                </tr>
                <tr>
                  <th scope="row">Volume delta</th>
                  <td>{{ fmt(f.price.volumeDelta) }}</td>
                </tr>
                <tr>
                  <th scope="row">Book mid / spread</th>
                  <td>
                    {{ fmt(f.orderbook?.mid ?? null) }} /
                    {{ fmt(f.orderbook?.spread ?? null) }}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Depth imbalance</th>
                  <td>{{ fmt(f.orderbook?.depthImbalance ?? null) }}</td>
                </tr>
                <tr>
                  <th scope="row">Trades in window</th>
                  <td>
                    {{ f.trades.tradeCount }}
                    (imbalance {{ f.trades.buySellImbalance | number: '1.2-2' }})
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="data__hint">
            Full table:
            <a class="page__link" [routerLink]="['/data/features']" [queryParams]="{ marketId }">
              Feature explorer
            </a>
          </p>
        }
      }
    </section>
  `,
  styleUrl: './data-shared.less',
})
export class DataMarketDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly dataService = inject(DataService);

  protected readonly marketId = this.route.snapshot.paramMap.get('marketId') ?? '';
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly detail = signal<MarketDetailData | null>(null);

  protected readonly impliedSeries = computed<ChartPoint[]>(() =>
    (this.detail()?.series ?? []).map((p) => ({ at: p.at, value: p.impliedYes })),
  );

  protected readonly latestFeature = computed(() => {
    const rows = this.detail()?.features ?? [];
    return rows.length > 0 ? rows[rows.length - 1]! : null;
  });

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    if (!this.marketId) {
      this.error.set('Missing market id');
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.dataService.getMarketDetail(this.marketId).subscribe({
      next: (data) => {
        this.detail.set(data);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        const message =
          err && typeof err === 'object' && 'error' in err
            ? String((err as { error?: { error?: string } }).error?.error ?? 'Failed to load market')
            : 'Failed to load market';
        this.error.set(message);
        this.loading.set(false);
      },
    });
  }

  protected fmt(value: number | null): string {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return '—';
    }
    return value.toFixed(4);
  }
}
