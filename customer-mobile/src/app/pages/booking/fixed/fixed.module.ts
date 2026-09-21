import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';

import { FixedBookPage } from './fixed.page';
import { StepShellComponent } from '../step-shell.component';
import { SeatGridComponent } from './seat-grid.component';
import { HoldTimerComponent } from '../../fixed-book/hold-timer.component';
import { PaymentMethodModalComponent } from '../../../shared/payment-method-modal.component';
import { CityFilterModalComponent } from '../../../shared/city-filter-modal.component';

const routes: Routes = [{ path: '', component: FixedBookPage }];

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    RouterModule.forChild(routes),
    StepShellComponent,
    SeatGridComponent,
    HoldTimerComponent,
    PaymentMethodModalComponent,
    CityFilterModalComponent,
  ],
  declarations: [FixedBookPage],
})
export class FixedBookPageModule {}
