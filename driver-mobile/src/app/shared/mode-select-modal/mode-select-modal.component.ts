import { Component, Input } from '@angular/core';
import { ModalController } from '@ionic/angular';

export type DriverMode = 'voice' | 'self';

/**
 * App-open mode chooser. Greets the driver when they open the app and lets them
 * pick how they want to run it for this session:
 *   - Voice — the AI voice assistant drives the app, hands-free (future wiring).
 *   - Self  — the driver taps through the app manually, as today.
 *
 * Replaces the old subscription prompt. Static for now: picking an option just
 * dismisses with the chosen mode (the dashboard remembers it) so the AI voice
 * feature can hook in later. Presented once per app session by the dashboard.
 */
@Component({
  selector: 'app-mode-select-modal',
  templateUrl: './mode-select-modal.component.html',
  styleUrls: ['./mode-select-modal.component.scss'],
  standalone: false,
})
export class ModeSelectModalComponent {
  /** The driver's previously-picked mode, so we can highlight it on reopen. */
  @Input() current: DriverMode | string | null = null;

  constructor(private modalCtrl: ModalController) {}

  /** Remember the picked mode and close. */
  choose(mode: DriverMode): void {
    void this.modalCtrl.dismiss({ mode });
  }

  /** Dismiss without changing the mode. */
  close(): void {
    void this.modalCtrl.dismiss();
  }
}
