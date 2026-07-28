import { Component } from '@angular/core';
import { ModalController } from '@ionic/angular';

/**
 * Post-approval payout nudge. There is no multi-step driver signup wizard in
 * this app, so the "add your bank details" step that would normally sit inside
 * it lives here instead: a one-time full-screen prompt on the dashboard, shown
 * to an approved driver who has no payout account yet.
 *
 * Why it matters: a driver with no payout account can still drive, and their
 * share of every fare quietly accumulates as held earnings with nothing telling
 * them why no money has arrived. This catches that before the first ride.
 *
 * Skippable by design — it must never stand between a driver and working. The
 * dashboard falls back to a dismissible banner for anyone who skips.
 */
@Component({
  selector: 'app-payout-prompt-modal',
  templateUrl: './payout-prompt-modal.component.html',
  styleUrls: ['./payout-prompt-modal.component.scss'],
  standalone: false,
})
export class PayoutPromptModalComponent {
  constructor(private modalCtrl: ModalController) {}

  /** Close and tell the dashboard to open the payout form. */
  add(): void {
    void this.modalCtrl.dismiss({ add: true });
  }

  /** Close and leave it for later — the banner takes over from here. */
  skip(): void {
    void this.modalCtrl.dismiss({ add: false });
  }
}
