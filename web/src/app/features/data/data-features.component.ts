import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataNavComponent } from './data-nav.component';
import { DataService } from '../../core/services/data.service';
import { FeatureRow, FeaturesDataResponse } from '../../core/models/data.model';

@Component({
  selector: 'app-data-features',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataNavComponent, RouterLink, DecimalPipe, FormsModule],
  template: `
    <section class="page data" aria-labelledby="data-features-heading">
      <header class="page__header">
        <div>
          <h1 id="data-features-heading">Feature explorer</h1>
          <p class="page__subtitle">
            Read-time Feature Builder output — momentum, book microstructure, and trade flow.
          </p>
        </div>
        <button type="button" class="page__refresh" (click)="load()">Refresh</button>
      </header>

      <app-data-nav />

      <form class="data__search" (ngSubmit)="load()" aria-label="Choose market">
        <label class="visually-hidden" for="data-feature-market">Market id</label>
        <input
          id="data-feature-market"
          type="search"
          name="marketId"
          [(ngModel)]="marketId"
          placeholder="Market id (e.g. POLY-3013350)"
          required
        />
        <button type="submit" class="page__action">Build features</button>
      </form>

      @if (!marketId.trim()) {
        <p class="data__sparse" role="status">
          Enter a market id that appears under
          <a class="page__link" routerLink="/data/markets">Collected markets</a>.
        </p>
      } @else if (loading()) {
        <p class="page__status" role="status">Building features…</p>
      } @else if (error()) {
        <p class="page__status page__status--error" role="alert">{{ error() }}</p>
      } @else if (response(); as r) {
        @if (r.rowCount < 5) {
          <p class="data__sparse" role="status">
            Only {{ r.rowCount }} feature row(s). Change-over-time columns will often
            show as empty until more snapshots arrive.
          </p>
        }

        <p class="data__hint">
          {{ r.title }} — {{ r.rowCount }} row(s)
        </p>

        <div class="page__table-wrap">
          <table class="page__table">
            <thead>
              <tr>
                <th scope="col">Captured</th>
                <th scope="col">Implied YES</th>
                <th scope="col">Δ1m</th>
                <th scope="col">Δ5m</th>
                <th scope="col">Vol</th>
                <th scope="col">Mid</th>
                <th scope="col">Spread</th>
                <th scope="col">Imbalance</th>
                <th scope="col">Trades</th>
                <th scope="col">Flow imb.</th>
              </tr>
            </thead>
            <tbody>
              @for (row of recentRows(); track row.capturedAt) {
                <tr>
                  <td>{{ formatTime(row.capturedAt) }}</td>
                  <td>{{ row.price.impliedYesProbability | number: '1.3-3' }}</td>
                  <td>{{ fmt(row.price.change1m) }}</td>
                  <td>{{ fmt(row.price.change5m) }}</td>
                  <td>{{ fmt(row.price.volatility) }}</td>
                  <td>{{ fmt(row.orderbook?.mid ?? null) }}</td>
                  <td>{{ fmt(row.orderbook?.spread ?? null) }}</td>
                  <td>{{ fmt(row.orderbook?.depthImbalance ?? null) }}</td>
                  <td>{{ row.trades.tradeCount }}</td>
                  <td>{{ row.trades.buySellImbalance | number: '1.2-2' }}</td>
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
export class DataFeaturesComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly dataService = inject(DataService);

  protected marketId = '';
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly response = signal<FeaturesDataResponse | null>(null);

  ngOnInit(): void {
    const q = this.route.snapshot.queryParamMap.get('marketId');
    if (q) {
      this.marketId = q;
      this.load();
    }
  }

  protected recentRows(): FeatureRow[] {
    const rows = this.response()?.features ?? [];
    // Show newest first for the explorer table.
    return [...rows].reverse().slice(0, 100);
  }

  protected load(): void {
    const id = this.marketId.trim();
    if (!id) {
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.dataService.getFeatures(id).subscribe({
      next: (data) => {
        this.response.set(data);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(err instanceof Error ? err.message : 'Failed to build features');
        this.loading.set(false);
      },
    });
  }

  protected formatTime(value: string): string {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
  }

  protected fmt(value: number | null): string {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return '—';
    }
    return value.toFixed(4);
  }
}
