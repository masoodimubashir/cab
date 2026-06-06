import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { SharedBookPage } from './shared-book.page';
import { SharedBookPageRoutingModule } from './shared-book-routing.module';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, SharedBookPageRoutingModule],
  declarations: [SharedBookPage],
})
export class SharedBookPageModule {}
