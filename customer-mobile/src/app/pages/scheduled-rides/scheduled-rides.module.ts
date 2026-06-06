import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { ScheduledRidesPage } from './scheduled-rides.page';
import { ScheduledRidesPageRoutingModule } from './scheduled-rides-routing.module';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, ScheduledRidesPageRoutingModule],
  declarations: [ScheduledRidesPage],
})
export class ScheduledRidesPageModule {}
