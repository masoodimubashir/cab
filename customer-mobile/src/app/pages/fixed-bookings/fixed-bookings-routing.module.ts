import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { FixedBookingsPage } from './fixed-bookings.page';

const routes: Routes = [
  {
    path: '',
    component: FixedBookingsPage,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class FixedBookingsPageRoutingModule {}
