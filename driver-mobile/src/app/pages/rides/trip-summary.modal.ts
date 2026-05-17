import { Component, Input } from '@angular/core';
import { ModalController } from '@ionic/angular';

/**
 * Bottom-sheet modal shown to the driver right after they tap "Complete ride".
 * Reads the breakdown the backend returns from /driver-progress so we don't
 * need a second round-trip. Kept self-contained so we can later reuse it from
 * trip-history without splicing in business logic.
 */
@Component({
  selector: 'app-trip-summary-modal',
  templateUrl: './trip-summary.modal.html',
  styleUrls: ['./trip-summary.modal.scss'],
  standalone: false,
})
export class TripSummaryModal {
  @Input() trip: Record<string, unknown> | null = null;
  @Input() breakdown: Record<string, unknown> | null = null;

  constructor(private modalCtrl: ModalController) {}

  get finalFare(): number {
    return Number(this.breakdown?.['final_fare'] ?? this.trip?.['final_fare'] ?? 0);
  }

  get waitingCharge(): number {
    return Number(this.breakdown?.['waiting_charge_amount'] ?? 0);
  }

  get estimatedFare(): number {
    return Number(this.breakdown?.['estimated_fare'] ?? this.trip?.['estimated_fare'] ?? 0);
  }

  get tipAmount(): number {
    return Number(this.breakdown?.['tip_amount'] ?? this.trip?.['tip_amount'] ?? 0);
  }

  get paymentMethod(): string {
    const m = (this.breakdown?.['payment_method'] ?? this.trip?.['payment_method']) as string | undefined;
    return m ? m.toUpperCase() : '—';
  }

  done(): void {
    void this.modalCtrl.dismiss({ dismissed: true });
  }
}
