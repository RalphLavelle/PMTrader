import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page home" aria-labelledby="home-heading">
      <h1 id="home-heading">PMTrader</h1>
      <p class="home__intro">
        Trade binary prediction markets on Solana via Jupiter. Choose an area below
        to explore recent activity or browse open markets.
      </p>

      <nav class="home__nav" aria-label="Main sections">
        <a routerLink="/trades" class="home__card">
          <h2>Trades</h2>
          <p>View the global trade feed and your wallet history.</p>
        </a>
        <a routerLink="/markets" class="home__card">
          <h2>Markets</h2>
          <p>Browse trending prediction markets and open market details.</p>
        </a>
        <a routerLink="/data" class="home__card">
          <h2>Data</h2>
          <p>Explore the research dataset, order books, and computed features.</p>
        </a>
      </nav>
    </section>
  `,
  styleUrl: './home.component.less',
  imports: [RouterLink],
})
export class HomeComponent {}
