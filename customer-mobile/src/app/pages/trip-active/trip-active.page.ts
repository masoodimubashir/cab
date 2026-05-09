import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ActionSheetController, AlertController, ToastController } from '@ionic/angular';
import { ApiService } from '../../core/api.service';
import { AuthService, PaymentMethod } from '../../core/auth.service';

type TripDetail = {
  id: number;
  status: string;
  final_fare: number | null;
  payment_method?: PaymentMethod | null;
  driver?: { id: number; name?: string | null; accepted_payment_methods?: PaymentMethod[] | null };
};

// TODO: this page is intentionally minimal. Driver tracking, ETA, chat,
// SOS, and trip-share controls are out of scope for the inDrive-flow
// rebuild and live in a follow-up iteration.

@Component({
  selector: 'app-trip-active',
  templateUrl: './trip-active.page.html',
  styleUrls: ['./trip-active.page.scss'],
  standalone: false,
})
export class TripActivePage implements OnInit, OnDestroy {
  tripId!: number;
  loading = true;
  trip: TripDetail | null = null;
  driverAccepts: PaymentMethod[] = ['cash', 'upi', 'qr'];
  selectedPaymentMethod: PaymentMethod | null = null;
  private poll: any = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private auth: AuthService,
    private alertCtrl: AlertController,
    private actionSheetCtrl: ActionSheetController,
    private toastCtrl: ToastController
  ) {}

  ngOnInit(): void {
    this.tripId = Number(this.route.snapshot.paramMap.get('tripId'));
    if (!this.tripId) {
      this.router.navigateByUrl('/customer-tabs/book', { replaceUrl: true });
      return;
    }
    this.refresh();
    this.poll = setInterval(() => this.refresh(), 5000);
  }

  ngOnDestroy(): void {
    if (this.poll) clearInterval(this.poll);
  }

  private refresh(): void {
    this.api
      .get<{ trip_id: number; trip?: TripDetail; negotiation?: { final_amount: number } }>(
        `/trips/${this.tripId}/negotiation`
      )
      .subscribe({
        next: (res) => {
          this.loading = false;
          if (res?.trip) {
            this.trip = res.trip;
            const driver = res.trip.driver;
            if (driver?.accepted_payment_methods?.length) {
              this.driverAccepts = driver.accepted_payment_methods;
            }
            if (this.selectedPaymentMethod == null && this.trip.payment_method) {
              this.selectedPaymentMethod = this.trip.payment_method;
            }
          }
        },
        error: () => {
          this.loading = false;
        },
      });
  }

  canCancel(): boolean {
    if (!this.trip) return false;
    return ['CONFIRMED', 'ASSIGNED'].includes(this.trip.status);
  }

  isCompleted(): boolean {
    return this.trip?.status === 'COMPLETED';
  }

  async cancel(): Promise<void> {
    const a = await this.alertCtrl.create({
      header: 'Cancel trip?',
      message: 'The driver will be notified.',
      buttons: [
        { text: 'Keep trip', role: 'cancel' },
        {
          text: 'Cancel trip',
          role: 'destructive',
          handler: async () => {
            try {
              await this.api.post(`/trips/${this.tripId}/cancel`, {}).toPromise();
              this.router.navigateByUrl('/customer-tabs/book', { replaceUrl: true });
            } catch (e: any) {
              const t = await this.toastCtrl.create({
                message: e?.error?.message || 'Could not cancel.',
                duration: 2500,
                color: 'danger',
              });
              await t.present();
            }
          },
        },
      ],
    });
    await a.present();
  }

  async pay(): Promise<void> {
    const allowed: PaymentMethod[] = (['cash', 'upi', 'qr'] as PaymentMethod[]).filter((m) =>
      this.driverAccepts.includes(m)
    );
    if (!allowed.length) {
      const t = await this.toastCtrl.create({
        message: 'Driver has no payment methods enabled.',
        duration: 2500,
        color: 'danger',
      });
      await t.present();
      return;
    }

    const sheet = await this.actionSheetCtrl.create({
      header: 'Pay with',
      buttons: [
        ...allowed.map((m) => ({
          text: m.toUpperCase(),
          handler: () => this.doPay(m),
        })),
        { text: 'Cancel', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  private async doPay(method: PaymentMethod): Promise<void> {
    try {
      await this.api.post(`/trips/${this.tripId}/pay/${method}`, {}).toPromise();
      const t = await this.toastCtrl.create({
        message: 'Payment recorded.',
        duration: 2000,
        color: 'success',
      });
      await t.present();
      this.refresh();
    } catch (e: any) {
      const t = await this.toastCtrl.create({
        message: e?.error?.message || 'Payment failed.',
        duration: 2500,
        color: 'danger',
      });
      await t.present();
    }
  }
}
