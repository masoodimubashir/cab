import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular';

import { ApiService } from '../../../core/api.service';
import { AuthService } from '../../../core/auth.service';
import { BookingService } from '../booking.service';
import { Place } from '../booking.models';

declare const Razorpay: any;

interface Estimate {
  estimated_fare?: number;
  city_vehicle_type_id?: number;
  vehicle_name?: string;
  available?: boolean;
  message?: string;
}
interface ShuttleBooking { id: number; trip_id?: number | null; }

type Step = 'pickup' | 'drop' | 'fare' | 'paying' | 'forming';

/**
 * "Pool ride" — the Shuttle flow on the shared shell.
 *
 * Pickup → drop → fare → pay → wait for the pool to form. A pool is paid before
 * a car is found, so the money moves at the "pay" step and the ride sits
 * FORMING until a driver is assigned.
 *
 * The create + Razorpay + confirm path is ported from the existing customer
 * shuttle booking — same endpoints, same money handling; only the surface is
 * the new shell.
 */
@Component({
  selector: 'app-shuttle-book',
  templateUrl: './shuttle.page.html',
  styleUrls: ['./shuttle.page.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShuttleBookPage implements OnInit {
  step: Step = 'pickup';
  readonly total = 4;

  estimate: Estimate | null = null;
  estimating = false;
  booking: ShuttleBooking | null = null;

  busy = false;
  error: string | null = null;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private bookingSvc: BookingService,
    private router: Router,
    private toastCtrl: ToastController,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    if (!this.bookingSvc.trip.cityId) {
      void this.router.navigate(['/customer-tabs/go']);
      return;
    }
    if (this.bookingSvc.trip.pickup) this.step = 'drop';
  }

  get fromLabel(): string { return this.bookingSvc.trip.pickup?.address ?? ''; }
  get toLabel(): string { return this.bookingSvc.trip.drop?.address ?? ''; }
  get stepIndex(): number { return { pickup: 1, drop: 2, fare: 3, paying: 4, forming: 4 }[this.step]; }
  get near(): { lat: number; lng: number } | undefined {
    const p = this.bookingSvc.trip.pickup;
    return p ? { lat: p.lat, lng: p.lng } : undefined;
  }

  // ---- steps 1 & 2 ------------------------------------------------------

  onPickup(place: Place): void {
    this.bookingSvc.setPickup(place);
    this.step = 'drop';
    this.cdr.markForCheck();
  }

  onDrop(place: Place): void {
    this.bookingSvc.setDrop(place);
    this.step = 'fare';
    void this.loadEstimate();
    this.cdr.markForCheck();
  }

  // ---- step 3: fare -----------------------------------------------------

  private async loadEstimate(): Promise<void> {
    const { pickup, drop, cityId, rideTypeId } = this.bookingSvc.trip;
    if (!pickup || !drop || !cityId) return;

    this.estimating = true;
    this.error = null;
    this.cdr.markForCheck();

    try {
      const res = await this.api
        .post<Estimate>('/pricing/estimate', {
          city_id: cityId,
          vehicle_type_id: null,
          ride_type_id: rideTypeId,
          pickup_lat: pickup.lat,
          pickup_lng: pickup.lng,
          drop_lat: drop.lat,
          drop_lng: drop.lng,
        })
        .toPromise();
      this.estimate = res ?? null;
      if (this.estimate?.available === false) {
        this.error = this.estimate.message || 'Pool isn\'t available for this trip yet.';
      }
    } catch (e: any) {
      this.estimate = null;
      this.error = e?.error?.message || 'We couldn\'t price this pool. Try again.';
    } finally {
      this.estimating = false;
      this.cdr.markForCheck();
    }
  }

  get fare(): number | null {
    return this.estimate?.estimated_fare ?? null;
  }

  get canConfirm(): boolean {
    return !!this.fare && this.estimate?.available !== false;
  }

  confirm(): void {
    if (!this.canConfirm) return;
    this.step = 'paying';
    this.cdr.markForCheck();
  }

  // ---- step 4: pay ------------------------------------------------------

  pay(): void {
    if (this.busy) return;
    const { pickup, drop, cityId, scope } = this.bookingSvc.trip;
    if (!pickup || !drop || !cityId) { this.error = 'Missing trip details.'; return; }

    this.busy = true;
    this.error = null;
    this.cdr.markForCheck();

    this.api.post<{ booking?: ShuttleBooking }>('/shuttle/bookings', {
      city_vehicle_type_id: this.estimate?.city_vehicle_type_id ?? null,
      city_id: cityId,
      vehicle_type_id: null,
      scope,
      pickup_address: pickup.address,
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      drop_address: drop.address,
      drop_lat: drop.lat,
      drop_lng: drop.lng,
    }, { 'Idempotency-Key': this.uuid('shuttle') }).subscribe({
      next: (res) => {
        const b = res?.booking ?? null;
        if (!b?.id) { this.busy = false; void this.toast('Booking failed. Try again.', 'danger'); this.cdr.markForCheck(); return; }
        this.booking = b;
        void this.startRazorpay(b);
      },
      error: (err) => { this.busy = false; this.error = err?.error?.message || 'Could not create the pool booking.'; this.cdr.markForCheck(); },
    });
  }

  private async startRazorpay(booking: ShuttleBooking): Promise<void> {
    if (typeof Razorpay === 'undefined') {
      this.busy = false;
      await this.toast('Payment library not loaded. Check your connection.', 'danger');
      this.cdr.markForCheck();
      return;
    }

    let order: { razorpay: { key_id: string; order_id: string; amount_paise: number; currency: string } };
    try {
      order = (await this.api
        .post<any>(`/shuttle/bookings/${booking.id}/razorpay-order`, {}, { 'Idempotency-Key': this.uuid('shuttle-pay') })
        .toPromise());
    } catch (err: any) {
      this.busy = false;
      await this.toast(err?.error?.message || 'Could not start payment.', 'danger');
      this.cdr.markForCheck();
      return;
    }

    const user = this.auth.getUser();
    const rzp = new Razorpay({
      key: order.razorpay.key_id,
      order_id: order.razorpay.order_id,
      amount: order.razorpay.amount_paise,
      currency: order.razorpay.currency,
      name: 'DreamCabs',
      description: `Shuttle booking ${booking.id}`,
      prefill: { name: user?.name || '', email: user?.email || '', contact: user?.phone || '' },
      theme: { color: '#12B35B' },
      handler: (resp: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) =>
        this.confirmPayment(booking, resp),
      modal: {
        ondismiss: async () => {
          this.busy = false;
          await this.toast('Payment cancelled. Your pool booking is pending payment.', 'danger');
          this.cdr.markForCheck();
        },
      },
    });
    rzp.on('payment.failed', async (resp: any) => {
      this.busy = false;
      await this.toast(resp?.error?.description || 'Payment failed.', 'danger');
      this.cdr.markForCheck();
    });
    rzp.open();
  }

  private confirmPayment(
    booking: ShuttleBooking,
    payment: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string },
  ): void {
    this.api.post<{ booking?: ShuttleBooking; message?: string }>(
      `/shuttle/bookings/${booking.id}/confirm-payment`,
      payment,
      { 'Idempotency-Key': this.uuid('shuttle-confirm') },
    ).subscribe({
      next: (res) => {
        this.busy = false;
        const tripId = res?.booking?.trip_id;
        this.bookingSvc.reset();
        if (tripId) {
          void this.router.navigateByUrl(`/customer-tabs/trip/${tripId}`, { replaceUrl: true });
        } else {
          // No car yet — the pool is forming.
          this.step = 'forming';
        }
        this.cdr.markForCheck();
      },
      error: (err) => { this.busy = false; this.error = err?.error?.message || 'Payment verification failed.'; this.cdr.markForCheck(); },
    });
  }

  // ---- forming ----------------------------------------------------------

  viewPools(): void {
    this.bookingSvc.reset();
    void this.router.navigate(['/customer-tabs/shuttle-rides']);
  }

  // ---- nav --------------------------------------------------------------

  back(): void {
    this.error = null;
    switch (this.step) {
      case 'drop': this.step = 'pickup'; break;
      case 'fare': this.step = 'drop'; break;
      case 'paying': this.step = 'fare'; break;
      default: void this.router.navigate(['/customer-tabs/go']);
    }
    this.cdr.markForCheck();
  }

  private uuid(prefix: string): string {
    try { return `${prefix}-${(crypto as any).randomUUID()}`; }
    catch { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`; }
  }

  private async toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2600, color });
    await t.present();
  }
}
