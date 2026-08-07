import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/**
 * Section navigation shared by every /data page.
 *
 * This markup used to be copied into each dashboard, which meant adding a
 * section required editing every file and remembering to move the highlight.
 * `routerLinkActive` now derives the highlight from the current URL, so there
 * is nothing for a page to pass in and nothing to get wrong.
 */
@Component({
  selector: 'app-data-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="data__nav" aria-label="Data sections">
      <!-- Exact matching only for the index, or it would light up on every child route. -->
      <a
        routerLink="/data"
        routerLinkActive="data__nav-link--active"
        [routerLinkActiveOptions]="{ exact: true }"
        ariaCurrentWhenActive="page"
        class="data__nav-link"
        >Overview</a
      >
      <a
        routerLink="/data/markets"
        routerLinkActive="data__nav-link--active"
        ariaCurrentWhenActive="page"
        class="data__nav-link"
        >Markets</a
      >
      <a
        routerLink="/data/orderbooks"
        routerLinkActive="data__nav-link--active"
        ariaCurrentWhenActive="page"
        class="data__nav-link"
        >Order books</a
      >
      <a
        routerLink="/data/trades"
        routerLinkActive="data__nav-link--active"
        ariaCurrentWhenActive="page"
        class="data__nav-link"
        >Trades</a
      >
      <a
        routerLink="/data/features"
        routerLinkActive="data__nav-link--active"
        ariaCurrentWhenActive="page"
        class="data__nav-link"
        >Features</a
      >
      <a
        routerLink="/data/backtest"
        routerLinkActive="data__nav-link--active"
        ariaCurrentWhenActive="page"
        class="data__nav-link"
        >Backtest</a
      >
      <a
        routerLink="/data/fitness"
        routerLinkActive="data__nav-link--active"
        ariaCurrentWhenActive="page"
        class="data__nav-link"
        >Fitness</a
      >
    </nav>
  `,
  styleUrl: './data-shared.less',
})
export class DataNavComponent {}
