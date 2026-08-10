import { DecimalPipe, UpperCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CompletedFitnessTrade } from '../../core/models/fitness.model';
import { percentOrDash } from '../../core/utils/format-stats';
import { marketTradingRows } from './fitness-trade-utils';

/**
 * Per-market rollup of coherent paper trades (individual markets view).
 */
@Component({
  selector: 'app-fitness-markets-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, UpperCasePipe],
  template: `
    <div class="page__table-wrap">
      <table class="page__table">
        <caption class="visually-hidden">{{ caption() }}</caption>
        <thead>
          <tr>
            <th scope="col">Market</th>
            <th scope="col">Trades</th>
            <th scope="col">Win rate</th>
            <th scope="col">Gross P&amp;L</th>
            <th scope="col">Net P&amp;L</th>
            <th scope="col">Resolution (context)</th>
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.marketId) {
            <tr>
              <th scope="row">{{ row.marketId }}</th>
              <td>{{ row.trades | number }}</td>
              <td>{{ percent(row.winRate) }}</td>
              <td>{{ money(row.grossPnlUsd) }}</td>
              <td>{{ money(row.netPnlUsd) }}</td>
              <td>
                @if (row.resolvedTo; as result) {
                  <span class="data__muted" title="Not used for trading P&amp;L">
                    {{ result | uppercase }}
                  </span>
                } @else {
                  <span class="data__muted">—</span>
                }
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="6">No markets produced coherent paper trades.</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styleUrl: './data-shared.less',
})
export class FitnessMarketsTableComponent {
  readonly trades = input.required<CompletedFitnessTrade[]>();
  readonly caption = input('Trading performance by market');

  protected readonly rows = computed(() => marketTradingRows(this.trades()));

  protected percent(value: number | null): string {
    return percentOrDash(value);
  }

  protected money(value: number): string {
    const sign = value > 0 ? '+' : '';
    return `${sign}$${value.toFixed(2)}`;
  }
}
