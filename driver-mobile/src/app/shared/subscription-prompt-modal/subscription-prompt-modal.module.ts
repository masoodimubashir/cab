import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { SubscriptionPromptModalComponent } from './subscription-prompt-modal.component';
import { PlanCardModule } from '../plan-card/plan-card.module';

@NgModule({
  declarations: [SubscriptionPromptModalComponent],
  imports: [CommonModule, IonicModule, PlanCardModule],
  exports: [SubscriptionPromptModalComponent],
})
export class SubscriptionPromptModalModule {}
