import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { CustomerTabsPage } from './customer-tabs.page';
import { CustomerTabsPageRoutingModule } from './customer-tabs-routing.module';

@NgModule({
  imports: [CommonModule, IonicModule, CustomerTabsPageRoutingModule],
  declarations: [CustomerTabsPage],
})
export class CustomerTabsPageModule {}

