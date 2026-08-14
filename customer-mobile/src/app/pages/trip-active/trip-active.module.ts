import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TripActivePage } from './trip-active.page';
import { TripActivePageRoutingModule } from './trip-active-routing.module';
import { PaymentMethodModalComponent } from '../../shared/payment-method-modal.component';
import { BoardingCodePromptComponent } from '../../shared/boarding-code-prompt.component';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, TripActivePageRoutingModule, PaymentMethodModalComponent, BoardingCodePromptComponent],
  declarations: [TripActivePage],
})
export class TripActivePageModule {}
