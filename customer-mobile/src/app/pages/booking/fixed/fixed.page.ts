import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';

import { ApiService } from '../../../core/api.service';
import { AuthService } from '../../../core/auth.service';
import { PaymentOptionsService } from '../../../core/payment-options.service';
import { PaymentChoice } from '../../../shared/payment-method-modal.component';
import { BookingService, resolveCity } from '../booking.service';
import { City } from '../booking.models';

import { SeatCell } from './seat-grid.component';

declare const Razorpay: any;

interface FixedStop {
  id: number; seq: number; name: string;
  is_pickup: boolean; is_drop: boolean;
  is_active: boolean; is_temporarily_unavailable: boolean;
}
interface FixedRoute {
  id: number; name: string; scope: 'local' | 'outstation';
  origin_name: string; dest_name: string;
  flat_fare: number; luggage_surcharge_amount: number;
  stops: FixedStop[];
}
interface FixedDeparture {
  id: number; depart_at: string | null; announced_depart_at: string | null;
  seats_remaining: number; luggage_remaining: number; status: string;
  vehicle_name?: string | null;
}
interface SeatMapResponse {
  layout: { rows: number; cols: number };
  cells: SeatCell[];
}
interface SeatHold { id: number; seats: number; amount: number; }
interface CouponPreview { base_amount: number; discount: number; final_amount: number; coupon?: { title: string } | null; }
interface Reservation { id: number; }

type Step = 'route' | 'departure' | 'details' | 'seats' | 'review' | 'done';

/**
 * "Share a seat" — the Fixed flow on the shared shell.
 *
 * Route → departure → board/drop + luggage → seats → review → ticket. Every
 * step wears the same StepShell as Book-a-car, so the two feel like one app.
 *
 * The seat-hold and Razorpay payment path is ported verbatim from the existing
 * fixed-book page — it is the launch flow and its money handling is proven, so
 * only the surface changed, not the transaction.
 */
