import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { TripDetailsPage } from './trip-details.page';
import { TripDetailsPageRoutingModule } from './trip-details-routing.module';

@NgModule({
  imports: [CommonModule, IonicModule, TripDetailsPageRoutingModule],
  declarations: [TripDetailsPage],
})
export class TripDetailsPageModule {}
