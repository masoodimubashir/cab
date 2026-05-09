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
        path: 'trip/:tripId',
        loadChildren: () =>
          import('../pages/trip-active/trip-active.module').then((m) => m.TripActivePageModule),
      },
      {
        path: 'negotiation/:tripId',
        redirectTo: 'trip/:tripId',
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
