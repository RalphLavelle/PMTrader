import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { AgentFitness, RegimeFitness } from '../../core/models/fitness.model';
import {
  fixedOrDash,
  humaniseAgent,
  percentOrDash,
  signedPercentOrDash,
} from '../../core/utils/format-stats';
import { FitnessEquityChartsComponent } from './fitness-equity-charts.component';
import { FitnessTradesTableComponent } from './fitness-trades-table.component';

/** Human labels for the regime dimensions, so the table groups readably. */
const DIMENSION_LABELS: Record<RegimeFitness['dimension'], string> = {
  liquidity: 'Liquidity',
  time_to_close: 'Time to close',
  market_conviction: 'How lopsided the market was',
  orderbook: 'Order book coverage',
};

/**
 * One specialist's full record: trading first, forecasting second.
 */
@Component({
  selector: 'app-fitness-agent-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, FitnessEquityChartsComponent, FitnessTradesTableComponent],
  template: `
    <details class="data__agent">
      <summary>
        <strong>{{ title() }}</strong>
        — weight {{ agent().weight.weight | number: '1.2-2' }} over
        {{ agent().trading.trades | number }} paper trades
      </summary>

      <p class="data__hint">{{ agent().weight.rationale }}</p>

      <h3 class="data__section-title">Trading performance (primary)</h3>
      <div class="page__table-wrap">
        <table class="page__table">
          <caption class="visually-hidden">{{ title() }} coherent paper-trade stats</caption>
          <thead>
            <tr>
              <th scope="col">Trades</th>
              <th scope="col">Win rate</th>
              <th scope="col">Avg trade</th>
              <th scope="col">Gross</th>
              <th scope="col">Net</th>
              <th scope="col">Profit factor</th>
              <th scope="col">Best</th>
              <th scope="col">Worst</th>
              <th scope="col">Max DD</th>
              <th scope="col">Avg hold</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{{ agent().trading.trades | number }}</td>
              <td>{{ percent(agent().trading.winRate) }}</td>
              <td>{{ moneyOrDash(agent().trading.avgTradePnlUsd) }}</td>
              <td>{{ money(agent().trading.grossPnlUsd ?? agent().trading.realisedPnlUsd) }}</td>
              <td>{{ money(agent().trading.realisedPnlUsd) }}</td>
              <td>{{ fixed(agent().trading.profitFactor) }}</td>
              <td>{{ moneyOrDash(agent().trading.largestWinnerUsd) }}</td>
              <td>{{ moneyOrDash(agent().trading.largestLoserUsd) }}</td>
              <td>{{ money(agent().trading.maxDrawdownUsd) }}</td>
              <td>{{ fixed(agent().trading.avgHoldingMinutes) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="data__hint">
        Behaviour —
        missed {{ agent().trading.behaviour.missedOpportunities }},
        premature exits {{ agent().trading.behaviour.prematureExits }},
        losing exits {{ agent().trading.behaviour.losingExits }},
        held too long {{ agent().trading.behaviour.heldTooLong }},
        drawdown events {{ agent().trading.behaviour.drawdownEvents }}.
        Avg MFE {{ moneyOrDash(agent().trading.avgMfeUsd) }},
        avg MAE {{ moneyOrDash(agent().trading.avgMaeUsd) }}.
      </p>

      <app-fitness-equity-charts [trades]="agent().trades ?? []" [title]="title()" />

      <h3 class="data__section-title">Individual trades</h3>
      <app-fitness-trades-table
        [trades]="agent().trades ?? []"
        [caption]="title() + ' coherent paper trades'"
      />

      <h3 class="data__section-title">By market regime (trading + forecast)</h3>
      <p class="data__hint">
        Trading columns use coherent trades entered in that regime. Forecast columns
        remain the secondary Brier / stance view.
      </p>
      <div class="page__table-wrap">
        <table class="page__table">
          <caption class="visually-hidden">
            {{ title() }} performance broken down by market conditions
          </caption>
          <thead>
            <tr>
              <th scope="col">Condition</th>
              <th scope="col">Bucket</th>
              <th scope="col">Trades</th>
              <th scope="col">Win rate</th>
              <th scope="col">Net P&amp;L</th>
              <th scope="col">Stances</th>
              <th scope="col">Brier (2nd)</th>
            </tr>
          </thead>
          <tbody>
            @for (regime of regimes(); track regime.key) {
              <tr>
                <th scope="row">{{ regime.dimensionLabel }}</th>
                <td [title]="regime.description">{{ regime.bucket }}</td>
                <td>{{ (regime.trading?.trades ?? 0) | number }}</td>
                <td>{{ percent(regime.trading?.winRate ?? null) }}</td>
                <td>{{ moneyOrDash(regime.trading?.realisedPnlUsd ?? null) }}</td>
                <td>{{ regime.stats.stances | number }}</td>
                <td>{{ fixed(regime.stats.brierScore) }}</td>
              </tr>
            } @empty {
              <tr>
                <td colspan="7">No graded trades or stances for this agent.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <h3 class="data__section-title">Forecasting calibration (secondary)</h3>
      <p class="data__hint">
        When this agent implied a high chance of YES, did markets resolve YES that often?
        Separate from trading P&amp;L.
      </p>
      <div class="page__table-wrap">
        <table class="page__table">
          <caption class="visually-hidden">
            {{ title() }} predicted versus observed YES rate by probability band
          </caption>
          <thead>
            <tr>
              <th scope="col">Band</th>
              <th scope="col">Stances</th>
              <th scope="col">Mean predicted</th>
              <th scope="col">Observed YES</th>
            </tr>
          </thead>
          <tbody>
            @for (bucket of agent().calibration; track bucket.lowerBound) {
              <tr>
                <th scope="row">
                  {{ percent(bucket.lowerBound, 0) }}–{{ percent(bucket.upperBound, 0) }}
                </th>
                <td>{{ bucket.decisions | number }}</td>
                <td>{{ percent(bucket.meanPredicted) }}</td>
                <td>{{ percent(bucket.observedYesRate) }}</td>
              </tr>
            } @empty {
              <tr>
                <td colspan="4">Nothing to calibrate (needs resolution labels).</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <h3 class="data__section-title">By evidence source (forecasting)</h3>
      <div class="page__table-wrap">
        <table class="page__table">
          <caption class="visually-hidden">{{ title() }} performance by evidence source</caption>
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Stances</th>
              <th scope="col">Accuracy</th>
              <th scope="col">Brier</th>
              <th scope="col">Skill vs market</th>
            </tr>
          </thead>
          <tbody>
            @for (entry of agent().bySource; track entry.source) {
              <tr>
                <th scope="row">{{ sourceLabel(entry.source) }}</th>
                <td>{{ entry.stats.stances | number }}</td>
                <td>{{ percent(entry.stats.accuracy) }}</td>
                <td>{{ fixed(entry.stats.brierScore) }}</td>
                <td>{{ signed(entry.stats.skillVsMarket) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </details>
  `,
  styleUrl: './data-shared.less',
})
export class FitnessAgentDetailComponent {
  readonly agent = input.required<AgentFitness>();

  protected readonly title = computed(() => humaniseAgent(this.agent().agent));

  /** Regime rows with their dimension label resolved and a stable track key. */
  protected readonly regimes = computed(() =>
    this.agent().regimes.map((regime) => ({
      ...regime,
      key: `${regime.dimension}:${regime.bucket}`,
      dimensionLabel: DIMENSION_LABELS[regime.dimension],
    })),
  );

  protected percent(value: number | null, decimals = 1): string {
    return percentOrDash(value, decimals);
  }

  protected signed(value: number | null): string {
    return signedPercentOrDash(value);
  }

  protected fixed(value: number | null): string {
    return fixedOrDash(value);
  }

  protected money(value: number): string {
    const sign = value > 0 ? '+' : '';
    return `${sign}$${value.toFixed(2)}`;
  }

  protected moneyOrDash(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '—';
    }
    return this.money(value);
  }

  protected sourceLabel(source: string): string {
    if (source === 'paper_replay') return 'Paper replay';
    if (source === 'backtest') return 'Replayed history';
    return 'Live swarm runs';
  }
}
