import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { WalletService } from './core/services/wallet.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <header class="app-header">
      <a routerLink="/" class="app-header__brand">PMTrader</a>
      <nav class="app-header__nav" aria-label="Main navigation">
        <a routerLink="/" routerLinkActive="app-header__link--active" [routerLinkActiveOptions]="{ exact: true }">
          Home
        </a>
        <a routerLink="/trades" routerLinkActive="app-header__link--active">Trades</a>
        <a routerLink="/markets" routerLinkActive="app-header__link--active">Markets</a>
      </nav>
      <div
        class="app-header__wallet-status"
        [attr.title]="wallet.statusMessage()"
        role="status"
        [attr.aria-label]="wallet.statusMessage()"
      >
        <span
          class="app-header__status-light"
          [class.app-header__status-light--connected]="wallet.status() === 'connected'"
          [class.app-header__status-light--error]="wallet.status() === 'error'"
          [class.app-header__status-light--connecting]="wallet.status() === 'connecting'"
          aria-hidden="true"
        ></span>
      </div>
    </header>
    <main id="main-content">
      <router-outlet />
    </main>
  `,
  styleUrl: './app.less',
})
export class App {
  protected readonly wallet = inject(WalletService);
}
