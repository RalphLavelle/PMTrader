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
  {
    path: 'data',
    loadComponent: () =>
      import('./features/data/data-overview.component').then((m) => m.DataOverviewComponent),
  },
  {
    path: 'data/markets',
    loadComponent: () =>
      import('./features/data/data-markets.component').then((m) => m.DataMarketsComponent),
  },
  {
    path: 'data/markets/:marketId',
    loadComponent: () =>
      import('./features/data/data-market-detail.component').then(
        (m) => m.DataMarketDetailComponent,
      ),
  },
  {
    path: 'data/orderbooks',
    loadComponent: () =>
      import('./features/data/data-orderbooks.component').then(
        (m) => m.DataOrderbooksComponent,
      ),
  },
  {
    path: 'data/trades',
    loadComponent: () =>
      import('./features/data/data-trades.component').then((m) => m.DataTradesComponent),
  },
  {
    path: 'data/features',
    loadComponent: () =>
      import('./features/data/data-features.component').then((m) => m.DataFeaturesComponent),
  },
  {
    path: 'data/backtest',
    loadComponent: () =>
      import('./features/data/data-backtest.component').then((m) => m.DataBacktestComponent),
  },
  {
    path: 'data/fitness',
    loadComponent: () =>
      import('./features/data/data-fitness.component').then((m) => m.DataFitnessComponent),
  },
  {
    path: 'data/paper',
    loadComponent: () =>
      import('./features/data/data-paper.component').then((m) => m.DataPaperComponent),
  },
  { path: '**', redirectTo: '' },
];
