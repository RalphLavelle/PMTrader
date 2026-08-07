import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { FitnessReport, FitnessStatus } from '../../core/models/fitness.model';
import { FitnessService } from '../../core/services/fitness.service';
import {
  fixedOrDash,
  humaniseAgent,
  percentOrDash,
  signedPercentOrDash,
} from '../../core/utils/format-stats';
import { DataNavComponent } from './data-nav.component';
import { FitnessAgentDetailComponent } from './fitness-agent-detail.component';
import { FitnessContextComponent } from './fitness-context.component';

/**
 * Phase 5 dashboard: which specialist deserves trust, and under what conditions.
 *
 * Phase 4 graded the swarm's blended recommendation and found it almost always
 * holds, which makes it a poor thing to measure. This page grades each
 * specialist's own stance instead, whether or not the Risk Manager acted on it.
 */
@Component({
  selector: 'app-data-fitness',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DataNavComponent,
    DecimalPipe,
    FitnessAgentDetailComponent,
    FitnessContextComponent,
    ReactiveFormsModule,
  ],
  template: `
    <section class="page data" aria-labelledby="data-fitness-heading">
      <header class="page__header">
        <div>
          <h1 id="data-fitness-heading">Agent fitness</h1>
          <p class="page__subtitle">
            Grades every specialist's own stance against markets that have already
            resolved, and suggests how much each one's confidence should count.
          </p>
        </div>
      </header>

      <app-data-nav />

      <form class="data__controls" [formGroup]="form" (ngSubmit)="run()" aria-label="Fitness options">
        <label for="fit-markets">Markets</label>
        <input id="fit-markets" type="number" min="1" max="500" formControlName="markets" />

        <label for="fit-interval">Minutes between decisions</label>
        <input id="fit-interval" type="number" min="1" max="1440" formControlName="intervalMinutes" />

        <label for="fit-sample">Stances needed for a weight</label>
        <input id="fit-sample" type="number" min="1" max="10000" formControlName="minSample" />

        <label for="fit-book">
          <input id="fit-book" type="checkbox" formControlName="requireOrderbook" />
          Only where depth was captured
        </label>

        <label for="fit-runs">
          <input id="fit-runs" type="checkbox" formControlName="includeLiveRuns" />
          Include live swarm runs
        </label>

        <button type="submit" class="page__action" [disabled]="running()">
          {{ running() ? 'Measuring…' : 'Measure fitness' }}
        </button>
      </form>

      @if (error(); as message) {
        <p class="page__status page__status--error" role="alert">{{ message }}</p>
      }

      @if (status(); as s) {
        <p class="data__hint" role="status">
          {{ s.resolvedMarkets | number }} resolved markets are available to grade against.
          @if (s.resolvedMarkets === 0) {
            Enable <code>LABELLER_ENABLED=true</code> and wait for markets to settle.
          }
        </p>
      }

      @if (running()) {
        <p class="page__status" role="status">Replaying history and grading stances…</p>
      }

      @if (report(); as rep) {
        <div class="data__cards" role="list">
          <article class="data__card" role="listitem">
            <h2>Stances graded</h2>
            <p class="data__metric">{{ rep.gradedStances | number }}</p>
          </article>
          <article class="data__card" role="listitem">
            <h2>Markets covered</h2>
            <p class="data__metric">{{ rep.marketsCovered | number }}</p>
          </article>
          <article class="data__card" role="listitem">
            <h2>Specialists graded</h2>
            <p class="data__metric">{{ rep.agents.length | number }}</p>
          </article>
          <article class="data__card" role="listitem">
            <h2>Reliable weights</h2>
            <p class="data__metric">{{ reliableWeights() | number }}</p>
          </article>
        </div>

        @if (rep.warnings.length > 0) {
          <div class="data__sparse" role="status">
            <h2 class="data__section-title">Read these first</h2>
            <ul class="data__warnings">
              @for (warning of rep.warnings; track warning) {
                <li>{{ warning }}</li>
              }
            </ul>
          </div>
        }

        <h2 class="data__section-title">Suggested weights for Phase 6</h2>
        <p class="data__hint">
          A weight of 1.00 means "trust this specialist exactly as much as it asks to
          be trusted". Above 1 it beat the market price; below 1 reading the price
          would have served us better. Nothing applies these yet — Phase 5 measures,
          Phase 6 decides.
        </p>
        <div class="page__table-wrap">
          <table class="page__table">
            <caption class="visually-hidden">Suggested confidence weight per specialist</caption>
            <thead>
              <tr>
                <th scope="col">Specialist</th>
                <th scope="col">Weight</th>
                <th scope="col">Stances</th>
                <th scope="col">Took a side</th>
                <th scope="col">Accuracy</th>
                <th scope="col">Brier</th>
                <th scope="col">Skill vs market</th>
                <th scope="col">Overconfidence</th>
              </tr>
            </thead>
            <tbody>
              @for (agent of rep.agents; track agent.agent) {
                <tr>
                  <th scope="row">{{ humanise(agent.agent) }}</th>
                  <td>
                    {{ agent.weight.weight | number: '1.2-2' }}
                    @if (!agent.weight.reliable) {
                      <span class="data__tag">too few samples</span>
                    }
                  </td>
                  <td>{{ agent.overall.stances | number }}</td>
                  <td>{{ agent.overall.directional | number }}</td>
                  <td>{{ percent(agent.overall.accuracy) }}</td>
                  <td>{{ fixed(agent.overall.brierScore) }}</td>
                  <td>{{ signed(agent.overall.skillVsMarket) }}</td>
                  <td>{{ signed(agent.overall.overconfidence) }}</td>
                </tr>
              } @empty {
                <tr><td colspan="8">No specialist had any gradable stance.</td></tr>
              }
            </tbody>
          </table>
        </div>

        <app-fitness-context [headToHead]="rep.headToHead" [sources]="rep.sources" />

        <h2 class="data__section-title">Per specialist</h2>
        @for (agent of rep.agents; track agent.agent) {
          <app-fitness-agent-detail [agent]="agent" />
        }
      }
    </section>
  `,
  styleUrl: './data-shared.less',
})
export class DataFitnessComponent implements OnInit {
  private readonly fitness = inject(FitnessService);
  private readonly fb = inject(FormBuilder);

