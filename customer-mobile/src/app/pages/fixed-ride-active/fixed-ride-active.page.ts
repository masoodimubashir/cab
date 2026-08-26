import { Component, ElementRef, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, Platform, ToastController } from '@ionic/angular';
import { Subscription, interval } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import {
  buildPassengerMarkerElement,
  buildReusableCarMarkerElement,
  buildStopMarkerElement,
  updateCarMarkerBearing,
} from '../../core/car-marker.helper';
import { FixedCustomerLocationService } from '../../core/fixed-customer-location.service';
import { GeoFix, GeolocationService } from '../../core/geolocation.service';
import { PlacesService } from '../../core/places.service';
import { RealtimeService, TripLocationPayload } from '../../core/realtime.service';

declare const google: any;

interface FixedLiveStatus {
  key: string;
  label: string;
  detail: string;
  tone: 'primary' | 'success' | 'warning' | 'danger' | 'medium' | string;
}

interface StopItem {
  id: number;
  seq: number;
  name: string;
  lat: number | null;
  lng: number | null;
  is_pickup?: boolean;
  is_drop?: boolean;
}

interface FixedBooking {
  id: number;
  route_name?: string | null;
  trip_id?: number | null;
  departure_status?: string | null;
  fixed_last_reached_stop_seq?: number | null;
  fixed_last_reached_stop_at?: string | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  vehicle_name?: string | null;
  vehicle_type_name?: string | null;
  vehicle_brand?: string | null;
  vehicle_model?: string | null;
  vehicle_color?: string | null;
  vehicle_reg_no?: string | null;
  board_lat?: number | null;
  board_lng?: number | null;
  drop_lat?: number | null;
  drop_lng?: number | null;
  seats: number;
  status: string;
  boarding_code?: string | null;
  fixed_live_status?: FixedLiveStatus | null;
  payment_method?: string | null;
  payment_status?: string | null;
  refund_status?: string | null;
  payment_reference?: string | null;
  fare_amount?: number | null;
  promo_discount_amount?: number | null;
  has_extra_luggage?: boolean;
  extra_luggage_count?: number;
  luggage_surcharge_amount?: number;
  board?: string | null;
  drop?: string | null;
  created_at?: string | null;
  announced_depart_at?: string | null;
  depart_at?: string | null;
  service_date?: string | null;
  rating_score?: number | null;
  rating_comment?: string | null;
  latest_driver_location?: { lat: number; lng: number; recorded_at?: string | null } | null;
  stops?: StopItem[];
}

@Component({
  selector: 'app-fixed-ride-active',
  templateUrl: './fixed-ride-active.page.html',
  styleUrls: ['./fixed-ride-active.page.scss'],
  standalone: false,
})
export class FixedRideActivePage implements OnDestroy {
  @ViewChild('fixedActiveMap', { static: false }) mapElRef?: ElementRef<HTMLDivElement>;

  loading = false;
  cancelling = false;
  submittingRating = false;
  ratingScore = 5;
  ratingComment = '';
  error: string | null = null;
  booking: FixedBooking | null = null;
  sheetExpanded = false;

  private map: any | null = null;
  private pickupMarker: any | null = null;
  private dropMarker: any | null = null;
  private userLiveMarker: any | null = null;
  private driverMarker: any | null = null;
  private stopMarkers: any[] = [];
  private routePolylines: any[] = [];
  private driverPosition: { lat: number; lng: number } | null = null;
  private driverBearing = 0;
  private userPosition: { lat: number; lng: number } | null = null;

