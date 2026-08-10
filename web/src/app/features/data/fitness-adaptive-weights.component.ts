import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AdaptiveWeightTable } from '../../core/models/fitness.model';
import { fixedOrDash, humaniseAgent } from '../../core/utils/format-stats';

/**
 * Phase 6 adaptive weights — inspectable evidence for each specialist.
 *
 * Shown on the fitness and live-paper dashboards so readers can see why
 * influence moved away from the baseline of 1.0.
 */
@Component({
  selector: 'app-fitness-adaptive-weights',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    <section class="data__panel">
      @if (table(); as t) {
        <h2 class="data__section-title">⚖️ Adaptive weights (Phase 6)</h2>
      <p class="data__hint">
        Deterministic influence multipliers from coherent paper trades — not raw
        win rate × confidence. Baseline is {{ t.baselineWeight | number: '1.1-1' }}
        when evidence is thin.
        @if (t.sourceFitnessAt) {
          Last refreshed {{ shortTime(t.sourceFitnessAt) }}.
        }
      </p>

      @if (t.warnings.length > 0) {
        <ul class="data__warnings">
          @for (warning of t.warnings; track warning) {
            <li>{{ warning }}</li>
          }
        </ul>
      }

      <div class="page__table-wrap">
        <table class="page__table">
          <caption class="visually-hidden">Adaptive agent weights and evidence</caption>
          <thead>
            <tr>
              <th scope="col">Specialist</th>
              <th scope="col">Weight</th>
              <th scope="col">Baseline</th>
              <th scope="col">Samples</th>
              <th scope="col">Evidence</th>
              <th scope="col">Recent P&amp;L</th>
              <th scope="col">Long-term P&amp;L</th>
              <th scope="col">Drawdown</th>
              <th scope="col">Fitness</th>
            </tr>
          </thead>
          <tbody>
            @for (agent of t.agents; track agent.agent) {
              <tr>
                <th scope="row">{{ humanise(agent.agent) }}</th>
                <td>{{ agent.currentWeight | number: '1.3-3' }}</td>
                <td>{{ agent.baselineWeight | number: '1.1-1' }}</td>
                <td>{{ agent.sampleCount | number }}</td>
                <td>
                  <span class="data__tag">{{ agent.evidenceLevel }}</span>
                </td>
                <td>{{ money(agent.recentPnlUsd) }}</td>
                <td>{{ money(agent.longTermPnlUsd) }}</td>
                <td>{{ money(-agent.drawdownUsd) }}</td>
                <td>{{ fixed(agent.effectiveFitness) }}</td>
              </tr>
              <tr class="data__detail-row">
                <td colspan="9">
                  <p class="data__hint">{{ agent.rationale }}</p>
                  @if (agent.regime) {
                    <p class="data__hint">
                      Regime {{ agent.regime.dimension }}/{{ agent.regime.bucket }} —
                      {{ agent.regime.sampleCount | number }} trades,
                      fitness {{ fixed(agent.regime.fitness) }},
                      P&amp;L {{ money(agent.regime.realisedPnlUsd) }}.
                    </p>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="9">No adaptive weights published yet.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else {
      <h2 class="data__section-title">⚖️ Adaptive weights (Phase 6)</h2>
      <p class="data__hint" role="status">
        No weights published yet. Run a fitness pass or enable live paper trading
        so completed trades can feed the adaptive layer.
      </p>
    }
    </section>
  `,
  styleUrl: './data-shared.less',
})
export class FitnessAdaptiveWeightsComponent {
  readonly table = input<AdaptiveWeightTable | null | undefined>(null);

  protected humanise(agent: string): string {
    return humaniseAgent(agent);
  }

  protected fixed(value: number): string {
    return fixedOrDash(value);
  }

  protected money(value: number): string {
    const sign = value > 0 ? '+' : '';
    return `${sign}$${value.toFixed(2)}`;
  }

  protected shortTime(iso: string): string {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) {
      return iso;
    }
    return new Date(ms).toLocaleString();
  }
}
