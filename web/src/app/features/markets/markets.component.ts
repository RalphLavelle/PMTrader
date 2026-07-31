import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MarketsService } from '../../core/services/markets.service';
import {
  EventMarketGroup,
  MarketListItem,
  PredictionEvent,
} from '../../core/models/market.model';
import { categoryEmoji, categoryLabel } from '../../core/utils/category-emoji';
import { compareMarketTitles } from '../../core/utils/market-sort';
import { formatMicroUsd } from '../../core/utils/micro-usd';

@Component({
  selector: 'app-markets',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page markets" aria-labelledby="markets-heading">
      <header class="page__header">
        <div>
          <h1 id="markets-heading">Markets</h1>
          <p class="page__subtitle">Trending prediction markets from Jupiter.</p>
        </div>
        <div class="markets__actions">
          <label class="markets__toggle">
            <input
              type="checkbox"
              [checked]="showClosed()"
              (change)="toggleClosed($event)"
            />
            Show closed markets
          </label>
          <button type="button" class="page__refresh" (click)="load()">Refresh</button>
        </div>
      </header>

      @if (loading()) {
        <p class="page__status" role="status">Loading markets…</p>
      } @else if (error()) {
        <p class="page__status page__status--error" role="alert">{{ error() }}</p>
      } @else if (eventGroups().length === 0) {
        <p class="page__status">No open markets found.</p>
      } @else {
        @for (group of eventGroups(); track group.eventId) {
          <section class="markets__event">
            <h2 class="markets__event-heading">
              <button
                type="button"
                class="markets__event-toggle"
                [id]="'event-' + group.eventId"
                [attr.aria-expanded]="isExpanded(group.eventId)"
                [attr.aria-controls]="'panel-' + group.eventId"
                (click)="toggleEvent(group.eventId)"
              >
                <span
                  class="markets__chevron"
                  [class.markets__chevron--open]="isExpanded(group.eventId)"
                  aria-hidden="true"
                ></span>
                <span class="markets__category" [attr.title]="categoryLabel(group.category)">
                  <span aria-hidden="true">{{ categoryEmoji(group.category) }}</span>
                  <span class="visually-hidden">{{ categoryLabel(group.category) }}</span>
                </span>
                <span class="markets__event-title">{{ group.eventTitle }}</span>
                <span class="markets__event-count">
                  {{ group.markets.length }}
                  {{ group.markets.length === 1 ? 'market' : 'markets' }}
                </span>
              </button>
            </h2>

            @if (isExpanded(group.eventId)) {
              <div class="markets__event-panel" [id]="'panel-' + group.eventId" role="region" [attr.aria-labelledby]="'event-' + group.eventId">
                <div class="page__table-wrap">
                  <table class="page__table markets__table">
                    <caption class="visually-hidden">
                      Markets for {{ group.eventTitle }}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Market</th>
                        <th scope="col">Yes</th>
                        <th scope="col">No</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (market of group.markets; track market.marketId) {
                        <tr [class.markets__row--closed]="market.status !== 'open'">
                          <td>
                            <a [routerLink]="['/markets', market.marketId]" class="page__link">
                              {{ market.marketTitle }}
                            </a>
                            @if (market.status !== 'open') {
                              <span class="markets__closed-tag">closed</span>
                            }
                          </td>
                          <td>{{ formatUsd(market.buyYesPriceUsd) }}</td>
                          <td>{{ formatUsd(market.buyNoPriceUsd) }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            }
          </section>
        }
      }
    </section>
  `,
  styleUrl: './markets.component.less',
  imports: [RouterLink],
})
export class MarketsComponent implements OnInit {
  private readonly marketsService = inject(MarketsService);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly events = signal<PredictionEvent[]>([]);
  protected readonly showClosed = signal(false);
  /** Event IDs whose market tables are currently expanded. */
  protected readonly expandedEvents = signal<Set<string>>(new Set());

  /** Events with nested markets, filtered and sorted for display. */
  protected readonly eventGroups = computed(() =>
    buildEventGroups(this.events(), this.showClosed()),
  );

  protected readonly categoryEmoji = categoryEmoji;
  protected readonly categoryLabel = categoryLabel;

  protected readonly formatUsd = (value: number | undefined) =>
    value === undefined ? '—' : formatMicroUsd(value);

  ngOnInit(): void {
    this.load();
  }

  toggleClosed(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.showClosed.set(checked);
  }

  /** True when an event's market list is expanded. */
  isExpanded(eventId: string): boolean {
    return this.expandedEvents().has(eventId);
  }

  /** Expand or collapse an event section when its heading is clicked. */
  toggleEvent(eventId: string): void {
    this.expandedEvents.update((current) => {
      const next = new Set(current);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.marketsService.getEvents({ filter: 'trending', start: 0, end: 50 }).subscribe({
      next: (response) => {
        this.events.set(response.data ?? []);
        this.loading.set(false);
      },
      error: (err: { error?: { error?: string }; message?: string }) => {
        this.error.set(err.error?.error ?? err.message ?? 'Failed to load markets.');
        this.loading.set(false);
      },
    });
  }
}

/** Group markets by event; filter open-only by default; sort markets within each event. */
function buildEventGroups(
  events: PredictionEvent[],
  showClosed: boolean,
): EventMarketGroup[] {
  const groups: EventMarketGroup[] = [];

  for (const event of events) {
    const markets: MarketListItem[] = [];

    for (const market of event.markets ?? []) {
      const isOpen = market.status === 'open';
      if (!isOpen && !showClosed) {
        continue;
      }

      markets.push({
        marketId: market.marketId,
        marketTitle: market.title,
        eventId: event.eventId,
        eventTitle: event.metadata.title,
        category: event.category,
        status: market.status,
        buyYesPriceUsd: market.pricing?.buyYesPriceUsd,
        buyNoPriceUsd: market.pricing?.buyNoPriceUsd,
      });
    }

    if (markets.length === 0) {
      continue;
    }

    markets.sort((a, b) => compareMarketTitles(a.marketTitle, b.marketTitle));

    groups.push({
      eventId: event.eventId,
      eventTitle: event.metadata.title,
      category: event.category,
      markets,
    });
  }

  return groups;
}