  private pollSub?: Subscription;
  private backButtonSub?: Subscription;
  private watchId: string | null = null;
  private trackingTripId: number | null = null;
  private unsubscribeTracking: (() => void) | null = null;
  private readonly inactiveStatuses = new Set(['DROPPED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);

  constructor(
    private api: ApiService,
    private route: ActivatedRoute,
    private router: Router,
    private alerts: AlertController,
    private toasts: ToastController,
    private platform: Platform,
    private fixedLocation: FixedCustomerLocationService,
    private geo: GeolocationService,
    private places: PlacesService,
    private realtime: RealtimeService,
    private zone: NgZone,
  ) {}

  ionViewWillEnter(): void {
    this.load();
    this.pollSub ??= interval(5000).subscribe(() => this.silentReload());
    this.backButtonSub = this.platform.backButton.subscribeWithPriority(10, () => {
      this.back();
    });
    void this.startUserLocationWatch();
  }

  ionViewWillLeave(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = undefined;
    this.backButtonSub?.unsubscribe();
    this.backButtonSub = undefined;
    this.stopRealtimeTracking();
    void this.stopUserLocationWatch();
    if (!this.booking || !this.isActiveBooking(this.booking)) void this.fixedLocation.stop();
  }

  ngOnDestroy(): void {
    this.clearMap();
    this.stopRealtimeTracking();
    void this.stopUserLocationWatch();
  }

  load(): void {
    const bookingId = Number(this.route.snapshot.paramMap.get('bookingId') || 0);
    if (!bookingId) {
      this.error = 'Fixed booking not found.';
      return;
    }

    this.loading = true;
    this.error = null;
    this.api.get<{ booking: FixedBooking }>('/fixed/bookings/' + bookingId).subscribe({
      next: (res) => {
        this.booking = res?.booking || null;
        this.loading = false;
        if (!this.booking) {
          this.error = 'Fixed booking not found.';
        } else {
          this.initOrUpdateMap();
          this.syncRealtimeTracking();
        }
        this.syncFixedLocationStream();
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.message || 'Could not load fixed ride.';
        this.syncFixedLocationStream();
      },
    });
  }

  private silentReload(): void {
    if (this.loading || this.cancelling) return;
    if (this.booking && !this.isActiveBooking(this.booking)) return;
    const bookingId = Number(this.route.snapshot.paramMap.get('bookingId') || 0);
    if (!bookingId) return;

    this.api.get<{ booking: FixedBooking }>('/fixed/bookings/' + bookingId).subscribe({
      next: (res) => {
        if (res?.booking) {
          this.booking = res.booking;
          if (res.booking.latest_driver_location?.lat != null && res.booking.latest_driver_location?.lng != null) {
            this.driverPosition = {
              lat: Number(res.booking.latest_driver_location.lat),
              lng: Number(res.booking.latest_driver_location.lng),
            };
          }
          this.initOrUpdateMap();
          this.syncRealtimeTracking();
          this.syncFixedLocationStream();
        }
      },
      error: () => {},
    });
  }

  toggleSheet(): void {
    this.sheetExpanded = !this.sheetExpanded;
  }

  back(): void {
    this.router.navigateByUrl('/customer-tabs/go');
  }

  callDriver(): void {
    const phone = this.booking?.driver_phone;
    if (phone) {
      window.open('tel:' + phone, '_system');
    }
  }

  // ── Smart Route Corridor Naming ───────────────────────────────────────────
  get routeOriginName(): string {
    const name = this.booking?.route_name || '';
    if (!name) return this.booking?.board || 'Origin';
    if (name.includes('->')) return name.split('->')[0].trim();
    if (name.includes('→')) return name.split('→')[0].trim();
    if (name.toLowerCase().includes(' to ')) return name.split(/\s+to\s+/i)[0].trim();
    return this.booking?.board || name;
  }

  get routeDestName(): string {
    const name = this.booking?.route_name || '';
    if (!name) return this.booking?.drop || 'Destination';
    if (name.includes('->')) return name.split('->')[1]?.trim() || '';
    if (name.includes('→')) return name.split('→')[1]?.trim() || '';
    if (name.toLowerCase().includes(' to ')) return name.split(/\s+to\s+/i)[1]?.trim() || '';
    return this.booking?.drop || name;
  }

  // ── Map Lifecycle & Rendering ─────────────────────────────────────────────
  private async initOrUpdateMap(): Promise<void> {
    if (!this.booking) return;

    if (this.booking.latest_driver_location?.lat != null && this.booking.latest_driver_location?.lng != null) {
      this.driverPosition = {
        lat: Number(this.booking.latest_driver_location.lat),
        lng: Number(this.booking.latest_driver_location.lng),
      };
    }

    if (!this.map) {
      await this.ensureMap();
    } else {
      this.updateMarkers();
    }
  }

  private async ensureMap(): Promise<void> {
    if (!this.mapElRef?.nativeElement) {
      setTimeout(() => void this.ensureMap(), 80);
      return;
    }

    try {
      await this.places.ensureLoaded();
      if (!this.mapElRef?.nativeElement || typeof google === 'undefined') return;

      const center = this.resolveCenter();
      this.map = new google.maps.Map(this.mapElRef.nativeElement, {
        center,
        zoom: 14,
        disableDefaultUI: true,
        zoomControl: false,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        mapId: 'DEMO_MAP_ID',
        gestureHandling: 'greedy',
        clickableIcons: false,
      });

      this.updateMarkers();
      this.fitMapBounds();
    } catch {
      /* ignore map init errors on connection loss */
    }
  }

  private resolveCenter(): { lat: number; lng: number } {
    if (this.driverPosition) return this.driverPosition;
    if (this.booking?.board_lat != null && this.booking?.board_lng != null) {
      return { lat: Number(this.booking.board_lat), lng: Number(this.booking.board_lng) };
    }
    if (this.userPosition) return this.userPosition;
    return { lat: 34.2985, lng: 74.4712 };
  }

  private updateMarkers(): void {
    if (!this.map || typeof google === 'undefined') return;

    const b = this.booking;
    if (!b) return;

    // 1. Pickup Stop Pin Marker (Clean pin, no person icon)
    if (b.board_lat != null && b.board_lng != null) {
      const pos = { lat: Number(b.board_lat), lng: Number(b.board_lng) };
      const label = 'Pickup: ' + (b.board || 'Stop');
      if (!this.pickupMarker) {
        this.pickupMarker = new google.maps.marker.AdvancedMarkerElement({
          position: pos,
          map: this.map,
          title: label,
          content: this.buildPinMarkerElement('pickup', label),
          zIndex: 900,
        });
      } else {
        this.pickupMarker.position = pos;
      }
    }

    // 2. Drop Stop Pin Marker (Clean pin, no person icon)
    if (b.drop_lat != null && b.drop_lng != null) {
      const pos = { lat: Number(b.drop_lat), lng: Number(b.drop_lng) };
      const label = 'Drop: ' + (b.drop || 'Stop');
      if (!this.dropMarker) {
        this.dropMarker = new google.maps.marker.AdvancedMarkerElement({
          position: pos,
          map: this.map,
          title: label,
          content: this.buildPinMarkerElement('drop', label),
          zIndex: 900,
        });
      } else {
        this.dropMarker.position = pos;
      }
    }

    // 3. Intermediate Stops
    if (b.stops && b.stops.length > 0) {
      const reachedSeq = Number(b.fixed_last_reached_stop_seq || 0);
      if (this.stopMarkers.length === 0) {
        this.stopMarkers = b.stops
          .filter((s) => s.lat != null && s.lng != null)
          .map((stop) => new google.maps.marker.AdvancedMarkerElement({
            position: { lat: Number(stop.lat), lng: Number(stop.lng) },
            map: this.map,
            title: `#${stop.seq} ${stop.name}`,
            content: buildStopMarkerElement({
              seq: stop.seq,
              isReached: Number(stop.seq) <= reachedSeq,
            }),
            zIndex: 800 + Number(stop.seq || 0),
          }));
      }
    }

    // 4. Customer Device Actual Live Location (Person Avatar)
    if (this.userPosition) {
      if (!this.userLiveMarker) {
        this.userLiveMarker = new google.maps.marker.AdvancedMarkerElement({
          position: this.userPosition,
          map: this.map,
          title: 'You (Actual Location)',
          content: buildPassengerMarkerElement({ kind: 'pickup', name: 'You', isLive: true }),
          zIndex: 1100,
        });
      } else {
        this.userLiveMarker.position = this.userPosition;
        if (!this.userLiveMarker.map) this.userLiveMarker.map = this.map;
      }
    }

    // 5. Driver Vehicle Live Marker
    if (this.driverPosition) {
      if (!this.driverMarker) {
        this.driverMarker = new google.maps.marker.AdvancedMarkerElement({
          position: this.driverPosition,
          map: this.map,
          title: b.vehicle_name || 'Driver',
          content: buildReusableCarMarkerElement({
            bearing: this.driverBearing,
            label: b.vehicle_name || 'Driver',
          }),
          zIndex: 1000,
        });
      } else {
        this.driverMarker.position = this.driverPosition;
        if (!this.driverMarker.map) this.driverMarker.map = this.map;
        updateCarMarkerBearing(this.driverMarker, this.driverBearing);
      }
    } else if (this.driverMarker) {
      this.driverMarker.map = null;
      this.driverMarker = null;
    }

    // 6. Draw Route Polyline Corridor
    this.renderRoutePolyline();
  }

  private renderRoutePolyline(): void {
    if (!this.map || typeof google === 'undefined') return;

    for (const poly of this.routePolylines) {
      poly.setMap(null);
    }
    this.routePolylines = [];

    const pathCoords: Array<{ lat: number; lng: number }> = [];

    if (this.booking?.stops && this.booking.stops.length >= 2) {
      for (const s of this.booking.stops) {
        if (s.lat != null && s.lng != null) {
          pathCoords.push({ lat: Number(s.lat), lng: Number(s.lng) });
        }
      }
    } else {
      if (this.booking?.board_lat != null && this.booking?.board_lng != null) {
        pathCoords.push({ lat: Number(this.booking.board_lat), lng: Number(this.booking.board_lng) });
      }
      if (this.booking?.drop_lat != null && this.booking?.drop_lng != null) {
        pathCoords.push({ lat: Number(this.booking.drop_lat), lng: Number(this.booking.drop_lng) });
      }
    }

    if (pathCoords.length >= 2) {
      // Glow Outer Line
      const glowPoly = new google.maps.Polyline({
        path: pathCoords,
        geodesic: true,
        strokeColor: '#B2EBD0',
        strokeOpacity: 0.6,
        strokeWeight: 7,
        map: this.map,
      });
      // Main Solid Green Line
      const mainPoly = new google.maps.Polyline({
        path: pathCoords,
        geodesic: true,
        strokeColor: '#12B35B',
        strokeOpacity: 0.95,
        strokeWeight: 4,
        map: this.map,
      });
      this.routePolylines.push(glowPoly, mainPoly);
    }
  }

  private buildPinMarkerElement(kind: 'pickup' | 'drop', label: string): HTMLElement {
    const el = document.createElement('div');
    el.className = `dc-fixed-pin-marker dc-fixed-pin-marker--${kind}`;
    const isPickup = kind === 'pickup';
    const bg = isPickup ? '#2563EB' : '#EF4444';
    const dotBg = isPickup ? '#3B82F6' : '#F87171';
    el.innerHTML = `
      <div style="background: ${bg}; color: #ffffff; font-size: 11px; font-weight: 850; padding: 3px 9px; border-radius: 99px; box-shadow: 0 3px 10px rgba(0,0,0,0.3); border: 1.5px solid #ffffff; white-space: nowrap; text-align: center; line-height: 1.2;">
        ${label}
      </div>
      <div style="width: 10px; height: 10px; border-radius: 50%; background: ${dotBg}; border: 2.5px solid #ffffff; margin: 3px auto 0; box-shadow: 0 2px 6px rgba(0,0,0,0.35);"></div>
    `;
    return el;
  }

  recenterMap(): void {
    this.fitMapBounds();
  }

  private fitMapBounds(): void {
    if (!this.map || typeof google === 'undefined') return;

    const bounds = new google.maps.LatLngBounds();
    let count = 0;

    const addPoint = (lat?: number | null, lng?: number | null) => {
      if (lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
        bounds.extend({ lat: Number(lat), lng: Number(lng) });
        count++;
      }
    };

    addPoint(this.booking?.board_lat, this.booking?.board_lng);
    addPoint(this.booking?.drop_lat, this.booking?.drop_lng);
    addPoint(this.driverPosition?.lat, this.driverPosition?.lng);
    addPoint(this.userPosition?.lat, this.userPosition?.lng);

    if (this.booking?.stops) {
      for (const s of this.booking.stops) {
        addPoint(s.lat, s.lng);
      }
    }

    if (count > 0) {
      this.map.fitBounds(bounds, 50);
    }
  }

  private clearMap(): void {
    if (this.pickupMarker) { this.pickupMarker.map = null; this.pickupMarker = null; }
    if (this.dropMarker) { this.dropMarker.map = null; this.dropMarker = null; }
    if (this.userLiveMarker) { this.userLiveMarker.map = null; this.userLiveMarker = null; }
    if (this.driverMarker) { this.driverMarker.map = null; this.driverMarker = null; }
    for (const m of this.stopMarkers) m.map = null;
    this.stopMarkers = [];
    for (const p of this.routePolylines) p.setMap(null);
    this.routePolylines = [];
    this.map = null;
  }

  // ── Realtime Driver Tracking ──────────────────────────────────────────────
  private syncRealtimeTracking(): void {
    const tripId = this.booking?.trip_id;
    if (!tripId || !this.isActiveBooking(this.booking!)) {
      this.stopRealtimeTracking();
      return;
    }
    if (this.trackingTripId === tripId) return;

    this.stopRealtimeTracking();
    this.trackingTripId = tripId;

    this.unsubscribeTracking = this.realtime.subscribeTracking(
      tripId,
      (payload: TripLocationPayload) => {
        if (payload?.location) {
          const loc = payload.location;
          this.zone.run(() => {
            this.driverPosition = { lat: loc.lat, lng: loc.lng };
            if (loc.bearing_deg != null) this.driverBearing = loc.bearing_deg;
            this.updateMarkers();
          });
        }
      },
      () => {
        this.zone.run(() => this.silentReload());
      },
    );
  }

  private stopRealtimeTracking(): void {
    if (this.unsubscribeTracking) {
      this.unsubscribeTracking();
      this.unsubscribeTracking = null;
    }
    this.trackingTripId = null;
  }

  // ── Customer Geolocation ──────────────────────────────────────────────────
  private async startUserLocationWatch(): Promise<void> {
    if (this.watchId) return;
    try {
      const initialFix = await this.geo.getCurrentPosition();
      if (initialFix) {
        this.zone.run(() => {
          this.userPosition = { lat: initialFix.lat, lng: initialFix.lng };
          if (this.map) this.updateMarkers();
        });
      }

      this.watchId = await this.geo.watchPosition(
        { enableHighAccuracy: true, maximumAge: 3000 },
        (fix: GeoFix | null) => {
          if (fix) {
            this.zone.run(() => {
              this.userPosition = { lat: fix.lat, lng: fix.lng };
              if (this.map) this.updateMarkers();
            });
          }
        },
      );
    } catch {
      /* ignore */
    }
  }

  private async stopUserLocationWatch(): Promise<void> {
    if (this.watchId) {
      await this.geo.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  // ── Ride Lifecycle Actions ────────────────────────────────────────────────
  async cancelRide(): Promise<void> {
    if (!this.booking || !this.canCancel(this.booking) || this.cancelling) return;
    const alert = await this.alerts.create({
      header: 'Cancel fixed ride?',
      message: 'Your seat will be released. Refund depends on the fixed ride cancellation window.',
      buttons: [
        { text: 'Keep booking', role: 'cancel' },
        { text: 'Cancel ride', role: 'confirm' },
      ],
    });
    await alert.present();
    const result = await alert.onDidDismiss();
    if (result.role !== 'confirm') return;

    this.cancelling = true;
    this.api.post<{ reservation: FixedBooking; message: string }>('/fixed/bookings/' + this.booking.id + '/cancel', {})
      .pipe(finalize(() => this.cancelling = false))
      .subscribe({
        next: async (res) => {
          this.booking = res?.reservation || this.booking;
          this.syncFixedLocationStream();
          await this.showToast(res?.message || 'Fixed booking cancelled.');
        },
        error: (err) => this.error = err?.error?.message || 'Could not cancel fixed booking.',
      });
  }

  canRate(booking: FixedBooking): boolean {
    return ['DROPPED', 'COMPLETED'].includes((booking.status || '').toUpperCase()) && booking.rating_score == null;
  }

  setRatingScore(score: number): void {
    this.ratingScore = score;
  }

  submitRating(): void {
    if (!this.booking || this.submittingRating) return;
    this.submittingRating = true;
    this.api.post<{ booking: FixedBooking; message: string }>('/fixed/bookings/' + this.booking.id + '/rate', {
      score: this.ratingScore,
      comment: this.ratingComment.trim() || null,
    }).pipe(finalize(() => this.submittingRating = false)).subscribe({
      next: async (res) => {
        if (res?.booking) {
          this.booking = res.booking;
        }
        await this.showToast(res?.message || 'Thank you for rating your ride!');
      },
      error: async (err) => {
        await this.showToast(err?.error?.message || 'Could not submit rating.');
      },
    });
  }

  isActiveBooking(booking: FixedBooking): boolean {
    return !this.inactiveStatuses.has((booking.status || '').toUpperCase());
  }

  codeDigits(booking: FixedBooking): string[] {
    return (booking.boarding_code || '').split('');
  }

  canCancel(booking: FixedBooking): boolean {
    const status = (booking.status || '').toUpperCase();
    const depStatus = (booking.departure_status || '').toUpperCase();
    return ['BOOKED', 'CONFIRMED'].includes(status) && !['DEPARTED', 'COMPLETED', 'CANCELLED'].includes(depStatus);
  }

  bookingStatusLabel(booking: FixedBooking): string {
    switch ((booking.status || '').toUpperCase()) {
      case 'BOOKED':
      case 'CONFIRMED': return 'Booking confirmed';
      case 'BOARDED': return 'Boarded';
      case 'DROPPED': return 'Dropped off';
      case 'COMPLETED': return 'Ride completed';
      case 'NO_SHOW': return 'No-show';
      case 'CANCELLED': return booking.fixed_live_status?.key === 'driver_missed_stop' ? 'Driver missed pickup' : 'Cancelled';
      default: return booking.fixed_live_status?.label || booking.status || 'Active ride';
    }
  }

  statusClass(booking: FixedBooking): string {
    switch ((booking.status || '').toUpperCase()) {
      case 'BOARDED':
      case 'DROPPED':
      case 'COMPLETED': return 'status--success';
      case 'NO_SHOW': return 'status--danger';
      case 'CANCELLED': return 'status--medium';
      default: return 'status--primary';
    }
  }

  statusDetail(booking: FixedBooking): string {
    if (booking.fixed_live_status?.detail) return booking.fixed_live_status.detail;
    switch ((booking.status || '').toUpperCase()) {
      case 'BOOKED':
      case 'CONFIRMED': return 'Your seat is booked. The vehicle will pick you up at your stop.';
      case 'BOARDED': return 'You have boarded the vehicle and are on your way.';
      case 'DROPPED': return 'You have arrived at your drop-off stop.';
      case 'COMPLETED': return 'This fixed ride is completed.';
      case 'NO_SHOW': return 'The driver reached your pickup stop and the waiting window expired.';
      case 'CANCELLED': return 'This fixed booking is cancelled.';
      default: return 'Fixed ride status: ' + booking.status;
    }
  }

  vehicleLine(booking: FixedBooking): string {
    return [booking.vehicle_name, booking.vehicle_type_name].filter(Boolean).join(' · ') || 'Vehicle assigned';
  }

  carLine(booking: FixedBooking): string {
    return [booking.vehicle_brand, booking.vehicle_model, booking.vehicle_color].filter(Boolean).join(' · ');
  }

  luggageLine(booking: FixedBooking): string {
    const booked = booking.extra_luggage_count || 0;
    return booked ? booked + ' extra' : 'No extra luggage';
  }

  fareLine(booking: FixedBooking): string {
    if (booking.fare_amount == null) return '-';
    return '₹' + Number(booking.fare_amount).toFixed(2);
  }

  paymentLine(booking: FixedBooking): string {
    const method = booking.payment_method ? this.prettyToken(booking.payment_method) : 'Online';
    const status = booking.payment_status ? this.prettyToken(booking.payment_status) : 'PAID';
    return method + ' · ' + status;
  }

  dateLine(booking: FixedBooking): string {
    const raw = booking.announced_depart_at || booking.depart_at || booking.created_at || booking.service_date;
    if (!raw) return '-';
    const date = new Date(raw);
    return isNaN(date.getTime()) ? raw : date.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  private syncFixedLocationStream(): void {
    if (this.booking && ['BOOKED', 'CONFIRMED'].includes((this.booking.status || '').toUpperCase())) void this.fixedLocation.start();
    else void this.fixedLocation.stop();
  }

  private prettyToken(value: string): string {
    return value.toString().toLowerCase().split('_').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  }

  private async showToast(message: string): Promise<void> {
    const toast = await this.toasts.create({ message, duration: 2200, position: 'bottom' });
    await toast.present();
  }
}
