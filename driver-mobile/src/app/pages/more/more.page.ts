import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { Subject, debounceTime } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService, PaymentMethod } from '../../core/auth.service';
import { PushService } from '../../core/push.service';

const ALL_METHODS: PaymentMethod[] = ['cash', 'upi', 'qr'];

@Component({
  selector: 'app-more',
  templateUrl: './more.page.html',
  styleUrls: ['./more.page.scss'],
  standalone: false,
})
export class MorePage implements OnInit, OnDestroy {
  acceptCash = true;
  acceptUpi = true;
  acceptQr = true;

  private save$ = new Subject<void>();
  private saveSub?: { unsubscribe: () => void };

  constructor(
    public auth: AuthService,
    private api: ApiService,
    private router: Router,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private push: PushService
  ) {}

  ngOnInit(): void {
    const u = this.auth.getUser();
    const methods = u?.accepted_payment_methods ?? ALL_METHODS;
    this.acceptCash = methods.includes('cash');
    this.acceptUpi = methods.includes('upi');
    this.acceptQr = methods.includes('qr');

    this.saveSub = this.save$.pipe(debounceTime(500)).subscribe(() => this.savePaymentMethods());
  }

  ngOnDestroy(): void {
    this.saveSub?.unsubscribe();
  }

  paymentToggleChanged(): void {
    this.save$.next();
  }

  private currentMethods(): PaymentMethod[] {
    const m: PaymentMethod[] = [];
    if (this.acceptCash) m.push('cash');
    if (this.acceptUpi) m.push('upi');
    if (this.acceptQr) m.push('qr');
    return m;
  }

  private async savePaymentMethods(): Promise<void> {
    const methods = this.currentMethods();
    if (!methods.length) {
      const t = await this.toastCtrl.create({
        message: 'Keep at least one payment method enabled.',
        duration: 2500,
        color: 'warning',
      });
      await t.present();
      // Restore one to keep state valid.
      this.acceptCash = true;
      return;
    }

    this.api.patch('/me/driver/payment-methods', { methods }).subscribe({
      next: () => {
        this.auth.updateUser({ accepted_payment_methods: methods });
      },
      error: async (e: any) => {
        const t = await this.toastCtrl.create({
          message: e?.error?.message || 'Could not save payment methods.',
          duration: 2500,
          color: 'danger',
        });
        await t.present();
      },
    });
  }

  async signOut(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Sign out?',
      message: 'You will need to sign in again to go online and accept rides.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Sign out',
          role: 'destructive',
          handler: () => this.performSignOut(),
        },
      ],
    });
    await alert.present();
  }

  private async performSignOut(): Promise<void> {
    await this.push.unregister();
    this.api.post('/me/logout', {}).subscribe({
      next: () => this.finishSignOut(),
      error: () => this.finishSignOut(),
    });
  }

  private finishSignOut(): void {
    this.auth.logout();
    this.router.navigateByUrl('/auth/login', { replaceUrl: true });
  }

  async confirmDeleteAccount(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Delete account',
      message: 'You are about to delete your account. Some data will be lost forever.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Continue',
          role: 'destructive',
          handler: () => this.router.navigateByUrl('/delete-account'),
        },
      ],
    });
    await alert.present();
  }

  goRegistration(): void {
    this.router.navigateByUrl('/driver-registration');
  }

  goPerformance(): void {
    this.router.navigateByUrl('/performance');
  }
}
