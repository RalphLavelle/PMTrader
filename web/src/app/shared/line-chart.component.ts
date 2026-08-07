import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ChartPoint } from '../core/models/data.model';

/**
 * Accessible inline SVG line chart — no third-party chart library.
 *
 * Visual: polyline + axes.
 * A11y: role="img" with aria-label, plus a visually-hidden data table so
 * screen readers get the numbers, not just the picture.
 */
@Component({
  selector: 'app-line-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    @if (points().length < 2) {
      <p class="line-chart__empty" role="status">
        {{ emptyMessage() }}
      </p>
    } @else {
      <figure class="line-chart">
        <svg
          [attr.viewBox]="'0 0 ' + width + ' ' + height"
          role="img"
          [attr.aria-label]="ariaLabel()"
          class="line-chart__svg"
        >
          <!-- Horizontal guide lines -->
          @for (g of guides(); track g.y) {
            <line
              [attr.x1]="padding.left"
              [attr.x2]="width - padding.right"
              [attr.y1]="g.y"
              [attr.y2]="g.y"
              class="line-chart__guide"
            />
            <text
              [attr.x]="padding.left - 6"
              [attr.y]="g.y + 4"
              text-anchor="end"
              class="line-chart__axis-label"
            >
              {{ g.label | number: '1.2-2' }}
            </text>
          }

          <polyline [attr.points]="polylinePoints()" class="line-chart__line" fill="none" />

          @for (p of plotted(); track p.at) {
            <circle [attr.cx]="p.x" [attr.cy]="p.y" r="2.5" class="line-chart__dot">
              <title>{{ p.at }}: {{ p.value | number: '1.4-4' }}</title>
            </circle>
          }
        </svg>

        @if (caption()) {
          <figcaption class="line-chart__caption">{{ caption() }}</figcaption>
        }

        <!-- Screen-reader table of the same data -->
        <table class="visually-hidden">
          <caption>{{ ariaLabel() }}</caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            @for (p of points(); track p.at) {
              <tr>
                <td>{{ p.at }}</td>
                <td>{{ p.value }}</td>
              </tr>
            }
          </tbody>
        </table>
      </figure>
    }
  `,
  styleUrl: './line-chart.component.less',
})
export class LineChartComponent {
  /** Data points in chronological order. */
  readonly points = input.required<ChartPoint[]>();
  /** Spoken description of what the chart shows. */
  readonly ariaLabel = input('Line chart');
  /** Optional visible caption under the chart. */
  readonly caption = input('');
  /** Message when there are fewer than two points. */
  readonly emptyMessage = input('Not enough data points to draw a chart yet.');

  protected readonly width = 640;
  protected readonly height = 220;
  protected readonly padding = { top: 16, right: 16, bottom: 24, left: 48 };

  protected readonly plotted = computed(() => {
    const pts = this.points();
    if (pts.length < 2) {
      return [] as Array<ChartPoint & { x: number; y: number }>;
    }
    const values = pts.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const innerW = this.width - this.padding.left - this.padding.right;
    const innerH = this.height - this.padding.top - this.padding.bottom;

    return pts.map((p, i) => ({
      ...p,
      x: this.padding.left + (i / (pts.length - 1)) * innerW,
      y: this.padding.top + (1 - (p.value - min) / span) * innerH,
    }));
  });

  protected readonly polylinePoints = computed(() =>
    this.plotted()
      .map((p) => `${p.x},${p.y}`)
      .join(' '),
  );

  protected readonly guides = computed(() => {
    const pts = this.points();
    if (pts.length < 2) {
      return [] as Array<{ y: number; label: number }>;
    }
    const values = pts.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const innerH = this.height - this.padding.top - this.padding.bottom;
    return [0, 0.5, 1].map((t) => {
      const label = min + span * (1 - t);
      return {
        y: this.padding.top + t * innerH,
        label,
      };
    });
  });
}
