import { Component, OnDestroy, OnInit } from '@angular/core';
import { ToastController } from '@ionic/angular';
import { Subject, debounceTime } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService, PaymentMethod } from '../../core/auth.service';

const ALL_METHODS: PaymentMethod[] = ['cash', 'razorpay'];

/**
 * Payment methods the driver accepts. Toggles persist via
 * PATCH /me/driver/payment-methods. At least one method must stay enabled.
 *
 * Moved out of the More tab into its own page so the More tab stays a clean
 * list of links rather than mixing inline controls.
 */
@Component({
  selector: 'app-payment-methods',
  templateUrl: './payment-methods.page.html',
  styleUrls: ['./payment-methods.page.scss'],
  standalone: false,
})
export class PaymentMethodsPage implements OnInit, OnDestroy {
  acceptCash = true;
  acceptRazorpay = true;
  /** Whether the operator lets drivers change their own payment methods. */
  canUpdate = true;

  private save$ = new Subject<void>();
  private saveSub?: { unsubscribe: () => void };

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private toastCtrl: ToastController,
  ) {}

  ngOnInit(): void {
    const u = this.auth.getUser();
    const methods = u?.accepted_payment_methods ?? ALL_METHODS;
    this.acceptCash = methods.includes('cash');
    this.acceptRazorpay = methods.includes('razorpay');

    // Is the driver allowed to change these, or does the operator control them?
    this.api
      .get<{ can_update: boolean; effective_modes?: string[] | null }>('/operator/driver-payment-modes')
      .subscribe({
        next: (res) => {
          this.canUpdate = !!res?.can_update;
          // When the operator owns payment policy, the driver follows their
          // city's allowed modes — show those (locked) instead of the driver's
          // own stored preference.
          if (!this.canUpdate && Array.isArray(res?.effective_modes)) {
            this.acceptCash = res.effective_modes.includes('cash');
            this.acceptRazorpay = res.effective_modes.includes('razorpay');
          }
        },
        error: () => { /* keep optimistic default; the backend still enforces */ },
      });

    this.saveSub = this.save$.pipe(debounceTime(500)).subscribe(() => this.save());
  }

  ngOnDestroy(): void {
    this.saveSub?.unsubscribe();
  }

  toggleChanged(): void {
    if (!this.canUpdate) return;
    this.save$.next();
  }

  /** Re-sync the toggles from the latest stored user (header reload button). */
  reload(): void {
    const u = this.auth.getUser();
    const methods = u?.accepted_payment_methods ?? ALL_METHODS;
    this.acceptCash = methods.includes('cash');
    this.acceptRazorpay = methods.includes('razorpay');
  }

  private currentMethods(): PaymentMethod[] {
    const m: PaymentMethod[] = [];
    if (this.acceptCash) m.push('cash');
    if (this.acceptRazorpay) m.push('razorpay');
    return m;
  }

  private async save(): Promise<void> {
    const methods = this.currentMethods();
    if (!methods.length) {
      const t = await this.toastCtrl.create({
        message: 'Keep at least one payment method enabled.',
        duration: 2500, color: 'warning',
      });
      await t.present();
      this.acceptRazorpay = true;
      return;
    }

    this.api.patch('/me/driver/payment-methods', { methods }).subscribe({
      next: () => this.auth.updateUser({ accepted_payment_methods: methods }),
      error: async (e: any) => {
        const t = await this.toastCtrl.create({
          message: e?.error?.message || 'Could not save payment methods.',
          duration: 2500, color: 'danger',
        });
        await t.present();
      },
    });
  }
}
