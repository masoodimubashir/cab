import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FixedRouteMapPageRoutingModule } from './fixed-route-map-routing.module';
import { FixedRouteMapPage } from './fixed-route-map.page';

@NgModule({
  imports: [CommonModule, IonicModule, FixedRouteMapPageRoutingModule],
  declarations: [FixedRouteMapPage],
})
export class FixedRouteMapPageModule {}
