import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { CustomerEmergencyContactsPage } from './emergency-contacts.page';

const routes: Routes = [{ path: '', component: CustomerEmergencyContactsPage }];

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, RouterModule.forChild(routes)],
  declarations: [CustomerEmergencyContactsPage],
})
export class CustomerEmergencyContactsPageModule {}
