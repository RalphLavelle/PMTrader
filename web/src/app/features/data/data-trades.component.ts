import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataNavComponent } from './data-nav.component';
import { DataService } from '../../core/services/data.service';
import { TradesDataResponse } from '../../core/models/data.model';
import { OutcomeBadgeComponent } from '../../shared/outcome-badge.component';

@Component({
  selector: 'app-data-trades',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataNavComponent, RouterLink, DecimalPipe, FormsModule, OutcomeBadgeComponent],
  template: `
    <section class="page data" aria-labelledby="data-trades-heading">
      <header class="page__header">
        <div>
          <h1 id="data-trades-heading">Collected trades</h1>
          <p class="page__subtitle">
            Fills stored by the collector in MongoDB (not the live Jupiter proxy).
          </p>
        </div>
        <button type="button" class="page__refresh" (click)="load()">Refresh</button>
      </header>

      <app-data-nav />

      <form class="data__search" (ngSubmit)="load()" aria-label="Filter trades">
        <label class="visually-hidden" for="data-trade-market">Market id</label>
        <input
          id="data-trade-market"
          type="search"
          name="marketId"
          [(ngModel)]="marketIdFilter"
          placeholder="Optional market id filter"
        />
        <button type="submit" class="page__action">Filter</button>
      </form>

      @if (loading()) {
        <p class="page__status" role="status">Loading trades…</p>
      } @else if (error()) {
        <p class="page__status page__status--error" role="alert">{{ error() }}</p>
      } @else if (response(); as r) {
        @if (r.data.length === 0) {
          <p class="data__sparse" role="status">
            No collected trades yet. Enable the trades stream in the collector schedule.
          </p>
        } @else {
          <dl class="data__stats">
            <div>
              <dt>Trades shown</dt>
              <dd>{{ r.summary.tradeCount }}</dd>
            </div>
            <div>
              <dt>Buy notional</dt>
              <dd>{{ r.summary.buyNotionalUsd | number: '1.2-2' }}</dd>
            </div>
            <div>
              <dt>Sell notional</dt>
              <dd>{{ r.summary.sellNotionalUsd | number: '1.2-2' }}</dd>
            </div>
            <div>
              <dt>Buy/sell imbalance</dt>
              <dd>{{ r.summary.buySellImbalance | number: '1.2-2' }}</dd>
            </div>
          </dl>

          <div class="page__table-wrap">
            <table class="page__table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Market</th>
                  <th scope="col">Action</th>
                  <th scope="col">Side</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Price</th>
                </tr>
              </thead>
              <tbody>
                @for (t of r.data; track t.id) {
                  <tr>
                    <td>{{ formatTime(t.timestamp) }}</td>
                    <td>
                      <a class="page__link" [routerLink]="['/data/markets', t.marketId]">
                        {{ t.marketTitle || t.marketId }}
                      </a>
                    </td>
                    <td>
                      <span
                        class="badge"
                        [class.badge--buy]="t.action === 'buy'"
                        [class.badge--sell]="t.action === 'sell'"
                      >
                        {{ t.action }}
                      </span>
                    </td>
                    <td><app-outcome-badge [value]="t.side" /></td>
                    <td>{{ t.amountUsd }}</td>
                    <td>{{ t.priceUsd }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </section>
  `,
  styleUrl: './data-shared.less',
})
export class DataTradesComponent implements OnInit {
  private readonly dataService = inject(DataService);

  protected marketIdFilter = '';
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly response = signal<TradesDataResponse | null>(null);

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.dataService
      .getTrades({
        marketId: this.marketIdFilter.trim() || undefined,
        limit: 100,
      })
      .subscribe({
        next: (data) => {
          this.response.set(data);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(err instanceof Error ? err.message : 'Failed to load trades');
          this.loading.set(false);
        },
      });
  }

  protected formatTime(value: string): string {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
  }
}
