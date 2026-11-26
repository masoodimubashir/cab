import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CarpoolTabsPage } from './driver/carpool-tabs.page';
import { CarpoolHomePage } from './driver/carpool-home.page';
import { CarpoolListPage } from './driver/carpool-list.page';
import { CarpoolInboxPage } from './driver/carpool-inbox.page';
import { CarpoolProfilePage } from './driver/carpool-profile.page';
import { CarpoolPublishPage } from './driver/carpool-publish.page';
import { CarpoolListingPage } from './driver/carpool-listing.page';
import { CarpoolCodePage } from './driver/carpool-code.page';
import { CarpoolRiderPage } from './driver/carpool-rider.page';
import { CarpoolChatPage } from './chat/carpool-chat.page';
import { CarpoolPickupPage } from './driver/carpool-pickup.page';
import { CarpoolDocumentsPage } from './driver/carpool-documents.page';
import { CarpoolDriverGuard } from './driver/carpool-driver.guard';

/**
 * Carpool screens, lazy loaded under /carpool behind AuthGuard and
 * CarpoolEnabledGuard (app-routing.module.ts). M3: the carpool driver's tabs
 * (Home · Carpools · Inbox · Profile), Publish and the carpool page. M4: the
 * rider profile (mockup 8c).
 */
const routes: Routes = [
  {
    path: '',
    component: CarpoolTabsPage,
    canActivate: [CarpoolDriverGuard],
    children: [
      { path: 'home', component: CarpoolHomePage },
      { path: 'carpools', component: CarpoolListPage },
      { path: 'inbox', component: CarpoolInboxPage },
      { path: 'profile', component: CarpoolProfilePage },
      { path: '', redirectTo: 'home', pathMatch: 'full' },
    ],
  },
  { path: 'publish', component: CarpoolPublishPage, canActivate: [CarpoolDriverGuard] },
  { path: 'documents', component: CarpoolDocumentsPage, canActivate: [CarpoolDriverGuard] },
  { path: 'listing/:id', component: CarpoolListingPage, canActivate: [CarpoolDriverGuard] },
  { path: 'chat/:id', component: CarpoolChatPage, canActivate: [CarpoolDriverGuard] },
  { path: 'chat/:id/pickup', component: CarpoolPickupPage, canActivate: [CarpoolDriverGuard] },
  { path: 'listing/:id/pickup/:requestId', component: CarpoolCodePage, canActivate: [CarpoolDriverGuard] },
  { path: 'listing/:id/rider/:requestId', component: CarpoolRiderPage, canActivate: [CarpoolDriverGuard] },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class CarpoolRoutingModule {}
