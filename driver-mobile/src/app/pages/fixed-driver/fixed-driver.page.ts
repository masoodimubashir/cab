import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { interval, Subscription } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import { BackgroundLocationService } from '../../core/background-location.service';
import {
  buildReusableCarMarkerElement,
  updateCarMarkerBearing,
  buildPassengerMarkerElement,
  buildStopMarkerElement,
} from '../../core/car-marker.helper';
import { GeoFix, GeolocationService } from '../../core/geolocation.service';
import { PlacesService } from '../../core/places.service';
import { RealtimeService } from '../../core/realtime.service';

declare const google: any;


interface FixedRoute {
  id: number;
  city_id: number;
  origin_city_id?: number | null;
  dest_city_id?: number | null;
  city_name?: string | null;
  origin_city_name?: string | null;
  dest_city_name?: string | null;
  name: string;
  scope: 'local' | 'outstation';
  origin_name: string;
  dest_name: string;
  flat_fare: number | null;
  max_luggage_per_vehicle: number;
  stops?: FixedStop[];
}

interface FixedVehicle {
  id: number;
  route_id: number;
  trip_id?: number | null;
  route_name: string;
  origin_name?: string | null;
  dest_name?: string | null;
  scope: string;
  capacity: number;
  seats_taken: number;
  seats_remaining: number;
  status: string;
  visible_to_customers: boolean;
  fixed_last_reached_stop_seq?: number | null;
  fixed_last_reached_stop_at?: string | null;
  active_hold_count?: number;
  reservation_count?: number;
}

interface SeatLayout {
  id: number;
  name: string;
  rows: number;
  cols: number;
  seat_count: number;
}

export interface SeatMapCell {
  row: number;
  col: number;
  kind: 'seat' | 'blocked' | 'aisle';
  label: string | null;
  category?: string | null;
  price_delta?: number;
  status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'BLOCKED' | 'AISLE';
}

export interface DepartureSeatMap {
  departure: { id: number; route_id: number; status: string };
  layout: { id: number; name: string; rows: number; cols: number };
  cells: SeatMapCell[];
}

interface FixedPassenger {
  id: number;
  customer_name: string | null;
  customer_phone: string | null;
  customer_lat?: number | null;
  customer_lng?: number | null;
  customer_location_updated_at?: string | null;
  seats: number;
  seat_labels?: string[];
  status: string;
  no_show_unlock_at?: string | null;
  payment_status: string | null;
  fare_amount: number | null;
  board_stop_id?: number | null;
  drop_stop_id?: number | null;
  board: string | null;
  drop: string | null;
  board_lat?: number | null;
  board_lng?: number | null;
  drop_lat?: number | null;
  drop_lng?: number | null;
}

interface FixedStop {
  id: number;
  seq: number;
  name: string;
  lat?: number | null;
  lng?: number | null;
  is_pickup?: boolean;
  is_drop?: boolean;
  is_active?: boolean;
  is_temporarily_unavailable?: boolean;
}

interface StopGuide extends FixedStop {
  waitingCount: number;
  boardedCount: number;
  dropCount: number;
  completedCount: number;
  status: 'done' | 'next' | 'pending';
}

export interface FixedCitySettings {
  fixed_waiting_time_per_stop_minutes?: number;
  fixed_stop_arrival_radius_m?: number;
  fixed_stop_arrival_dwell_seconds?: number;
  fixed_driver_missed_stop_grace_minutes?: number;
  fixed_customer_pickup_radius_m?: number;
  fixed_vehicle_approaching_alert_radius_m?: number;
  fixed_customer_grace_minutes?: number;
}

export interface StopDetailModalData {
  stop: FixedStop;
  guide: StopGuide;
  isReached: boolean;
  isNext: boolean;
  arrivalRadiusM: number;
  customerPickupRadiusM: number;
  approachingRadiusM: number;
  waitTimeMin: number;
  dwellSec: number;
  customerGraceMin: number;
  driverMissedGraceMin: number;
  boardingPassengers: FixedPassenger[];
  droppingPassengers: FixedPassenger[];
}

interface ManifestResponse {
  departure: FixedVehicle;
  passengers: FixedPassenger[];
  stops?: FixedStop[];
  city_settings?: FixedCitySettings;
}

@Component({
  selector: 'app-fixed-driver',
  templateUrl: './fixed-driver.page.html',
  styleUrls: ['./fixed-driver.page.scss'],
  standalone: false,
})
export class FixedDriverPage implements OnDestroy {
  loading = false;
  busy = false;
  error: string | null = null;
  message: string | null = null;

  routes: FixedRoute[] = [];
  vehicles: FixedVehicle[] = [];
  selectedRouteId: number | null = null;
  capacity = 4;

  // Filters for available routes list
  driverCities: { id: number; name: string }[] = [];
  driverScope: string | null = null;
  selectedCityFilter: number | 'all' = 'all';
  selectedScopeFilter: 'all' | 'local' | 'outstation' = 'all';
  routeSearchQuery = '';

  get filteredRoutes(): FixedRoute[] {
    return this.routes.filter((r) => {
      // 1. City Filter (matches city_id, origin_city_id, dest_city_id)
      if (this.selectedCityFilter !== 'all') {
        const cId = Number(this.selectedCityFilter);
        const matchesCity = r.city_id === cId || r.origin_city_id === cId || r.dest_city_id === cId;
        if (!matchesCity) return false;
      }

      // 2. Scope Filter (Local / Outstation)
      if (this.selectedScopeFilter !== 'all') {
        if (r.scope !== this.selectedScopeFilter) return false;
      }

      // 3. Search Query Filter
      if (this.routeSearchQuery && this.routeSearchQuery.trim()) {
        const q = this.routeSearchQuery.toLowerCase().trim();
        const nameMatches = (r.name || '').toLowerCase().includes(q);
        const originMatches = (r.origin_name || '').toLowerCase().includes(q);
        const destMatches = (r.dest_name || '').toLowerCase().includes(q);
        const stopsMatch = (r.stops || []).some((s) => (s.name || '').toLowerCase().includes(q));
        if (!nameMatches && !originMatches && !destMatches && !stopsMatch) return false;
      }

      return true;
    });
  }

  get hasMultipleScopes(): boolean {
    const scopes = new Set(this.routes.map((r) => r.scope));
    return scopes.size > 1;
  }

  setCityFilter(cityId: number | 'all'): void {
    this.selectedCityFilter = cityId;
  }

  setScopeFilter(scope: 'all' | 'local' | 'outstation'): void {
    this.selectedScopeFilter = scope;
  }

  resetRouteFilters(): void {
    this.selectedCityFilter = 'all';
    this.selectedScopeFilter = 'all';
    this.routeSearchQuery = '';
  }

  // Seat layouts (M6): fetched per selected route; driver picks which one to
  // open the vehicle with. Capacity derives from the layout's seat_count so
  // the seat map and the "seats total" counter can never disagree.
  layouts: SeatLayout[] = [];
  selectedLayoutId: number | null = null;
  layoutsLoading = false;

  activeVehicle: FixedVehicle | null = null;
  passengers: FixedPassenger[] = [];
  stops: FixedStop[] = [];
  citySettings: FixedCitySettings | null = null;
  selectedStopDetail: StopDetailModalData | null = null;
  passengerFilter: 'all' | 'waiting' | 'onboard' | 'done' = 'all';
  sheetTab: 'passengers' | 'stops' | 'seats' = 'passengers';
  showStopsTimeline = false;
  passengerSheetExpanded = true;
  detailsModalOpen = false;
  fixedLocationStreaming = false;

  // Seat layout map state
  seatMapData: DepartureSeatMap | null = null;
  seatMapLoading = false;
  seatActionBusy = false;

  openDetailsModal(tab: 'passengers' | 'stops' | 'seats' = 'passengers'): void {
    this.sheetTab = tab;
    this.detailsModalOpen = true;
    if (this.activeVehicle) {
      this.loadDepartureSeatMap(this.activeVehicle.id);
    }
  }

  openDetailsModalWithTab(tab: 'passengers' | 'stops' | 'seats'): void {
    this.openDetailsModal(tab);
  }

  selectSheetTab(tab: 'passengers' | 'stops' | 'seats'): void {
    this.sheetTab = tab;
    if (tab === 'seats' && this.activeVehicle && !this.seatMapData) {
      this.loadDepartureSeatMap(this.activeVehicle.id);
    }
  }

  closeDetailsModal(): void {
    this.detailsModalOpen = false;
  }

  private map: any = null;
  private routeLine: any = null;
  private stopMarkers: any[] = [];
  private passengerMarkers: any[] = [];
  private selfMarker: any = null;
  private selfWatchId: string | null = null;

  private manifestPoll?: Subscription;
  private unsubscribeFixedCatalog: (() => void) | null = null;
  // Ticks every second while the page is open so the No-show waiting-time
  // countdown updates smoothly between the 8s manifest refreshes.
  nowMs = Date.now();
  private clockTimer?: Subscription;

