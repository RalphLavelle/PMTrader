import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/** One tab in the /data section — emoji is decorative only (aria-hidden). */
interface DataTab {
  path: string;
  label: string;
  emoji: string;
  exact?: boolean;
  tone: string;
}

/**
 * Tab bar shared by every /data page.
 *
 * Styled as real tabs (not inline page headings) so readers can tell navigation
 * apart from the dashboard content below.
 */
@Component({
  selector: 'app-data-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="data__tabs" aria-label="Data sections">
      @for (tab of tabs; track tab.path) {
        <a
          [routerLink]="tab.path"
          routerLinkActive="data__tab--active"
          [routerLinkActiveOptions]="{ exact: tab.exact ?? false }"
          [class]="'data__tab data__tab--' + tab.tone"
          ariaCurrentWhenActive="page"
        >
          <span class="data__tab-emoji" aria-hidden="true">{{ tab.emoji }}</span>
          {{ tab.label }}
        </a>
      }
    </nav>
  `,
  styleUrl: './data-shared.less',
})
export class DataNavComponent {
  /** Order matches the learning loop: collect → analyse → grade → trade. */
  protected readonly tabs: DataTab[] = [
    { path: '/data', label: 'Overview', emoji: '📊', exact: true, tone: 'overview' },
    { path: '/data/markets', label: 'Markets', emoji: '🏪', tone: 'markets' },
    { path: '/data/orderbooks', label: 'Order books', emoji: '📖', tone: 'orderbooks' },
    { path: '/data/trades', label: 'Trades', emoji: '⚡', tone: 'trades' },
    { path: '/data/features', label: 'Features', emoji: '🔬', tone: 'features' },
    { path: '/data/backtest', label: 'Backtest', emoji: '⏪', tone: 'backtest' },
    { path: '/data/fitness', label: 'Fitness', emoji: '🏆', tone: 'fitness' },
    { path: '/data/paper', label: 'Paper', emoji: '📝', tone: 'paper' },
  ];
}
