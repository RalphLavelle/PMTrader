import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CompletedFitnessTrade } from '../../core/models/fitness.model';
import { LineChartComponent } from '../../shared/line-chart.component';
import { drawdownCurvePoints, equityCurvePoints } from './fitness-trade-utils';

/**
 * Equity and drawdown curves from coherent paper trades over time.
 */
@Component({
  selector: 'app-fitness-equity-charts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LineChartComponent],
  template: `
    <div class="data__charts" role="group" [attr.aria-label]="title() + ' performance over time'">
      <div>
        <h3 class="data__section-title">{{ title() }} equity curve</h3>
        <p class="data__hint">Cumulative net P&amp;L after each coherent closed trade.</p>
        <app-line-chart
          [points]="equity()"
          [ariaLabel]="title() + ' cumulative net P&L'"
          [caption]="'Net equity over exit time'"
          emptyMessage="Need at least two closed trades to draw an equity curve."
        />
      </div>
      <div>
        <h3 class="data__section-title">{{ title() }} drawdown</h3>
        <p class="data__hint">Distance below the running equity peak (≤ 0).</p>
        <app-line-chart
          [points]="drawdown()"
          [ariaLabel]="title() + ' drawdown from peak'"
          [caption]="'Drawdown over exit time'"
          emptyMessage="Need at least two closed trades to draw drawdown."
        />
      </div>
    </div>
  `,
  styleUrl: './data-shared.less',
})
export class FitnessEquityChartsComponent {
  readonly trades = input.required<CompletedFitnessTrade[]>();
  readonly title = input('Portfolio');

  protected readonly equity = computed(() => equityCurvePoints(this.trades()));
  protected readonly drawdown = computed(() => drawdownCurvePoints(this.trades()));
}
