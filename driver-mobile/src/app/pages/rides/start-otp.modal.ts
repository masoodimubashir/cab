import { Component, Input } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/api.service';

/**
 * Full-screen, non-dismissable start-ride OTP gate. Shown when the driver taps
 * "Start ride" at the pickup: the rider received a 6-digit code on their phone
 * (the friend's number on a for-someone-else booking, the booker's otherwise),
 * reads it back, and the driver enters it here. The modal verifies via
 * /driver-progress (status EN_ROUTE_DROP + code); on success the ride starts.
 */
@Component({
  selector: 'app-start-otp-modal',
  templateUrl: './start-otp.modal.html',
  styleUrls: ['./start-otp.modal.scss'],
  standalone: false,
})
export class StartOtpModal {
  @Input() tripId!: number;
  @Input() riderName = 'the rider';
  /** Only set in mock mode (no SMS gateway) so the flow is testable. */
  @Input() devCode: string | null = null;

  otp = '';
  otpLength = 6;
  otpInputFocused = false;
  verifying = false;
  error: string | null = null;

  constructor(
    private api: ApiService,
    private modalCtrl: ModalController,
    private toastCtrl: ToastController,
  ) {}

  get otpCells(): number[] {
    return Array.from({ length: this.otpLength }, (_, i) => i);
  }
  get otpReady(): boolean {
    return this.otp.trim().length >= this.otpLength;
  }

  onOtpInput(): void {
    this.otp = (this.otp || '').replace(/\D/g, '').slice(0, this.otpLength);
    this.error = null;
  }

  /** Verify the code and start the ride. Stays locked on a wrong/expired code. */
  async verify(): Promise<void> {
    if (!this.otpReady || this.verifying) return;
    this.verifying = true;
    this.error = null;
    try {
      const res: any = await firstValueFrom(
        this.api.patch(`/trips/${this.tripId}/driver-progress`, {
          status: 'EN_ROUTE_DROP',
          code: this.otp.trim(),
        }),
      );
      await this.modalCtrl.dismiss({ started: true, trip: res?.trip });
    } catch (e: any) {
      this.error = e?.error?.message || 'Incorrect code. Ask the rider to read it again.';
      this.otp = '';
    } finally {
      this.verifying = false;
    }
  }

  /** Re-send the start code to the rider's phone. */
  async resend(): Promise<void> {
    this.error = null;
    try {
      const res: any = await firstValueFrom(this.api.post(`/trips/${this.tripId}/start-otp`, {}));
      this.devCode = res?.dev_code ?? this.devCode;
      const t = await this.toastCtrl.create({
        message: 'Start code re-sent to the rider.',
        duration: 2200,
        color: 'success',
      });
      await t.present();
    } catch {
      this.error = 'Could not resend the code.';
    }
  }

  /** Back out (e.g. the rider is a no-show) — does NOT start the ride. */
  cancel(): void {
    void this.modalCtrl.dismiss(null);
  }
}
