import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ShuttleBookingsPage } from './shuttle-bookings.page';

const routes: Routes = [
  {
    path: '',
    component: ShuttleBookingsPage,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ShuttleBookingsPageRoutingModule {}
