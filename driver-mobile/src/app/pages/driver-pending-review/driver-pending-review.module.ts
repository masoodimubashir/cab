import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { DriverPendingReviewPage } from './driver-pending-review.page';

const routes: Routes = [{ path: '', component: DriverPendingReviewPage }];

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, RouterModule.forChild(routes)],
  declarations: [DriverPendingReviewPage],
})
export class DriverPendingReviewPageModule {}
