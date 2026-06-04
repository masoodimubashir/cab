import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { NotificationsPage } from './notifications.page';
import { NotificationsPageRoutingModule } from './notifications-routing.module';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, NotificationsPageRoutingModule],
  declarations: [NotificationsPage],
})
export class NotificationsPageModule {}
