import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { DataNavComponent } from './data-nav.component';
import { DataService } from '../../core/services/data.service';
import { DatasetOverview } from '../../core/models/data.model';
import { OutcomeBadgeComponent } from '../../shared/outcome-badge.component';

@Component({
  selector: 'app-data-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataNavComponent, DecimalPipe, OutcomeBadgeComponent],
  template: `
    <section class="page data" aria-labelledby="data-heading">
      <header class="page__header">
        <div>
          <h1 id="data-heading">📡 Research data</h1>
          <p class="page__subtitle">
            What the collector has stored in MongoDB, and how fresh it is.
          </p>
        </div>
        <button type="button" class="page__refresh" (click)="load()">Refresh</button>
      </header>

      <app-data-nav />

      @if (loading()) {
        <p class="page__status" role="status">Loading overview…</p>
      } @else if (error()) {
        <p class="page__status page__status--error" role="alert">{{ error() }}</p>
      } @else if (overview(); as o) {
        @if (o.totalDistinctMarkets === 0) {
          <p class="data__sparse" role="status">
            No market snapshots yet. Enable <code>COLLECTOR_ENABLED=true</code> and
            wait for a successful wide sweep, then refresh.
          </p>
        }

        <div class="data__cards" role="list">
          <article class="data__card" role="listitem">
            <h2>🌐 Distinct markets</h2>
            <p class="data__metric">{{ o.totalDistinctMarkets }}</p>
          </article>
          <article class="data__card" role="listitem">
            <h2>🏷️ Labels</h2>
            <p class="data__metric">{{ o.labelledMarkets }}</p>
          </article>
          <article class="data__card" role="listitem">
            <h2>🔄 Collector</h2>
            <p class="data__metric">{{ o.collectorEnabled ? 'On' : 'Off' }}</p>
          </article>
        </div>

        <h2 class="data__section-title">🗄️ Collections</h2>
        <div class="page__table-wrap">
          <table class="page__table">
            <thead>
              <tr>
                <th scope="col">Collection</th>
                <th scope="col">Rows</th>
                <th scope="col">Markets</th>
                <th scope="col">Oldest</th>
                <th scope="col">Newest</th>
              </tr>
            </thead>
            <tbody>
              @for (c of o.collections; track c.collection) {
                <tr>
                  <td><code>{{ c.collection }}</code></td>
                  <td>{{ c.count | number }}</td>
                  <td>{{ c.distinctMarkets | number }}</td>
                  <td>{{ formatTime(c.oldestAt) }}</td>
                  <td>{{ formatTime(c.newestAt) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <h2 class="data__section-title">⚙️ Collector streams</h2>
        <p class="data__hint">Schedule file: <code>{{ o.schedulePath }}</code></p>
        <div class="page__table-wrap">
          <table class="page__table">
            <thead>
              <tr>
                <th scope="col">Stream</th>
                <th scope="col">Enabled</th>
                <th scope="col">Every</th>
                <th scope="col">Last fetch</th>
                <th scope="col">Last error</th>
              </tr>
            </thead>
            <tbody>
              @for (entry of streamEntries(o); track entry.name) {
                <tr>
                  <td>{{ entry.name }}</td>
                  <td><app-outcome-badge [value]="entry.enabled" /></td>
                  <td>{{ entry.every.value }} {{ entry.every.unit }}</td>
                  <td>{{ formatTime(entry.lastFetchAt) }}</td>
                  <td class="data__error-cell">{{ entry.lastError ?? '—' }}</td>
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
export class DataOverviewComponent implements OnInit {
  private readonly dataService = inject(DataService);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly overview = signal<DatasetOverview | null>(null);

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.dataService.getOverview().subscribe({
      next: (data) => {
        this.overview.set(data);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(err instanceof Error ? err.message : 'Failed to load overview');
        this.loading.set(false);
      },
    });
  }

  protected formatTime(value: string | null | undefined): string {
    if (!value) {
      return '—';
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
  }

  protected streamEntries(o: DatasetOverview): Array<{
    name: string;
    enabled: boolean;
    every: { value: number; unit: string };
    lastFetchAt: string | null;
    lastError: string | null;
  }> {
    return Object.entries(o.schedule.streams).map(([name, stream]) => ({
      name,
      enabled: stream.enabled,
      every: stream.every,
      lastFetchAt: stream.lastFetchAt,
      lastError: stream.lastError,
    }));
  }
}
