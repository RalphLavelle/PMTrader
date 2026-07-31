import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MarketsService } from '../../core/services/markets.service';
import { MarketDetail } from '../../core/models/market.model';
import { formatMicroUsd, formatTimestamp } from '../../core/utils/micro-usd';

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
          <h1 id="market-heading">{{ market()!.title }}</h1>
          <p class="market-detail__meta">
            <span>Status: {{ market()!.status }}</span>
            @if (market()!.result) {
              <span>Result: {{ market()!.result }}</span>
            }
            @if (market()!.eventId) {
              <span>Event: {{ market()!.eventId }}</span>
            }
          </p>
        </header>

        @if (market()!.pricing) {
          <section aria-labelledby="pricing-heading">
            <h2 id="pricing-heading">Pricing</h2>
            <div class="page__table-wrap">
              <table class="page__table">
                <caption class="visually-hidden">Current market prices</caption>
                <thead>
                  <tr>
                    <th scope="col">Side</th>
                    <th scope="col">Buy</th>
                    <th scope="col">Sell</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Yes</td>
                    <td>{{ formatUsd(market()!.pricing!.buyYesPriceUsd) }}</td>
                    <td>{{ formatUsd(market()!.pricing!.sellYesPriceUsd) }}</td>
                  </tr>
                  <tr>
                    <td>No</td>
                    <td>{{ formatUsd(market()!.pricing!.buyNoPriceUsd) }}</td>
                    <td>{{ formatUsd(market()!.pricing!.sellNoPriceUsd) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="market-detail__volume">
              Volume: {{ market()!.pricing!.volume | number }}
            </p>
          </section>
        }

        <section aria-labelledby="timing-heading">
          <h2 id="timing-heading">Timing</h2>
          <dl class="market-detail__dl">
            <div>
              <dt>Opens</dt>
              <dd>{{ formatTime(market()!.openTime) }}</dd>
            </div>
            <div>
              <dt>Closes</dt>
              <dd>{{ formatTime(market()!.closeTime) }}</dd>
            </div>
            @if (market()!.resolveAt) {
              <div>
                <dt>Resolved</dt>
                <dd>{{ market()!.resolveAt }}</dd>
              </div>
            }
          </dl>
        </section>

        @if (market()!.rulesPrimary) {
          <section aria-labelledby="rules-heading">
            <h2 id="rules-heading">Rules</h2>
            <p class="market-detail__rules">{{ market()!.rulesPrimary }}</p>
          </section>
        }
      }
    </section>
  `,
  styleUrl: './market-detail.component.less',
  imports: [RouterLink, DecimalPipe],
})
export class MarketDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly marketsService = inject(MarketsService);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly market = signal<MarketDetail | null>(null);

  protected readonly formatUsd = formatMicroUsd;
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

    this.marketsService.getMarket(marketId).subscribe({
      next: (market) => {
        this.market.set(market);
        this.loading.set(false);
      },
      error: (err: { error?: { error?: string }; message?: string }) => {
        this.error.set(err.error?.error ?? err.message ?? 'Failed to load market.');
        this.loading.set(false);
      },
    });
  }
}