  // Boarding OTP popup: tapping "Board" sends a code to the customer and the
  // driver must type it back here to confirm the right passenger boards.
  otpPassenger: FixedPassenger | null = null;
  otpCode = '';
  otpError: string | null = null;
  otpSending = false;    // requesting/resending the code
  otpVerifying = false;  // checking a typed code
  otpResendIn = 0;       // seconds until Resend unlocks
  otpLockedFor = 0;      // seconds of anti-brute-force lockout
  otpDevCode: string | null = null; // shown only in SMS mock mode (dev)
  // Per-passenger cooldown (reservation id → seconds). Set when the driver
  // closes the OTP sheet while a resend/lockout timer is still running: the
  // row's Board button shows the countdown and stays disabled until it ends,
  // then a fresh tap starts the whole process again with a new code.
  boardCooldowns: Record<number, number> = {};
  private otpTimer?: Subscription;

  constructor(
    private api: ApiService,
    private alerts: AlertController,
    private toasts: ToastController,
    private router: Router,
    private realtime: RealtimeService,
    private backgroundLocation: BackgroundLocationService,
    private geo: GeolocationService,
    private places: PlacesService,
  ) {}

  /**
   * Fresh GPS fix attached to board/drop/no-show requests so the backend's
   * stop-reached check never depends on the background stream being alive.
   * Falls back to {} (backend then uses the last streamed ping) if the fix
   * can't be obtained quickly.
   */
  private async actionCoords(): Promise<{ lat?: number; lng?: number }> {
    try {
      const fix = await this.geo.getCurrentPosition({ timeout: 8000, maximumAge: 15000 });
      return fix ? { lat: fix.lat, lng: fix.lng } : {};
    } catch {
      return {};
    }
  }

  ionViewWillEnter(): void {
    this.subscribeFixedCatalog();
    this.startClock();
    this.refresh();
  }

  ionViewWillLeave(): void {
    this.unsubscribeFixedCatalog?.();
    this.unsubscribeFixedCatalog = null;
    this.stopManifestPolling();
    this.stopClock();
    this.closeBoardingOtp();
    // Leaving the page: drop row cooldowns and their ticker — the server
    // still enforces the exact remaining time (429 puts it back on the button).
    this.boardCooldowns = {};
    this.otpTimer?.unsubscribe();
    this.otpTimer = undefined;
    void this.stopFixedTripLocationStreaming();
    void this.stopDriverWatch();
    this.resetEmbeddedMap();
  }

  ngOnDestroy(): void {
    void this.stopDriverWatch();
    this.resetEmbeddedMap();
  }

  private subscribeFixedCatalog(): void {
    this.unsubscribeFixedCatalog?.();
    this.unsubscribeFixedCatalog = this.realtime.subscribeFixedCatalog(() => this.refresh());
  }

  refresh(forceMap = true): void {
    this.loading = true;
    this.error = null;
    this.message = null;
    let pending = 2;
    const done = () => {
      pending -= 1;
      if (pending === 0) this.loading = false;
    };

    this.api.get<{ data: FixedRoute[]; driver_cities?: { id: number; name: string }[]; driver_scope?: string }>('/fixed/driver/routes').subscribe({
      next: (res) => {
        this.routes = res.data ?? [];
        if (res.driver_cities && res.driver_cities.length) {
          this.driverCities = res.driver_cities;
        } else {
          const map = new Map<number, string>();
          for (const r of this.routes) {
            if (r.city_id && r.city_name) map.set(r.city_id, r.city_name);
            if (r.origin_city_id && r.origin_city_name) map.set(r.origin_city_id, r.origin_city_name);
            if (r.dest_city_id && r.dest_city_name) map.set(r.dest_city_id, r.dest_city_name);
          }
          this.driverCities = Array.from(map.entries()).map(([id, name]) => ({ id, name }));
        }

        if (res.driver_scope) {
          this.driverScope = res.driver_scope;
        }

        if (this.selectedRouteId && !this.routes.some(r => r.id === this.selectedRouteId)) {
          this.selectedRouteId = null;
        }
        if (this.selectedRouteId) {
          this.syncCapacity();
        }
      },
      error: (err) => this.error = err?.error?.message || 'Could not load fixed routes.',
      complete: done,
    });

    this.api.get<{ data: FixedVehicle[] }>('/fixed/driver/vehicles').subscribe({
      next: (res) => {
        this.vehicles = res.data ?? [];
        this.activeVehicle = this.pickActiveVehicle();
        if (this.activeVehicle) {
          this.loadManifest(this.activeVehicle.id, false, forceMap);
          this.startManifestPolling();
          void this.syncFixedTripLocationStreaming();
        } else {
          this.stopManifestPolling();
          void this.stopFixedTripLocationStreaming();
          this.resetEmbeddedMap();
        }
      },
      error: (err) => this.error = err?.error?.message || 'Could not load fixed vehicles.',
      complete: done,
    });
  }

  selectRoute(route: FixedRoute): void {
    this.selectedRouteId = route.id;
    this.syncCapacity();
  }

  clearSelectedRoute(): void {
    this.selectedRouteId = null;
    this.layouts = [];
    this.selectedLayoutId = null;
  }

  /**
   * Route changed: reload the layouts for the new route and (re)derive the
   * capacity. Called from the route <ion-select>'s (ionChange) hook.
   */
  syncCapacity(): void {
    this.selectedLayoutId = null;
    this.layouts = [];
    if (!this.selectedRouteId) {
      this.capacity = 1;
      return;
    }
    this.layoutsLoading = true;
    this.api.get<{ data: SeatLayout[] }>(`/fixed/driver/routes/${this.selectedRouteId}/layouts`)
      .pipe(finalize(() => this.layoutsLoading = false))
      .subscribe({
        next: (res) => {
          this.layouts = res.data ?? [];
          // Pre-select the first (usually only) layout so a single-tap Open works.
          this.selectedLayoutId = this.layouts[0]?.id ?? null;
          this.applyLayoutCapacity();
        },
        error: (err) => {
          this.error = err?.error?.message || 'Could not load seat layouts.';
        },
      });
  }

  onLayoutChange(): void {
    this.applyLayoutCapacity();
  }

  private applyLayoutCapacity(): void {
    const layout = this.layouts.find((l) => l.id === this.selectedLayoutId);
    if (layout) this.capacity = layout.seat_count;
    else this.capacity = 4;
  }

  openVehicle(): void {
    if (!this.selectedRouteId) {
      this.error = 'Select a fixed route first.';
      return;
    }
    if (!this.selectedLayoutId) {
      this.error = 'Pick a seat layout.';
      return;
    }

    this.busy = true;
    this.error = null;
    this.api.post<{ vehicle: FixedVehicle; message: string }>('/fixed/driver/vehicles', {
      route_id: this.selectedRouteId,
      vehicle_seat_layout_id: this.selectedLayoutId,
    }).pipe(finalize(() => this.busy = false)).subscribe({
      next: (res) => {
        this.message = res.message || 'Ride opened.';
        this.activeVehicle = res.vehicle;
        this.refresh();
      },
      error: (err) => {
        // If 500 or error occurs but vehicle was actually created on server, recover automatically
        this.api.get<{ vehicle?: FixedVehicle | null; data?: FixedVehicle[] }>('/fixed/driver/vehicles').subscribe({
          next: (check) => {
            const v = check?.vehicle || (Array.isArray(check?.data) && check.data.length > 0 ? check.data[0] : null);
            if (v) {
              this.activeVehicle = v;
              this.error = null;
              this.message = 'Ride active.';
              this.refresh();
            } else {
              this.error = err?.error?.message || 'Could not open ride.';
            }
          },
          error: () => {
            this.error = err?.error?.message || 'Could not open ride.';
          },
        });
      },
    });
  }

  async closeBookings(): Promise<void> {
    if (!this.activeVehicle || !this.canCloseVehicle(this.activeVehicle)) return;

    const alert = await this.alerts.create({
      header: 'Close ride?',
      message: 'This closes the active ride because no customer has booked yet.',
      buttons: [
        { text: 'Keep open', role: 'cancel' },
        { text: 'Close', role: 'confirm' },
      ],
    });
    await alert.present();
    const result = await alert.onDidDismiss();
    if (result.role !== 'confirm') return;

    this.busy = true;
    this.error = null;
    this.api.post<{ vehicle: FixedVehicle | null; message: string }>("/fixed/departures/" + this.activeVehicle.id + "/close-bookings", {})
      .pipe(finalize(() => this.busy = false))
      .subscribe({
        next: async (res) => {
          this.activeVehicle = res.vehicle;
          this.passengers = [];
          this.stops = [];
          this.stopManifestPolling();
          await this.stopFixedTripLocationStreaming();
          await this.showToast(res.message || 'Ride closed.');
          this.refresh();
        },
        error: (err) => {
          this.error = this.apiErrorMessage(err, 'Could not close ride.');
          if (this.activeVehicle) this.loadManifest(this.activeVehicle.id, false);
        },
      });
  }

