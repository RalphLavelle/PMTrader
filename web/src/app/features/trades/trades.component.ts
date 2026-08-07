import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TradesService } from '../../core/services/trades.service';
import { HistoryEvent, Trade } from '../../core/models/trade.model';
import { formatMicroUsd, formatTimestamp } from '../../core/utils/micro-usd';
import { OutcomeBadgeComponent } from '../../shared/outcome-badge.component';

type TradeView = 'feed' | 'history';

@Component({
  selector: 'app-trades',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page trades" aria-labelledby="trades-heading">
      <header class="page__header">
        <div>
          <h1 id="trades-heading">Trades</h1>
          <p class="page__subtitle">
            Recent prediction market activity from Jupiter.
          </p>
        </div>
        <div class="trades__actions">
          <div class="trades__tabs" role="tablist" aria-label="Trade views">
            <button
              type="button"
              role="tab"
              class="trades__tab"
              [class.trades__tab--active]="view() === 'feed'"
              [attr.aria-selected]="view() === 'feed'"
              (click)="setView('feed')"
            >
              Global feed
            </button>
            <button
              type="button"
              role="tab"
              class="trades__tab"
              [class.trades__tab--active]="view() === 'history'"
              [attr.aria-selected]="view() === 'history'"
              (click)="setView('history')"
            >
              My history
            </button>
          </div>
          <button type="button" class="page__refresh" (click)="load()">
            Refresh
          </button>
        </div>
      </header>

      @if (loading()) {
        <p class="page__status" role="status">Loading trades…</p>
      } @else if (error()) {
        <p class="page__status page__status--error" role="alert">
          {{ error() }}
        </p>
      } @else if (view() === 'feed' && trades().length === 0) {
        <p class="page__status">No trades found.</p>
      } @else if (view() === 'history' && history().length === 0) {
        <p class="page__status">
          No prediction market activity found for your wallet yet.
        </p>
      } @else {
        @if (view() === 'feed') {
          <div class="page__table-wrap">
            <table class="page__table">
              <caption class="visually-hidden">
                Recent global prediction market trades
              </caption>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Action</th>
                  <th scope="col">Side</th>
                  <th scope="col">Market</th>
                  <th scope="col">Price</th>
                  <th scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                @for (trade of trades(); track trade.id) {
                  <tr>
                    <td>{{ formatTime(trade.timestamp) }}</td>
                    <td>
                      <span
                        class="badge"
                        [class.badge--buy]="trade.action === 'buy'"
                        [class.badge--sell]="trade.action === 'sell'"
                      >
                        {{ trade.action }}
                      </span>
                    </td>
                    <td><app-outcome-badge [value]="trade.side" /></td>
                    <td>
                      <a
                        [routerLink]="['/markets', trade.marketId]"
                        class="trades__market-link"
                      >
                        <span class="trades__market-title">{{ trade.marketTitle }}</span>
                        <span class="trades__event-title">{{ trade.eventTitle }}</span>
                      </a>
                    </td>
                    <td>{{ formatUsd(trade.priceUsd) }}</td>
                    <td>{{ formatUsd(trade.amountUsd) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <div class="page__table-wrap">
            <table class="page__table">
              <caption class="visually-hidden">
                Your prediction market transaction history
              </caption>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Event</th>
                  <th scope="col">Type</th>
                  <th scope="col">Market</th>
                  <th scope="col">Cost</th>
                </tr>
              </thead>
              <tbody>
                @for (event of history(); track event.id) {
                  <tr>
                    <td>{{ formatTime(event.timestamp) }}</td>
                    <td>{{ event.eventType }}</td>
                    <td>
                      @if (event.isBuy !== undefined) {
                        <span class="trades__event-type">
                          <span
                            class="badge"
                            [class.badge--buy]="event.isBuy"
                            [class.badge--sell]="!event.isBuy"
                          >
                            {{ event.isBuy ? 'Buy' : 'Sell' }}
                          </span>
                          <app-outcome-badge [value]="event.isYes ?? null" />
                        </span>
                      } @else {
                        —
                      }
                    </td>
                    <td>
                      @if (event.marketId) {
                        <a [routerLink]="['/markets', event.marketId]" class="page__link">
                          {{ event.marketMetadata?.title ?? event.marketId }}
                        </a>
                      } @else {
                        {{ event.marketMetadata?.title ?? '—' }}
                      }
                    </td>
                    <td>{{ formatUsd(event.totalCostUsd) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </section>
  `,
  styleUrl: './trades.component.less',
  imports: [RouterLink, OutcomeBadgeComponent],
})
export class TradesComponent implements OnInit {
  private readonly tradesService = inject(TradesService);

  protected readonly view = signal<TradeView>('feed');
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly trades = signal<Trade[]>([]);
  protected readonly history = signal<HistoryEvent[]>([]);

  protected readonly formatUsd = formatMicroUsd;
  protected readonly formatTime = formatTimestamp;

  ngOnInit(): void {
    this.load();
  }

  setView(view: TradeView): void {
    this.view.set(view);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);

    if (this.view() === 'feed') {
      this.tradesService.getRecentTrades().subscribe({
        next: (response) => {
          this.trades.set(response.data ?? []);
          this.loading.set(false);
        },
        error: (err: { error?: { error?: string }; message?: string }) => {
          this.error.set(
            err.error?.error ?? err.message ?? 'Failed to load trades.',
          );
          this.loading.set(false);
        },
      });
      return;
    }

    this.tradesService.getHistory().subscribe({
      next: (response) => {
        this.history.set(response.data ?? []);
        this.loading.set(false);
      },
      error: (err: { error?: { error?: string }; message?: string }) => {
        this.error.set(
          err.error?.error ?? err.message ?? 'Failed to load history.',
        );
        this.loading.set(false);
      },
    });
  }
}
