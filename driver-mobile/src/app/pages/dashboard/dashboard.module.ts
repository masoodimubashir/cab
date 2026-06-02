import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { DashboardPage } from './dashboard.page';
import { DashboardPageRoutingModule } from './dashboard-routing.module';
import { SubscriptionsModalModule } from '../../shared/subscriptions-modal/subscriptions-modal.module';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, DashboardPageRoutingModule, SubscriptionsModalModule],
  declarations: [DashboardPage],
})
export class DashboardPageModule {}
