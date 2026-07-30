import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';

import { ApiService } from '../../../core/api.service';
import { RealtimeService } from '../../../core/realtime.service';
import { BookingService } from '../booking.service';
import { Place } from '../booking.models';

type Step = 'pickup' | 'drop' | 'car' | 'price';
type Waiting = 'idle' | 'searching' | 'bids';

interface VehicleType {
  id: number;
  name: string;
}

interface Estimate {
  estimated_fare?: number;
  time_min?: number;
  city_vehicle_type_id?: number;
  vehicle_name?: string;
  available?: boolean;
  message?: string;
}

interface DriverOffer {
  id?: number;
  from_role: 'customer' | 'driver';
  amount: number;
  status: string;
  driver_name?: string;
  driver_rating?: number | null;
  eta_minutes?: number | null;
}

/**
 * "Book a car" — the private, name-your-price flow (frames on the reference
 * shell). Five steps: pickup, drop, choose car, name your price, drivers
 * answer. Every step wears the shared StepShell, so the frame never changes;
 * only the content between the bar and the button does.
 *
 * Wired to the app's existing endpoints — `/pricing/vehicle-types`,
 * `/pricing/estimate`, `POST /trips`, the negotiation routes and the realtime
 * channel. Nothing new on the server.
 */
@Component({
  selector: 'app-private-book',
  templateUrl: './private.page.html',
  styleUrls: ['./private.page.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrivateBookPage implements OnInit, OnDestroy {
  step: Step = 'pickup';
  readonly total = 5;

  vehicleTypes: VehicleType[] = [];
  /** null = "Any car" — the trip stays open to every driver. */
  vehicleTypeId: number | null = null;
  estimate: Estimate | null = null;
  estimating = false;

  offer: number | null = null;
  minFare = 0;

  waiting: Waiting = 'idle';
  tripId: number | null = null;
  secondsLeft = 60;
  offers: DriverOffer[] = [];
  askedAmount: number | null = null;
  noAnswer = false;

  busy = false;
  error: string | null = null;

  private countdown?: ReturnType<typeof setInterval>;
  private poll?: ReturnType<typeof setInterval>;
  private unsubscribe?: () => void;

  constructor(
    private api: ApiService,
    private booking: BookingService,
    private realtime: RealtimeService,
    private router: Router,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    // Reached without a trip in progress — send them back to the home sheet
    // rather than show empty steps.
    if (!this.booking.trip.cityId) {
      void this.router.navigate(['/customer-tabs/go']);
      return;
    }
    // If they already set a pickup on the home map, start at the drop.
    if (this.booking.trip.pickup) this.step = 'drop';
    this.loadVehicleTypes();
  }

  ngOnDestroy(): void {
    this.stopWatching();
  }

  // ---- shell inputs -----------------------------------------------------

  get fromLabel(): string { return this.booking.trip.pickup?.address ?? ''; }
  get toLabel(): string { return this.booking.trip.drop?.address ?? ''; }

  get stepIndex(): number {
    return { pickup: 1, drop: 2, car: 3, price: 4 }[this.step];
  }

  get near(): { lat: number; lng: number } | undefined {
    const p = this.booking.trip.pickup;
    return p ? { lat: p.lat, lng: p.lng } : undefined;
  }

  // ---- steps 1 & 2: pickup / drop --------------------------------------

  onPickup(place: Place): void {
    this.booking.setPickup(place);
    this.step = 'drop';
    this.cdr.markForCheck();
  }

  onDrop(place: Place): void {
    this.booking.setDrop(place);
    this.step = 'car';
    void this.loadEstimate();
    this.cdr.markForCheck();
  }

  // ---- step 3: choose car ----------------------------------------------

  private loadVehicleTypes(): void {
    this.api.get<{ data: VehicleType[] }>('/pricing/vehicle-types').subscribe({
      next: (res) => { this.vehicleTypes = res?.data ?? []; this.cdr.markForCheck(); },
      error: () => { this.vehicleTypes = []; },
    });
  }

  chooseVehicle(id: number | null): void {
    this.vehicleTypeId = id;
    void this.loadEstimate();
  }

  private async loadEstimate(): Promise<void> {
    const { pickup, drop, cityId } = this.booking.trip;
    if (!pickup || !drop || !cityId) return;

    this.estimating = true;
    this.error = null;
    this.cdr.markForCheck();

    try {
      const res = await this.api
        .post<Estimate>('/pricing/estimate', {
          city_id: cityId,
          vehicle_type_id: this.vehicleTypeId,
          ride_type_id: null,
          pickup_lat: pickup.lat,
          pickup_lng: pickup.lng,
          drop_lat: drop.lat,
          drop_lng: drop.lng,
        })
        .toPromise();
      this.estimate = res ?? null;
    } catch {
      this.estimate = null;
      this.error = 'We couldn\'t price this trip. Try again.';
    } finally {
      this.estimating = false;
      this.cdr.markForCheck();
    }
  }

  get estimatedFare(): number | null {
    return this.estimate?.estimated_fare ?? null;
  }

  goToPrice(): void {
    this.step = 'price';
    this.cdr.markForCheck();
  }

  // ---- step 4: name your price -----------------------------------------

  get guideLine(): string {
    const f = this.estimatedFare;
    if (!f) return '';
    const low = Math.round(f * 0.92 / 10) * 10;
    const high = Math.round(f * 1.08 / 10) * 10;
    return `Most riders pay ₹${low}–${high} for this trip`;
  }

  get offerTooLow(): boolean {
    const a = Number(this.offer);
    return !!this.offer && Number.isFinite(a) && !!this.minFare && a < this.minFare;
  }

  get offerValid(): boolean {
    const a = Number(this.offer);
    return !!this.offer && Number.isFinite(a) && a > 0 && (!this.minFare || a >= this.minFare);
  }

  async sendToDrivers(): Promise<void> {
    if (!this.offerValid || this.busy) return;
    const amount = Number(this.offer);
    this.busy = true;
    this.error = null;
    this.cdr.markForCheck();

    try {
      await this.ensureTrip();
      if (!this.tripId) throw new Error('Trip creation failed.');
      await this.api.post(`/trips/${this.tripId}/negotiation/customer-offer`, { amount }).toPromise();
      this.askedAmount = amount;
      this.startWatching();
    } catch (e: any) {
      this.error = this.msg(e, 'Could not send your price. Try again.');
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  // ---- step 5: searching / bids ----------------------------------------

  takesYourPrice(o: DriverOffer): boolean {
    return this.askedAmount !== null && Number(o.amount) <= Number(this.askedAmount);
  }

  offerLine(o: DriverOffer): string {
    const m = this.takesYourPrice(o) ? `Takes ₹${o.amount}` : `Wants ₹${o.amount}`;
    return o.eta_minutes != null ? `${m} · ${o.eta_minutes} min` : m;
  }

  async rideWith(o: DriverOffer): Promise<void> {
    if (!this.tripId || o.id == null) {
      await this.toast('That offer expired. Pick another.', 'danger');
      return;
    }
    const alert = await this.alertCtrl.create({
      header: `Ride for ₹${o.amount}?`,
      message: o.driver_name ? `with ${o.driver_name}` : undefined,
      buttons: [
        { text: 'Back', role: 'cancel' },
        { text: 'Yes, book it', handler: () => void this.lock(o) },
      ],
    });
    await alert.present();
  }

  async cancel(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Stop looking?',
      message: 'This request will be cancelled.',
      buttons: [
        { text: 'Keep looking', role: 'cancel' },
        { text: 'Stop', role: 'destructive', handler: () => void this.abandon() },
      ],
    });
    await alert.present();
  }

  // ---- navigation -------------------------------------------------------

  back(): void {
    this.error = null;
    switch (this.step) {
      case 'drop': this.step = this.booking.trip.pickup ? 'pickup' : 'pickup'; break;
      case 'car': this.step = 'drop'; break;
      case 'price': this.step = 'car'; break;
      default: void this.router.navigate(['/customer-tabs/go']);
    }
    this.cdr.markForCheck();
  }

  trackByOffer = (_: number, o: DriverOffer): number | string => o.id ?? o.amount;

  // ---- plumbing ---------------------------------------------------------

  private async ensureTrip(): Promise<void> {
    if (this.tripId) return;
    const { pickup, drop, cityId } = this.booking.trip;
    if (!pickup || !drop || !cityId) throw new Error('Tell us where you are going first.');

    const res = await this.api
      .post<{ trip: { id: number } }>('/trips', {
        city_id: cityId,
        vehicle_type_id: this.vehicleTypeId,
        pickup_address: pickup.address,
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        drop_address: drop.address,
        drop_lat: drop.lat,
        drop_lng: drop.lng,
        scheduled_at: null,
        payment_method: null,
      })
      .toPromise();
    this.tripId = res?.trip?.id ?? null;

    if (this.tripId) {
      // The server's floor is the real one; read it before showing bids.
      try {
        const cfg = await this.api
          .get<{ negotiation_config?: { min_amount?: number } }>(`/trips/${this.tripId}/negotiation`)
          .toPromise();
        const min = cfg?.negotiation_config?.min_amount;
        if (typeof min === 'number' && Number.isFinite(min) && min >= 0) this.minFare = min;
      } catch {
        // Keep the client-side floor if the read fails.
      }
    }
  }

  private startWatching(): void {
    this.stopWatching();
    this.waiting = 'searching';
    this.offers = [];
    this.noAnswer = false;
    this.secondsLeft = 60;
    this.cdr.markForCheck();

    this.countdown = setInterval(() => {
      this.secondsLeft = Math.max(0, this.secondsLeft - 1);
      if (this.secondsLeft <= 0) {
        clearInterval(this.countdown);
        if (!this.offers.length) this.noAnswer = true;
      }
      this.cdr.markForCheck();
    }, 1000);

    if (this.tripId) {
      this.unsubscribe = this.realtime.subscribeNegotiation(
        this.tripId,
        (p: any) => this.onOffer(p?.offer),
        () => this.onAgreed(),
      );
      this.poll = setInterval(() => void this.pollNegotiation(), 4000);
    }
  }

  private async pollNegotiation(): Promise<void> {
    if (!this.tripId) return;
    try {
      const res = await this.api
        .get<{ offers?: DriverOffer[]; negotiation?: { status?: string } }>(
          `/trips/${this.tripId}/negotiation`,
        )
        .toPromise();
      for (const o of res?.offers ?? []) this.onOffer(o);
      if (res?.negotiation?.status === 'LOCKED') this.onAgreed();
    } catch {
      // A dropped poll just retries on the next tick.
    }
  }

  private onOffer(o?: DriverOffer): void {
    if (!o || o.from_role !== 'driver') return;
    if (this.offers.some((x) => x.id != null && x.id === o.id)) return;
    this.offers = [...this.offers, o];
    this.noAnswer = false;
    if (this.waiting === 'searching') this.waiting = 'bids';
    this.cdr.markForCheck();
  }

  private async lock(o: DriverOffer): Promise<void> {
    if (!this.tripId) return;
    try {
      await this.api
        .post(`/trips/${this.tripId}/negotiation/customer-confirm`, {
          final_fare: o.amount,
          accepted_offer_id: o.id,
        })
        .toPromise();
      this.onAgreed();
    } catch (e: any) {
      await this.toast(this.msg(e, 'Could not book that driver.'), 'danger');
    }
  }

  private onAgreed(): void {
    if (!this.tripId) return;
    const id = this.tripId;
    this.stopWatching();
    this.booking.reset();
    void this.router.navigateByUrl(`/customer-tabs/trip/${id}`, { replaceUrl: true });
  }

  private async abandon(): Promise<void> {
    const id = this.tripId;
    this.stopWatching();
    if (id) {
      try { await this.api.post(`/trips/${id}/cancel`, {}).toPromise(); } catch { /* already gone */ }
    }
    this.booking.reset();
    void this.router.navigate(['/customer-tabs/go']);
  }

  private stopWatching(): void {
    if (this.countdown) clearInterval(this.countdown);
    if (this.poll) clearInterval(this.poll);
    if (this.unsubscribe) this.unsubscribe();
    this.countdown = undefined;
    this.poll = undefined;
    this.unsubscribe = undefined;
  }

  private msg(e: any, fallback: string): string {
    return e?.error?.message || e?.message || fallback;
  }

  private async toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2600, color });
    await t.present();
  }
}
