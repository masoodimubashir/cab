import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { PerformancePage } from './performance.page';
import { PerformancePageRoutingModule } from './performance-routing.module';

@NgModule({
  imports: [CommonModule, IonicModule, PerformancePageRoutingModule],
  declarations: [PerformancePage],
})
export class PerformancePageModule {}
