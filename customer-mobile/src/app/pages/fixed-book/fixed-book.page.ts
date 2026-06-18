import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { ApiService } from '../../core/api.service';

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

interface FixedReservation {
  id: number;
  seats: number;
  fare_amount: number | null;
  status: string;
  payment_status: string | null;
  route?: { id: number; name: string; scope: string; mode: string } | null;
  route_departure?: { id: number; service_date: string | null; depart_at: string | null; announced_depart_at: string | null; status: string } | null;
  board_stop?: { id: number; name: string } | null;
  drop_stop?: { id: number; name: string } | null;
}

type Step = 'routes' | 'vehicles' | 'details' | 'done';
type PaymentMethod = 'wallet' | 'razorpay';

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
  paymentMethod: PaymentMethod = 'wallet';
  hold: SeatHold | null = null;
  confirmation: FixedReservation | null = null;

  private entered = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
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
    return (this.selectedRoute?.stops || []).filter((s) => s.is_active && !s.is_temporarily_unavailable && s.is_pickup);
  }

  get dropStops(): FixedStop[] {
    return (this.selectedRoute?.stops || []).filter((s) => s.is_active && !s.is_temporarily_unavailable && s.is_drop);
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
    return !!this.selectedRoute
      && !!this.selectedDeparture
      && this.boardStopId != null
      && this.dropStopId != null
      && this.boardStopId !== this.dropStopId
      && this.seats >= 1
      && this.seats <= this.maxSeats
      && !this.booking;
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
    this.setExtraLuggage(Math.min(this.extraLuggageCount, this.maxLuggage));
    this.seats = Math.min(this.seats, this.maxSeats);
    if (!this.seats || this.seats < 1) this.seats = 1;
    this.step = 'details';
  }

  setSeats(next: number): void {
    this.seats = Math.max(1, Math.min(this.maxSeats, next));
  }

  setExtraLuggage(next: number): void {
    this.extraLuggageCount = Math.max(0, Math.min(this.maxLuggage, next));
  }

  confirm(): void {
    if (!this.canConfirm || !this.selectedDeparture) return;
    this.booking = true;
    this.hold = null;
    this.api.post<{ hold: SeatHold }>('/fixed/seat-holds', {
      route_departure_id: this.selectedDeparture.id,
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
        this.confirmHoldPayment(this.hold);
      },
      error: async (err) => {
        this.booking = false;
        await this.showToast(err?.error?.message || 'Could not hold seats. Please try again.');
      },
    });
  }

  private confirmHoldPayment(hold: SeatHold): void {
    this.api.post<{ reservation: FixedReservation }>(`/fixed/seat-holds/${hold.id}/confirm-payment`, {
      board_stop_id: this.boardStopId,
      drop_stop_id: this.dropStopId,
      booking_channel: 'advance',
      payment_method: this.paymentMethod,
      payment_reference: this.paymentMethod === 'razorpay' ? `mobile-${Date.now()}` : null,
    }, { 'Idempotency-Key': this.uuid() }).subscribe({
      next: (res) => {
        this.booking = false;
        this.confirmation = res?.reservation ?? null;
        this.step = 'done';
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

  private resetDetails(): void {
    this.boardStopId = null;
    this.dropStopId = null;
    this.seats = 1;
    this.extraLuggageCount = 0;
    this.paymentMethod = 'wallet';
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
