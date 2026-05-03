import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CustomerTabsPage } from './customer-tabs.page';

const routes: Routes = [
  {
    path: '',
    component: CustomerTabsPage,
    children: [
      {
        path: 'book',
        loadChildren: () =>
          import('../pages/customer-book/customer-book.module').then((m) => m.CustomerBookPageModule),
      },
      {
        path: 'my-trips',
        loadChildren: () =>
          import('../pages/customer-trips/customer-trips.module').then((m) => m.CustomerTripsPageModule),
      },
      {
        path: 'negotiation/:tripId',
        loadChildren: () =>
          import('../pages/customer-negotiation/customer-negotiation.module').then(
            (m) => m.CustomerNegotiationPageModule
          ),
      },
      {
        path: 'more',
        loadChildren: () => import('../pages/more/more.module').then((m) => m.MorePageModule),
      },
      {
        path: '',
        redirectTo: 'book',
        pathMatch: 'full',
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class CustomerTabsPageRoutingModule {}

