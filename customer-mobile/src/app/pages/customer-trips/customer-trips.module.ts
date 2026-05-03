import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { CustomerTripsPage } from './customer-trips.page';
import { FormsModule } from '@angular/forms';
import { CustomerTripsPageRoutingModule } from './customer-trips-routing.module';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, CustomerTripsPageRoutingModule],
  declarations: [CustomerTripsPage],
})
export class CustomerTripsPageModule {}