  protected readonly running = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly status = signal<FitnessStatus | null>(null);
  protected readonly report = signal<FitnessReport | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    markets: [50],
    intervalMinutes: [15],
    minSample: [30],
    requireOrderbook: [false],
    includeLiveRuns: [true],
  });

  /** How many weights rest on enough evidence to be worth acting on. */
  protected readonly reliableWeights = computed(
    () => this.report()?.agents.filter((agent) => agent.weight.reliable).length ?? 0,
  );

  ngOnInit(): void {
    this.loadStatus();
  }

  /** Fetch how much labelled data exists, plus any report from an earlier pass. */
  protected loadStatus(): void {
    this.fitness.getStatus().subscribe({
      next: (data) => {
        this.status.set(data);
        this.form.patchValue({
          markets: data.defaults.backtest.maxMarkets,
          intervalMinutes: data.defaults.backtest.decisionIntervalMinutes,
          minSample: data.defaults.minSampleForWeight,
          includeLiveRuns: data.defaults.includeLiveRuns,
        });
        if (data.lastRun) {
          this.report.set(data.lastRun);
        }
      },
      error: (err: unknown) => this.error.set(this.message(err, 'Failed to load status')),
    });
  }

  protected run(): void {
    this.running.set(true);
    this.error.set(null);

    this.fitness.run(this.form.getRawValue()).subscribe({
      next: (result) => {
        this.report.set(result);
        this.running.set(false);
      },
      error: (err: unknown) => {
        this.error.set(this.message(err, 'Fitness pass failed'));
        this.running.set(false);
      },
    });
  }

  protected humanise(agent: string): string {
    return humaniseAgent(agent);
  }

  protected percent(value: number | null): string {
    return percentOrDash(value);
  }

  protected signed(value: number | null): string {
    return signedPercentOrDash(value);
  }

  protected fixed(value: number | null): string {
    return fixedOrDash(value);
  }

  private message(err: unknown, fallback: string): string {
    return err instanceof Error ? err.message : fallback;
  }
}
