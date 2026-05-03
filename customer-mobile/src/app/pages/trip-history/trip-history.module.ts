import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { TripHistoryPage } from './trip-history.page';
import { TripHistoryPageRoutingModule } from './trip-history-routing.module';

@NgModule({
  imports: [CommonModule, IonicModule, TripHistoryPageRoutingModule],
  declarations: [TripHistoryPage],
})
export class TripHistoryPageModule {}
