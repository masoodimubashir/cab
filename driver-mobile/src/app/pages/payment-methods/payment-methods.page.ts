import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { Subject, debounceTime } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService, PaymentMethod } from '../../core/auth.service';

const ALL_METHODS: PaymentMethod[] = ['cash', 'upi', 'qr'];

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
  acceptUpi = true;
  acceptQr = true;

  private save$ = new Subject<void>();
  private saveSub?: { unsubscribe: () => void };

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private router: Router,
    private toastCtrl: ToastController,
  ) {}

  ngOnInit(): void {
    const u = this.auth.getUser();
    const methods = u?.accepted_payment_methods ?? ALL_METHODS;
    this.acceptCash = methods.includes('cash');
    this.acceptUpi = methods.includes('upi');
    this.acceptQr = methods.includes('qr');

    this.saveSub = this.save$.pipe(debounceTime(500)).subscribe(() => this.save());
  }

  ngOnDestroy(): void {
    this.saveSub?.unsubscribe();
  }

  toggleChanged(): void {
    this.save$.next();
  }

  private currentMethods(): PaymentMethod[] {
    const m: PaymentMethod[] = [];
    if (this.acceptCash) m.push('cash');
    if (this.acceptUpi) m.push('upi');
    if (this.acceptQr) m.push('qr');
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
      this.acceptCash = true;
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

  back(): void {
    this.router.navigateByUrl('/tabs/more');
  }
}
