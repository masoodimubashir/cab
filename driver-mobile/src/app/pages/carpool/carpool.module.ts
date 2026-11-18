import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { CarpoolRoutingModule } from './carpool-routing.module';

/** The carpool feature (Carpool-Integration-Guide section 5). UI kit pieces live in ./ui. */
@NgModule({
  imports: [CommonModule, IonicModule, CarpoolRoutingModule],
})
export class CarpoolModule {}
