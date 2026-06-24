import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

interface FixedStop {
  id: number;
  seq: number;
  name: string;
  lat: number;
  lng: number;
  is_pickup: boolean;
  is_drop: boolean;
  is_active: boolean;
  is_temporarily_unavailable: boolean;
  unavailable_reason: string | null;
}

interface FixedRoute {
  id: number;
  name: string;
  scope: 'local' | 'outstation';
  mode: 'fixed';
  origin_name: string;
  dest_name: string;
  origin_lat: number;
  origin_lng: number;
  dest_lat: number;
  dest_lng: number;
  flat_fare: number;
  luggage_surcharge_amount: number;
  max_luggage_per_vehicle: number;
  booking_window_hours: number;
  max_seats_per_booking: number;
  waiting_time_per_stop_minutes: number;
  requires_prepaid: boolean;
  stops: FixedStop[];
}

interface FixedDeparture {
  id: number;
  route_id: number;
  service_date: string | null;
  depart_at: string | null;
  announced_depart_at: string | null;
  capacity: number;
  seats_taken: number;
  seats_remaining: number;
  first_bookable_stop_seq?: number | null;
  status: string;
  departure_kind: 'driver_opened' | 'scheduled';
  visible_to_customers: boolean;
  luggage_capacity: number;
  luggage_taken: number;
  luggage_remaining: number;
}

interface SeatHold {
  id: number;
  route_departure_id: number;
  seats: number;
  amount: number;
  status: string;
  expires_at: string | null;
}

interface FixedRazorpayOrder {
  hold: SeatHold;
  razorpay: { key_id: string; order_id: string; amount_paise: number; currency: string };
}

declare const Razorpay: any;

interface FixedLiveStatus {
  key: string;
  label: string;
  detail: string;
  tone: 'primary' | 'success' | 'warning' | 'danger' | 'medium' | string;
  arrived_at?: string | null;
  no_show_after_at?: string | null;
  auto_outcome?: string | null;
  refund_status?: string | null;
}

interface FixedReservation {
  id: number;
  seats: number;
  fare_amount: number | null;
  status: string;
  fixed_live_status?: FixedLiveStatus | null;
  payment_status: string | null;
  refund_status?: string | null;
  route_name?: string | null;
  board?: string | null;
  drop?: string | null;
  route?: { id: number; name: string; scope: string; mode: string } | null;
  route_departure?: { id: number; service_date: string | null; depart_at: string | null; announced_depart_at: string | null; status: string } | null;
  board_stop?: { id: number; name: string } | null;
  drop_stop?: { id: number; name: string } | null;
}

type Step = 'routes' | 'vehicles' | 'details' | 'done';

@Component({
  selector: 'app-fixed-book',
  templateUrl: './fixed-book.page.html',
  styleUrls: ['./fixed-book.page.scss'],
  standalone: false,
})
export class FixedBookPage implements OnInit, OnDestroy {
  cityId: number | null = null;
  scope: 'local' | 'outstation' | '' = '';
  step: Step = 'routes';

  loading = false;
  booking = false;
  error: string | null = null;

  routes: FixedRoute[] = [];
  departures: FixedDeparture[] = [];
  selectedRoute: FixedRoute | null = null;
  selectedDeparture: FixedDeparture | null = null;

  boardStopId: number | null = null;
  dropStopId: number | null = null;
  seats = 1;
  extraLuggageCount = 0;
  hold: SeatHold | null = null;
  confirmation: FixedReservation | null = null;
  activeBookings: FixedReservation[] = [];

