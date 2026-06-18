import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { FixedDriverPageRoutingModule } from './fixed-driver-routing.module';
import { FixedDriverPage } from './fixed-driver.page';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, FixedDriverPageRoutingModule],
  declarations: [FixedDriverPage],
})
export class FixedDriverPageModule {}
