import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { MarketsService } from '../../core/services/markets.service';
import { OrdersService } from '../../core/services/orders.service';
import { MarketDetail } from '../../core/models/market.model';
import { Orderbook } from '../../core/models/order.model';
import { buildMarketDetailFields } from '../../core/utils/market-details';
import { formatMicroUsd, formatTimestamp } from '../../core/utils/micro-usd';
import { MarketTradeFormComponent } from './market-trade-form.component';
import { OutcomeBadgeComponent } from '../../shared/outcome-badge.component';

@Component({
  selector: 'app-market-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page market-detail" aria-labelledby="market-heading">
      <p class="market-detail__back">
        <a routerLink="/markets">← Back to markets</a>
      </p>

      @if (loading()) {
        <p class="page__status" role="status">Loading market…</p>
      } @else if (error()) {
        <p class="page__status page__status--error" role="alert">{{ error() }}</p>
      } @else if (market()) {
        <header class="market-detail__header">
          @if (market()!.imageUrl) {
            <img
              class="market-detail__image"
              [src]="market()!.imageUrl!"
              [alt]="market()!.title"
              width="64"
              height="64"
            />
          }
          <div>
            <h1 id="market-heading">{{ market()!.title }}</h1>
          </div>
        </header>

        <app-market-trade-form
          [marketId]="market()!.marketId"
          [canTrade]="canTrade()"
        />

        <section aria-labelledby="details-heading">
          <h2 id="details-heading">Market details</h2>
          <dl class="market-detail__dl market-detail__dl--grid">
            @for (field of detailFields(); track field.label) {
              <div>
                <dt>{{ field.label }}</dt>
                <dd>
                  @if (field.outcome !== undefined && field.outcome !== null) {
                    <app-outcome-badge [value]="field.outcome" />
                  } @else if (field.label === 'Result' && field.value === 'Unresolved') {
                    <span class="outcome outcome--neutral">Unresolved</span>
                  } @else {
                    {{ field.value }}
                  }
                </dd>
              </div>
            }
          </dl>
        </section>

        @if (market()!.rulesPrimary) {
          <section aria-labelledby="rules-heading">
            <h2 id="rules-heading">Rules</h2>
            <p class="market-detail__rules">{{ market()!.rulesPrimary }}</p>
            @if (market()!.rulesSecondary) {
              <p class="market-detail__rules">{{ market()!.rulesSecondary }}</p>
            }
          </section>
        }

        @if (orderbook()) {
          <section aria-labelledby="orderbook-heading">
            <h2 id="orderbook-heading">Orderbook</h2>
            <div class="market-detail__orderbooks">
              <div class="page__table-wrap">
                <table class="page__table">
                  <caption>Yes bids</caption>
                  <thead>
                    <tr>
                      <th scope="col">Price</th>
                      <th scope="col">Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (level of orderbook()!.yes_dollars.slice(0, 10); track $index) {
                      <tr>
                        <td>{{ formatPrice(level[0]) }}</td>
                        <td>{{ level[1] | number }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <div class="page__table-wrap">
                <table class="page__table">
                  <caption>No bids</caption>
                  <thead>
                    <tr>
                      <th scope="col">Price</th>
                      <th scope="col">Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (level of orderbook()!.no_dollars.slice(0, 10); track $index) {
                      <tr>
                        <td>{{ formatPrice(level[0]) }}</td>
                        <td>{{ level[1] | number }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        }
      }
    </section>
  `,
  styleUrl: './market-detail.component.less',
  imports: [RouterLink, DecimalPipe, MarketTradeFormComponent, OutcomeBadgeComponent],
})
export class MarketDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly marketsService = inject(MarketsService);
  private readonly ordersService = inject(OrdersService);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly market = signal<MarketDetail | null>(null);
  protected readonly orderbook = signal<Orderbook | null>(null);
  protected readonly tradingActive = signal(false);

  protected readonly detailFields = computed(() => {
    const current = this.market();
    return current ? buildMarketDetailFields(current) : [];
  });

  protected readonly canTrade = computed(
    () => this.market()?.status === 'open' && this.tradingActive(),
  );

  protected readonly formatTime = formatTimestamp;

  ngOnInit(): void {
    const marketId = this.route.snapshot.paramMap.get('marketId');
    if (!marketId) {
      this.error.set('Market ID is missing.');
      return;
    }
    this.load(marketId);
  }

  load(marketId: string): void {
    this.loading.set(true);
    this.error.set(null);

    forkJoin({
      market: this.marketsService.getMarket(marketId),
      orderbook: this.marketsService.getOrderbook(marketId),
      tradingStatus: this.ordersService.getTradingStatus(),
    }).subscribe({
      next: ({ market, orderbook, tradingStatus }) => {
        this.market.set(market);
        this.orderbook.set(orderbook);
        this.tradingActive.set(tradingStatus.trading_active);
        this.loading.set(false);
      },
      error: (err: { error?: { error?: string }; message?: string }) => {
        this.error.set(err.error?.error ?? err.message ?? 'Failed to load market.');
        this.loading.set(false);
      },
    });
  }

  /** Orderbook prices arrive as decimal strings like "0.6500". */
  protected formatPrice(price: string): string {
    const value = Number.parseFloat(price);
    if (Number.isNaN(value)) {
      return price;
    }
    return value.toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  }
}
