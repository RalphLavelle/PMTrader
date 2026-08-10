import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { HeadToHead, SourceSummary } from '../../core/models/fitness.model';
import { humaniseAgent, percentOrDash } from '../../core/utils/format-stats';

/**
 * The context a reader needs around the weights table.
 *
 * Neither of these tables is about a single specialist, which is why they do not
 * belong in the per-agent drill-down; and neither is the headline result, which
 * is why they do not belong above it. They answer "should I believe the weights,
 * and what do the specialists do to each other?".
 */
@Component({
  selector: 'app-fitness-context',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    <h2 class="data__section-title">🤝 When specialists disagreed</h2>
    <p class="data__hint">
      The Risk Manager multiplies blended confidence by how much the specialists agreed,
      which assumes both sides of a disagreement are equally worth hearing. If one wins
      consistently here, that assumption is costing us edge.
    </p>
    <div class="page__table-wrap">
      <table class="page__table">
        <caption class="visually-hidden">Head-to-head record for each pair of specialists</caption>
        <thead>
          <tr>
            <th scope="col">Pair</th>
            <th scope="col">Both took a side</th>
            <th scope="col">Agreed</th>
            <th scope="col">Accuracy when agreed</th>
            <th scope="col">Disagreed</th>
            <th scope="col">Who was right</th>
          </tr>
        </thead>
        <tbody>
          @for (pair of headToHead(); track pair.agentA + pair.agentB) {
            <tr>
              <th scope="row">{{ humanise(pair.agentA) }} vs {{ humanise(pair.agentB) }}</th>
              <td>{{ pair.comparisons | number }}</td>
              <td>{{ pair.agreements | number }}</td>
              <td>{{ percent(pair.agreementAccuracy) }}</td>
              <td>{{ pair.disagreements | number }}</td>
              <td>
                {{ humanise(pair.agentA) }} {{ pair.agentAWins }} – {{ pair.agentBWins }}
                {{ humanise(pair.agentB) }}
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="6">No two specialists ever took a side at the same moment.</td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <h2 class="data__section-title">📚 Where the evidence came from</h2>
    <div class="page__table-wrap">
      <table class="page__table">
        <caption class="visually-hidden">Evidence contributed by each source</caption>
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">Stances</th>
            <th scope="col">Markets</th>
            <th scope="col">Agents covered</th>
            <th scope="col">What to keep in mind</th>
          </tr>
        </thead>
        <tbody>
          @for (source of sources(); track source.source) {
            <tr>
              <th scope="row">
                @switch (source.source) {
                  @case ('paper_replay') { Paper replay (primary) }
                  @case ('backtest') { Replayed history (forecast) }
                  @case ('live_run') { Live swarm runs (forecast) }
                }
              </th>
              <td>{{ source.stances | number }}</td>
              <td>{{ source.markets | number }}</td>
              <td>{{ agentList(source.agents) }}</td>
              <td class="data__hint">{{ source.note }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styleUrl: './data-shared.less',
})
export class FitnessContextComponent {
  readonly headToHead = input.required<HeadToHead[]>();
  readonly sources = input.required<SourceSummary[]>();

  protected humanise(agent: string): string {
    return humaniseAgent(agent);
  }

  /** A dash rather than an empty cell, so "no agents" is visibly deliberate. */
  protected agentList(agents: string[]): string {
    return agents.length > 0 ? agents.map(humaniseAgent).join(', ') : '—';
  }

  protected percent(value: number | null): string {
    return percentOrDash(value);
  }
}
