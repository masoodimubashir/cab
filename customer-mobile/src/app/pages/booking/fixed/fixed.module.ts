import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';

import { FixedBookPage } from './fixed.page';
import { StepShellComponent } from '../step-shell.component';

const routes: Routes = [{ path: '', component: FixedBookPage }];

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, RouterModule.forChild(routes), StepShellComponent],
  declarations: [FixedBookPage],
})
export class FixedBookPageModule {}