@Component({
  selector: 'app-fixed-book',
  templateUrl: './fixed.page.html',
  styleUrls: ['./fixed.page.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FixedBookPage implements OnInit {
  step: Step = 'route';
  readonly total = 5;

  cityId: number | null = null;
  cities: City[] = [];
  selectedCity: City | null = null;
  search = '';

  get selectedCityName(): string {
    return this.selectedCity?.name || (this.cityId ? `City #${this.cityId}` : 'All Cities');
  }

  routes: FixedRoute[] = [];
  route: FixedRoute | null = null;

  departures: FixedDeparture[] = [];
  departure: FixedDeparture | null = null;

  boardStopId: number | null = null;
  dropStopId: number | null = null;
  luggage = 0;

  seatMap: SeatMapResponse | null = null;
  selected: string[] = [];

  couponTitle = '';
  coupon: CouponPreview | null = null;
  couponError: string | null = null;

  paymentMethod: 'gpay' | 'all' = 'gpay';

  // Payment method chooser (Online / UPI / Cash). Cash pays only the upfront
  // deposit online; the rest is cash to the driver at drop-off.
  paymentModalOpen = false;
  payMethod: PaymentChoice = 'online';
  cashDepositPercent = 0;

  reservation: Reservation | null = null;
  boardingCode = '';

  loading = false;
  busy = false;
  error: string | null = null;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private booking: BookingService,
    private router: Router,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private cdr: ChangeDetectorRef,
    private paymentOptions: PaymentOptionsService,
  ) {}

  async ngOnInit(): Promise<void> {
    this.cityId = this.booking.trip.cityId;
    await this.loadCities();
    this.loadRoutes();
    // Know the operator's cash deposit split so the ticket can show it.
    void this.paymentOptions.load().then((m) => {
      this.cashDepositPercent = m.cash_deposit_percent || 0;
      this.cdr.markForCheck();
    });
  }

  async loadCities(): Promise<void> {
    try {
      this.cities = await this.booking.cities().catch(() => [] as City[]);
      if (this.cityId != null && this.cityId > 0) {
        this.selectedCity = this.cities.find((c) => c.id === this.cityId) || null;
      }
      this.cdr.markForCheck();
    } catch {
      this.cities = [];
    }
  }

  cityModalOpen = false;

  openCityFilter(): void {
    if (!this.cities.length) {
      void this.loadCities();
    }
    this.cityModalOpen = true;
    this.cdr.markForCheck();
  }

  onCityModalSelect(cityId: number | null): void {
    this.cityModalOpen = false;
    this.selectCity(cityId);
  }

  onCityModalDismiss(): void {
    this.cityModalOpen = false;
    this.cdr.markForCheck();
  }

  selectCity(cityId: number | null): void {
    this.cityId = cityId;
    this.booking.setCity(cityId);
    this.selectedCity = this.cities.find((c) => c.id === cityId) || null;
    this.route = null;
    this.departure = null;
    this.boardStopId = null;
    this.dropStopId = null;
    this.loadRoutes();
    this.cdr.markForCheck();
  }

  // ---- shell inputs -----------------------------------------------------

  get stepIndex(): number {
    return { route: 1, departure: 2, details: 3, seats: 4, review: 5, done: 5 }[this.step];
  }

  // ---- step 1: route ----------------------------------------------------

  private loadRoutes(): void {
    this.loading = true;
    const params = new URLSearchParams();
    if (this.cityId != null && this.cityId > 0) {
      params.set('city_id', String(this.cityId));
    }
    const qStr = params.toString() ? '?' + params.toString() : '';
    this.api.get<{ data: FixedRoute[] }>('/fixed/routes' + qStr).subscribe({
      next: (res) => { this.routes = res?.data ?? []; this.loading = false; this.cdr.markForCheck(); },
      error: () => { this.routes = []; this.loading = false; this.cdr.markForCheck(); },
    });
  }

  get visibleRoutes(): FixedRoute[] {
    const q = this.search.trim().toLowerCase();
    if (!q) return this.routes;
    return this.routes.filter((r) =>
      r.name.toLowerCase().includes(q) ||
      (r.stops ?? []).some((s) => s.name.toLowerCase().includes(q)));
  }

  pickRoute(route: FixedRoute): void {
    this.route = route;
    this.boardStopId = null;
    this.dropStopId = null;
    this.selected = [];
    this.step = 'departure';
    this.loadDepartures(route);
    this.cdr.markForCheck();
  }

  // ---- step 2: departure -----------------------------------------------

  private loadDepartures(route: FixedRoute): void {
    this.loading = true;
    this.api.get<{ data: FixedDeparture[] }>(`/fixed/routes/${route.id}/departures`).subscribe({
      next: (res) => { this.departures = res?.data ?? []; this.loading = false; this.cdr.markForCheck(); },
      error: () => { this.departures = []; this.loading = false; this.cdr.markForCheck(); },
    });
  }

  departLabel(d: FixedDeparture): string {
    const t = d.announced_depart_at || d.depart_at;
    if (!t) return 'Boarding now';
    try { return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch { return 'Scheduled'; }
  }

  pickDeparture(d: FixedDeparture): void {
    this.departure = d;
    this.step = 'details';
    this.cdr.markForCheck();
  }

  // ---- step 3: stops + luggage -----------------------------------------

  get boardStops(): FixedStop[] {
    return (this.route?.stops ?? []).filter((s) => s.is_pickup && s.is_active && !s.is_temporarily_unavailable);
  }
  get dropStops(): FixedStop[] {
    const board = this.route?.stops.find((s) => s.id === this.boardStopId);
    return (this.route?.stops ?? []).filter((s) =>
      s.is_drop && s.is_active && !s.is_temporarily_unavailable && (!board || s.seq > board.seq));
  }

  pickBoard(id: number): void {
    this.boardStopId = id;
    // A drop earlier than the new board makes no sense — clear it.
    const board = this.route?.stops.find((s) => s.id === id);
    const drop = this.route?.stops.find((s) => s.id === this.dropStopId);
    if (board && drop && drop.seq <= board.seq) this.dropStopId = null;
    this.cdr.markForCheck();
  }
  pickDrop(id: number): void { this.dropStopId = id; this.cdr.markForCheck(); }

  get luggageMax(): number {
    return Math.max(0, this.departure?.luggage_remaining ?? 0);
  }
  addLuggage(n: number): void {
    this.luggage = Math.min(this.luggageMax, Math.max(0, this.luggage + n));
    this.coupon = null;
    this.cdr.markForCheck();
  }

  get detailsReady(): boolean {
    return !!this.boardStopId && !!this.dropStopId;
  }

  goToSeats(): void {
    this.step = 'seats';
    this.loadSeatMap();
    this.cdr.markForCheck();
  }

  // ---- step 4: seats ----------------------------------------------------

  private loadSeatMap(): void {
    if (!this.departure) return;
    this.loading = true;
    this.error = null;
    this.api.get<SeatMapResponse>(`/fixed/departures/${this.departure.id}/seat-map`).subscribe({
      next: (res) => {
        this.seatMap = res;
        // Drop any seats that were grabbed by someone else since we last looked.
        this.selected = this.selected.filter((l) => res.cells.some((c) => c.label === l && c.status === 'AVAILABLE'));
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => { this.seatMap = null; this.error = err?.error?.message || 'Could not load seats.'; this.loading = false; this.cdr.markForCheck(); },
    });
  }

  get maxSeats(): number {
    return Math.max(1, this.departure?.seats_remaining ?? 1);
  }

  /** The seat grid emits a label; toggle it in/out of the selection. */
  toggleLabel(label: string): void {
    const i = this.selected.indexOf(label);
    if (i >= 0) {
      this.selected = this.selected.filter((_, idx) => idx !== i);
    } else {
      if (this.selected.length >= this.maxSeats) {
        void this.toast(`You can pick up to ${this.maxSeats} seat${this.maxSeats > 1 ? 's' : ''}.`, 'danger');
        return;
      }
      this.selected = [...this.selected, label];
    }
    this.coupon = null;
    this.cdr.markForCheck();
  }

  /** Re-pull the map so seats others just booked show as taken. */
  refreshSeats(): void {
    this.loadSeatMap();
  }

  /** Does this departure actually have seats to pick? */
  get hasSeats(): boolean {
    return (this.seatMap?.cells ?? []).some((c) => c.kind === 'seat');
  }

  /** How many are still free — shown so the rider knows what's left. */
  get seatsFree(): number {
    return (this.seatMap?.cells ?? []).filter((c) => c.kind === 'seat' && c.status === 'AVAILABLE').length;
  }

  // ---- step 5: review + pay --------------------------------------------

  goToReview(): void {
    if (!this.selected.length) { void this.toast('Pick at least one seat.', 'danger'); return; }
    this.step = 'review';
    this.cdr.markForCheck();
  }

  get seatFare(): number {
    const base = (this.route?.flat_fare ?? 0) * this.selected.length;
    const deltas = this.selected.reduce((sum, l) => sum + (this.seatMap?.cells.find((c) => c.label === l)?.price_delta ?? 0), 0);
    return base + deltas;
  }
  get luggageTotal(): number {
    return this.luggage * (this.route?.luggage_surcharge_amount ?? 0);
  }
  get grossTotal(): number {
    return this.seatFare + this.luggageTotal;
  }
  get finalTotal(): number {
    return this.coupon ? this.coupon.final_amount : this.grossTotal;
  }

  applyCoupon(): void {
    if (!this.couponTitle.trim()) return;
    this.couponError = null;
    this.api.post<CouponPreview>('/fixed/coupon-preview', this.payload(true)).subscribe({
      next: (res) => { this.coupon = res; this.cdr.markForCheck(); },
      error: (err) => { this.coupon = null; this.couponError = err?.error?.message || 'Coupon could not be applied.'; this.cdr.markForCheck(); },
    });
  }
  removeCoupon(): void { this.couponTitle = ''; this.coupon = null; this.couponError = null; }

  /** Opens the shared payment sheet so the rider picks Online / UPI / Cash. */
  pay(): void {
    if (this.busy || !this.selected.length) return;
    this.paymentModalOpen = true;
    this.cdr.markForCheck();
  }

  /** Chosen from the shared payment sheet — hold the seats tagged with the
   *  method (cash charges only the deposit online), then run its payment. */
  onPayMethod(method: PaymentChoice): void {
    this.paymentModalOpen = false;
    this.payMethod = method;
    this.createHoldAndPay(method);
  }

  private createHoldAndPay(method: PaymentChoice): void {
    if (this.busy || !this.selected.length) return;
    this.busy = true;
    this.error = null;
    this.cdr.markForCheck();

    const payload = { ...this.payload(false), payment_method: method === 'cash' ? 'cash' : 'razorpay' };
    this.api.post<{ hold: SeatHold }>('/fixed/seat-holds', payload, { 'Idempotency-Key': this.uuid() }).subscribe({
      next: (res) => {
        const hold = res?.hold ?? null;
        if (!hold) { this.busy = false; void this.toast('Could not hold seats. Try again.', 'danger'); this.cdr.markForCheck(); return; }
        void this.startRazorpay(hold);
      },
      error: (err) => { this.busy = false; void this.toast(err?.error?.message || 'Could not hold seats.', 'danger'); this.cdr.markForCheck(); },
    });
  }

  /** For a cash ticket: the upfront deposit charged online now (rest is cash). */
  get cashDeposit(): number {
    if (this.payMethod !== 'cash' || this.cashDepositPercent <= 0) return 0;
    return Math.round(this.finalTotal * this.cashDepositPercent / 100);
  }
  get cashBalance(): number {
    return Math.max(0, this.finalTotal - this.cashDeposit);
  }
  get payMethodLabel(): string {
    return this.payMethod === 'cash' ? 'Cash' : this.payMethod === 'gpay' ? 'UPI / GPay' : 'Online';
  }

  private async startRazorpay(hold: SeatHold): Promise<void> {
    if (typeof Razorpay === 'undefined') {
      this.busy = false;
      await this.toast('Payment library not loaded. Check your connection.', 'danger');
      this.cdr.markForCheck();
      return;
    }

    let order: { razorpay: { key_id: string; order_id: string; amount_paise: number; currency: string } };
    try {
      order = (await this.api
        .post<any>(`/fixed/seat-holds/${hold.id}/razorpay-order`, {}, { 'Idempotency-Key': this.uuid() })
        .toPromise());
    } catch (err: any) {
      this.busy = false;
      await this.toast(err?.error?.message || 'Could not start payment.', 'danger');
      this.cdr.markForCheck();
      return;
    }

    const user = this.auth.getUser();
    const rzpOptions: any = {
      key: order.razorpay.key_id,
      order_id: order.razorpay.order_id,
      amount: order.razorpay.amount_paise,
      currency: order.razorpay.currency,
      name: 'DreamCabs',
      description: `Fixed booking #${hold.id}`,
      prefill: {
        name: user?.name || '',
        email: user?.email || '',
        contact: user?.phone || '',
        ...(this.payMethod === 'gpay' ? { method: 'upi' } : {}),
      },
      ...(this.payMethod === 'gpay'
        ? {
            method: {
              upi: true,
              card: false,
              netbanking: false,
              wallet: false,
              emi: false,
              paylater: false,
            },
            upi: {
              flow: 'intent',
            },
            config: {
              display: {
                blocks: {
                  upi: {
                    name: 'Pay via Google Pay / UPI',
                    instruments: [
                      {
                        method: 'upi',
                        flows: ['intent'],
                        apps: ['google_pay', 'phonepe', 'paytm', 'bhim'],
                      },
                    ],
                  },
                },
                sequence: ['block.upi'],
                preferences: { show_default_blocks: false },
              },
            },
          }
        : {}),
      theme: { color: '#12B35B' },
      handler: (resp: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) =>
        this.confirmPayment(hold, resp),
      modal: {
        ondismiss: async () => {
          this.busy = false;
          this.release(hold);
          await this.toast('Payment cancelled. Your seat hold was released.', 'danger');
          this.cdr.markForCheck();
        },
      },
    };

    const rzp = new Razorpay(rzpOptions);
    rzp.on('payment.failed', async (resp: any) => {
      this.busy = false;
      await this.toast(resp?.error?.description || 'Payment failed.', 'danger');
      this.cdr.markForCheck();
    });
    rzp.open();
  }

  private confirmPayment(
    hold: SeatHold,
    payment: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string },
  ): void {
    this.api.post<{ reservation: Reservation; boarding_otp?: string }>(
      `/fixed/seat-holds/${hold.id}/confirm-payment`,
      { board_stop_id: this.boardStopId, drop_stop_id: this.dropStopId, booking_channel: 'advance', ...payment },
      { 'Idempotency-Key': this.uuid() },
    ).subscribe({
      next: (res) => {
        this.busy = false;
        this.reservation = res?.reservation ?? null;
        this.boardingCode = res?.boarding_otp ?? '';
        this.step = 'done';
        this.cdr.markForCheck();
      },
      error: (err) => { this.busy = false; void this.toast(err?.error?.message || 'Payment confirmation failed.', 'danger'); this.cdr.markForCheck(); },
    });
  }

  private release(hold: SeatHold): void {
    this.api.post(`/fixed/seat-holds/${hold.id}/release`, {}).subscribe({ next: () => {}, error: () => {} });
  }

  // ---- done -------------------------------------------------------------

  viewBooking(): void {
    const bookingId = (this.reservation as any)?.id;
    this.booking.reset();
    if (bookingId) {
      void this.router.navigate(['/customer-tabs/fixed-rides', bookingId]);
    } else {
      void this.router.navigateByUrl('/customer-tabs/fixed-rides?active=1');
    }
  }

  // ---- nav --------------------------------------------------------------

  back(): void {
    this.error = null;
    switch (this.step) {
      case 'departure': this.step = 'route'; break;
      case 'details': this.step = 'departure'; break;
      case 'seats': this.step = 'details'; break;
      case 'review': this.step = 'seats'; break;
      default: void this.router.navigate(['/customer-tabs/go']);
    }
    this.cdr.markForCheck();
  }

  trackByRoute = (_: number, r: FixedRoute): number => r.id;
  trackByDep = (_: number, d: FixedDeparture): number => d.id;
  trackByStop = (_: number, s: FixedStop): number => s.id;

  // ---- plumbing ---------------------------------------------------------

  private payload(requireCoupon: boolean): Record<string, unknown> {
    const p: Record<string, unknown> = {
      route_departure_id: this.departure?.id,
      board_stop_id: this.boardStopId,
      drop_stop_id: this.dropStopId,
      seat_labels: this.selected,
      seats: this.selected.length || 1,
      has_extra_luggage: this.luggage > 0,
      extra_luggage_count: this.luggage,
    };
    const c = this.couponTitle.trim();
    if (c || requireCoupon) p['coupon_title'] = c;
    return p;
  }

  private uuid(): string {
    try { return (crypto as any).randomUUID(); }
    catch { return `fixed-${Date.now()}-${Math.floor(Math.random() * 1e9)}`; }
  }

  private async toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2600, color });
    await t.present();
  }
}
