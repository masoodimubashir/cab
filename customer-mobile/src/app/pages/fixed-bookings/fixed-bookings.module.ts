import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { FixedBookingsPageRoutingModule } from './fixed-bookings-routing.module';
import { FixedBookingsPage } from './fixed-bookings.page';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, FixedBookingsPageRoutingModule],
  declarations: [FixedBookingsPage],
})
export class FixedBookingsPageModule {}
