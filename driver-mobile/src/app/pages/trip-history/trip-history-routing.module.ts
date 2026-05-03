import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { TripHistoryPage } from './trip-history.page';

const routes: Routes = [{ path: '', component: TripHistoryPage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class TripHistoryPageRoutingModule {}
