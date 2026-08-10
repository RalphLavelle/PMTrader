import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MarketsService } from '../../core/services/markets.service';
import { EventsCatalogResponse, PredictionEvent } from '../../core/models/market.model';
import { categoryEmoji, categoryLabel } from '../../core/utils/category-emoji';
import { buildCategoryHierarchy } from '../../core/utils/markets-hierarchy';
import { formatMicroUsd } from '../../core/utils/micro-usd';

@Component({
  selector: 'app-markets',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page markets" aria-labelledby="markets-heading">
      <header class="page__header">
        <div>
          <h1 id="markets-heading">Markets</h1>
          <p class="page__subtitle">
            All Jupiter prediction markets, grouped by category and subcategory.
          </p>
          @if (summary()) {
            <p class="markets__summary">{{ summary() }}</p>
          }
          @if (refreshing()) {
            <p class="markets__refresh-notice" role="status">
              <span class="markets__refresh-spinner" aria-hidden="true"></span>
              Fetching updated markets…
            </p>
          }
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
          <button type="button" class="page__refresh" (click)="load(true)">Refresh</button>
        </div>
      </header>

      @if (loading()) {
        <p class="page__status" role="status">Loading markets…</p>
      } @else if (error()) {
        <p class="page__status page__status--error" role="alert">{{ error() }}</p>
      } @else if (categoryGroups().length === 0) {
        <p class="page__status">No open markets found.</p>
      } @else {
        @for (cat of categoryGroups(); track cat.category) {
          <section class="markets__category-block">
            <h2 class="markets__category-heading">
              <button
                type="button"
                class="markets__category-toggle"
                [id]="'category-' + cat.category"
                [attr.aria-expanded]="isCategoryExpanded(cat.category)"
                [attr.aria-controls]="'category-panel-' + cat.category"
                (click)="toggleCategory(cat.category)"
              >
                <span
                  class="markets__chevron"
                  [class.markets__chevron--open]="isCategoryExpanded(cat.category)"
                  aria-hidden="true"
                ></span>
                <span class="markets__category-icon" [attr.title]="cat.categoryLabel">
                  <span aria-hidden="true">{{ categoryEmoji(cat.category) }}</span>
                  <span class="visually-hidden">{{ cat.categoryLabel }}</span>
                </span>
                <span class="markets__category-title">{{ cat.categoryLabel }}</span>
                <span class="markets__count">
                  {{ cat.eventCount }} {{ cat.eventCount === 1 ? 'event' : 'events' }} ·
                  {{ cat.marketCount }} {{ cat.marketCount === 1 ? 'market' : 'markets' }}
                </span>
              </button>
            </h2>

            @if (isCategoryExpanded(cat.category)) {
              <div
                class="markets__category-panel"
                [id]="'category-panel-' + cat.category"
                role="region"
                [attr.aria-labelledby]="'category-' + cat.category"
              >
                @for (sub of cat.subcategories; track sub.subcategory) {
                  <section class="markets__subcategory-block">
                    <h3 class="markets__subcategory-heading">
                      <button
                        type="button"
                        class="markets__subcategory-toggle"
                        [id]="subKey(cat.category, sub.subcategory)"
                        [attr.aria-expanded]="isSubcategoryExpanded(cat.category, sub.subcategory)"
                        [attr.aria-controls]="subPanelId(cat.category, sub.subcategory)"
                        (click)="toggleSubcategory(cat.category, sub.subcategory)"
                      >
                        <span
                          class="markets__chevron"
                          [class.markets__chevron--open]="
                            isSubcategoryExpanded(cat.category, sub.subcategory)
                          "
                          aria-hidden="true"
                        ></span>
                        <span class="markets__subcategory-title">{{ sub.subcategoryLabel }}</span>
                        <span class="markets__count">
                          {{ sub.eventCount }} · {{ sub.marketCount }}
                        </span>
                      </button>
                    </h3>

                    @if (isSubcategoryExpanded(cat.category, sub.subcategory)) {
                      <div
                        class="markets__subcategory-panel"
                        [id]="subPanelId(cat.category, sub.subcategory)"
                        role="region"
                        [attr.aria-labelledby]="subKey(cat.category, sub.subcategory)"
                      >
                        @for (group of sub.events; track group.eventId) {
                          <section class="markets__event">
                            <h4 class="markets__event-heading">
                              <button
                                type="button"
                                class="markets__event-toggle"
                                [id]="'event-' + group.eventId"
                                [attr.aria-expanded]="isEventExpanded(group.eventId)"
                                [attr.aria-controls]="'panel-' + group.eventId"
                                (click)="toggleEvent(group.eventId)"
                              >
                                <span
                                  class="markets__chevron"
                                  [class.markets__chevron--open]="isEventExpanded(group.eventId)"
                                  aria-hidden="true"
                                ></span>
                                <span class="markets__event-title">{{ group.eventTitle }}</span>
                                <span class="markets__count">
                                  {{ group.markets.length }}
                                  {{ group.markets.length === 1 ? 'market' : 'markets' }}
                                </span>
                              </button>
                            </h4>

                            @if (isEventExpanded(group.eventId)) {
                              <div
                                class="markets__event-panel"
                                [id]="'panel-' + group.eventId"
                                role="region"
                                [attr.aria-labelledby]="'event-' + group.eventId"
                              >
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
                                            <a
                                              [routerLink]="['/markets', market.marketId]"
                                              class="page__link"
                                            >
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
                      </div>
                    }
                  </section>
                }
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
export class MarketsComponent implements OnInit, OnDestroy {
  private readonly marketsService = inject(MarketsService);
  private refreshPollTimer: ReturnType<typeof setTimeout> | null = null;

  /** Full-page spinner only when we have no catalog rows yet. */
  protected readonly loading = signal(false);
  /** Background Jupiter refresh in progress (cached rows stay visible). */
  protected readonly refreshing = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly events = signal<PredictionEvent[]>([]);
  protected readonly catalogMeta = signal<{ eventCount: number; marketCount: number } | null>(
    null,
  );
  protected readonly showClosed = signal(false);
  protected readonly expandedCategories = signal<Set<string>>(new Set());
  protected readonly expandedSubcategories = signal<Set<string>>(new Set());
  protected readonly expandedEvents = signal<Set<string>>(new Set());

  protected readonly categoryGroups = computed(() =>
    buildCategoryHierarchy(this.events(), this.showClosed()),
  );

  protected readonly summary = computed(() => {
    const meta = this.catalogMeta();
    if (!meta) {
      return null;
    }
    return `${meta.eventCount} events · ${meta.marketCount} markets`;
  });

  protected readonly categoryEmoji = categoryEmoji;
  protected readonly categoryLabel = categoryLabel;

  protected readonly formatUsd = (value: number | undefined) =>
    value === undefined ? '—' : formatMicroUsd(value);

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.clearRefreshPoll();
  }

  toggleClosed(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.showClosed.set(checked);
  }

  isCategoryExpanded(category: string): boolean {
    return this.expandedCategories().has(category);
  }

  toggleCategory(category: string): void {
    this.expandedCategories.update((current) => toggleSetMember(current, category));
  }

  isSubcategoryExpanded(category: string, subcategory: string): boolean {
    return this.expandedSubcategories().has(subcategoryKey(category, subcategory));
  }

  toggleSubcategory(category: string, subcategory: string): void {
    const key = subcategoryKey(category, subcategory);
    this.expandedSubcategories.update((current) => toggleSetMember(current, key));
  }

  isEventExpanded(eventId: string): boolean {
    return this.expandedEvents().has(eventId);
  }

  toggleEvent(eventId: string): void {
    this.expandedEvents.update((current) => toggleSetMember(current, eventId));
  }

  subKey(category: string, subcategory: string): string {
    return `sub-${category}-${subcategory}`;
  }

  subPanelId(category: string, subcategory: string): string {
    return `sub-panel-${category}-${subcategory}`;
  }

  load(refresh = false): void {
    if (this.events().length === 0) {
      this.loading.set(true);
    }
    this.error.set(null);

    this.marketsService.getCatalog(refresh).subscribe({
      next: (response) => {
        this.applyCatalog(response);
      },
      error: (err: { error?: { error?: string }; message?: string }) => {
        this.error.set(err.error?.error ?? err.message ?? 'Failed to load markets.');
        this.loading.set(false);
        this.refreshing.set(false);
        this.clearRefreshPoll();
      },
    });
  }

  /** Apply a catalog payload and poll while the API refreshes from Jupiter. */
  private applyCatalog(response: EventsCatalogResponse): void {
    this.events.set(response.data ?? []);
    this.catalogMeta.set({
      eventCount: response.eventCount,
      marketCount: response.marketCount,
    });
    this.loading.set(false);
    this.refreshing.set(response.refreshing);

    if (response.refreshing) {
      this.scheduleRefreshPoll();
    } else {
      this.clearRefreshPoll();
    }
  }

  /** Poll every few seconds until the background refresh completes. */
  private scheduleRefreshPoll(): void {
    this.clearRefreshPoll();
    this.refreshPollTimer = setTimeout(() => {
      this.marketsService.getCatalog().subscribe({
        next: (response) => this.applyCatalog(response),
        error: () => this.refreshing.set(false),
      });
    }, 4_000);
  }

  private clearRefreshPoll(): void {
    if (this.refreshPollTimer !== null) {
      clearTimeout(this.refreshPollTimer);
      this.refreshPollTimer = null;
    }
  }
}

function subcategoryKey(category: string, subcategory: string): string {
  return `${category}:${subcategory}`;
}

function toggleSetMember(current: Set<string>, key: string): Set<string> {
  const next = new Set(current);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}
