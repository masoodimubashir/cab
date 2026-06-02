import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { PlanCardComponent } from './plan-card.component';

@NgModule({
  imports: [CommonModule, IonicModule],
  declarations: [PlanCardComponent],
  exports: [PlanCardComponent],
})
export class PlanCardModule {}
