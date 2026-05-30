import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { WalletPage } from './wallet.page';
import { WalletPageRoutingModule } from './wallet-routing.module';

@NgModule({
  imports: [CommonModule, IonicModule, WalletPageRoutingModule],
  declarations: [WalletPage],
})
export class WalletPageModule {}
