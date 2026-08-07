import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { DataNavComponent } from './data-nav.component';
import { DataService } from '../../core/services/data.service';
import {
  ChartPoint,
  OrderbookCoverage,
  OrderbookDetailData,
} from '../../core/models/data.model';
import { LineChartComponent } from '../../shared/line-chart.component';

@Component({
  selector: 'app-data-orderbooks',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataNavComponent, DecimalPipe, LineChartComponent],
  template: `
    <section class="page data" aria-labelledby="data-ob-heading">
      <header class="page__header">
        <div>
          <h1 id="data-ob-heading">Order books</h1>
          <p class="page__subtitle">
            Depth captures from <code>orderbook_snapshots</code> and binary mid/spread.
          </p>
        </div>
        <button type="button" class="page__refresh" (click)="loadList()">Refresh</button>
      </header>

      <app-data-nav />

      @if (listLoading()) {
        <p class="page__status" role="status">Loading orderbook markets…</p>
      } @else if (listError()) {
        <p class="page__status page__status--error" role="alert">{{ listError() }}</p>
      } @else if (markets().length === 0) {
        <p class="data__sparse" role="status">
          No orderbook snapshots yet. Add market ids to
          <code>collector-schedule.json</code> and enable the orderbook stream.
        </p>
      } @else {
        <div class="page__table-wrap">
          <table class="page__table">
            <thead>
              <tr>
                <th scope="col">Market</th>
                <th scope="col">Snapshots</th>
                <th scope="col">Last seen</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              @for (m of markets(); track m.marketId) {
                <tr>
                  <td><code>{{ m.marketId }}</code></td>
                  <td>{{ m.snapshotCount }}</td>
                  <td>{{ formatTime(m.lastSeenAt) }}</td>
                  <td>
                    <button type="button" class="page__refresh" (click)="selectMarket(m.marketId)">
                      View
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (selectedId()) {
        <h2 class="data__section-title">Detail: {{ selectedId() }}</h2>
        @if (detailLoading()) {
          <p class="page__status" role="status">Loading orderbook…</p>
        } @else if (detailError()) {
          <p class="page__status page__status--error" role="alert">{{ detailError() }}</p>
        } @else if (detail(); as d) {
          <dl class="data__stats">
            <div>
              <dt>Snapshots</dt>
              <dd>{{ d.snapshotCount }}</dd>
            </div>
            <div>
              <dt>Best YES bid</dt>
              <dd>{{ fmt(d.latest.features.bestYesBid) }}</dd>
            </div>
            <div>
              <dt>Best NO bid</dt>
              <dd>{{ fmt(d.latest.features.bestNoBid) }}</dd>
            </div>
            <div>
              <dt>Mid</dt>
              <dd>{{ fmt(d.latest.features.mid) }}</dd>
            </div>
            <div>
              <dt>Spread</dt>
              <dd>{{ fmt(d.latest.features.spread) }}</dd>
            </div>
            <div>
              <dt>Depth imbalance</dt>
              <dd>{{ fmt(d.latest.features.depthImbalance) }}</dd>
            </div>
          </dl>

          <app-line-chart
            [points]="spreadSeries()"
            ariaLabel="Orderbook spread over time"
            caption="Binary spread = 1 − best NO bid − best YES bid"
            emptyMessage="Need at least two orderbook snapshots to chart spread."
          />

          <div class="data__ladders">
            <div class="data__ladder">
              <h3>YES bids (top 10)</h3>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Price</th>
                    <th scope="col">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  @for (level of d.latest.yesLadder.slice(0, 10); track level.priceUsd) {
                    <tr>
                      <td>{{ level.priceUsd | number: '1.2-4' }}</td>
                      <td>{{ level.quantity | number: '1.0-2' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <div class="data__ladder">
              <h3>NO bids (top 10)</h3>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Price</th>
                    <th scope="col">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  @for (level of d.latest.noLadder.slice(0, 10); track level.priceUsd) {
                    <tr>
                      <td>{{ level.priceUsd | number: '1.2-4' }}</td>
                      <td>{{ level.quantity | number: '1.0-2' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }
      }
    </section>
  `,
  styleUrl: './data-shared.less',
})
export class DataOrderbooksComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly dataService = inject(DataService);

  protected readonly listLoading = signal(true);
  protected readonly listError = signal<string | null>(null);
  protected readonly markets = signal<OrderbookCoverage[]>([]);

  protected readonly selectedId = signal<string | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly detailError = signal<string | null>(null);
  protected readonly detail = signal<OrderbookDetailData | null>(null);

  protected readonly spreadSeries = computed<ChartPoint[]>(() =>
    (this.detail()?.series ?? [])
      .filter((p) => p.spread !== null)
      .map((p) => ({ at: p.at, value: p.spread as number })),
  );

  ngOnInit(): void {
    const q = this.route.snapshot.queryParamMap.get('marketId');
    this.loadList(q);
  }

  protected loadList(autoSelect?: string | null): void {
    this.listLoading.set(true);
    this.listError.set(null);
    this.dataService.getOrderbookMarkets().subscribe({
      next: (res) => {
        this.markets.set(res.data);
        this.listLoading.set(false);
        const pick = autoSelect ?? res.data[0]?.marketId;
        if (pick) {
          this.selectMarket(pick);
        }
      },
      error: (err: unknown) => {
        this.listError.set(err instanceof Error ? err.message : 'Failed to load orderbooks');
        this.listLoading.set(false);
      },
    });
  }

  protected selectMarket(marketId: string): void {
    this.selectedId.set(marketId);
    this.detailLoading.set(true);
    this.detailError.set(null);
    this.dataService.getOrderbookDetail(marketId).subscribe({
      next: (data) => {
        this.detail.set(data);
        this.detailLoading.set(false);
      },
      error: (err: unknown) => {
        this.detailError.set(err instanceof Error ? err.message : 'Failed to load detail');
        this.detailLoading.set(false);
      },
    });
  }

  protected formatTime(value: string): string {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
  }

  protected fmt(value: number | null): string {
    if (value === null || Number.isNaN(value)) {
      return '—';
    }
    return value.toFixed(4);
  }
}
