import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { FixedRideActivePage } from './fixed-ride-active.page';

const routes: Routes = [
  {
    path: '',
    component: FixedRideActivePage,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class FixedRideActivePageRoutingModule {}