  loadManifest(vehicleId: number, showSpinner = true, forceMap = false): void {
    if (showSpinner) this.busy = true;
    const oldRadius = Number(this.citySettings?.fixed_stop_arrival_radius_m || 0);
    const oldStopsJson = JSON.stringify(this.stops.map((s) => ({ id: s.id, seq: s.seq })));
    const oldPassengersJson = JSON.stringify(this.passengers.map((p) => ({ id: p.id, status: p.status, lat: p.customer_lat, lng: p.customer_lng })));
    const oldCitySettingsJson = JSON.stringify(this.citySettings || {});
    const hadMap = !!this.map;

    this.api.get<ManifestResponse>(`/fixed/departures/${vehicleId}/manifest`)
      .pipe(finalize(() => { if (showSpinner) this.busy = false; }))
      .subscribe({
        next: (res) => {
          this.activeVehicle = res.departure;
          this.passengers = res.passengers ?? [];
          this.stops = this.visibleManifestStops(res.stops ?? [], this.passengers);
          if (res.city_settings) {
            this.citySettings = res.city_settings;
          }
          void this.syncFixedTripLocationStreaming();

          const newRadius = Number(this.citySettings?.fixed_stop_arrival_radius_m || 0);
          const newStopsJson = JSON.stringify(this.stops.map((s) => ({ id: s.id, seq: s.seq })));
          const newPassengersJson = JSON.stringify(this.passengers.map((p) => ({ id: p.id, status: p.status, lat: p.customer_lat, lng: p.customer_lng })));
          const newCitySettingsJson = JSON.stringify(this.citySettings || {});

          // Live update stop detail popup if open
          if (this.selectedStopDetail) {
            this.openStopDetail(this.selectedStopDetail.stop);
          }

          if (!hadMap) {
            this.ensureEmbeddedMap(forceMap);
          } else if (
            forceMap ||
            oldStopsJson !== newStopsJson ||
            oldPassengersJson !== newPassengersJson ||
            oldCitySettingsJson !== newCitySettingsJson ||
            oldRadius !== newRadius
          ) {
            if (this.map && typeof google !== 'undefined' && google.maps?.event) {
              google.maps.event.trigger(this.map, 'resize');
            }
            this.refreshEmbeddedMap(forceMap);
          }
        },
        error: (err) => {
          if (showSpinner) this.error = err?.error?.message || 'Could not load passenger list.';
        },
      });
  }

  openRouteMap(): void {
    if (!this.activeVehicle) return;
    void this.router.navigateByUrl(`/tabs/fixed/map/${this.activeVehicle.id}`);
  }

