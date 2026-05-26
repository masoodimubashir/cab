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
        path: 'more',
        loadChildren: () =>
          import('../pages/more/more.module').then((m) => m.CustomerMorePageModule),
      },
      {
        path: 'profile',
        loadChildren: () =>
          import('../pages/profile/profile.module').then((m) => m.CustomerProfilePageModule),
      },
      {
        path: 'saved-locations',
        loadChildren: () =>
          import('../pages/saved-locations/saved-locations.module').then((m) => m.SavedLocationsPageModule),
      },
      {
        path: 'emergency-contacts',
        loadChildren: () =>
          import('../pages/emergency-contacts/emergency-contacts.module').then((m) => m.CustomerEmergencyContactsPageModule),
      },
      {
        path: 'trip/:tripId',
        loadChildren: () =>
          import('../pages/trip-active/trip-active.module').then((m) => m.TripActivePageModule),
      },
      {
        path: 'trip-details/:tripId',
        loadChildren: () =>
          import('../pages/trip-details/trip-details.module').then((m) => m.TripDetailsPageModule),
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
