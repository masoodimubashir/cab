import { Component, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { interval, Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { buildReusableCarMarkerElement, updateCarMarkerBearing } from '../../core/car-marker.helper';
import { GeoFix, GeolocationService } from '../../core/geolocation.service';
import { PlacesService } from '../../core/places.service';

declare const google: any;

interface FixedVehicle {
  id: number;
  route_name: string;
  origin_name?: string | null;
  dest_name?: string | null;
  status: string;
  fixed_last_reached_stop_seq?: number | null;
}

interface FixedStop {
  id: number;
  seq: number;
  name: string;
  lat?: number | null;
  lng?: number | null;
  is_active?: boolean;
  is_temporarily_unavailable?: boolean;
}

interface FixedPassenger {
  id?: number;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_lat?: number | null;
  customer_lng?: number | null;
  customer_location_updated_at?: string | null;
  seats?: number | null;
  status?: string | null;
  board_stop_id?: number | null;
  drop_stop_id?: number | null;
  board?: string | null;
  drop?: string | null;
  board_lat?: number | null;
  board_lng?: number | null;
  drop_lat?: number | null;
  drop_lng?: number | null;
}

interface FixedCitySettings {
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
  stops?: FixedStop[];
  passengers?: FixedPassenger[];
  city_settings?: FixedCitySettings;
}

@Component({
  selector: 'app-fixed-driver-map',
  templateUrl: './fixed-driver-map.page.html',
  styleUrls: ['./fixed-driver-map.page.scss'],
  standalone: false,
})
export class FixedDriverMapPage implements OnDestroy {
  loading = false;
  error: string | null = null;
  vehicle: FixedVehicle | null = null;
  stops: FixedStop[] = [];
  passengers: FixedPassenger[] = [];
  citySettings: FixedCitySettings | null = null;
  selectedStopDetail: StopDetailModalData | null = null;

  private map: any = null;
  private routeLine: any = null;
  private stopMarkers: any[] = [];
  private stopRadiusCircles: any[] = [];
  private passengerMarkers: any[] = [];
  private selfMarker: any = null;
  private selfWatchId: string | null = null;
  private manifestPoll?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private places: PlacesService,
    private geo: GeolocationService,
  ) {}

  ionViewWillEnter(): void {
    this.load(true);
    this.startPolling();
  }

  ionViewWillLeave(): void {
    this.stopPolling();
    void this.stopDriverWatch();
    this.resetMap();
  }

  ngOnDestroy(): void {
    this.stopPolling();
    void this.stopDriverWatch();
    this.resetMap();
  }

  private startPolling(): void {
    this.stopPolling();
    this.manifestPoll = interval(4000).subscribe(() => {
      this.load(false);
    });
  }

  private stopPolling(): void {
    if (this.manifestPoll) {
      this.manifestPoll.unsubscribe();
      this.manifestPoll = undefined;
    }
  }

  back(): void {
    void this.router.navigateByUrl('/tabs/fixed');
  }

  get routeOriginName(): string {
    const raw = this.vehicle?.origin_name;
    if (raw && raw.trim().toLowerCase() !== 'origin') return raw.trim();
    if (this.stops.length > 0 && this.stops[0]?.name) return this.stops[0].name;
    const rName = this.vehicle?.route_name;
    if (rName) {
      if (rName.includes('->')) return rName.split('->')[0].trim();
      if (rName.includes('→')) return rName.split('→')[0].trim();
      if (rName.toLowerCase().includes(' to ')) return rName.split(/ to /i)[0].trim();
    }
    return this.stops[0]?.name || 'Origin';
  }

  get routeDestName(): string {
    const raw = this.vehicle?.dest_name;
    if (raw && raw.trim().toLowerCase() !== 'destination') return raw.trim();
    if (this.stops.length > 1 && this.stops[this.stops.length - 1]?.name) {
      return this.stops[this.stops.length - 1].name;
    }
    const rName = this.vehicle?.route_name;
    if (rName) {
      if (rName.includes('->')) return rName.split('->')[1].trim();
      if (rName.includes('→')) return rName.split('→')[1].trim();
      if (rName.toLowerCase().includes(' to ')) return rName.split(/ to /i)[1].trim();
    }
    return this.stops[this.stops.length - 1]?.name || 'Destination';
  }

  routeLineText(): string {
    if (!this.vehicle) return 'Fixed route';
    const orig = this.routeOriginName;
    const dest = this.routeDestName;
    if (orig && dest && orig !== 'Origin' && dest !== 'Destination') return orig + ' to ' + dest;
    return this.vehicle.route_name || 'Fixed route';
  }

  passengerSummaryText(): string {
    const waiting = this.passengers.filter((passenger) => ['BOOKED', 'CONFIRMED'].includes((passenger.status || '').toUpperCase())).length;
    const boarded = this.passengers.filter((passenger) => (passenger.status || '').toUpperCase() === 'BOARDED').length;
    if (!this.passengers.length) return 'No passengers yet';
    return waiting + ' waiting · ' + boarded + ' boarded';
  }

  load(showSpinner = true): void {
    const departureId = Number(this.route.snapshot.paramMap.get('departureId') || 0);
    if (!departureId) {
      this.error = 'Fixed vehicle not found.';
      return;
    }

    if (showSpinner) this.loading = true;
    this.error = null;

    const oldRadius = Number(this.citySettings?.fixed_stop_arrival_radius_m || 0);
    const oldStopsJson = JSON.stringify(this.stops.map((s) => ({ id: s.id, seq: s.seq })));
    const oldPassengersJson = JSON.stringify(this.passengers.map((p) => ({ id: p.id, status: p.status })));
    const oldCitySettingsJson = JSON.stringify(this.citySettings || {});
    const hadMap = !!this.map;

    this.api.get<ManifestResponse>(`/fixed/departures/${departureId}/manifest`).subscribe({
      next: (res) => {
        this.vehicle = res.departure;
        this.passengers = res.passengers ?? [];
        this.stops = this.visibleManifestStops(res.stops ?? [], this.passengers);
        this.citySettings = res.city_settings || null;

        // Live update stop detail popup if open
        if (this.selectedStopDetail) {
          this.openStopDetail(this.selectedStopDetail.stop);
        }

        const newRadius = Number(this.citySettings?.fixed_stop_arrival_radius_m || 0);
        const newStopsJson = JSON.stringify(this.stops.map((s) => ({ id: s.id, seq: s.seq })));
        const newPassengersJson = JSON.stringify(this.passengers.map((p) => ({ id: p.id, status: p.status })));
        const newCitySettingsJson = JSON.stringify(this.citySettings || {});

        if (!this.map) {
          requestAnimationFrame(() => void this.initMap());
        } else if (
          oldStopsJson !== newStopsJson ||
          oldPassengersJson !== newPassengersJson ||
          oldCitySettingsJson !== newCitySettingsJson ||
          oldRadius !== newRadius
        ) {
          this.refreshMap();
        }
      },
      error: (err) => {
        if (showSpinner) this.error = err?.error?.message || 'Could not load fixed route map.';
      },
      complete: () => {
        if (showSpinner) this.loading = false;
      },
    });
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

  private async initMap(): Promise<void> {
    try {
      await this.places.ensureLoaded();
      const div = document.getElementById('fixed-driver-full-map');
      if (!div) return;
      const firstStop = this.stops.find((stop) => this.hasStopCoords(stop));
      this.map = new google.maps.Map(div, {
        center: firstStop ? this.stopPosition(firstStop) : { lat: 28.6139, lng: 77.209 },
        zoom: 13,
        disableDefaultUI: true,
        zoomControl: true,
        mapId: 'DEMO_MAP_ID',
      });
      this.refreshMap();
      void this.startDriverWatch();
    } catch {
      this.error = 'Could not load the map.';
    }
  }

  private refreshMap(): void {
    if (!this.map) return;
    this.clearRouteObjects();
    const routeStops = this.stops.filter((stop) => this.hasStopCoords(stop));
    if (!routeStops.length) {
      this.error = 'No stop coordinates are available for this route.';
      return;
    }

    this.routeLine = new google.maps.Polyline({
      path: routeStops.map((stop) => this.stopPosition(stop)),
      map: this.map,
      strokeColor: '#12B35B',
      strokeOpacity: 0.9,
      strokeWeight: 5,
    });

    const reachedSeq = Number(this.vehicle?.fixed_last_reached_stop_seq || 0);
    const radiusM = this.citySettings?.fixed_stop_arrival_radius_m || 150;

    // Render light-colored Stop Arrival Radius Circles on the map
    this.stopRadiusCircles = routeStops.map((stop) => {
      const isReached = stop.seq <= reachedSeq;
      const isNext = !isReached && (reachedSeq === 0 ? stop.seq === 1 : stop.seq === reachedSeq + 1);

      const circle = new google.maps.Circle({
        map: this.map,
        center: this.stopPosition(stop),
        radius: radiusM,
        fillColor: isNext ? '#10B981' : (isReached ? '#94A3B8' : '#0EA5E9'),
        fillOpacity: isNext ? 0.18 : 0.08,
        strokeColor: isNext ? '#059669' : (isReached ? '#64748B' : '#0284C7'),
        strokeOpacity: isNext ? 0.7 : 0.35,
        strokeWeight: isNext ? 2 : 1,
        clickable: true,
        zIndex: 5,
      });

      circle.addListener('click', () => {
        this.openStopDetail(stop);
      });

      return circle;
    });

    this.stopMarkers = routeStops.map((stop) => {
      const marker = new google.maps.marker.AdvancedMarkerElement({
        position: this.stopPosition(stop),
        map: this.map,
        title: stop.name,
        content: this.buildStopMarker(stop),
        zIndex: stop.seq,
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
    this.fitMap();
  }

  openStopDetail(stop: FixedStop): void {
    const reachedSeq = Number(this.vehicle?.fixed_last_reached_stop_seq || 0);
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

  private onDriverPosition(fix: GeoFix): void {
    if (!this.map) return;
    const position = { lat: fix.lat, lng: fix.lng };
    if (!this.selfMarker) {
      this.selfMarker = new google.maps.marker.AdvancedMarkerElement({
        position,
        map: this.map,
        title: 'You (Driver)',
        content: this.buildDriverMarker(fix.bearing ?? 0),
        zIndex: 1000,
      });
      this.fitMap();
      return;
    }
    this.selfMarker.position = position;
    if (fix.bearing != null) {
      updateCarMarkerBearing(this.selfMarker, fix.bearing);
    }
  }

  private fitMap(): void {
    if (!this.map) return;
    const bounds = new google.maps.LatLngBounds();
    let any = false;
    for (const marker of [...this.stopMarkers, ...this.passengerMarkers, this.selfMarker]) {
      if (marker?.position) {
        bounds.extend(marker.position as any);
        any = true;
      }
    }
    if (any) this.map.fitBounds(bounds, 72);
  }

  private resetMap(): void {
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
    for (const circle of this.stopRadiusCircles) circle.setMap(null);
    for (const marker of this.stopMarkers) marker.map = null;
    for (const marker of this.passengerMarkers) marker.map = null;
    this.stopRadiusCircles = [];
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
      if (passenger.customer_lat != null && passenger.customer_lng != null &&
          Number.isFinite(Number(passenger.customer_lat)) && Number.isFinite(Number(passenger.customer_lng))) {
        return { lat: Number(passenger.customer_lat), lng: Number(passenger.customer_lng) };
      }
      if (passenger.board_lat != null && passenger.board_lng != null &&
          Number.isFinite(Number(passenger.board_lat)) && Number.isFinite(Number(passenger.board_lng))) {
        return { lat: Number(passenger.board_lat), lng: Number(passenger.board_lng) };
      }
      const stopId = passenger.board_stop_id;
      const stop = this.stops.find((item) => Number(item.id) === Number(stopId));
      return stop && this.hasStopCoords(stop) ? this.stopPosition(stop) : null;
    }

    if (passenger.drop_lat != null && passenger.drop_lng != null &&
        Number.isFinite(Number(passenger.drop_lat)) && Number.isFinite(Number(passenger.drop_lng))) {
      return { lat: Number(passenger.drop_lat), lng: Number(passenger.drop_lng) };
    }
    const dropStopId = passenger.drop_stop_id;
    const dropStop = this.stops.find((item) => Number(item.id) === Number(dropStopId));
    return dropStop && this.hasStopCoords(dropStop) ? this.stopPosition(dropStop) : null;
  }

  private buildPassengerMarker(kind: 'pickup' | 'drop', count: number, name = 'Passenger', isLive = false): HTMLElement {
    const el = document.createElement('div');
    el.className = `fixed-driver-person-marker fixed-driver-person-marker--${kind} ${isLive ? 'is-live-walking' : ''}`;

    const iconHtml = kind === 'pickup'
      ? `<div class="person-avatar-wrap">
           <span class="person-cap-icon">🧢</span>
           ${isLive ? '<span class="person-walking-pulse"></span>' : ''}
         </div>`
      : `<div class="person-avatar-wrap person-avatar-wrap--drop">
           <span class="person-cap-icon">📍</span>
         </div>`;

    const labelHtml = `
      <div class="person-tag-pill">
        <span class="person-tag-name">${this.escapeMarkerHtml(name)}</span>
        <span class="person-tag-seats">${count}s</span>
        ${isLive ? '<span class="person-live-dot" title="Live Walking">●</span>' : ''}
      </div>
    `;

    el.innerHTML = `${iconHtml}${labelHtml}`;
    return el;
  }

  private escapeMarkerHtml(str: string): string {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private buildStopMarker(stop: FixedStop): HTMLElement {
    const el = document.createElement('div');
    el.className = 'fixed-driver-stop-marker';
    const reachedSeq = Number(this.vehicle?.fixed_last_reached_stop_seq || 0);
    const tone = stop.seq <= reachedSeq ? '#64748B' : '#12B35B';
    el.style.setProperty('--stop-color', tone);
    el.innerHTML = `<span>${stop.seq}</span>`;
    return el;
  }

  private buildDriverMarker(bearing: number): HTMLElement {
    return buildReusableCarMarkerElement({
      bearing,
      label: 'You (Car)',
    });
  }
}
