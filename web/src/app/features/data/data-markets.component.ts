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
import { MarketCoverage } from '../../core/models/data.model';

@Component({
  selector: 'app-data-markets',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataNavComponent, RouterLink, DecimalPipe, FormsModule],
  template: `
    <section class="page data" aria-labelledby="data-markets-heading">
      <header class="page__header">
        <div>
          <h1 id="data-markets-heading">Collected markets</h1>
          <p class="page__subtitle">
            Markets present in <code>market_snapshots</code>. Use the category filter to
            focus on crypto price markets.
          </p>
        </div>
        <button type="button" class="page__refresh" (click)="load()">Refresh</button>
      </header>

      <app-data-nav />

      <form class="data__search" (ngSubmit)="load()" aria-label="Search markets">
        <label class="visually-hidden" for="data-market-search">Search</label>
        <input
          id="data-market-search"
          type="search"
          name="search"
          [(ngModel)]="searchText"
          placeholder="Search by id or title"
        />
        <label class="visually-hidden" for="data-market-category">Category</label>
        <select id="data-market-category" name="category" [(ngModel)]="categoryFilter">
          <option value="">All categories</option>
          <option value="crypto">Crypto</option>
        </select>
        <button type="submit" class="page__action">Search</button>
      </form>

      @if (loading()) {
        <p class="page__status" role="status">Loading markets…</p>
      } @else if (error()) {
        <p class="page__status page__status--error" role="alert">{{ error() }}</p>
      } @else if (markets().length === 0) {
        <p class="data__sparse" role="status">
          No markets found. The wide sweep may still be failing, or your search
          matched nothing.
        </p>
      } @else {
        <div class="page__table-wrap">
          <table class="page__table">
            <thead>
              <tr>
                <th scope="col">Market</th>
                <th scope="col">Category</th>
                <th scope="col">Status</th>
                <th scope="col">Snapshots</th>
                <th scope="col">Implied YES</th>
                <th scope="col">Last seen</th>
              </tr>
            </thead>
            <tbody>
              @for (m of markets(); track m.marketId) {
                <tr>
                  <td>
                    <a class="page__link" [routerLink]="['/data/markets', m.marketId]">
                      {{ m.title || m.marketId }}
                    </a>
                    <div><code>{{ m.marketId }}</code></div>
                  </td>
                  <td>{{ m.category || '—' }}</td>
                  <td>{{ m.status }}</td>
                  <td>
                    {{ m.snapshotCount }}
                    @if (m.snapshotCount < 5) {
                      <span class="visually-hidden"> (sparse coverage)</span>
                    }
                  </td>
                  <td>{{ m.latestImpliedYes | number: '1.2-2' }}</td>
                  <td>{{ formatTime(m.lastSeenAt) }}</td>
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
export class DataMarketsComponent implements OnInit {
  private readonly dataService = inject(DataService);

  protected searchText = '';
  protected categoryFilter = 'crypto';
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly markets = signal<MarketCoverage[]>([]);

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.dataService
      .getMarkets({
        search: this.searchText || undefined,
        limit: 100,
        category: this.categoryFilter || undefined,
      })
      .subscribe({
      next: (res) => {
        this.markets.set(res.data);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(err instanceof Error ? err.message : 'Failed to load markets');
        this.loading.set(false);
      },
    });
  }

  protected formatTime(value: string): string {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
  }
}
