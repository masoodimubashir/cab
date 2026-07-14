import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { FixedDriverMapPage } from './fixed-driver-map.page';
import { FixedDriverPage } from './fixed-driver.page';

const routes: Routes = [
  { path: '', component: FixedDriverPage },
  { path: 'map/:departureId', component: FixedDriverMapPage },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class FixedDriverPageRoutingModule {}
