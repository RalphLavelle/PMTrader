import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { normaliseOutcome, outcomeDisplayLabel, type OutcomeKind } from '../core/utils/outcome-style';

/**
 * A coloured Yes / No label used for market outcomes, trade sides, and stances.
 *
 * Centralising the markup keeps green/red styling consistent everywhere the app
 * shows a binary decision.
 */
@Component({
  selector: 'app-outcome-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="outcome"
      [class.outcome--yes]="kind() === 'yes'"
      [class.outcome--no]="kind() === 'no'"
      [class.outcome--neutral]="kind() === null"
    >
      {{ label() }}
    </span>
  `,
})
export class OutcomeBadgeComponent {
  /** Raw value from the API — yes/no, true/false, or display strings. */
  readonly value = input.required<OutcomeKind>();

  /** Optional override for the visible text (defaults to Yes / No / —). */
  readonly text = input<string>();

  protected readonly kind = computed(() => normaliseOutcome(this.value()));

  protected readonly label = computed(() => {
    const override = this.text();
    if (override !== undefined && override !== '') {
      return override;
    }
    return outcomeDisplayLabel(this.kind());
  });
}
