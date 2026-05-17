import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { CustomerProfilePage } from './profile.page';

const routes: Routes = [{ path: '', component: CustomerProfilePage }];

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, RouterModule.forChild(routes)],
  declarations: [CustomerProfilePage],
})
export class CustomerProfilePageModule {}
