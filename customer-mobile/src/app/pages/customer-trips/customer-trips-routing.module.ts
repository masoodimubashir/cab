import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CustomerTripsPage } from './customer-trips.page';

const routes: Routes = [{ path: '', component: CustomerTripsPage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class CustomerTripsPageRoutingModule {}

