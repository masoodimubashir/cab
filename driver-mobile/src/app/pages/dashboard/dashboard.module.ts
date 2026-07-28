import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { DashboardPage } from './dashboard.page';
import { DashboardPageRoutingModule } from './dashboard-routing.module';
import { ModeSelectModalModule } from '../../shared/mode-select-modal/mode-select-modal.module';
import { SubscriptionPromptModalModule } from '../../shared/subscription-prompt-modal/subscription-prompt-modal.module';
import { PayoutPromptModalModule } from '../../shared/payout-prompt-modal/payout-prompt-modal.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    DashboardPageRoutingModule,
    ModeSelectModalModule,
    SubscriptionPromptModalModule,
    PayoutPromptModalModule,
  ],
  declarations: [DashboardPage],
})
export class DashboardPageModule {}
