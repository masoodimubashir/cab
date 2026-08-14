import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { FixedRideActivePageRoutingModule } from './fixed-ride-active-routing.module';
import { FixedRideActivePage } from './fixed-ride-active.page';
import { BoardingCodePromptComponent } from '../../shared/boarding-code-prompt.component';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, FixedRideActivePageRoutingModule, BoardingCodePromptComponent],
  declarations: [FixedRideActivePage],
})
export class FixedRideActivePageModule {}
