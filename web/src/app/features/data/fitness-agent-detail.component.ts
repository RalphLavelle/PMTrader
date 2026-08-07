import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { AgentFitness, RegimeFitness } from '../../core/models/fitness.model';
import {
  fixedOrDash,
  humaniseAgent,
  percentOrDash,
  signedPercentOrDash,
} from '../../core/utils/format-stats';

/** Human labels for the regime dimensions, so the table groups readably. */
const DIMENSION_LABELS: Record<RegimeFitness['dimension'], string> = {
  liquidity: 'Liquidity',
  time_to_close: 'Time to close',
  market_conviction: 'How lopsided the market was',
  orderbook: 'Order book coverage',
};

/**
 * One specialist's full record: how it did overall, and where.
 *
 * Split out of the fitness page because the page is a comparison between agents
 * and this is a drill-down into one. Keeping them apart means the page stays
 * readable and this table can be reused unchanged if a per-agent route is ever
 * added.
 */
@Component({
  selector: 'app-fitness-agent-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    <details class="data__agent">
      <summary>
        <strong>{{ title() }}</strong>
        — weight {{ agent().weight.weight | number: '1.2-2' }} over
        {{ agent().overall.stances | number }} stances
      </summary>

      <p class="data__hint">{{ agent().weight.rationale }}</p>

      <h3 class="data__section-title">By market conditions</h3>
      <p class="data__hint">
        A single accuracy figure hides where a specialist earns its keep. Skill compares
        the agent's Brier score with the market price's over the same moments, so a
        positive number means it knew something the price did not.
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
              <th scope="col">Stances</th>
              <th scope="col">Took a side</th>
              <th scope="col">Accuracy</th>
              <th scope="col">Brier</th>
              <th scope="col">Skill vs market</th>
            </tr>
          </thead>
          <tbody>
            @for (regime of regimes(); track regime.key) {
              <tr>
                <th scope="row">{{ regime.dimensionLabel }}</th>
                <td [title]="regime.description">{{ regime.bucket }}</td>
                <td>{{ regime.stats.stances | number }}</td>
                <td>{{ regime.stats.directional | number }}</td>
                <td>{{ percent(regime.stats.accuracy) }}</td>
                <td>{{ fixed(regime.stats.brierScore) }}</td>
                <td>{{ signed(regime.stats.skillVsMarket) }}</td>
              </tr>
            } @empty {
              <tr>
                <td colspan="7">No graded stances for this agent.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <h3 class="data__section-title">Calibration</h3>
      <p class="data__hint">
        When this agent implied a {{ '70%' }} chance of YES, did roughly {{ '70%' }} of
        those markets resolve YES? Predicted and observed should track each other.
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
                <td colspan="4">Nothing to calibrate.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <h3 class="data__section-title">By evidence source</h3>
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
                <th scope="row">
                  {{ entry.source === 'backtest' ? 'Replayed history' : 'Live swarm runs' }}
                </th>
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
}
