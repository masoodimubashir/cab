import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { FixedRouteMapPage } from './fixed-route-map.page';

const routes: Routes = [{ path: '', component: FixedRouteMapPage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class FixedRouteMapPageRoutingModule {}
