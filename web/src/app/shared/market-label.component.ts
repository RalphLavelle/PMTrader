import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { categoryEmoji, categoryLabel } from '../core/utils/category-emoji';

/**
 * Consistent market identity: category emoji, market title, event context, and link.
 *
 * Use across the data dashboards so rows like "66,600" are readable next to the
 * event question (e.g. a 5-minute Bitcoin price market).
 */
@Component({
  selector: 'app-market-label',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, NgTemplateOutlet],
  template: `
    @if (linked()) {
      <a [routerLink]="routerLink()" class="market-label__link" [class.market-label__link--heading]="heading()">
        <ng-container *ngTemplateOutlet="body" />
      </a>
    } @else {
      <span class="market-label" [class.market-label--heading]="heading()">
        <ng-container *ngTemplateOutlet="body" />
      </span>
    }

    <ng-template #body>
      <span class="market-label__row">
        @if (showCategory() && category()) {
          <span class="market-label__category" [attr.title]="categoryLabel(category()!)">
            <span aria-hidden="true">{{ categoryEmoji(category()!) }}</span>
            <span class="visually-hidden">{{ categoryLabel(category()!) }}</span>
          </span>
        }
        <span class="market-label__primary">{{ primaryTitle() }}</span>
      </span>
      @if (eventTitle()) {
        <span class="market-label__event">{{ eventTitle() }}</span>
      }
    </ng-template>
  `,
  styleUrl: './market-label.component.less',
})
export class MarketLabelComponent {
  readonly marketId = input.required<string>();
  /** Strike / option label from snapshots (e.g. "66,600"). */
  readonly title = input<string>();
  /** Alias used by trade rows. */
  readonly marketTitle = input<string>();
  /** Event question or match title for context. */
  readonly eventTitle = input<string>();
  readonly category = input<string>();
  /** Link to data market detail (default), live market page, or none. */
  readonly linkTo = input<'data' | 'live' | 'none'>('data');
  readonly heading = input(false);
  readonly showCategory = input(true);

  protected readonly linked = computed(() => this.linkTo() !== 'none');
  protected readonly primaryTitle = computed(
    () => this.marketTitle() ?? this.title() ?? this.marketId(),
  );
  protected readonly routerLink = computed(() =>
    this.linkTo() === 'live'
      ? ['/markets', this.marketId()]
      : ['/data/markets', this.marketId()],
  );

  protected readonly categoryEmoji = categoryEmoji;
  protected readonly categoryLabel = categoryLabel;
}
