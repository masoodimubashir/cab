import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { SubscriptionsPage } from './subscriptions.page';
import { SubscriptionsPageRoutingModule } from './subscriptions-routing.module';

@NgModule({
  imports: [CommonModule, IonicModule, SubscriptionsPageRoutingModule],
  declarations: [SubscriptionsPage],
})
export class SubscriptionsPageModule {}
