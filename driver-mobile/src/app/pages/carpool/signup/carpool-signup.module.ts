import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { DriverTypePage } from './driver-type.page';
import { CarpoolSignupPage } from './carpool-signup.page';
import { CarpoolStatusPage } from './carpool-status.page';
import { CarpoolPlansPage } from './carpool-plans.page';
import { CarpoolSignupGuard } from './carpool-signup.guard';

/**
 * Carpool driver sign-up (M1), lazy loaded under /carpool-signup. Separate
 * from /carpool because it opens while carpool is still off for riders (A38).
 */
const routes: Routes = [
  // Sign-up itself only while it's open; the status page always, so a carpool
  // driver is never sent back to the commercial screens (or into a redirect loop).
  { path: '', component: DriverTypePage, canActivate: [CarpoolSignupGuard] },
  { path: 'details', component: CarpoolSignupPage, canActivate: [CarpoolSignupGuard] },
  { path: 'status', component: CarpoolStatusPage },
  { path: 'plans', component: CarpoolPlansPage },
];

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, RouterModule.forChild(routes)],
  declarations: [DriverTypePage, CarpoolSignupPage, CarpoolStatusPage, CarpoolPlansPage],
})
export class CarpoolSignupModule {}
