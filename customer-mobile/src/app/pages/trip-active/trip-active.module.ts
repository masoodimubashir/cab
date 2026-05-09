import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TripActivePage } from './trip-active.page';
import { TripActivePageRoutingModule } from './trip-active-routing.module';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, TripActivePageRoutingModule],
  declarations: [TripActivePage],
})
export class TripActivePageModule {}
