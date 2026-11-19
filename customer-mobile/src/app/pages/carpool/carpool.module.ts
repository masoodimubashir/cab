import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { CarpoolRoutingModule } from './carpool-routing.module';
import { CarpoolDriverProfilePage } from './rider/carpool-driver-profile.page';
import { CarpoolResultsPage } from './rider/carpool-results.page';
import { CarpoolRidePage } from './rider/carpool-ride.page';
import { CarpoolSearchPage } from './rider/carpool-search.page';
import { CarpoolMessagesPage } from './rider/carpool-messages.page';
import { CarpoolPickupPage } from './rider/carpool-pickup.page';
import { CarpoolChatPage } from './chat/carpool-chat.page';

/**
 * The mockup's font. The app loads no web font of its own, so without this
 * the carpool screens fall back to Arial. Loaded once, when carpool opens.
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

/** The carpool feature, rider side (Carpool-Integration-Guide section 5). UI kit pieces live in ./ui. */
@NgModule({
  declarations: [CarpoolSearchPage, CarpoolResultsPage, CarpoolRidePage, CarpoolDriverProfilePage, CarpoolMessagesPage, CarpoolPickupPage, CarpoolChatPage],
  imports: [CommonModule, FormsModule, IonicModule, CarpoolRoutingModule],
})
export class CarpoolModule {
  constructor() {
    loadCarpoolFont();
  }
}
