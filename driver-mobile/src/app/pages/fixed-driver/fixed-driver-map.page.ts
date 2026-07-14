import { Component, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
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

interface ManifestResponse {
  departure: FixedVehicle;
  stops?: FixedStop[];
  passengers?: FixedPassenger[];
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

  private map: any = null;
  private routeLine: any = null;
  private stopMarkers: any[] = [];
  private passengerMarkers: any[] = [];
  private selfMarker: any = null;
  private selfWatchId: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private places: PlacesService,
    private geo: GeolocationService,
  ) {}

  ionViewWillEnter(): void {
    this.load();
  }

  ionViewWillLeave(): void {
    void this.stopDriverWatch();
    this.resetMap();
  }

  ngOnDestroy(): void {
    void this.stopDriverWatch();
    this.resetMap();
  }

  back(): void {
    void this.router.navigateByUrl('/tabs/fixed');
  }

  routeLineText(): string {
    if (!this.vehicle) return 'Fixed route';
    if (this.vehicle.origin_name && this.vehicle.dest_name) return this.vehicle.origin_name + ' to ' + this.vehicle.dest_name;
    return this.vehicle.route_name || 'Fixed route';
  }

  passengerSummaryText(): string {
    const waiting = this.passengers.filter((passenger) => ['BOOKED', 'CONFIRMED'].includes((passenger.status || '').toUpperCase())).length;
    const boarded = this.passengers.filter((passenger) => (passenger.status || '').toUpperCase() === 'BOARDED').length;
    if (!this.passengers.length) return 'No passengers yet';
    return waiting + ' waiting · ' + boarded + ' boarded';
  }

  load(): void {
    const departureId = Number(this.route.snapshot.paramMap.get('departureId') || 0);
    if (!departureId) {
      this.error = 'Fixed vehicle not found.';
      return;
    }

    this.loading = true;
    this.error = null;
    this.api.get<ManifestResponse>(`/fixed/departures/${departureId}/manifest`).subscribe({
      next: (res) => {
        this.vehicle = res.departure;
        this.passengers = res.passengers ?? [];
        this.stops = this.visibleManifestStops(res.stops ?? [], this.passengers);
        requestAnimationFrame(() => void this.initMap());
      },
      error: (err) => this.error = err?.error?.message || 'Could not load fixed route map.',
      complete: () => this.loading = false,
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

    this.stopMarkers = routeStops.map((stop) => new google.maps.marker.AdvancedMarkerElement({
      position: this.stopPosition(stop),
      map: this.map,
      title: stop.name,
      content: this.buildStopMarker(stop),
      zIndex: stop.seq,
    }));

    this.passengerMarkers = this.passengerPointGroups().map((point) => new google.maps.marker.AdvancedMarkerElement({
      position: point.position,
      map: this.map,
      title: point.title,
      content: this.buildPassengerMarker(point.kind, point.count),
      zIndex: point.kind === 'pickup' ? 900 : 850,
    }));
    this.fitMap();
  }

  private async startDriverWatch(): Promise<void> {
    if (this.selfWatchId !== null) return;
    try {
      this.selfWatchId = await this.geo.watchPosition(
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
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
        title: 'You',
        content: this.buildDriverMarker(fix.bearing ?? 0),
        zIndex: 1000,
      });
      this.fitMap();
      return;
    }
    this.selfMarker.position = position;
    const arrow = (this.selfMarker.content as HTMLElement | null)?.firstElementChild as HTMLElement | null;
    if (arrow && fix.bearing != null) arrow.style.transform = `rotate(${fix.bearing}deg)`;
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

  private passengerPointGroups(): Array<{ kind: 'pickup' | 'drop'; count: number; title: string; position: { lat: number; lng: number } }> {
    const groups = new Map<string, { kind: 'pickup' | 'drop'; count: number; title: string; position: { lat: number; lng: number } }>();

    for (const passenger of this.passengers) {
      const status = (passenger.status || '').toUpperCase();
      if (['CANCELLED', 'NO_SHOW', 'DROPPED', 'COMPLETED'].includes(status)) continue;

      const pickup = this.passengerPosition(passenger, 'pickup');
      if (pickup) this.addPassengerPoint(groups, 'pickup', pickup, passenger.board || 'Pickup');

      const drop = this.passengerPosition(passenger, 'drop');
      if (drop && status === 'BOARDED') this.addPassengerPoint(groups, 'drop', drop, passenger.drop || 'Drop');
    }

    return Array.from(groups.values());
  }

  private addPassengerPoint(
    groups: Map<string, { kind: 'pickup' | 'drop'; count: number; title: string; position: { lat: number; lng: number } }>,
    kind: 'pickup' | 'drop',
    position: { lat: number; lng: number },
    label: string,
  ): void {
    const key = kind + ':' + position.lat.toFixed(6) + ',' + position.lng.toFixed(6);
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.title = existing.count + ' passenger ' + (kind === 'pickup' ? 'pickup' : 'drop') + 's at ' + label;
      return;
    }
    groups.set(key, {
      kind,
      count: 1,
      title: '1 passenger ' + (kind === 'pickup' ? 'pickup' : 'drop') + ' at ' + label,
      position,
    });
  }

  private passengerPosition(passenger: FixedPassenger, kind: 'pickup' | 'drop'): { lat: number; lng: number } | null {
    const lat = kind === 'pickup' ? passenger.board_lat : passenger.drop_lat;
    const lng = kind === 'pickup' ? passenger.board_lng : passenger.drop_lng;
    if (lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
      return { lat: Number(lat), lng: Number(lng) };
    }

    const stopId = kind === 'pickup' ? passenger.board_stop_id : passenger.drop_stop_id;
    const stop = this.stops.find((item) => Number(item.id) === Number(stopId));
    return stop && this.hasStopCoords(stop) ? this.stopPosition(stop) : null;
  }

  private buildPassengerMarker(kind: 'pickup' | 'drop', count: number): HTMLElement {
    const el = document.createElement('div');
    el.className = 'fixed-driver-passenger-marker fixed-driver-passenger-marker--' + kind;
    el.innerHTML = '<span>' + (kind === 'pickup' ? 'P' : 'D') + '</span><strong>' + count + '</strong>';
    return el;
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
    const el = document.createElement('div');
    el.className = 'fixed-driver-self-marker';
    el.innerHTML = `<span style="transform: rotate(${bearing}deg)"></span>`;
    return el;
  }
}
