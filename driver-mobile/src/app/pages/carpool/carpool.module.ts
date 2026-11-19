import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { CarpoolRoutingModule } from './carpool-routing.module';
import { CarpoolTabsPage } from './driver/carpool-tabs.page';
import { CarpoolHomePage } from './driver/carpool-home.page';
import { CarpoolListPage } from './driver/carpool-list.page';
import { CarpoolInboxPage } from './driver/carpool-inbox.page';
import { CarpoolProfilePage } from './driver/carpool-profile.page';
import { CarpoolPublishPage } from './driver/carpool-publish.page';
import { CarpoolListingPage } from './driver/carpool-listing.page';
import { CarpoolRiderPage } from './driver/carpool-rider.page';
import { CarpoolChatPage } from './chat/carpool-chat.page';
import { CarpoolPickupPage } from './driver/carpool-pickup.page';

/**
 * Roboto, as the mockup loads it. Android has Roboto built in; browsers and
 * iOS don't, and without it the screens fall back to Helvetica/Arial. Added
 * only when the carpool screens load, so commercial screens are unchanged.
 */
function loadCarpoolFont(): void {
  const id = 'carpool-roboto';
  if (typeof document === 'undefined' || document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;800&display=swap';
  document.head.appendChild(link);
}

/** The carpool feature (Carpool-Integration-Guide section 5). Driver screens live in ./driver. */
@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, RouterModule, CarpoolRoutingModule],
  declarations: [
    CarpoolTabsPage,
    CarpoolHomePage,
    CarpoolListPage,
    CarpoolInboxPage,
    CarpoolProfilePage,
    CarpoolPublishPage,
    CarpoolListingPage,
    CarpoolRiderPage,
    CarpoolChatPage,
    CarpoolPickupPage,
  ],
})
export class CarpoolModule {
  constructor() {
    loadCarpoolFont();
  }
}
