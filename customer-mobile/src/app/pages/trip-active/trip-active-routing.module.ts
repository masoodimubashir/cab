import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { TripActivePage } from './trip-active.page';

const routes: Routes = [{ path: '', component: TripActivePage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class TripActivePageRoutingModule {}
