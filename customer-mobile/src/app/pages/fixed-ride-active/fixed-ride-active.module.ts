import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { FixedRideActivePageRoutingModule } from './fixed-ride-active-routing.module';
import { FixedRideActivePage } from './fixed-ride-active.page';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, FixedRideActivePageRoutingModule],
  declarations: [FixedRideActivePage],
})
export class FixedRideActivePageModule {}
