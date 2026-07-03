import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ShuttleBookingsPageRoutingModule } from './shuttle-bookings-routing.module';
import { ShuttleBookingsPage } from './shuttle-bookings.page';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, ShuttleBookingsPageRoutingModule],
  declarations: [ShuttleBookingsPage],
})
export class ShuttleBookingsPageModule {}
