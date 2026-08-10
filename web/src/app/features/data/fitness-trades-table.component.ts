import { DecimalPipe, UpperCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { CompletedFitnessTrade } from '../../core/models/fitness.model';
import { humaniseAgent, percentOrDash } from '../../core/utils/format-stats';
import { sortTradesChronologically } from './fitness-trade-utils';

/**
 * Table of coherent paper trades with expandable entry context.
 *
 * Resolution is labelled as secondary context — it never drove the P&L column.
 */
@Component({
  selector: 'app-fitness-trades-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, UpperCasePipe],
  template: `
    <div class="page__table-wrap">
      <table class="page__table">
        <caption class="visually-hidden">{{ caption() }}</caption>
        <thead>
          <tr>
            <th scope="col">Market</th>
            <th scope="col">Side</th>
            <th scope="col">Entry</th>
            <th scope="col">Exit</th>
            <th scope="col">Hold (min)</th>
            <th scope="col">Gross</th>
            <th scope="col">Net</th>
            <th scope="col">Resolution (context)</th>
            <th scope="col"><span class="visually-hidden">Details</span></th>
          </tr>
        </thead>
        <tbody>
          @for (trade of rows(); track trackKey(trade, $index)) {
            <tr>
              <th scope="row">{{ trade.marketId }}</th>
              <td>{{ trade.side | uppercase }}</td>
              <td>
                {{ trade.entryPriceUsd | number: '1.2-4' }}
                <span class="data__muted">{{ shortTime(trade.entryAt) }}</span>
              </td>
              <td>
                {{ trade.exitPriceUsd | number: '1.2-4' }}
                <span class="data__muted">{{ shortTime(trade.exitAt) }}</span>
              </td>
              <td>{{ trade.holdingMinutes | number: '1.0-1' }}</td>
              <td>{{ money(trade.grossPnlUsd) }}</td>
              <td>{{ money(trade.netPnlUsd) }}</td>
              <td>
                @if (trade.resolvedTo; as result) {
                  <span class="data__muted" title="Not used for trading P&amp;L">
                    {{ result | uppercase }}
                  </span>
                } @else {
                  <span class="data__muted">—</span>
                }
              </td>
              <td>
                <button
                  type="button"
                  class="data__linkish"
                  [attr.aria-expanded]="expanded() === trackKey(trade, $index)"
                  (click)="toggle(trackKey(trade, $index))"
                >
                  {{ expanded() === trackKey(trade, $index) ? 'Hide' : 'Signals' }}
                </button>
              </td>
            </tr>
            @if (expanded() === trackKey(trade, $index)) {
              <tr class="data__detail-row">
                <td colspan="9">
                  <p class="data__hint">
                    Entry {{ trade.entryAt }} → exit {{ trade.exitAt }}.
                    Size {{ money(trade.sizeUsd) }} ({{ trade.quantity | number: '1.0-2' }} contracts).
                    Cost drag {{ money(trade.estimatedCostUsd) }}.
                  </p>
                  <p class="data__hint">
                    Signals at entry
                    ({{ trade.swarmStateAtEntry.recommendation }},
                    conf {{ percent(trade.swarmStateAtEntry.confidence) }},
                    {{ trade.swarmStateAtEntry.approved ? 'approved' : 'not approved' }}):
                  </p>
                  <ul class="data__warnings">
                    @for (signal of trade.swarmStateAtEntry.signals; track signal.agent) {
                      <li>
                        {{ humanise(signal.agent) }} —
                        {{ signal.stance }} @ {{ percent(signal.confidence) }}
                      </li>
                    } @empty {
                      <li>No specialist signals recorded at entry.</li>
                    }
                  </ul>
                  <p class="data__hint">Adaptive weights at entry:</p>
                  <ul class="data__warnings">
                    @if (trade.adaptiveWeightsAtEntry; as weights) {
                      @for (entry of weightEntries(weights); track entry.agent) {
                        <li>{{ humanise(entry.agent) }} — {{ entry.weight | number: '1.2-2' }}</li>
                      }
                    } @else {
                      <li>None published yet (baseline influence of 1.0).</li>
                    }
                  </ul>
                </td>
              </tr>
            }
          } @empty {
            <tr>
              <td colspan="9">No coherent paper trades in this book yet.</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styleUrl: './data-shared.less',
})
export class FitnessTradesTableComponent {
  readonly trades = input.required<CompletedFitnessTrade[]>();
  readonly caption = input('Coherent paper trades');

  protected readonly expanded = signal<string | null>(null);

  protected readonly rows = computed(() => sortTradesChronologically(this.trades()));

  protected trackKey(trade: CompletedFitnessTrade, index: number): string {
    return `${trade.marketId}:${trade.entryAt}:${trade.exitAt}:${index}`;
  }

  protected toggle(key: string): void {
    this.expanded.update((current) => (current === key ? null : key));
  }

  protected shortTime(iso: string): string {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) {
      return iso;
    }
    return new Date(ms).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  protected humanise(agent: string): string {
    return humaniseAgent(agent);
  }

  protected percent(value: number): string {
    return percentOrDash(value);
  }

  protected money(value: number): string {
    const sign = value > 0 ? '+' : '';
    return `${sign}$${value.toFixed(2)}`;
  }

  protected weightEntries(weights: Record<string, number>): Array<{ agent: string; weight: number }> {
    return Object.entries(weights)
      .map(([agent, weight]) => ({ agent, weight }))
      .sort((a, b) => a.agent.localeCompare(b.agent));
  }
}
