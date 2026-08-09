import { Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { FixedCustomerLocationService } from '../../core/fixed-customer-location.service';
import { GeolocationService } from '../../core/geolocation.service';
import { RealtimeService, TripLocationPayload } from '../../core/realtime.service';
import { PlacesService } from '../../core/places.service';
import { PaymentChoice } from '../../shared/payment-method-modal.component';

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
  path_polyline?: number[][] | null;
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
  trip_id?: number | null;
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
  driver?: string | null;
  driver_name?: string | null;
  vehicle_name?: string | null;
  vehicle_type_name?: string | null;
  vehicle_brand?: string | null;
  vehicle_model?: string | null;
  vehicle_color?: string | null;
  vehicle_reg_no?: string | null;
}

interface SeatHold {
  id: number;
  route_departure_id: number;
  seats: number;
  amount: number;
  original_amount?: number | null;
  discount_amount?: number | null;
  coupon_assignment_id?: number | null;
  status: string;
  expires_at: string | null;
}

interface FixedRazorpayOrder {
  hold: SeatHold;
  razorpay: { key_id: string; order_id: string; amount_paise: number; currency: string };
}

interface FixedCouponPreview {
  base_amount: number;
  discount: number;
  final_amount: number;
  coupon?: { assignment_id: number; title: string } | null;
}

declare const google: any;
declare const Razorpay: any;

interface TippingConfig {
  enabled: boolean;
  values: number[];
  in_percentage: boolean;
}

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
  route_departure_id?: number | null;
  trip_id?: number | null;
  seats: number;
  fare_amount: number | null;
  status: string;
  fixed_live_status?: FixedLiveStatus | null;
  payment_status: string | null;
  refund_status?: string | null;
  route_name?: string | null;
  board?: string | null;
  drop?: string | null;
  latest_driver_location?: { lat: number; lng: number; recorded_at?: string | null } | null;
  route?: { id: number; name: string; scope: string; mode: string } | null;
  route_departure?: { id: number; service_date: string | null; depart_at: string | null; announced_depart_at: string | null; status: string } | null;
  board_stop?: { id: number; name: string } | null;
  drop_stop?: { id: number; name: string } | null;
}

type Step = 'routes' | 'vehicles' | 'details' | 'seats' | 'review' | 'done';

interface SeatMapCell {
  row: number;
  col: number;
  kind: 'seat' | 'blocked' | 'aisle';
  label: string | null;
  category: string | null;
  price_delta: number;
  status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'BLOCKED' | 'AISLE';
}
interface SeatMapResponse {
  departure: { id: number; route_id: number; status: string };
  layout: { id: number; name: string; rows: number; cols: number };
  cells: SeatMapCell[];
}
type FixedScopeFilter = 'all' | 'local' | 'outstation';

@Component({
  selector: 'app-fixed-book',
  templateUrl: './fixed-book.page.html',
  styleUrls: ['./fixed-book.page.scss'],
  standalone: false,
})
export class FixedBookPage implements OnInit, OnDestroy {
  cityId: number | null = null;
  scope: 'local' | 'outstation' | '' = '';
  routeFilter: FixedScopeFilter = 'all';
  routeSearch = '';
  step: Step = 'routes';

  loading = false;
  booking = false;
  error: string | null = null;
  locationWarning: string | null = null;

  routes: FixedRoute[] = [];
  departures: FixedDeparture[] = [];
  selectedRoute: FixedRoute | null = null;
  selectedDeparture: FixedDeparture | null = null;

  boardStopId: number | null = null;
  dropStopId: number | null = null;
  seats = 1;
  extraLuggageCount = 0;

  // Seat picker (M5) — replaces the counter with a real per-seat picker.
  seatMap: SeatMapResponse | null = null;
  selectedLabels: string[] = [];
  loadingSeatMap = false;
  seatMapError: string | null = null;
  couponTitle = '';
  couponPreview: FixedCouponPreview | null = null;
  couponMessage: string | null = null;
  couponError: string | null = null;
  applyingCoupon = false;
  hold: SeatHold | null = null;
  /** Shared payment-method sheet (Online / GPay / Cash) shown before booking. */
  paymentModalOpen = false;
  confirmation: FixedReservation | null = null;
  activeBookings: FixedReservation[] = [];
  liveTrackingActive = false;
  tipping: TippingConfig | null = null;
  selectedTipPreset: number | null = null;

  snappedStopInfo: { stopName: string; distanceMeters: number; kind: 'pickup' | 'drop' } | null = null;

