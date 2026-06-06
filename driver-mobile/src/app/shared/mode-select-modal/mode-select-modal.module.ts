import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { ModeSelectModalComponent } from './mode-select-modal.component';

@NgModule({
  imports: [CommonModule, IonicModule],
  declarations: [ModeSelectModalComponent],
  exports: [ModeSelectModalComponent],
})
export class ModeSelectModalModule {}
