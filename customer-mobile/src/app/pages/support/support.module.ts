import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';
import { SupportPage } from './support.page';

const routes: Routes = [{ path: '', component: SupportPage }];

@NgModule({
  declarations: [SupportPage],
  imports: [CommonModule, IonicModule, RouterModule.forChild(routes)],
})
export class SupportPageModule {}