  private entered = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private auth: AuthService,
    private toast: ToastController,
  ) {}

  ngOnInit(): void { this.enter(); }
  ngOnDestroy(): void {}

  ionViewWillEnter(): void {
    if (this.entered) this.enter();
    this.entered = true;
  }

  get title(): string {
    return this.scope === 'outstation' ? 'Outstation fixed' : 'Local fixed';
  }

  get scopeLabel(): string {
    return this.scope === 'outstation' ? 'Outstation' : 'Local';
  }

  get pickupStops(): FixedStop[] {
    const firstSeq = this.selectedDeparture?.first_bookable_stop_seq ?? 1;
    return (this.selectedRoute?.stops || []).filter((s) => s.is_active && !s.is_temporarily_unavailable && s.is_pickup && s.seq >= firstSeq);
  }

  get dropStops(): FixedStop[] {
    const boardSeq = this.selectedRoute?.stops.find((s) => s.id === this.boardStopId)?.seq ?? 0;
    return (this.selectedRoute?.stops || []).filter((s) => s.is_active && !s.is_temporarily_unavailable && s.is_drop && s.seq > boardSeq);
  }

  get unavailableStops(): FixedStop[] {
    return (this.selectedRoute?.stops || []).filter((s) => !s.is_active || s.is_temporarily_unavailable);
  }

  get maxSeats(): number {
    const routeMax = this.selectedRoute?.max_seats_per_booking ?? 4;
    const remaining = this.selectedDeparture?.seats_remaining ?? routeMax;
    return Math.max(1, Math.min(routeMax, remaining));
  }

  get luggageAvailable(): boolean {
    return this.maxLuggage > 0;
  }

  get maxLuggage(): number {
    return Math.max(0, this.selectedDeparture?.luggage_remaining ?? 0);
  }

  get fareTotal(): number {
    const fare = this.selectedRoute?.flat_fare ?? 0;
    const luggage = this.extraLuggageCount * (this.selectedRoute?.luggage_surcharge_amount ?? 0);
    return (fare * Math.max(1, this.seats)) + luggage;
  }

  get fullStateText(): string | null {
    if (!this.selectedRoute || !this.departures.length) return null;
    const firstOpen = this.departures.find((d) => d.seats_remaining > 0);
    if (firstOpen) return null;
    return 'All boarding vehicles for this route are full right now. Please check again shortly.';
  }

  get canConfirm(): boolean {
    return !this.bookingBlockReason && !this.booking;
  }

  get bookingBlockReason(): string | null {
    if (!this.selectedRoute) return 'Choose a fixed route first.';
    if (!this.selectedDeparture) return 'Choose a live boarding vehicle first.';
    if (!this.pickupStops.length) return 'No pickup stops are currently available for this vehicle. The driver may have already passed them.';
    if (!this.boardStopId) return 'Choose your boarding stop.';
    if (!this.dropStops.length) return 'No drop stops are available after the selected boarding stop.';
    if (!this.dropStopId) return 'Choose your drop stop.';
    if (this.boardStopId === this.dropStopId) return 'Boarding and drop stop must be different.';
    if (this.seats < 1) return 'Select at least one seat.';
    if (this.seats > this.maxSeats) return 'Only ' + this.maxSeats + ' seat' + (this.maxSeats > 1 ? 's are' : ' is') + ' available for this vehicle.';
    return null;
  }

  get pickupStopHelp(): string | null {
    if (!this.selectedDeparture || this.pickupStops.length) return null;
    return 'Pickup is closed for all remaining stops on this vehicle.';
  }

  get dropStopHelp(): string | null {
    if (!this.boardStopId || this.dropStops.length) return null;
    return 'No later drop stop is available from this boarding stop.';
  }

  private enter(): void {
    const q = this.route.snapshot.queryParamMap;
    this.cityId = q.get('city_id') ? Number(q.get('city_id')) : null;
    const rawScope = q.get('scope') || '';
    this.scope = rawScope === 'outstation' ? 'outstation' : rawScope === 'local' ? 'local' : '';
    this.step = 'routes';
    this.selectedRoute = null;
    this.selectedDeparture = null;
    this.departures = [];
    this.hold = null;
    this.confirmation = null;
    this.resetDetails();
    this.loadRoutes();
    this.loadMyBookings();
  }

  loadRoutes(): void {
    if (this.cityId == null) return;
    this.loading = true;
    this.error = null;
    this.api.get<{ data: FixedRoute[] }>(`/fixed/routes?city_id=${this.cityId}`).subscribe({
      next: (res) => {
        let rows = res?.data || [];
        if (this.scope) rows = rows.filter((r) => r.scope === this.scope);
        this.routes = rows;
        this.loading = false;
      },
      error: () => {
        this.routes = [];
        this.loading = false;
        this.error = 'Could not load fixed routes for this city.';
      },
    });
  }


  loadMyBookings(): void {
    this.api.get<{ data: FixedReservation[] }>("/fixed/bookings").subscribe({
      next: (res) => {
        const rows = res?.data || [];
        this.activeBookings = rows.filter((booking) => !["DROPPED", "COMPLETED"].includes(booking.status)).slice(0, 5);
      },
      error: () => {
        this.activeBookings = [];
      },
    });
  }

  pickRoute(route: FixedRoute): void {
    this.selectedRoute = route;
    this.selectedDeparture = null;
    this.departures = [];
    this.resetDetails();
    this.step = 'vehicles';
    this.loadDepartures(route);
  }

  loadDepartures(route: FixedRoute): void {
    this.loading = true;
    this.api.get<{ data: FixedDeparture[] }>(`/fixed/routes/${route.id}/departures`).subscribe({
      next: (res) => {
        this.departures = res?.data || [];
        this.loading = false;
      },
      error: () => {
        this.departures = [];
        this.loading = false;
      },
    });
  }

  pickDeparture(dep: FixedDeparture): void {
    if (dep.seats_remaining <= 0) return;
    this.selectedDeparture = dep;
    if (!this.pickupStops.some((stop) => stop.id === this.boardStopId)) {
      this.boardStopId = null;
      this.dropStopId = null;
    }
    this.setExtraLuggage(Math.min(this.extraLuggageCount, this.maxLuggage));
    this.seats = Math.min(this.seats, this.maxSeats);
    if (!this.seats || this.seats < 1) this.seats = 1;
    this.step = 'details';
  }


  onBoardStopChange(): void {
    if (!this.dropStops.some((stop) => stop.id === this.dropStopId)) {
      this.dropStopId = null;
    }
  }

  setSeats(next: number): void {
    this.seats = Math.max(1, Math.min(this.maxSeats, next));
  }

  setExtraLuggage(next: number): void {
    this.extraLuggageCount = Math.max(0, Math.min(this.maxLuggage, next));
  }

  testPay(): void {
    this.confirm(true);
  }

  confirm(testPayment = false): void {
    if (!this.canConfirm || !this.selectedDeparture) return;
    this.booking = true;
    this.hold = null;
    this.api.post<{ hold: SeatHold }>('/fixed/seat-holds', {
      route_departure_id: this.selectedDeparture.id,
      board_stop_id: this.boardStopId,
      drop_stop_id: this.dropStopId,
      seats: this.seats,
      has_extra_luggage: this.extraLuggageCount > 0,
      extra_luggage_count: this.extraLuggageCount,
    }, { 'Idempotency-Key': this.uuid() }).subscribe({
      next: (res) => {
        this.hold = res?.hold ?? null;
        if (!this.hold) {
          this.booking = false;
          void this.showToast('Could not hold seats. Please try again.');
          return;
        }
        if (testPayment) {
          this.confirmHoldTestPayment(this.hold);
        } else {
          void this.startRazorpayPayment(this.hold);
        }
      },
      error: async (err) => {
        this.booking = false;
        await this.showToast(err?.error?.message || 'Could not hold seats. Please try again.');
      },
    });
  }

  private async startRazorpayPayment(hold: SeatHold): Promise<void> {
    if (typeof Razorpay === 'undefined') {
      this.booking = false;
      await this.showToast('Payment library not loaded. Check your connection.');
      return;
    }

    let order: FixedRazorpayOrder;
    try {
      order = (await this.api
        .post<FixedRazorpayOrder>(`/fixed/seat-holds/${hold.id}/razorpay-order`, {}, { 'Idempotency-Key': this.uuid() })
        .toPromise()) as FixedRazorpayOrder;
    } catch (err: any) {
      this.booking = false;
      await this.showToast(err?.error?.message || 'Could not start Razorpay payment.');
      return;
    }

    const user = this.auth.getUser();
    const rzp = new Razorpay({
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
      },
      theme: { color: '#000000' },
      handler: (resp: {
        razorpay_payment_id: string;
        razorpay_order_id: string;
        razorpay_signature: string;
      }) => {
        this.confirmHoldPayment(hold, resp);
      },
      modal: {
        ondismiss: async () => {
          this.booking = false;
          await this.showToast('Payment cancelled. Your seat hold will expire automatically.');
        },
      },
    });

    rzp.on('payment.failed', async (resp: any) => {
      this.booking = false;
      await this.showToast(resp?.error?.description || 'Payment failed.');
    });

    rzp.open();
  }


  private confirmHoldTestPayment(hold: SeatHold): void {
    this.api.post<{ reservation: FixedReservation }>(`/fixed/seat-holds/${hold.id}/test-confirm-payment`, {
      booking_channel: "advance",
    }, { "Idempotency-Key": this.uuid() }).subscribe({
      next: (res) => {
        this.booking = false;
        this.confirmation = res?.reservation ?? null;
        this.step = "done";
        this.loadMyBookings();
      },
      error: async (err) => {
        this.booking = false;
        await this.showToast(err?.error?.message || "Test payment confirmation failed.");
      },
    });
  }

  private confirmHoldPayment(hold: SeatHold, payment: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }): void {
    this.api.post<{ reservation: FixedReservation }>(`/fixed/seat-holds/${hold.id}/confirm-payment`, {
      board_stop_id: this.boardStopId,
      drop_stop_id: this.dropStopId,
      booking_channel: 'advance',
      ...payment,
    }, { 'Idempotency-Key': this.uuid() }).subscribe({
      next: (res) => {
        this.booking = false;
        this.confirmation = res?.reservation ?? null;
        this.step = 'done';
        this.loadMyBookings();
      },
      error: async (err) => {
        this.booking = false;
        await this.showToast(err?.error?.message || 'Payment confirmation failed. Your hold will expire automatically.');
      },
    });
  }

  back(): void {
    if (this.step === 'done') {
      this.router.navigateByUrl('/customer-tabs/my-trips');
      return;
    }
    if (this.step === 'details') {
      this.step = 'vehicles';
      this.hold = null;
      return;
    }
    if (this.step === 'vehicles') {
      this.step = 'routes';
      this.selectedRoute = null;
      this.selectedDeparture = null;
      this.departures = [];
      this.resetDetails();
      return;
    }
    this.router.navigateByUrl('/customer-tabs/book');
  }

  done(): void {
    this.router.navigateByUrl('/customer-tabs/my-trips');
  }

  departureTime(dep: FixedDeparture | null): string {
    if (!dep) return 'Boarding now';
    const iso = dep.announced_depart_at || dep.depart_at;
    if (!iso) return dep.departure_kind === 'driver_opened' ? 'Boarding now' : 'Boarding now';
    const date = new Date(iso);
    return isNaN(date.getTime()) ? 'Boarding now' : date.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
  }

  stopName(id: number | null): string {
    return this.selectedRoute?.stops.find((s) => s.id === id)?.name || '';
  }


  liveStatus(booking: FixedReservation): FixedLiveStatus {
    return booking.fixed_live_status || {
      key: booking.status,
      label: booking.status,
      detail: "Fixed booking status is " + booking.status + ".",
      tone: "primary",
    };
  }

  liveStatusClass(booking: FixedReservation): string {
    const tone = this.liveStatus(booking).tone || "primary";
    return "fb-live--" + tone;
  }

  fixedBookingRoute(booking: FixedReservation): string {
    return booking.route_name || booking.route?.name || "Fixed ride";
  }

  fixedBookingStops(booking: FixedReservation): string {
    const board = booking.board || booking.board_stop?.name || "Pickup stop";
    const drop = booking.drop || booking.drop_stop?.name || "Drop stop";
    return `${board} → ${drop}`;
  }

  private resetDetails(): void {
    this.boardStopId = null;
    this.dropStopId = null;
    this.seats = 1;
    this.extraLuggageCount = 0;
  }

  private uuid(): string {
    try {
      return (crypto as unknown as { randomUUID: () => string }).randomUUID();
    } catch {
      return `fixed-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    }
  }

  private async showToast(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2600, color: 'danger', position: 'bottom' });
    await t.present();
  }
}
