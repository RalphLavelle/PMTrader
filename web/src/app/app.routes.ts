import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/home/home.component').then((m) => m.HomeComponent),
  },
  {
    path: 'trades',
    loadComponent: () =>
      import('./features/trades/trades.component').then((m) => m.TradesComponent),
  },
  {
    path: 'markets',
    loadComponent: () =>
      import('./features/markets/markets.component').then((m) => m.MarketsComponent),
  },
  {
    path: 'markets/:marketId',
    loadComponent: () =>
      import('./features/markets/market-detail.component').then(
        (m) => m.MarketDetailComponent,
      ),
  },
  { path: '**', redirectTo: '' },
];
