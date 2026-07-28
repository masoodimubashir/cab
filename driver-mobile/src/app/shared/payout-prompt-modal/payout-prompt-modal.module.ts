import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { PayoutPromptModalComponent } from './payout-prompt-modal.component';

@NgModule({
  imports: [CommonModule, IonicModule],
  declarations: [PayoutPromptModalComponent],
  exports: [PayoutPromptModalComponent],
})
export class PayoutPromptModalModule {}
