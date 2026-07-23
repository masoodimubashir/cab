import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { FixedBookPage } from './fixed-book.page';
import { FixedBookPageRoutingModule } from './fixed-book-routing.module';
import { SeatGridComponent } from './seat-grid.component';
import { HoldTimerComponent } from './hold-timer.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    FixedBookPageRoutingModule,
    SeatGridComponent,
    HoldTimerComponent,
  ],
  declarations: [FixedBookPage],
})
export class FixedBookPageModule {}