  async startRide(): Promise<void> {
    if (!this.activeVehicle) return;
    const alert = await this.alerts.create({
      header: 'Start fixed ride?',
      message: 'Customers can still book from upcoming stops while seats are available.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Start ride', role: 'confirm' },
      ],
    });
    await alert.present();
    const result = await alert.onDidDismiss();
    if (result.role !== 'confirm') return;

    this.busy = true;
    this.error = null;
    this.api.post<{ vehicle: FixedVehicle; message: string }>(`/fixed/departures/${this.activeVehicle.id}/start`, {})
      .pipe(finalize(() => this.busy = false))
      .subscribe({
        next: async (res) => {
          this.activeVehicle = res.vehicle;
          await this.showToast(res.message || 'Fixed ride started.');
          void this.syncFixedTripLocationStreaming();
          this.refresh();
        },
        error: (err) => this.error = err?.error?.message || 'Could not start fixed ride.',
      });
  }

  async completeRide(): Promise<void> {
    if (!this.activeVehicle || !this.canComplete(this.activeVehicle)) return;
    const alert = await this.alerts.create({
      header: 'Complete fixed ride?',
      message: 'This closes the vehicle and stops new fixed bookings. All active passengers must already be dropped, cancelled or no-show.',
      buttons: [
        { text: 'Keep open', role: 'cancel' },
        { text: 'Complete ride', role: 'confirm' },
      ],
    });
    await alert.present();
    const result = await alert.onDidDismiss();
    if (result.role !== 'confirm') return;

    this.busy = true;
    this.error = null;
    this.api.post<{ vehicle: FixedVehicle; message: string }>("/fixed/departures/" + this.activeVehicle.id + "/complete", {})
      .pipe(finalize(() => this.busy = false))
      .subscribe({
        next: async (res) => {
          this.activeVehicle = res.vehicle;
          this.stopManifestPolling();
          await this.stopFixedTripLocationStreaming();
          await this.showToast(res.message || 'Fixed ride completed.');
          this.refresh();
        },
        error: (err) => this.error = err?.error?.message || 'Could not complete fixed ride.',
      });
  }

  /**
   * Boarding is OTP-gated: tapping Board sends a code to the customer
   * (on their booking screen until the SMS template is DLT-approved, then by
   * SMS; email/push per operator settings) and slides up the half-screen
   * sheet where the driver types the code the customer reads out.
   */
  async board(passenger: FixedPassenger): Promise<void> {
    if (!this.boardReady(passenger) || this.otpSending || this.boardCooldown(passenger) > 0) return;

    this.otpSending = true;
    this.error = null;
    const coords = await this.actionCoords();
    this.api.post<{ message: string; resend_after?: number; dev_code?: string | null }>(
      `/fixed/bookings/${passenger.id}/boarding-otp`, coords,
    )
      .pipe(finalize(() => this.otpSending = false))
      .subscribe({
        next: (res) => {
          delete this.boardCooldowns[passenger.id];
          this.openBoardingOtp(passenger);
          this.otpDevCode = res.dev_code || null;
          this.startOtpCountdown(res.resend_after ?? 30);
        },
        error: (err) => {
          // Server-side cooldown/lockout still running (e.g. app restarted):
          // put the countdown on the row's Board button instead of opening
          // the sheet — same UX as closing it mid-timer.
          if (err?.status === 429 && (err?.error?.retry_after || err?.error?.locked_for)) {
            this.setBoardCooldown(passenger.id, err.error.retry_after || err.error.locked_for);
            if (err?.error?.locked_for) {
              this.error = err?.error?.message || 'Too many wrong codes. Wait before retrying.';
            }
            return;
          }
          this.error = err?.error?.message || 'Could not send the boarding code.';
        },
      });
  }

  /** Seconds left before this passenger's Board button unlocks again. */
  boardCooldown(passenger: FixedPassenger): number {
    return this.boardCooldowns[passenger.id] ?? 0;
  }

  private setBoardCooldown(reservationId: number, seconds: number): void {
    const secs = Math.max(0, Math.round(seconds));
    if (secs <= 0) return;
    this.boardCooldowns[reservationId] = secs;
    this.ensureOtpTimer();
  }

  async resendBoardingOtp(): Promise<void> {
    const passenger = this.otpPassenger;
    if (!passenger || this.otpResendIn > 0 || this.otpLockedFor > 0 || this.otpSending) return;

    this.otpSending = true;
    this.otpError = null;
    const coords = await this.actionCoords();
    this.api.post<{ message: string; resend_after?: number; dev_code?: string | null }>(
      `/fixed/bookings/${passenger.id}/boarding-otp`, coords,
    )
      .pipe(finalize(() => this.otpSending = false))
      .subscribe({
        next: async (res) => {
          this.otpCode = '';
          this.otpDevCode = res.dev_code || null;
          this.startOtpCountdown(res.resend_after ?? 30);
          await this.showToast('Code re-sent to the passenger.');
        },
        error: (err) => {
          if (err?.status === 429 && err?.error?.retry_after) {
            this.startOtpCountdown(err.error.retry_after);
            return;
          }
          if (err?.status === 429 && err?.error?.locked_for) {
            this.otpError = err?.error?.message || 'Too many wrong codes.';
            this.startOtpLockout(err.error.locked_for);
            return;
          }
          this.otpError = err?.error?.message || 'Could not resend the code.';
        },
      });
  }

  async confirmBoardingOtp(): Promise<void> {
    const passenger = this.otpPassenger;
    if (!passenger || this.otpCode.length !== 4 || this.otpVerifying || this.otpLockedFor > 0) return;

    this.otpVerifying = true;
    this.otpError = null;
    const coords = await this.actionCoords();
    this.api.post<{ message: string }>(`/fixed/bookings/${passenger.id}/board`, { code: this.otpCode, ...coords })
      .pipe(finalize(() => this.otpVerifying = false))
      .subscribe({
        next: async (res) => {
          this.closeBoardingOtp();
          // Boarded — any leftover resend countdown is moot and the Board
          // button hides for this passenger.
          delete this.boardCooldowns[passenger.id];
          await this.showToast(res.message || 'Passenger boarded.');
          if (this.activeVehicle) this.loadManifest(this.activeVehicle.id, false);
        },
        error: (err) => {
          this.otpCode = '';
          if (err?.status === 429 && err?.error?.locked_for) {
            this.otpError = err?.error?.message || 'Too many wrong codes.';
            this.startOtpLockout(err.error.locked_for);
            return;
          }
          this.otpError = err?.error?.message || 'Wrong code. Try again.';
        },
      });
  }

  closeBoardingOtp(): void {
    // Sheet closed while a resend/lockout timer is running → move the
    // remaining seconds onto the row's Board button so the driver can't
    // hammer new codes; it re-enables by itself when the timer ends.
    if (this.otpPassenger) {
      const remaining = Math.max(this.otpResendIn, this.otpLockedFor);
      if (remaining > 0) this.setBoardCooldown(this.otpPassenger.id, remaining);
    }
    this.otpPassenger = null;
    this.otpCode = '';
    this.otpError = null;
    this.otpDevCode = null;
    this.otpResendIn = 0;
    this.otpLockedFor = 0;
    if (!Object.keys(this.boardCooldowns).length) {
      this.otpTimer?.unsubscribe();
      this.otpTimer = undefined;
    }
  }

  onOtpInput(value: string | null | undefined): void {
    this.otpCode = String(value ?? '').replace(/\D+/g, '').slice(0, 4);
    if (this.otpError && this.otpCode.length > 0) this.otpError = null;
  }

  otpDigit(i: number): string {
    return this.otpCode[i] ?? '';
  }

  private openBoardingOtp(passenger: FixedPassenger): void {
    this.otpPassenger = passenger;
    this.otpCode = '';
    this.otpError = null;
    this.otpDevCode = null;
    this.otpLockedFor = 0;
  }

  private startOtpCountdown(seconds: number): void {
    this.otpResendIn = Math.max(0, Math.round(seconds));
    this.ensureOtpTimer();
  }

  private startOtpLockout(seconds: number): void {
    this.otpLockedFor = Math.max(0, Math.round(seconds));
    this.ensureOtpTimer();
  }

  /**
   * One shared 1s ticker drives the in-sheet resend/lockout countdowns AND
   * the per-row Board-button cooldowns (after the sheet was closed).
   */
  private ensureOtpTimer(): void {
    if (this.otpTimer) return;
    this.otpTimer = interval(1000).subscribe(() => {
      if (this.otpResendIn > 0) this.otpResendIn--;
      if (this.otpLockedFor > 0) {
        this.otpLockedFor--;
        if (this.otpLockedFor === 0 && this.otpError) this.otpError = null;
      }
      for (const key of Object.keys(this.boardCooldowns)) {
        const id = Number(key);
        this.boardCooldowns[id]--;
        if (this.boardCooldowns[id] <= 0) delete this.boardCooldowns[id];
      }
      if (this.otpResendIn <= 0 && this.otpLockedFor <= 0 && !Object.keys(this.boardCooldowns).length) {
        this.otpTimer?.unsubscribe();
        this.otpTimer = undefined;
      }
    });
  }

  private startClock(): void {
    this.nowMs = Date.now();
    this.clockTimer?.unsubscribe();
    this.clockTimer = interval(1000).subscribe(() => (this.nowMs = Date.now()));
  }

  private stopClock(): void {
    this.clockTimer?.unsubscribe();
    this.clockTimer = undefined;
  }

  drop(passenger: FixedPassenger): void {
    if (!this.canDropPassenger(passenger)) return;
    this.updatePassenger(passenger, 'drop');
  }

  async noShow(passenger: FixedPassenger): Promise<void> {
    if (!this.canNoShowPassenger(passenger)) return;
    const alert = await this.alerts.create({
      header: 'Mark passenger no-show?',
      message: 'Use this only after reaching the pickup stop and the customer did not board.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Mark no-show', role: 'confirm' },
      ],
    });
    await alert.present();
    const result = await alert.onDidDismiss();
    if (result.role !== 'confirm') return;
    this.updatePassenger(passenger, 'no-show');
  }

  canCancelPassenger(passenger: FixedPassenger): boolean {
    if (this.rideStarted) return false;
    const status = (passenger.status || '').toUpperCase();
    return ['BOOKED', 'CONFIRMED'].includes(status);
  }

  async cancelPassenger(passenger: FixedPassenger): Promise<void> {
    if (!this.canCancelPassenger(passenger)) return;
    const fareText = passenger.fare_amount ? ` Full fare of ₹${passenger.fare_amount} will be automatically refunded.` : '';
    const alert = await this.alerts.create({
      header: 'Cancel Passenger Booking?',
      message: `Are you sure you want to cancel the booking for ${passenger.customer_name || 'this passenger'}?${fareText}`,
      inputs: [
        {
          name: 'reason',
          type: 'text',
          placeholder: 'Reason for cancellation (optional)',
        },
      ],
      buttons: [
        { text: 'Keep Booking', role: 'cancel' },
        {
          text: 'Cancel & Refund',
          role: 'confirm',
          cssClass: 'alert-btn-danger',
          handler: (data) => {
            this.executeCancelPassenger(passenger, data?.reason);
          },
        },
      ],
    });
    await alert.present();
  }

  private executeCancelPassenger(passenger: FixedPassenger, reason?: string): void {
    this.busy = true;
    this.error = null;
    this.api.post<{ message: string }>(`/fixed/bookings/${passenger.id}/cancel`, { reason: reason || 'Driver cancelled' })
      .pipe(finalize(() => this.busy = false))
      .subscribe({
        next: async (res) => {
          await this.showToast(res.message || 'Passenger booking cancelled.');
          if (this.activeVehicle) this.loadManifest(this.activeVehicle.id, false);
        },
        error: (err) => this.error = err?.error?.message || 'Could not cancel passenger booking.',
      });
  }

  get filteredGroupedPassengers(): Array<{ stop: string; waiting: number; boarded: number; passengers: FixedPassenger[] }> {
    const list = this.passengerFilter === 'all' 
      ? this.activeManifestPassengers 
      : this.passengerFilter === 'waiting'
      ? this.passengers.filter(p => ['BOOKED', 'CONFIRMED'].includes((p.status || '').toUpperCase()))
      : this.passengerFilter === 'onboard'
      ? this.passengers.filter(p => (p.status || '').toUpperCase() === 'BOARDED')
      : this.passengers.filter(p => ['DROPPED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'].includes((p.status || '').toUpperCase()));

    const groups = new Map<string, FixedPassenger[]>();
    for (const passenger of list) {
      const stop = passenger.board || 'Boarding point';
      groups.set(stop, [...(groups.get(stop) ?? []), passenger]);
    }
    return Array.from(groups.entries()).map(([stop, passengers]) => ({
      stop,
      passengers,
      waiting: passengers.filter((p) => ['BOOKED', 'CONFIRMED'].includes((p.status || '').toUpperCase())).length,
      boarded: passengers.filter((p) => (p.status || '').toUpperCase() === 'BOARDED').length,
    }));
  }

  get waitingCount(): number {
    return this.passengers.filter(p => ['BOOKED', 'CONFIRMED'].includes((p.status || '').toUpperCase())).length;
  }

  get onboardCount(): number {
    return this.passengers.filter(p => (p.status || '').toUpperCase() === 'BOARDED').length;
  }

  get completedCount(): number {
    return this.passengers.filter(p => ['DROPPED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'].includes((p.status || '').toUpperCase())).length;
  }

  get groupedPassengers(): Array<{ stop: string; waiting: number; boarded: number; passengers: FixedPassenger[] }> {
    const groups = new Map<string, FixedPassenger[]>();
    for (const passenger of this.activeManifestPassengers) {
      const stop = passenger.board || 'Boarding point';
      groups.set(stop, [...(groups.get(stop) ?? []), passenger]);
    }
    return Array.from(groups.entries()).map(([stop, passengers]) => ({
      stop,
      passengers,
      waiting: passengers.filter((p) => ['BOOKED', 'CONFIRMED'].includes((p.status || '').toUpperCase())).length,
      boarded: passengers.filter((p) => (p.status || '').toUpperCase() === 'BOARDED').length,
    }));
  }

  get activeManifestPassengers(): FixedPassenger[] {
    return this.passengers.filter((passenger) => this.isActivePassenger(passenger));
  }

  get stopGuide(): StopGuide[] {
    if (!this.stops.length) return [];
    const reachedSeq = this.reachedStopSeq;
    const nextStop = this.stops.find((stop) => Number(stop.seq || 0) > reachedSeq) ?? null;
    return this.stops.map((stop) => {
      const seq = Number(stop.seq || 0);
      return {
        ...stop,
        waitingCount: this.stopWaitingCount(stop),
        boardedCount: this.stopBoardedCount(stop),
        dropCount: this.stopDropCount(stop),
        completedCount: this.stopCompletedCount(stop),
        status: seq <= reachedSeq ? 'done' : nextStop?.id === stop.id ? 'next' : 'pending',
      };
    });
  }

  get nextStopGuide(): StopGuide | null {
    return this.stopGuide.find((stop) => stop.status === 'next') ?? null;
  }

  get lastReachedStop(): FixedStop | null {
    const reachedSeq = this.reachedStopSeq;
    if (reachedSeq <= 0) return null;
    return this.stops
      .filter((stop) => Number(stop.seq || 0) <= reachedSeq)
      .sort((a, b) => Number(b.seq || 0) - Number(a.seq || 0))[0] ?? null;
  }

  get reachedStopSeq(): number {
    return Number(this.activeVehicle?.fixed_last_reached_stop_seq || 0);
  }

  get activePassengerSummary(): Array<{ label: string; count: number }> {
    const waiting = this.passengers.filter((p) => ['BOOKED', 'CONFIRMED'].includes((p.status || '').toUpperCase())).length;
    const boarded = this.passengers.filter((p) => (p.status || '').toUpperCase() === 'BOARDED').length;
    return [
      { label: 'Waiting to board', count: waiting },
      { label: 'Onboard', count: boarded },
    ].filter((item) => item.count > 0);
  }

  get completionChecklist(): Array<{ label: string; count: number; tone: 'block' | 'done' }> {
    const waiting = this.passengers.filter((p) => ['BOOKED', 'CONFIRMED'].includes((p.status || '').toUpperCase())).length;
    const boarded = this.passengers.filter((p) => (p.status || '').toUpperCase() === 'BOARDED').length;
    const dropped = this.passengers.filter((p) => ['DROPPED', 'COMPLETED'].includes((p.status || '').toUpperCase())).length;
    const noShow = this.passengers.filter((p) => (p.status || '').toUpperCase() === 'NO_SHOW').length;
    const cancelled = this.passengers.filter((p) => (p.status || '').toUpperCase() === 'CANCELLED').length;
    return [
      { label: 'Waiting', count: waiting, tone: waiting > 0 ? 'block' : 'done' },
      { label: 'Onboard', count: boarded, tone: boarded > 0 ? 'block' : 'done' },
      { label: 'Dropped', count: dropped, tone: 'done' },
      { label: 'No-show', count: noShow, tone: 'done' },
      { label: 'Cancelled', count: cancelled, tone: 'done' },
    ];
  }

  get selectedRoute(): FixedRoute | null {
    return this.routes.find((route) => route.id === Number(this.selectedRouteId)) ?? null;
  }

  get setupHelp(): string {
    if (!this.routes.length) return 'No routes available.';
    return 'Select a route.';
  }

  getRouteOriginName(route: FixedRoute | null): string {
    if (!route) return 'Origin';
    const rName = route.name?.trim() || '';
    if (rName) {
      if (rName.includes('->')) return rName.split('->')[0].trim();
      if (rName.includes('→')) return rName.split('→')[0].trim();
      if (rName.toLowerCase().includes(' to ')) return rName.split(/ to /i)[0].trim();
    }
    if (route.stops && route.stops.length > 0 && route.stops[0]?.name) {
      return route.stops[0].name.trim();
    }
    const raw = route.origin_name?.trim();
    if (raw && raw.toLowerCase() !== 'origin') return raw;
    return 'Origin';
  }

  getRouteDestName(route: FixedRoute | null): string {
    if (!route) return 'Destination';
    const rName = route.name?.trim() || '';
    if (rName) {
      if (rName.includes('->')) return rName.split('->')[1].trim();
      if (rName.includes('→')) return rName.split('→')[1].trim();
      if (rName.toLowerCase().includes(' to ')) return rName.split(/ to /i)[1].trim();
    }
    if (route.stops && route.stops.length > 1 && route.stops[route.stops.length - 1]?.name) {
      return route.stops[route.stops.length - 1].name.trim();
    }
    const raw = route.dest_name?.trim();
    if (raw && raw.toLowerCase() !== 'destination') return raw;
    return 'Destination';
  }

  get routeOriginName(): string {
    const route = this.routes.find((r) => r.id === this.activeVehicle?.route_id) || null;
    const fromRoute = this.getRouteOriginName(route);
    if (fromRoute && fromRoute !== 'Origin') return fromRoute;

    if (this.stops.length > 0 && this.stops[0]?.name) return this.stops[0].name;
    const raw = this.activeVehicle?.origin_name?.trim();
    if (raw && raw.toLowerCase() !== 'origin') return raw;
    return 'Origin';
  }

  get routeDestName(): string {
    const route = this.routes.find((r) => r.id === this.activeVehicle?.route_id) || null;
    const fromRoute = this.getRouteDestName(route);
    if (fromRoute && fromRoute !== 'Destination') return fromRoute;

    if (this.stops.length > 1 && this.stops[this.stops.length - 1]?.name) {
      return this.stops[this.stops.length - 1].name;
    }
    const raw = this.activeVehicle?.dest_name?.trim();
    if (raw && raw.toLowerCase() !== 'destination') return raw;
    return 'Destination';
  }

  vehicleRouteLine(vehicle: FixedVehicle | null): string {
    if (!vehicle) return '';
    const orig = this.routeOriginName;
    const dest = this.routeDestName;
    if (orig && dest && orig !== 'Origin' && dest !== 'Destination') return orig + ' to ' + dest;
    return vehicle.route_name || 'Fixed route';
  }

  statusLabel(vehicle: FixedVehicle | null): string {
    if (!vehicle) return '';
    switch (vehicle.status) {
      case 'FORMING': return 'Boarding';
      case 'DISPATCHED': return 'Assigned';
      case 'DEPARTED': return 'Started';
      case 'COMPLETED': return 'Completed';
      case 'CANCELLED': return 'Cancelled';
      default: return vehicle.status;
    }
  }

  completeBlockReason(vehicle: FixedVehicle | null): string | null {
    if (!vehicle) return null;
    if (['COMPLETED', 'CANCELLED'].includes(vehicle.status)) return 'This ride is already closed.';
    const active = this.passengers.filter((passenger) => ['BOOKED', 'CONFIRMED', 'BOARDED'].includes(passenger.status)).length;
    if (active > 0) {
      const parts = this.activePassengerSummary.map((item) => item.count + ' ' + item.label.toLowerCase());
      return 'Complete ride is locked: ' + (parts.length ? parts.join(', ') : active + ' active passenger(s)') + ' remain.';
    }
    return null;
  }

  canStart(vehicle: FixedVehicle | null): boolean {
    if (!vehicle) return false;
    const status = (vehicle.status || '').toUpperCase();
    return status === 'FORMING' && !this.rideStarted;
  }

  canComplete(vehicle: FixedVehicle | null): boolean {
    if (!vehicle || !this.rideStarted) return false;
    const status = (vehicle.status || '').toUpperCase();
    return !['COMPLETED', 'CANCELLED'].includes(status)
      && !this.passengers.some((passenger) => ['BOOKED', 'CONFIRMED', 'BOARDED'].includes((passenger.status || '').toUpperCase()));
  }

  canCloseVehicle(vehicle: FixedVehicle | null): boolean {
    if (!vehicle) return false;
    const status = (vehicle.status || '').toUpperCase();
    return status === 'FORMING'
      && !this.rideStarted
      && (vehicle.seats_taken || 0) <= 0
      && (vehicle.active_hold_count || 0) <= 0
      && (vehicle.reservation_count || 0) <= 0
      && !this.passengers.some((p) => !['CANCELLED', 'NO_SHOW'].includes((p.status || '').toUpperCase()));
  }

  /** The ride is under way — the backend only boards/drops on a started vehicle. */
  get rideStarted(): boolean {
    return ['DISPATCHED', 'DEPARTED'].includes((this.activeVehicle?.status || '').toUpperCase());
  }

  /** This passenger row is at a status where a Board button makes sense. Kept as
   *  the button's visibility check so the affordance stays on screen (disabled)
   *  rather than vanishing while the driver hasn't started or reached the stop. */
  canBoardPassenger(passenger: FixedPassenger): boolean {
    return ['BOOKED', 'CONFIRMED'].includes((passenger.status || '').toUpperCase());
  }

  /** Every precondition the backend enforces for boarding is met, so the tap will
   *  succeed: right status, ride started, and the pickup stop reached. Gating the
   *  button on this turns the old post-tap 422s ("Start the fixed ride…", "Reach
   *  the passenger pickup stop…") into an up-front disabled state with a reason. */
  boardReady(passenger: FixedPassenger): boolean {
    return this.canBoardPassenger(passenger)
      && this.rideStarted
      && this.isPassengerPickupReached(passenger);
  }

  /** Why the Board button is disabled, or null when it's ready to tap. */
  boardBlockReason(passenger: FixedPassenger): string | null {
    if (!this.canBoardPassenger(passenger)) return null;
    if (!this.rideStarted) return 'Start the ride to begin boarding';
    if (!this.isPassengerPickupReached(passenger)) {
      const stop = this.passengerBoardStop(passenger);
      return stop ? 'Board unlocks when you reach ' + stop.name : 'Board unlocks when you reach the pickup stop';
    }
    return null;
  }

  canDropPassenger(passenger: FixedPassenger): boolean {
    return (passenger.status || '').toUpperCase() === 'BOARDED';
  }

  /**
   * The No-show button appears once the vehicle has reached the pickup stop
   * (the backend then reports a no_show_unlock_at). Before that the button is
   * hidden entirely — no dead greyed-out button.
   */
  noShowVisible(passenger: FixedPassenger): boolean {
    const status = (passenger.status || '').toUpperCase();
    return ['BOOKED', 'CONFIRMED'].includes(status) && !!passenger.no_show_unlock_at;
  }

  /**
   * Seconds left on the mandatory waiting time before no-show unlocks.
   * 0 = ready (or not applicable). The server enforces the same deadline, so
   * this is only the visible countdown, not the actual gate.
   */
  noShowCountdown(passenger: FixedPassenger): number {
    if (!passenger.no_show_unlock_at) return 0;
    const remaining = new Date(passenger.no_show_unlock_at).getTime() - this.nowMs;
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  }

  noShowCountdownLabel(passenger: FixedPassenger): string {
    const secs = this.noShowCountdown(passenger);
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return mins > 0 ? `${mins}:${rem.toString().padStart(2, '0')}` : `${rem}s`;
  }

  canNoShowPassenger(passenger: FixedPassenger): boolean {
    return this.noShowVisible(passenger) && this.noShowCountdown(passenger) <= 0;
  }

  private isActivePassenger(passenger: FixedPassenger): boolean {
    return ['BOOKED', 'CONFIRMED', 'BOARDED'].includes((passenger.status || '').toUpperCase());
  }

  stopStatusLabel(stop: StopGuide): string {
    if (stop.status === 'next') return 'Next';
    if (stop.status === 'done') return 'Reached';
    return 'Upcoming';
  }


  passengerStatusLabel(passenger: FixedPassenger): string {
    switch ((passenger.status || '').toUpperCase()) {
      case 'BOOKED':
      case 'CONFIRMED':
        return 'Booked';
      case 'BOARDED':
        return 'Boarded';
      case 'DROPPED':
        return 'Dropped off';
      case 'COMPLETED':
        return 'Completed';
      case 'NO_SHOW':
        return 'No-show';
      case 'CANCELLED':
        return 'Cancelled';
      default:
        return passenger.status || 'Status';
    }
  }

  loadDepartureSeatMap(departureId: number): void {
    this.seatMapLoading = true;
    this.api.get<DepartureSeatMap>(`/fixed/driver/departures/${departureId}/seat-map`)
      .pipe(finalize(() => { this.seatMapLoading = false; }))
      .subscribe({
        next: (res) => {
          this.seatMapData = res;
        },
        error: (err) => {
          this.error = err?.error?.message || 'Could not load vehicle seat layout.';
        },
      });
  }

  get availableSeatCellsCount(): number {
    return (this.seatMapData?.cells || []).filter((c) => c.kind === 'seat' && c.status === 'AVAILABLE').length;
  }

  get bookedSeatCellsCount(): number {
    return (this.seatMapData?.cells || []).filter((c) => c.kind === 'seat' && (c.status === 'BOOKED' || c.status === 'HELD')).length;
  }

  get blockedSeatCellsCount(): number {
    return (this.seatMapData?.cells || []).filter((c) => c.kind === 'seat' && c.status === 'BLOCKED').length;
  }

  get seatMapRows(): { rowIndex: number; cells: SeatMapCell[] }[] {
    if (!this.seatMapData || !this.seatMapData.cells) return [];
    const rowMap = new Map<number, SeatMapCell[]>();
    for (const cell of this.seatMapData.cells) {
      const list = rowMap.get(cell.row) || [];
      list.push(cell);
      rowMap.set(cell.row, list);
    }
    return Array.from(rowMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([rowIndex, cells]) => ({
        rowIndex,
        cells: cells.sort((a, b) => a.col - b.col),
      }));
  }

  async onSeatCellTap(cell: SeatMapCell): Promise<void> {
    if (cell.kind !== 'seat' || !cell.label || !this.activeVehicle) return;

    if (cell.status === 'AVAILABLE') {
      const alert = await this.alerts.create({
        header: `Block Seat ${cell.label}?`,
        subHeader: 'Walk-in / Offline Passenger',
        message: `Marking seat ${cell.label} will block online app customers from booking it.`,
        buttons: [
          { text: 'Cancel', role: 'cancel' },
          {
            text: 'Block Seat',
            role: 'confirm',
            handler: () => {
              this.blockSeat(cell.label!);
            },
          },
        ],
      });
      await alert.present();
    } else if (cell.status === 'BLOCKED') {
      const alert = await this.alerts.create({
        header: `Unblock Seat ${cell.label}?`,
        subHeader: 'Passenger Dropped Off',
        message: `Release seat ${cell.label} and make it available for online customer bookings again?`,
        buttons: [
          { text: 'Cancel', role: 'cancel' },
          {
            text: 'Unblock & Make Available',
            role: 'confirm',
            handler: () => {
              this.unblockSeat(cell.label!);
            },
          },
        ],
      });
      await alert.present();
    } else if (cell.status === 'BOOKED' || cell.status === 'HELD') {
      const p = this.passengers.find((pass) => (pass.seat_labels || []).includes(cell.label!));
      const msg = p
        ? `Booked by: ${p.customer_name || 'Passenger'} (${p.customer_phone || 'Online'})\nFrom: ${p.board || 'Origin'} → ${p.drop || 'Destination'}`
        : 'This seat is reserved online by an app customer.';
      const alert = await this.alerts.create({
        header: `Seat ${cell.label} (Online Booked)`,
        message: msg,
        buttons: ['OK'],
      });
      await alert.present();
    }
  }

  blockSeat(label: string): void {
    if (!this.activeVehicle) return;
    this.seatActionBusy = true;
    this.api.post<{ message: string; seat_map: DepartureSeatMap; vehicle: FixedVehicle }>(
      `/fixed/driver/departures/${this.activeVehicle.id}/seats/block`,
      { label }
    ).pipe(finalize(() => { this.seatActionBusy = false; })).subscribe({
      next: (res) => {
        if (res.seat_map) this.seatMapData = res.seat_map;
        if (res.vehicle) this.activeVehicle = { ...this.activeVehicle, ...res.vehicle };
        void this.showToast(res.message || `Seat ${label} blocked.`);
      },
      error: (err) => {
        this.error = err?.error?.message || `Could not block seat ${label}.`;
      },
    });
  }

  unblockSeat(label: string): void {
    if (!this.activeVehicle) return;
    this.seatActionBusy = true;
    this.api.post<{ message: string; seat_map: DepartureSeatMap; vehicle: FixedVehicle }>(
      `/fixed/driver/departures/${this.activeVehicle.id}/seats/unblock`,
      { label }
    ).pipe(finalize(() => { this.seatActionBusy = false; })).subscribe({
      next: (res) => {
        if (res.seat_map) this.seatMapData = res.seat_map;
        if (res.vehicle) this.activeVehicle = { ...this.activeVehicle, ...res.vehicle };
        void this.showToast(res.message || `Seat ${label} released.`);
      },
      error: (err) => {
        this.error = err?.error?.message || `Could not unblock seat ${label}.`;
      },
    });
  }

  passengerStatusColor(passenger: FixedPassenger): string {
    switch ((passenger.status || '').toUpperCase()) {
      case 'BOARDED':
      case 'DROPPED':
      case 'COMPLETED':
        return 'success';
      case 'NO_SHOW':
        return 'danger';
      case 'CANCELLED':
        return 'medium';
      default:
        return 'warning';
    }
  }

  passengerActionHint(passenger: FixedPassenger): string {
    const status = (passenger.status || '').toUpperCase();
    if (['BOOKED', 'CONFIRMED'].includes(status)) {
      if (!this.rideStarted) return 'Start the ride to begin boarding';
      if (!this.isPassengerPickupReached(passenger)) return 'Board & no-show unlock once you reach the pickup stop';
      const secs = this.noShowCountdown(passenger);
      if (secs > 0) return 'Wait for the passenger — no-show unlocks in ' + this.noShowCountdownLabel(passenger);
      return 'Board or mark no-show';
    }
    if (status === 'BOARDED') return 'Ready to drop';
    return this.passengerStatusLabel(passenger);
  }

  private isPassengerPickupReached(passenger: FixedPassenger): boolean {
    const stop = this.passengerBoardStop(passenger);
    return !!stop && Number(stop.seq || 0) <= this.reachedStopSeq;
  }


  private visibleManifestStops(stops: FixedStop[], passengers: FixedPassenger[]): FixedStop[] {
    const usedStopIds = new Set<number>();
    passengers.forEach((passenger) => {
      if (passenger.board_stop_id) usedStopIds.add(Number(passenger.board_stop_id));
      if (passenger.drop_stop_id) usedStopIds.add(Number(passenger.drop_stop_id));
    });

    return stops
      .filter((stop) => this.isStopAvailable(stop) || usedStopIds.has(Number(stop.id)))
      .slice()
      .sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));
  }

  private isStopAvailable(stop: FixedStop): boolean {
    return stop.is_active !== false && stop.is_temporarily_unavailable !== true;
  }

  private passengerBoardStop(passenger: FixedPassenger): FixedStop | null {
    const stopId = Number(passenger.board_stop_id || 0);
    if (stopId > 0) return this.stops.find((stop) => Number(stop.id) === stopId) ?? null;
    return this.stops.find((stop) => this.sameStop(passenger.board, stop.name)) ?? null;
  }

  private stopWaitingCount(stop: FixedStop): number {
    return this.passengers.filter((p) => ['BOOKED', 'CONFIRMED'].includes((p.status || '').toUpperCase()) && this.sameStop(p.board, stop.name)).length;
  }

  private stopBoardedCount(stop: FixedStop): number {
    return this.passengers.filter((p) => (p.status || '').toUpperCase() === 'BOARDED' && this.sameStop(p.board, stop.name)).length;
  }

  private stopDropCount(stop: FixedStop): number {
    return this.passengers.filter((p) => (p.status || '').toUpperCase() === 'BOARDED' && this.sameStop(p.drop, stop.name)).length;
  }

  private stopCompletedCount(stop: FixedStop): number {
    return this.passengers.filter((p) => ['DROPPED', 'COMPLETED'].includes((p.status || '').toUpperCase()) && this.sameStop(p.drop, stop.name)).length;
  }

  private sameStop(a: string | null | undefined, b: string | null | undefined): boolean {
    return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
  }

  private fixedTripId(vehicle: FixedVehicle | null): number | null {
    const tripId = Number(vehicle?.trip_id || 0);
    return tripId > 0 ? tripId : null;
  }

  private shouldStreamFixedLocation(vehicle: FixedVehicle | null): boolean {
    return !!this.fixedTripId(vehicle) && !!vehicle && ['DISPATCHED', 'DEPARTED'].includes(vehicle.status);
  }

  private async syncFixedTripLocationStreaming(): Promise<void> {
    const vehicle = this.activeVehicle;
    if (!this.shouldStreamFixedLocation(vehicle)) {
      await this.stopFixedTripLocationStreaming();
      return;
    }

    const tripId = this.fixedTripId(vehicle);
    if (!tripId) return;

    try {
      await this.backgroundLocation.start(tripId);
      this.fixedLocationStreaming = true;
    } catch (err: any) {
      this.fixedLocationStreaming = false;
      this.error = err?.message || 'Could not start fixed ride GPS sharing.';
    }
  }

  private async stopFixedTripLocationStreaming(): Promise<void> {
    if (this.backgroundLocation.isStreaming()) {
      await this.backgroundLocation.stop();
    }
    this.fixedLocationStreaming = false;
  }

  private async updatePassenger(passenger: FixedPassenger, action: 'board' | 'drop' | 'no-show'): Promise<void> {
    this.busy = true;
    this.error = null;
    const coords = await this.actionCoords();
    this.api.post<{ message: string }>(`/fixed/bookings/${passenger.id}/${action}`, coords)
      .pipe(finalize(() => this.busy = false))
      .subscribe({
        next: async (res) => {
          await this.showToast(res.message || 'Passenger updated.');
          if (this.activeVehicle) this.loadManifest(this.activeVehicle.id, false);
        },
        error: (err) => this.error = err?.error?.message || 'Could not update passenger.',
      });
  }


  private startManifestPolling(): void {
    this.stopManifestPolling();
    if (!this.activeVehicle || ["COMPLETED", "CANCELLED"].includes(this.activeVehicle.status)) return;

    this.manifestPoll = interval(4000).subscribe(() => {
      if (!this.activeVehicle) return;
      this.loadManifest(this.activeVehicle.id, false);
    });
  }

  private stopManifestPolling(): void {
    this.manifestPoll?.unsubscribe();
    this.manifestPoll = undefined;
  }

  private pickActiveVehicle(): FixedVehicle | null {
    return this.vehicles.find((vehicle) => ['FORMING', 'DISPATCHED', 'DEPARTED'].includes(vehicle.status))
      ?? this.vehicles[0]
      ?? null;
  }

  private apiErrorMessage(err: any, fallback: string): string {
    if (typeof err?.error?.message === 'string' && err.error.message.trim()) return err.error.message;
    if (typeof err?.error === 'string' && err.error.trim()) return err.error;
    if (err?.status) return fallback + ' (' + err.status + ')';
    return fallback;
  }

  private async showToast(message: string): Promise<void> {
    const toast = await this.toasts.create({ message, duration: 1800, position: 'bottom' });
    await toast.present();
  }

  /* ─── Embedded Map Management ─── */
  ensureEmbeddedMap(forceRefit = false): void {
    if (this.map) {
      if (typeof google !== 'undefined' && google.maps?.event) {
        google.maps.event.trigger(this.map, 'resize');
      }
      this.refreshEmbeddedMap(forceRefit);
      return;
    }
    requestAnimationFrame(() => void this.initEmbeddedMap());
  }

  togglePassengerSheet(): void {
    this.passengerSheetExpanded = !this.passengerSheetExpanded;
  }

  recenterMap(): void {
    if (!this.map) return;
    if (this.selfMarker?.position) {
      this.map.panTo(this.selfMarker.position);
      this.map.setZoom(16);
    } else {
      this.fitEmbeddedMap();
    }
  }

  private async initEmbeddedMap(): Promise<void> {
    if (this.map) return;
    try {
      await this.places.ensureLoaded();
      const div = document.getElementById('fixed-driver-embedded-map');
      if (!div) return;
      const firstStop = this.stops.find((stop) => this.hasStopCoords(stop));
      this.map = new google.maps.Map(div, {
        center: firstStop ? this.stopPosition(firstStop) : { lat: 28.6139, lng: 77.209 },
        zoom: 13,
        disableDefaultUI: true,
        zoomControl: false,
        mapId: 'DEMO_MAP_ID',
      });
      this.refreshEmbeddedMap();
      void this.startDriverWatch();
    } catch {
      // Graceful fallback if map API cannot be reached
    }
  }

  private refreshEmbeddedMap(refit = true): void {
    if (!this.map) return;
    this.clearRouteObjects();
    const routeStops = this.stops.filter((stop) => this.hasStopCoords(stop));
    if (!routeStops.length) return;

    this.routeLine = new google.maps.Polyline({
      path: routeStops.map((stop) => this.stopPosition(stop)),
      map: this.map,
      strokeColor: '#12B35B',
      strokeOpacity: 0.9,
      strokeWeight: 5,
    });

    this.stopMarkers = routeStops.map((stop) => {
      const marker = new google.maps.marker.AdvancedMarkerElement({
        position: this.stopPosition(stop),
        map: this.map,
        title: stop.name,
        content: this.buildStopMarker(stop),
        zIndex: Number(stop.seq || 0),
      });

      marker.addListener('click', () => {
        this.openStopDetail(stop);
      });

      return marker;
    });

    this.passengerMarkers = this.passengerPointGroups().map((point) => new google.maps.marker.AdvancedMarkerElement({
      position: point.position,
      map: this.map,
      title: point.title,
      content: this.buildPassengerMarker(point.kind, point.count, point.name, point.isLive),
      zIndex: point.kind === 'pickup' ? (point.isLive ? 960 : 920) : 850,
    }));
    if (refit) {
      this.fitEmbeddedMap();
    }
  }

  openStopDetail(stop: FixedStop): void {
    const guide = this.stopGuide.find((s) => s.id === stop.id) || {
      ...stop,
      waitingCount: 0,
      boardedCount: 0,
      dropCount: 0,
      completedCount: 0,
      status: 'pending' as const,
    };
    const reachedSeq = Number(this.activeVehicle?.fixed_last_reached_stop_seq || 0);
    const isReached = stop.seq <= reachedSeq;
    const isNext = !isReached && (reachedSeq === 0 ? stop.seq === 1 : stop.seq === reachedSeq + 1);

    const boardingPassengers = this.passengers.filter((p) => {
      const status = (p.status || '').toUpperCase();
      if (['CANCELLED', 'NO_SHOW'].includes(status)) return false;
      return Number(p.board_stop_id) === Number(stop.id);
    });

    const droppingPassengers = this.passengers.filter((p) => {
      const status = (p.status || '').toUpperCase();
      if (['CANCELLED', 'NO_SHOW'].includes(status)) return false;
      return Number(p.drop_stop_id) === Number(stop.id);
    });

    this.selectedStopDetail = {
      stop,
      guide,
      isReached,
      isNext,
      arrivalRadiusM: this.citySettings?.fixed_stop_arrival_radius_m || 150,
      customerPickupRadiusM: this.citySettings?.fixed_customer_pickup_radius_m || 150,
      approachingRadiusM: this.citySettings?.fixed_vehicle_approaching_alert_radius_m || 500,
      waitTimeMin: this.citySettings?.fixed_waiting_time_per_stop_minutes || 5,
      dwellSec: this.citySettings?.fixed_stop_arrival_dwell_seconds || 20,
      customerGraceMin: this.citySettings?.fixed_customer_grace_minutes || 2,
      driverMissedGraceMin: this.citySettings?.fixed_driver_missed_stop_grace_minutes || 3,
      boardingPassengers,
      droppingPassengers,
    };
  }

  closeStopDetail(): void {
    this.selectedStopDetail = null;
  }

  navigateToStop(stop: FixedStop): void {
    if (!stop.lat || !stop.lng) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`;
    window.open(url, '_system');
  }

  trackByStopId(_index: number, stop: StopGuide): number {
    return stop.id;
  }

  trackByPassengerId(_index: number, passenger: FixedPassenger): number {
    return passenger.id;
  }

  trackByGroup(_index: number, group: { stop: string }): string {
    return group.stop;
  }

  private async startDriverWatch(): Promise<void> {
    if (this.selfWatchId !== null) return;
    try {
      this.selfWatchId = await this.geo.watchPosition(
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
        (fix, err) => {
          if (err) {
            void this.stopDriverWatch();
            return;
          }
          if (fix) this.onDriverPosition(fix);
        },
      );
    } catch {
      this.selfWatchId = null;
    }
  }

  private async stopDriverWatch(): Promise<void> {
    if (this.selfWatchId !== null) {
      await this.geo.clearWatch(this.selfWatchId);
      this.selfWatchId = null;
    }
  }

  private lastDriverLocationSentAt = 0;

  private onDriverPosition(fix: GeoFix): void {
    const position = { lat: fix.lat, lng: fix.lng };
    if (this.map) {
      if (!this.selfMarker) {
        this.selfMarker = new google.maps.marker.AdvancedMarkerElement({
          position,
          map: this.map,
          title: 'You (Driver)',
          content: this.buildDriverMarker(fix.bearing ?? 0),
          zIndex: 1000,
        });
        this.fitEmbeddedMap();
      } else {
        this.selfMarker.position = position;
        if (fix.bearing != null) {
          updateCarMarkerBearing(this.selfMarker, fix.bearing);
        }
      }
    }

    // Proactively post GPS location to server (throttled to 4s)
    const now = Date.now();
    if (now - this.lastDriverLocationSentAt >= 4000) {
      this.lastDriverLocationSentAt = now;
      const tripId = this.fixedTripId(this.activeVehicle);
      if (tripId) {
        this.api.post(`/trips/${tripId}/location`, {
          lat: fix.lat,
          lng: fix.lng,
          accuracy_m: fix.accuracy ?? null,
          bearing_deg: fix.bearing ?? null,
          speed_kmh: fix.speed != null ? Math.max(0, fix.speed) * 3.6 : null,
        }).subscribe({ error: () => {} });
      } else {
        this.api.post('/drivers/me/location', {
          lat: fix.lat,
          lng: fix.lng,
          accuracy: fix.accuracy ?? null,
          bearing: fix.bearing ?? null,
          speed: fix.speed != null ? Math.max(0, fix.speed) * 3.6 : null,
        }).subscribe({ error: () => {} });
      }
    }
  }

  private fitEmbeddedMap(): void {
    if (!this.map) return;
    const bounds = new google.maps.LatLngBounds();
    let any = false;
    for (const marker of [...this.stopMarkers, ...this.passengerMarkers, this.selfMarker]) {
      if (marker?.position) {
        bounds.extend(marker.position as any);
        any = true;
      }
    }
    if (any) this.map.fitBounds(bounds, 40);
  }

  private resetEmbeddedMap(): void {
    this.clearRouteObjects();
    if (this.selfMarker) {
      this.selfMarker.map = null;
      this.selfMarker = null;
    }
    this.map = null;
  }

  private clearRouteObjects(): void {
    if (this.routeLine) {
      this.routeLine.setMap(null);
      this.routeLine = null;
    }
    for (const marker of this.stopMarkers) marker.map = null;
    for (const marker of this.passengerMarkers) marker.map = null;
    this.stopMarkers = [];
    this.passengerMarkers = [];
  }

  private hasStopCoords(stop: FixedStop): boolean {
    return stop.lat != null && stop.lng != null && Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lng));
  }

  private stopPosition(stop: FixedStop): { lat: number; lng: number } {
    return { lat: Number(stop.lat), lng: Number(stop.lng) };
  }

  private passengerPointGroups(): Array<{
    kind: 'pickup' | 'drop';
    count: number;
    title: string;
    name: string;
    isLive: boolean;
    position: { lat: number; lng: number };
  }> {
    const points: Array<{
      kind: 'pickup' | 'drop';
      count: number;
      title: string;
      name: string;
      isLive: boolean;
      position: { lat: number; lng: number };
    }> = [];

    for (const passenger of this.passengers) {
      const status = (passenger.status || '').toUpperCase();
      if (['CANCELLED', 'NO_SHOW', 'DROPPED', 'COMPLETED'].includes(status)) continue;

      if (['BOOKED', 'CONFIRMED'].includes(status)) {
        const pickup = this.passengerPosition(passenger, 'pickup');
        if (pickup) {
          const isLive = passenger.customer_lat != null && passenger.customer_lng != null &&
            Number.isFinite(Number(passenger.customer_lat)) && Number.isFinite(Number(passenger.customer_lng));
          const name = passenger.customer_name || 'Passenger';
          points.push({
            kind: 'pickup',
            count: passenger.seats || 1,
            name,
            isLive,
            title: `${name} (${passenger.seats || 1} seat${(passenger.seats || 1) > 1 ? 's' : ''}) - ${isLive ? 'Live Walking' : 'Pickup at ' + (passenger.board || 'stop')}`,
            position: pickup,
          });
        }
      } else if (status === 'BOARDED') {
        const drop = this.passengerPosition(passenger, 'drop');
        if (drop) {
          const name = passenger.customer_name || 'Passenger';
          points.push({
            kind: 'drop',
            count: passenger.seats || 1,
            name,
            isLive: false,
            title: `${name} - Drop off at ${passenger.drop || 'destination'}`,
            position: drop,
          });
        }
      }
    }
    return points;
  }

  private passengerPosition(passenger: FixedPassenger, kind: 'pickup' | 'drop'): { lat: number; lng: number } | null {
    if (kind === 'pickup') {
      // 1. Live walking / customer GPS location if available
      if (passenger.customer_lat != null && passenger.customer_lng != null &&
          Number.isFinite(Number(passenger.customer_lat)) && Number.isFinite(Number(passenger.customer_lng))) {
        return { lat: Number(passenger.customer_lat), lng: Number(passenger.customer_lng) };
      }
      // 2. Pickup stop coordinates
      if (passenger.board_lat != null && passenger.board_lng != null &&
          Number.isFinite(Number(passenger.board_lat)) && Number.isFinite(Number(passenger.board_lng))) {
        return { lat: Number(passenger.board_lat), lng: Number(passenger.board_lng) };
      }
      const stopId = passenger.board_stop_id;
      const stop = this.stops.find((item) => Number(item.id) === Number(stopId));
      return stop && this.hasStopCoords(stop) ? this.stopPosition(stop) : null;
    }

    // Drop position
    if (passenger.drop_lat != null && passenger.drop_lng != null &&
        Number.isFinite(Number(passenger.drop_lat)) && Number.isFinite(Number(passenger.drop_lng))) {
      return { lat: Number(passenger.drop_lat), lng: Number(passenger.drop_lng) };
    }
    const dropStopId = passenger.drop_stop_id;
    const dropStop = this.stops.find((item) => Number(item.id) === Number(dropStopId));
    return dropStop && this.hasStopCoords(dropStop) ? this.stopPosition(dropStop) : null;
  }

  private buildPassengerMarker(kind: 'pickup' | 'drop', count: number, name = 'Passenger', isLive = false): HTMLElement {
    return buildPassengerMarkerElement({ kind, count, name, isLive });
  }

  private buildStopMarker(stop: FixedStop): HTMLElement {
    const reachedSeq = Number(this.activeVehicle?.fixed_last_reached_stop_seq || 0);
    return buildStopMarkerElement({
      seq: stop.seq,
      isReached: Number(stop.seq || 0) <= reachedSeq,
    });
  }

  private buildDriverMarker(bearing: number): HTMLElement {
    return buildReusableCarMarkerElement({
      bearing,
      label: 'You (Car)',
    });
  }
}
