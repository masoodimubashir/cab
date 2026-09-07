import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { TabsPage } from './tabs.page';

const routes: Routes = [
  {
    path: '',
    component: TabsPage,
    children: [
      {
        path: 'dashboard',
        loadChildren: () =>
          import('../pages/dashboard/dashboard.module').then((m) => m.DashboardPageModule),
      },
      {
        path: 'rides',
        loadChildren: () =>
          import('../pages/rides/rides.module').then((m) => m.RidesPageModule),
      },
      {
        path: 'earnings',
        loadChildren: () =>
          import('../pages/earnings/earnings.module').then((m) => m.EarningsPageModule),
      },
      {
        path: 'wallet',
        loadChildren: () =>
          import('../pages/wallet/wallet.module').then((m) => m.WalletPageModule),
      },
      {
        path: 'history',
        loadChildren: () =>
          import('../pages/trip-history/trip-history.module').then((m) => m.TripHistoryPageModule),
      },
      {
        path: 'scheduled',
        loadChildren: () =>
          import('../pages/scheduled-rides/scheduled-rides.module').then((m) => m.ScheduledRidesPageModule),
      },
      {
        path: 'fixed',
        loadChildren: () =>
          import('../pages/fixed-driver/fixed-driver.module').then((m) => m.FixedDriverPageModule),
      },
      {
        path: 'more',
        loadChildren: () => import('../pages/more/more.module').then((m) => m.MorePageModule),
      },
      {
        path: 'terms',
        loadChildren: () => import('../pages/terms/terms.module').then((m) => m.TermsPageModule),
      },
      {
        path: 'privacy',
        loadChildren: () => import('../pages/privacy/privacy.module').then((m) => m.PrivacyPageModule),
      },
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full',
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class TabsPageRoutingModule {}
