import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { CustomerBookPage } from './customer-book.page';
import { CustomerBookPageRoutingModule } from './customer-book-routing.module';
import { ModeSelectModalModule } from '../../shared/mode-select-modal/mode-select-modal.module';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, CustomerBookPageRoutingModule, ModeSelectModalModule],
  declarations: [CustomerBookPage],
})
export class CustomerBookPageModule {}