  private entered = false;
  private unsubscribeFixedCity: (() => void) | null = null;
  private fixedMap: any = null;
  private fixedMapMarker: any = null;
  private fixedVehicleMarker: any = null;
  private fixedRouteLine: any = null;
  private fixedStopMarkers: any[] = [];
  private fixedSelectionLines: any[] = [];
  private fixedVehiclePosition: { lat: number; lng: number } | null = null;
  private trackingTripId: number | null = null;
  private unsubscribeTracking: (() => void) | null = null;
  private locationSub?: Subscription;
  private routeSearchTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private auth: AuthService,
    private toast: ToastController,
    private fixedLocation: FixedCustomerLocationService,
    private geo: GeolocationService,
    private realtime: RealtimeService,
    private places: PlacesService,
    private zone: NgZone,
  ) {}

  ngOnInit(): void {
    this.locationSub = this.fixedLocation.state$.subscribe((state) => {
      this.locationWarning = state.degraded ? state.message : null;
    });
    this.loadTippingConfig();
    this.enter();
  }

  private loadTippingConfig(): void {
    this.api.get<TippingConfig>('/operator/tipping').subscribe({
      next: (cfg) => { this.tipping = cfg.enabled ? cfg : null; },
      error: () => { this.tipping = null; },
    });
  }
  ngOnDestroy(): void {
    this.unsubscribeFixedCity?.();
    this.unsubscribeFixedCity = null;
    this.stopLiveTracking();
    if (this.routeSearchTimer) clearTimeout(this.routeSearchTimer);
    this.routeSearchTimer = undefined;
    this.locationSub?.unsubscribe();
    this.locationSub = undefined;
  }

  ionViewWillLeave(): void {}

  ionViewDidEnter(): void {
    void this.initFixedMap();
  }

  ionViewWillEnter(): void {
    if (this.entered) this.enter();
    this.entered = true;
  }

  get title(): string {
    if (this.routeFilter === 'outstation') return 'Outstation fixed';
    if (this.routeFilter === 'local') return 'Local fixed';
    return 'Fixed routes';
  }

  get scopeLabel(): string {
    if (this.routeFilter === 'outstation') return 'Outstation';
    if (this.routeFilter === 'local') return 'Local';
    return 'All';
  }

  get visibleRoutes(): FixedRoute[] {
    const term = this.routeSearch.trim().toLowerCase();
    return this.routes.filter((route) => {
      if (this.routeFilter !== 'all' && route.scope !== this.routeFilter) return false;
      if (!term) return true;
      return [
        route.name,
        route.origin_name,
        route.dest_name,
        ...(route.stops || []).map((stop) => stop.name),
      ].some((value) => (value || '').toLowerCase().includes(term));
    });
  }

  get localRouteCount(): number {
    return this.routes.filter((route) => route.scope === 'local').length;
  }

  get outstationRouteCount(): number {
    return this.routes.filter((route) => route.scope === 'outstation').length;
  }

  get pickupStops(): FixedStop[] {
    const firstSeq = this.selectedDeparture?.first_bookable_stop_seq ?? 1;
    return (this.selectedRoute?.stops || []).filter((s) => s.is_active && !s.is_temporarily_unavailable && s.is_pickup && s.seq >= firstSeq);
  }

  get dropStops(): FixedStop[] {
    const boardSeq = this.selectedRoute?.stops.find((s) => s.id === this.boardStopId)?.seq ?? 0;
    return (this.selectedRoute?.stops || []).filter((s) => s.is_active && !s.is_temporarily_unavailable && s.is_drop && s.seq > boardSeq);
  }

  get maxSeats(): number {
    const routeMax = this.selectedRoute?.max_seats_per_booking ?? 4;
    const remaining = this.selectedDeparture?.seats_remaining ?? routeMax;
    return Math.max(0, Math.min(routeMax, remaining));
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
    const seatCount = Math.max(1, this.selectedLabels.length || this.seats);
    const seatDeltas = this.selectedLabels
      .map((lbl) => (this.seatMap?.cells.find((c) => c.label === lbl)?.price_delta ?? 0))
      .reduce((a, b) => a + b, 0);
    return (fare * seatCount) + seatDeltas + luggage;
  }

  get tipAmount(): number {
    if (!this.tipping || this.selectedTipPreset == null) return 0;
    if (this.tipping.in_percentage) {
      const baseFare = (this.selectedRoute?.flat_fare || 0) * (this.selectedLabels.length || this.seats);
      return Math.max(1, Math.round((baseFare * this.selectedTipPreset) / 100));
    }
    return this.selectedTipPreset;
  }

  get payableTotal(): number {
    return (this.couponPreview?.final_amount ?? this.fareTotal) + this.tipAmount;
  }

  pickTipPreset(val: number): void {
    if (this.selectedTipPreset === val) {
      this.selectedTipPreset = null;
    } else {
      this.selectedTipPreset = val;
    }
  }

  tipPresetLabel(val: number): string {
    return this.tipping?.in_percentage ? `${val}%` : `₹${val}`;
  }

  get discountTotal(): number {
    return this.couponPreview?.discount ?? 0;
  }

  get luggageTotal(): number {
    return this.extraLuggageCount * (this.selectedRoute?.luggage_surcharge_amount ?? 0);
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
    if (this.maxSeats < 1) return 'No seats are available for this vehicle.';
    if (this.selectedLabels.length < 1) return 'Pick at least one seat.';
    if (this.selectedLabels.length > this.maxSeats) return 'You can pick up to ' + this.maxSeats + ' seat' + (this.maxSeats > 1 ? 's' : '') + '.';
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

  private async initFixedMap(): Promise<void> {
    if (this.fixedMap) return;

    try {
      await this.places.ensureLoaded();
      const el = document.getElementById('fixed-route-map');
      if (!el) return;

      const start = (await this.geo.getCurrentPosition()) ?? { lat: 28.6139, lng: 77.209 };
      this.fixedMap = new google.maps.Map(el, {
        center: start,
        zoom: 15,
        disableDefaultUI: true,
        clickableIcons: false,
        mapId: 'DEMO_MAP_ID',
      });

      this.fixedMapMarker = new google.maps.marker.AdvancedMarkerElement({
        position: start,
        map: this.fixedMap,
        title: 'You',
        content: this.buildMapDot(),
        zIndex: 2,
      });

      if (this.selectedRoute) this.drawRouteOnMap(this.selectedRoute);
      this.syncLiveVehicleTracking();
    } catch {
      this.fixedMap = null;
      this.fixedMapMarker = null;
    }
  }

  private drawRouteOnMap(route: FixedRoute): void {
    if (!this.fixedMap || typeof google === 'undefined') return;

    this.clearRouteFromMap();
    const path = this.routeMapPath(route);
    if (path.length < 2) return;

    this.fixedRouteLine = new google.maps.Polyline({
      path,
      map: this.fixedMap,
      geodesic: true,
      strokeColor: '#1e6cf0',
      strokeOpacity: 0.96,
      strokeWeight: 5,
    });

    const bounds = new google.maps.LatLngBounds();
    path.forEach((point) => bounds.extend(point));
    this.fixedMap.fitBounds(bounds, this.routeFitPadding());
    if (this.step === 'details') this.renderStopsOnMap();
    this.ensureVehicleMarker();
  }

  private routeFitPadding(): { top: number; right: number; bottom: number; left: number } {
    const mapHeight = Math.max(1, document.getElementById('fixed-route-map')?.getBoundingClientRect().height || window.innerHeight || 1);
    const sheetHeight = document.querySelector<HTMLElement>('.bottom-sheet')?.getBoundingClientRect().height || 0;
    const topbarHeight = document.querySelector<HTMLElement>('.fb-topbar')?.getBoundingClientRect().height || 0;

    return {
      top: Math.round(topbarHeight + 28),
      right: 28,
      bottom: Math.min(Math.round(sheetHeight + 32), Math.round(mapHeight * 0.62)),
      left: 28,
    };
  }

  private clearRouteFromMap(): void {
    this.clearStopMarkers();
    if (this.fixedRouteLine) {
      this.fixedRouteLine.setMap(null);
      this.fixedRouteLine = null;
    }
  }

  private bookableRouteStops(route: FixedRoute): FixedStop[] {
    return [...(route.stops || [])].filter((stop) => stop.is_active && !stop.is_temporarily_unavailable);
  }

  private routeMapPath(route: FixedRoute): { lat: number; lng: number }[] {
    const configured = Array.isArray(route.path_polyline)
      ? route.path_polyline
          .map((point) => ({ lat: Number(point?.[0]), lng: Number(point?.[1]) }))
          .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
      : [];

    if (configured.length >= 2) return configured;

    const stops = this.bookableRouteStops(route)
      .sort((a, b) => a.seq - b.seq)
      .map((stop) => ({ lat: Number(stop.lat), lng: Number(stop.lng) }))
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

    return [
      { lat: Number(route.origin_lat), lng: Number(route.origin_lng) },
      ...stops,
      { lat: Number(route.dest_lat), lng: Number(route.dest_lng) },
    ].filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  }

  private renderStopsOnMap(): void {
    if (!this.fixedMap || !this.selectedRoute || typeof google === 'undefined') return;

    this.clearStopMarkers();
    const stops = this.bookableRouteStops(this.selectedRoute)
      .filter((stop) => Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lng)))
      .sort((a, b) => a.seq - b.seq);

    this.fixedStopMarkers = stops.map((stop) => new google.maps.marker.AdvancedMarkerElement({
      position: { lat: Number(stop.lat), lng: Number(stop.lng) },
      map: this.fixedMap,
      title: stop.name,
      content: this.buildStopMarker(stop),
      zIndex: this.stopMarkerZIndex(stop),
    }));

    this.drawSelectedStopSegments();
  }

  private drawSelectedStopSegments(): void {
    if (!this.fixedMap || !this.selectedRoute || typeof google === 'undefined') return;

    this.clearSelectionLines();
    const board = this.stopById(this.boardStopId);
    const drop = this.stopById(this.dropStopId);

    if (board) {
      const boardPath = this.segmentPathToStop(board);
      if (boardPath.length >= 2) this.fixedSelectionLines.push(new google.maps.Polyline({
        path: boardPath,
        map: this.fixedMap,
        geodesic: true,
        strokeColor: '#12B35B',
        strokeOpacity: 0.98,
        strokeWeight: 6,
        zIndex: 4,
      }));
    }

    if (drop) {
      const dropPath = board ? this.segmentPathBetweenStops(board, drop) : this.segmentPathToStop(drop);
      if (dropPath.length >= 2) this.fixedSelectionLines.push(new google.maps.Polyline({
        path: dropPath,
        map: this.fixedMap,
        geodesic: true,
        strokeColor: '#F59E0B',
        strokeOpacity: 0.98,
        strokeWeight: 6,
        zIndex: 5,
      }));
    }
  }

  private refreshStopMapSelection(): void {
    if (this.step !== 'details') return;
    this.renderStopsOnMap();
  }

  private buildStopMarker(stop: FixedStop): HTMLElement {
    const marker = document.createElement('div');
    marker.className = 'fb-stop-marker';
    if (stop.id === this.boardStopId) marker.classList.add('is-pickup');
    if (stop.id === this.dropStopId) marker.classList.add('is-drop');
    const label = document.createElement('span');
    label.textContent = stop.id === this.boardStopId ? 'P' : stop.id === this.dropStopId ? 'D' : String(stop.seq);
    marker.appendChild(label);

    marker.addEventListener('click', (e: Event) => {
      e.stopPropagation();
      this.zone.run(() => this.onStopMarkerClick(stop));
    });

    return marker;
  }

  snapMapClickToNearestStop(lat: number, lng: number): void {
    if (!this.selectedRoute || this.step !== 'details') return;

    const isPickupMode = !this.boardStopId || (!this.dropStopId && this.pickupStops.length > 0);
    const targetStops = isPickupMode ? this.pickupStops : this.dropStops;

    if (!targetStops.length) {
      this.showToast('No available stops to select.');
      return;
    }

    let minDistance = Infinity;
    let nearestStop: FixedStop | null = null;

    for (const stop of targetStops) {
      const dist = this.distanceMeters(lat, lng, Number(stop.lat), Number(stop.lng));
      if (dist < minDistance) {
        minDistance = dist;
        nearestStop = stop;
      }
    }

    if (nearestStop && minDistance < 10000) {
      const distRounded = Math.round(minDistance);
      if (isPickupMode) {
        this.boardStopId = nearestStop.id;
        this.onBoardStopChange();
        this.snappedStopInfo = { stopName: nearestStop.name, distanceMeters: distRounded, kind: 'pickup' };
        this.showToast(`Boarding stop set to "${nearestStop.name}" (snapped, ${distRounded}m away)`);
      } else {
        this.dropStopId = nearestStop.id;
        this.onDropStopChange();
        this.snappedStopInfo = { stopName: nearestStop.name, distanceMeters: distRounded, kind: 'drop' };
        this.showToast(`Drop stop set to "${nearestStop.name}" (snapped, ${distRounded}m away)`);
      }
      this.refreshStopMapSelection();
    } else {
      this.showToast('Clicked position is too far from any route stop.');
    }
  }

  onStopMarkerClick(stop: FixedStop): void {
    if (this.step !== 'details') return;

    const isAvailablePickup = this.pickupStops.some((s) => s.id === stop.id);
    const isAvailableDrop = this.dropStops.some((s) => s.id === stop.id);

    if (!this.boardStopId && isAvailablePickup) {
      this.boardStopId = stop.id;
      this.onBoardStopChange();
      this.snappedStopInfo = null;
      this.showToast(`Boarding stop selected: "${stop.name}"`);
    } else if (this.boardStopId && !this.dropStopId && isAvailableDrop) {
      this.dropStopId = stop.id;
      this.onDropStopChange();
      this.snappedStopInfo = null;
      this.showToast(`Drop stop selected: "${stop.name}"`);
    } else if (isAvailablePickup) {
      this.boardStopId = stop.id;
      this.onBoardStopChange();
      this.snappedStopInfo = null;
      this.showToast(`Boarding stop updated: "${stop.name}"`);
    } else if (isAvailableDrop) {
      this.dropStopId = stop.id;
      this.onDropStopChange();
      this.snappedStopInfo = null;
      this.showToast(`Drop stop updated: "${stop.name}"`);
    } else {
      this.showToast(`Stop "${stop.name}" is not available for selection.`);
    }
    this.refreshStopMapSelection();
  }

  private distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private stopMarkerZIndex(stop: FixedStop): number {
    if (stop.id === this.dropStopId) return 7;
    if (stop.id === this.boardStopId) return 6;
    return 3;
  }

  private stopById(id: number | null): FixedStop | null {
    if (!id || !this.selectedRoute) return null;
    return this.selectedRoute.stops.find((stop) => stop.id === id) || null;
  }

  private segmentPathToStop(stop: FixedStop): { lat: number; lng: number }[] {
    if (!this.selectedRoute) return [];
    const routePath = this.routeMapPath(this.selectedRoute);
    const stopPoint = { lat: Number(stop.lat), lng: Number(stop.lng) };
    const stopIndex = this.nearestPathIndex(routePath, stopPoint);
    if (stopIndex < 0) return [];
    return [...routePath.slice(0, stopIndex + 1), stopPoint];
  }

  private segmentPathBetweenStops(from: FixedStop, to: FixedStop): { lat: number; lng: number }[] {
    if (!this.selectedRoute) return [];
    const routePath = this.routeMapPath(this.selectedRoute);
    const fromPoint = { lat: Number(from.lat), lng: Number(from.lng) };
    const toPoint = { lat: Number(to.lat), lng: Number(to.lng) };
    const fromIndex = this.nearestPathIndex(routePath, fromPoint);
    const toIndex = this.nearestPathIndex(routePath, toPoint);
    if (fromIndex < 0 || toIndex < 0) return [];

    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    const middle = routePath.slice(start, end + 1);
    return fromIndex <= toIndex ? [fromPoint, ...middle, toPoint] : [fromPoint, ...middle.reverse(), toPoint];
  }

  private nearestPathIndex(path: { lat: number; lng: number }[], point: { lat: number; lng: number }): number {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    path.forEach((candidate, index) => {
      const distance = Math.pow(candidate.lat - point.lat, 2) + Math.pow(candidate.lng - point.lng, 2);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }

  private clearStopMarkers(): void {
    this.fixedStopMarkers.forEach((marker) => { marker.map = null; });
    this.fixedStopMarkers = [];
    this.clearSelectionLines();
  }

  private clearSelectionLines(): void {
    this.fixedSelectionLines.forEach((line) => line.setMap(null));
    this.fixedSelectionLines = [];
  }

  private buildMapDot(): HTMLElement {
    const dot = document.createElement('div');
    dot.className = 'fb-map-dot';
    return dot;
  }

  private buildVehicleMarker(): HTMLElement {
    const marker = document.createElement('div');
    marker.className = 'fb-vehicle-marker';
    return marker;
  }

  private enter(): void {
    const q = this.route.snapshot.queryParamMap;
    this.cityId = q.get('city_id') ? Number(q.get('city_id')) : null;
    const rawScope = q.get('scope') || '';
    this.scope = rawScope === 'outstation' ? 'outstation' : rawScope === 'local' ? 'local' : '';
    this.routeFilter = this.scope || 'all';
    this.subscribeFixedCatalog();
    this.step = 'routes';
    this.selectedRoute = null;
    this.clearRouteFromMap();
    this.selectedDeparture = null;
    this.departures = [];
    this.hold = null;
    this.confirmation = null;
    this.resetDetails();
    this.loadRoutes();
    this.loadMyBookings();
  }

  private subscribeFixedCatalog(): void {
    this.unsubscribeFixedCity?.();
    this.unsubscribeFixedCity = null;
    if (this.cityId == null) return;
    this.unsubscribeFixedCity = this.realtime.subscribeFixedCity(this.cityId, () => {
      this.refreshLiveFixedState();
    });
  }

  private refreshLiveFixedState(): void {
    this.loadRoutes(false);
    this.loadMyBookings();
    if (this.selectedRoute) this.loadDepartures(this.selectedRoute, false);
  }

  private reconcileSelectedRoute(rows: FixedRoute[]): void {
    if (!this.selectedRoute) return;

    const updated = rows.find((route) => route.id === this.selectedRoute?.id) ?? null;
    if (!updated) {
      this.selectedRoute = null;
      this.clearRouteFromMap();
      this.selectedDeparture = null;
      this.departures = [];
      this.resetDetails();
      this.step = 'routes';
      return;
    }

    this.selectedRoute = updated;
    this.drawRouteOnMap(updated);
    this.reconcileDetails();
  }

  private reconcileSelectedDeparture(): void {
    if (!this.selectedDeparture) return;

    const updated = this.departures.find((departure) => departure.id === this.selectedDeparture?.id) ?? null;
    if (!updated) {
      this.selectedDeparture = null;
      this.resetDetails();
      if (this.step === 'details') this.step = 'vehicles';
      return;
    }

    this.selectedDeparture = updated;
    this.reconcileDetails();
  }

  private reconcileDetails(): void {
    if (!this.selectedRoute) return;

    if (!this.pickupStops.some((stop) => stop.id === this.boardStopId)) {
      this.boardStopId = null;
      this.dropStopId = null;
    } else if (!this.dropStops.some((stop) => stop.id === this.dropStopId)) {
      this.dropStopId = null;
    }

    if (this.maxSeats < 1) {
      this.seats = 1;
    } else {
      this.seats = Math.max(1, Math.min(this.seats, this.maxSeats));
    }
    this.setExtraLuggage(this.extraLuggageCount);
  }

  onRouteSearchInput(): void {
    if (this.routeSearchTimer) clearTimeout(this.routeSearchTimer);
    this.routeSearchTimer = setTimeout(() => this.loadRoutes(false), 300);
  }

  loadRoutes(showSpinner = true): void {
    if (showSpinner) this.loading = true;
    this.error = null;
    const params = new URLSearchParams({ limit: '100' });
    const search = this.routeSearch.trim();
    if (search.length >= 2) params.set('q', search);
    this.api.get<{ data: FixedRoute[] }>("/fixed/routes?" + params.toString()).subscribe({
      next: (res) => {
        const rows = res?.data || [];
        this.routes = rows;
        this.reconcileSelectedRoute(this.visibleRoutes);
        if (showSpinner) this.loading = false;
      },
      error: (err) => {
        this.routes = [];
        if (showSpinner) this.loading = false;
        this.error = err?.status === 401
          ? 'Please login again on this local app.'
          : 'Could not load fixed routes.';
      },
    });
  }


  loadMyBookings(): void {
    this.api.get<{ data: FixedReservation[] }>("/fixed/bookings").subscribe({
      next: (res) => {
        const rows = res?.data || [];
        this.activeBookings = rows.filter((booking) => !["DROPPED", "COMPLETED", "CANCELLED", "NO_SHOW"].includes(booking.status)).slice(0, 5);
        this.syncFixedLocationStream();
        this.syncLiveVehicleTracking();
      },
      error: () => {
        this.activeBookings = [];
        this.syncFixedLocationStream();
        this.syncLiveVehicleTracking();
      },
    });
  }

  setRouteFilter(filter: FixedScopeFilter): void {
    if (this.routeFilter === filter) return;
    this.routeFilter = filter;
    this.reconcileSelectedRoute(this.visibleRoutes);
  }

  routeScopeLabel(route: FixedRoute): string {
    return route.scope === 'outstation' ? 'Outstation' : 'Local';
  }

  routeScopeIcon(route: FixedRoute): string {
    return route.scope === 'outstation' ? 'navigate-outline' : 'location-outline';
  }

  pickRoute(route: FixedRoute): void {
    this.selectedRoute = route;
    this.selectedDeparture = null;
    this.departures = [];
    this.resetDetails();
    this.step = 'vehicles';
    this.stopLiveTracking();
    requestAnimationFrame(() => this.drawRouteOnMap(route));
    this.loadDepartures(route);
  }

  loadDepartures(route: FixedRoute, showSpinner = true): void {
    if (showSpinner) this.loading = true;
    this.api.get<{ data: FixedDeparture[] }>(`/fixed/routes/${route.id}/departures`).subscribe({
      next: (res) => {
        this.departures = res?.data || [];
        this.reconcileSelectedDeparture();
        if (showSpinner) this.loading = false;
      },
      error: () => {
        this.departures = [];
        this.reconcileSelectedDeparture();
        if (showSpinner) this.loading = false;
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
    this.syncLiveVehicleTracking();
    requestAnimationFrame(() => {
      if (this.selectedRoute) this.drawRouteOnMap(this.selectedRoute);
      else this.renderStopsOnMap();
    });
  }


  onBoardStopChange(): void {
    if (!this.dropStops.some((stop) => stop.id === this.dropStopId)) {
      this.dropStopId = null;
    }
    this.clearCouponPreview();
    this.refreshStopMapSelection();
  }

  onDropStopChange(): void {
    this.clearCouponPreview();
    this.refreshStopMapSelection();
  }

  setSeats(next: number): void {
    this.seats = Math.max(1, Math.min(this.maxSeats, next));
    this.clearCouponPreview();
  }

  setExtraLuggage(next: number): void {
    this.extraLuggageCount = Math.max(0, Math.min(this.maxLuggage, next));
    this.clearCouponPreview();
  }

  /** Details step Continue → move to the seat picker and fetch the map. */
  proceedToPicker(): void {
    if (!this.selectedDeparture || !this.boardStopId || !this.dropStopId) return;
    this.step = 'seats';
    this.loadSeatMap();
  }

  loadSeatMap(): void {
    if (!this.selectedDeparture) return;
    this.loadingSeatMap = true;
    this.seatMapError = null;
    this.api.get<SeatMapResponse>(`/fixed/departures/${this.selectedDeparture.id}/seat-map`).subscribe({
      next: (res) => {
        this.seatMap = res;
        this.loadingSeatMap = false;
        // Drop any labels that are no longer available (someone else grabbed them).
        this.selectedLabels = this.selectedLabels.filter((lbl) =>
          res.cells.some((c) => c.label === lbl && c.status === 'AVAILABLE'),
        );
      },
      error: (err) => {
        this.loadingSeatMap = false;
        this.seatMapError = err?.error?.message || 'Could not load seat map.';
      },
    });
  }

  toggleSeat(label: string): void {
    const i = this.selectedLabels.indexOf(label);
    if (i >= 0) {
      this.selectedLabels = this.selectedLabels.filter((_, idx) => idx !== i);
    } else {
      if (this.selectedLabels.length >= this.maxSeats) {
        void this.showToast(`You can pick up to ${this.maxSeats} seat${this.maxSeats > 1 ? 's' : ''}.`);
        return;
      }
      this.selectedLabels = [...this.selectedLabels, label];
    }
    // Keep this.seats in sync so any read-only bindings show the right count.
    this.seats = Math.max(1, this.selectedLabels.length);
    this.clearCouponPreview();
  }

  /** Seat picker Continue → move to review (no hold yet; hold is created on Confirm & pay). */
  reviewBooking(): void {
    if (this.step !== 'seats' || this.selectedLabels.length < 1) return;
    this.seats = this.selectedLabels.length;
    this.step = 'review';
  }

  applyCoupon(): void {
    if (!this.selectedDeparture || !this.couponTitle.trim() || this.applyingCoupon) return;
    this.applyingCoupon = true;
    this.couponError = null;
    this.couponMessage = null;
    this.api.post<FixedCouponPreview>('/fixed/coupon-preview', this.bookingPayload(true)).subscribe({
      next: (res) => {
        this.applyingCoupon = false;
        this.couponPreview = res;
        this.couponMessage = res?.coupon?.title ? `${res.coupon.title} applied` : 'Coupon applied';
      },
      error: (err) => {
        this.applyingCoupon = false;
        this.couponPreview = null;
        this.couponError = err?.error?.message || err?.error?.error || 'Coupon could not be applied.';
      },
    });
  }

  removeCoupon(): void {
    this.couponTitle = '';
    this.clearCouponPreview();
  }

  testPay(): void {
    this.confirm(true);
  }

  confirm(testPayment = false): void {
    if (!this.canConfirm || !this.selectedDeparture) return;
    // The dev/test path skips the chooser and pays online in full.
    if (testPayment) {
      this.createHoldAndPay('online', true);
      return;
    }
    // Real bookings pick a method first (Online / GPay / Cash).
    this.paymentModalOpen = true;
  }

  /** Chosen from the shared payment sheet — hold the seats tagged with the
   *  method (cash charges only the deposit online), then run its payment. */
  onFixedPayMethod(method: PaymentChoice): void {
    this.paymentModalOpen = false;
    this.createHoldAndPay(method, false);
  }

  private createHoldAndPay(method: PaymentChoice, testPayment: boolean): void {
    if (!this.canConfirm || !this.selectedDeparture) return;
    this.booking = true;
    this.hold = null;
    const payload = {
      ...this.bookingPayload(false),
      payment_method: method === 'cash' ? 'cash' : 'razorpay',
    };
    this.api.post<{ hold: SeatHold }>('/fixed/seat-holds', payload, { 'Idempotency-Key': this.uuid() }).subscribe({
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
          void this.startRazorpayPayment(this.hold, method);
        }
      },
      error: async (err) => {
        this.booking = false;
        await this.showToast(err?.error?.message || 'Could not hold seats. Please try again.');
      },
    });
  }

  private async startRazorpayPayment(hold: SeatHold, method: PaymentChoice = 'online'): Promise<void> {
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
        // GPay → open Razorpay straight on UPI (still lets the user switch).
        ...(method === 'gpay' ? { method: 'upi' } : {}),
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
          this.releaseCurrentHold();
          await this.showToast('Payment cancelled. Your seat hold has been released.');
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
        this.loadMyBookings();
        this.openConfirmedFixedRide();
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
        this.loadMyBookings();
        this.openConfirmedFixedRide();
      },
      error: async (err) => {
        this.booking = false;
        await this.showToast(err?.error?.message || 'Payment confirmation failed. Your hold will expire automatically.');
      },
    });
  }

  back(): void {
    if (this.step === 'done') {
      this.router.navigateByUrl('/customer-tabs/fixed-rides');
      return;
    }
    if (this.step === 'review') {
      // If a hold was created for this review (payment aborted before the sheet),
      // release it so the seat immediately frees up for other customers.
      this.releaseCurrentHold();
      this.step = 'seats';
      return;
    }
    if (this.step === 'seats') {
      this.selectedLabels = [];
      this.seatMap = null;
      this.step = 'details';
      return;
    }
    if (this.step === 'details') {
      this.step = 'vehicles';
      this.clearStopMarkers();
      this.hold = null;
      this.selectedLabels = [];
      this.seatMap = null;
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
    this.router.navigateByUrl('/customer-tabs/go');
  }

  done(): void {
    this.openConfirmedFixedRide();
  }

  private openConfirmedFixedRide(): void {
    const id = this.confirmation?.id;
    this.router.navigateByUrl(id ? '/customer-tabs/fixed-rides/' + id : '/customer-tabs/fixed-rides?active=1');
  }

  departureVehicleName(dep: FixedDeparture | null): string {
    if (!dep) return 'Vehicle';
    const parts = [dep.vehicle_brand, dep.vehicle_name || dep.vehicle_type_name]
      .map((value) => (value || '').trim())
      .filter(Boolean);
    return parts.length ? [...new Set(parts)].join(' ') : 'Vehicle';
  }

  departureDriverName(dep: FixedDeparture | null): string {
    return dep?.driver_name || dep?.driver || 'Driver assigned';
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


  private syncFixedLocationStream(): void {
    const shouldStream = this.activeBookings.some((booking) => ['BOOKED', 'CONFIRMED'].includes((booking.status || '').toUpperCase()));
    if (shouldStream) void this.fixedLocation.start();
    else void this.fixedLocation.stop();
  }

  private syncLiveVehicleTracking(): void {
    const booking = this.currentMapBooking();
    const tripId = booking?.trip_id || null;
    this.seedVehicleLocation(booking || null);

    if (!tripId || !this.isLiveTrackingStatus(booking?.status || '')) {
      this.stopLiveTracking(false);
      return;
    }

    if (this.trackingTripId === tripId && this.unsubscribeTracking) {
      this.ensureVehicleMarker();
      return;
    }

    this.stopLiveTracking(false);
    this.trackingTripId = tripId;
    this.liveTrackingActive = true;
    this.unsubscribeTracking = this.realtime.subscribeTracking(
      tripId,
      (payload) => this.onTripLocation(payload),
      () => {},
    );
  }

  private currentMapBooking(): FixedReservation | null {
    if (this.confirmation) {
      const confirmed = this.activeBookings.find((booking) => booking.id === this.confirmation?.id);
      return confirmed || this.confirmation;
    }

    if (this.selectedDeparture) {
      return this.activeBookings.find((booking) => booking.route_departure_id === this.selectedDeparture?.id) || null;
    }

    if (this.activeBookings.length === 1) return this.activeBookings[0];
    return null;
  }

  private seedVehicleLocation(booking: FixedReservation | null): void {
    const latest = booking?.latest_driver_location;
    if (!latest || latest.lat == null || latest.lng == null) return;
    this.fixedVehiclePosition = { lat: Number(latest.lat), lng: Number(latest.lng) };
    this.ensureVehicleMarker();
  }

  private onTripLocation(payload: TripLocationPayload): void {
    const loc = payload?.location;
    if (!loc || loc.lat == null || loc.lng == null) return;
    this.zone.run(() => {
      this.fixedVehiclePosition = { lat: Number(loc.lat), lng: Number(loc.lng) };
      this.ensureVehicleMarker();
    });
  }

  private ensureVehicleMarker(): void {
    if (!this.fixedMap || !this.fixedVehiclePosition || typeof google === 'undefined') return;
    if (!this.fixedVehicleMarker) {
      this.fixedVehicleMarker = new google.maps.marker.AdvancedMarkerElement({
        position: this.fixedVehiclePosition,
        map: this.fixedMap,
        title: this.departureDriverName(this.selectedDeparture),
        content: this.buildVehicleMarker(),
        zIndex: 10,
      });
      return;
    }

    this.fixedVehicleMarker.position = this.fixedVehiclePosition;
    this.fixedVehicleMarker.map = this.fixedMap;
  }

  private isLiveTrackingStatus(status: string): boolean {
    return ['BOOKED', 'CONFIRMED', 'BOARDED', 'BOARDING', 'DISPATCHED', 'DEPARTED', 'IN_PROGRESS'].includes((status || '').toUpperCase());
  }

  private stopLiveTracking(clearMarker = true): void {
    if (this.unsubscribeTracking) this.unsubscribeTracking();
    this.unsubscribeTracking = null;
    this.trackingTripId = null;
    this.liveTrackingActive = false;
    if (clearMarker) {
      if (this.fixedVehicleMarker) this.fixedVehicleMarker.map = null;
      this.fixedVehicleMarker = null;
      this.fixedVehiclePosition = null;
    }
  }

  private resetDetails(): void {
    this.boardStopId = null;
    this.dropStopId = null;
    this.seats = 1;
    this.extraLuggageCount = 0;
    this.seatMap = null;
    this.selectedLabels = [];
    this.seatMapError = null;
    this.removeCoupon();
  }

  /** Fire-and-forget release when the user bails after the hold is created. */
  private releaseCurrentHold(): void {
    if (!this.hold) return;
    const holdId = this.hold.id;
    this.hold = null;
    this.api.post(`/fixed/seat-holds/${holdId}/release`, {}).subscribe({
      next: () => {},
      error: () => {},
    });
  }

  onHoldExpired(): void {
    this.hold = null;
    void this.showToast('Your seat hold expired. Please pick your seats again.');
    this.step = 'seats';
    this.loadSeatMap();
  }

  clearCouponPreview(): void {
    this.couponPreview = null;
    this.couponMessage = null;
    this.couponError = null;
  }

  private bookingPayload(requireCoupon: boolean): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      route_departure_id: this.selectedDeparture?.id,
      board_stop_id: this.boardStopId,
      drop_stop_id: this.dropStopId,
      seat_labels: this.selectedLabels,
      seats: this.selectedLabels.length || this.seats,
      has_extra_luggage: this.extraLuggageCount > 0,
      extra_luggage_count: this.extraLuggageCount,
      tip_amount: this.tipAmount,
    };
    const coupon = this.couponTitle.trim();
    if (coupon || requireCoupon) payload['coupon_title'] = coupon;
    return payload;
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
