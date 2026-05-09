import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { DeleteAccountPage } from './delete-account.page';
import { DeleteAccountPageRoutingModule } from './delete-account-routing.module';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, DeleteAccountPageRoutingModule],
  declarations: [DeleteAccountPage],
})
export class DeleteAccountPageModule {}
