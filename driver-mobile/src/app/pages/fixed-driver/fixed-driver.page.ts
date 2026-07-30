import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { interval, Subscription } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import { BackgroundLocationService } from '../../core/background-location.service';
import { GeolocationService } from '../../core/geolocation.service';
import { RealtimeService } from '../../core/realtime.service';


interface FixedRoute {
  id: number;
  city_id: number;
  name: string;
  scope: 'local' | 'outstation';
  origin_name: string;
  dest_name: string;
  flat_fare: number | null;
  max_seats_per_booking: number;
  max_luggage_per_vehicle: number;
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

interface FixedPassenger {
  id: number;
  customer_name: string | null;
  customer_phone: string | null;
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

interface ManifestResponse {
  departure: FixedVehicle;
  passengers: FixedPassenger[];
  stops?: FixedStop[];
}

@Component({
  selector: 'app-fixed-driver',
  templateUrl: './fixed-driver.page.html',
  styleUrls: ['./fixed-driver.page.scss'],
  standalone: false,
})
export class FixedDriverPage {
  loading = false;
  busy = false;
  error: string | null = null;
  message: string | null = null;

  routes: FixedRoute[] = [];
  vehicles: FixedVehicle[] = [];
  selectedRouteId: number | null = null;
  capacity = 4;

  // Seat layouts (M6): fetched per selected route; driver picks which one to
  // open the vehicle with. Capacity derives from the layout's seat_count so
  // the seat map and the "seats total" counter can never disagree.
  layouts: SeatLayout[] = [];
  selectedLayoutId: number | null = null;
  layoutsLoading = false;

  activeVehicle: FixedVehicle | null = null;
  passengers: FixedPassenger[] = [];
  stops: FixedStop[] = [];
  fixedLocationStreaming = false;
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
  }

  private subscribeFixedCatalog(): void {
    this.unsubscribeFixedCatalog?.();
    this.unsubscribeFixedCatalog = this.realtime.subscribeFixedCatalog(() => this.refresh());
  }

  refresh(): void {
    this.loading = true;
    this.error = null;
    this.message = null;
    let pending = 2;
    const done = () => {
      pending -= 1;
      if (pending === 0) this.loading = false;
    };

    this.api.get<{ data: FixedRoute[] }>('/fixed/driver/routes').subscribe({
      next: (res) => {
        this.routes = res.data ?? [];
        if (!this.selectedRouteId && this.routes.length) this.selectedRouteId = this.routes[0].id;
        this.syncCapacity();
      },
      error: (err) => this.error = err?.error?.message || 'Could not load fixed routes.',
      complete: done,
    });

    this.api.get<{ data: FixedVehicle[] }>('/fixed/driver/vehicles').subscribe({
      next: (res) => {
        this.vehicles = res.data ?? [];
        this.activeVehicle = this.pickActiveVehicle();
        if (this.activeVehicle) {
          this.loadManifest(this.activeVehicle.id, false);
          this.startManifestPolling();
          void this.syncFixedTripLocationStreaming();
        } else {
          this.stopManifestPolling();
          void this.stopFixedTripLocationStreaming();
        }
      },
      error: (err) => this.error = err?.error?.message || 'Could not load fixed vehicles.',
      complete: done,
    });
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
    else this.capacity = Number(this.selectedRoute?.max_seats_per_booking ?? 1);
  }

  openVehicle(): void {
    if (!this.selectedRouteId) {
      this.error = 'Select a fixed route first.';
      return;
    }
    if (!this.selectedLayoutId) {
      this.error = 'Pick a seat layout for this vehicle.';
      return;
    }

    this.busy = true;
    this.error = null;
    this.api.post<{ vehicle: FixedVehicle; message: string }>('/fixed/driver/vehicles', {
      route_id: this.selectedRouteId,
      vehicle_seat_layout_id: this.selectedLayoutId,
    }).pipe(finalize(() => this.busy = false)).subscribe({
      next: (res) => {
        this.message = res.message || 'Fixed vehicle opened.';
        this.activeVehicle = res.vehicle;
        this.refresh();
      },
      error: (err) => this.error = err?.error?.message || 'Could not open fixed vehicle.',
    });
  }

  async closeBookings(): Promise<void> {
    if (!this.activeVehicle || !this.canCloseVehicle(this.activeVehicle)) return;

    const alert = await this.alerts.create({
      header: 'Close fixed vehicle?',
      message: 'This removes the opened vehicle because no customer has booked yet.',
      buttons: [
        { text: 'Keep open', role: 'cancel' },
        { text: 'Close vehicle', role: 'confirm' },
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
          await this.showToast(res.message || 'Fixed vehicle closed.');
          this.refresh();
        },
        error: (err) => {
          this.error = this.apiErrorMessage(err, 'Could not close fixed vehicle.');
          if (this.activeVehicle) this.loadManifest(this.activeVehicle.id, false);
        },
      });
  }

  loadManifest(vehicleId: number, showSpinner = true): void {
    if (showSpinner) this.busy = true;
    this.api.get<ManifestResponse>(`/fixed/departures/${vehicleId}/manifest`)
      .pipe(finalize(() => this.busy = false))
      .subscribe({
        next: (res) => {
          this.activeVehicle = res.departure;
          this.passengers = res.passengers ?? [];
          this.stops = this.visibleManifestStops(res.stops ?? [], this.passengers);
          void this.syncFixedTripLocationStreaming();
        },
        error: (err) => this.error = err?.error?.message || 'Could not load passenger list.',
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
      { label: 'On vehicle', count: boarded },
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
      { label: 'On vehicle', count: boarded, tone: boarded > 0 ? 'block' : 'done' },
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

  vehicleRouteLine(vehicle: FixedVehicle | null): string {
    if (!vehicle) return '';
    if (vehicle.origin_name && vehicle.dest_name) return vehicle.origin_name + ' to ' + vehicle.dest_name;
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
    if (['COMPLETED', 'CANCELLED'].includes(vehicle.status)) return 'This fixed vehicle is already closed.';
    const active = this.passengers.filter((passenger) => ['BOOKED', 'CONFIRMED', 'BOARDED'].includes(passenger.status)).length;
    if (active > 0) {
      const parts = this.activePassengerSummary.map((item) => item.count + ' ' + item.label.toLowerCase());
      return 'Complete ride is locked: ' + (parts.length ? parts.join(', ') : active + ' active passenger(s)') + ' remain.';
    }
    return null;
  }

  canStart(vehicle: FixedVehicle | null): boolean {
    return !!vehicle && !['DEPARTED', 'COMPLETED', 'CANCELLED'].includes(vehicle.status);
  }

  canComplete(vehicle: FixedVehicle | null): boolean {
    return !!vehicle
      && !['COMPLETED', 'CANCELLED'].includes(vehicle.status)
      && !this.passengers.some((passenger) => ['BOOKED', 'CONFIRMED', 'BOARDED'].includes(passenger.status));
  }

  canCloseVehicle(vehicle: FixedVehicle | null): boolean {
    return !!vehicle
      && vehicle.status === 'FORMING'
      && (vehicle.seats_taken || 0) <= 0
      && (vehicle.active_hold_count || 0) <= 0
      && (vehicle.reservation_count || 0) <= 0
      && !this.passengers.length;
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

    this.manifestPoll = interval(8000).subscribe(() => {
      if (!this.activeVehicle || this.busy || this.loading) return;
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
}
