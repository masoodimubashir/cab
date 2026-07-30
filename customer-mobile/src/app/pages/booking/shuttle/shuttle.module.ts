import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';

import { ShuttleBookPage } from './shuttle.page';
import { StepShellComponent } from '../step-shell.component';
import { PlaceSearchComponent } from '../place-search.component';

const routes: Routes = [{ path: '', component: ShuttleBookPage }];

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    RouterModule.forChild(routes),
    StepShellComponent,
    PlaceSearchComponent,
  ],
  declarations: [ShuttleBookPage],
})
export class ShuttleBookPageModule {}
