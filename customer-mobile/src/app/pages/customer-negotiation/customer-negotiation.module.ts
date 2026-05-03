import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { CustomerNegotiationPage } from './customer-negotiation.page';
import { CustomerNegotiationPageRoutingModule } from './customer-negotiation-routing.module';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, CustomerNegotiationPageRoutingModule],
  declarations: [CustomerNegotiationPage],
})
export class CustomerNegotiationPageModule {}

