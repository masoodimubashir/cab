import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { SubscriptionsModalComponent } from './subscriptions-modal.component';
import { PlanCardModule } from '../plan-card/plan-card.module';

@NgModule({
  imports: [CommonModule, IonicModule, PlanCardModule],
  declarations: [SubscriptionsModalComponent],
  exports: [SubscriptionsModalComponent],
})
export class SubscriptionsModalModule {}
