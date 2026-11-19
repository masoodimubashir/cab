import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CarpoolEnabledGuard } from './carpool-enabled.guard';
import { CarpoolDriverProfilePage } from './rider/carpool-driver-profile.page';
import { CarpoolResultsPage } from './rider/carpool-results.page';
import { CarpoolRidePage } from './rider/carpool-ride.page';
import { CarpoolSearchPage } from './rider/carpool-search.page';
import { CarpoolMessagesPage } from './rider/carpool-messages.page';
import { CarpoolPickupPage } from './rider/carpool-pickup.page';
import { CarpoolChatPage } from './chat/carpool-chat.page';

/**
 * Carpool screens for riders, lazy loaded under /carpool behind AuthGuard
 * (app-routing.module.ts). Search and Results need carpool switched on; a
 * rider's own carpool pages keep working while it's off (A36). Since M3 this
 * file differs between the two apps.
 */
const routes: Routes = [
  { path: 'search', component: CarpoolSearchPage, canActivate: [CarpoolEnabledGuard] },
  { path: 'results', component: CarpoolResultsPage, canActivate: [CarpoolEnabledGuard] },
  { path: 'ride/:id', component: CarpoolRidePage },
  { path: 'ride/:id/driver', component: CarpoolDriverProfilePage },
  { path: 'messages', component: CarpoolMessagesPage },
  { path: 'chat/:id', component: CarpoolChatPage },
  { path: 'chat/:id/pickup', component: CarpoolPickupPage },
  { path: '', redirectTo: 'search', pathMatch: 'full' },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class CarpoolRoutingModule {}
