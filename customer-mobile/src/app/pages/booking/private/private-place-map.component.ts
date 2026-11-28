import { buildPrivateOriginMarker } from '../../../core/private-trip-pin';
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { PlacesService } from '../../../core/places.service';
import { GeolocationService } from '../../../core/geolocation.service';
import { CUSTOMER_MAP_STYLE, focusCustomerNavigation } from '../../../core/customer-map';
import { watchMapCamera, releaseMapCamera, resumeMapCamera } from '../../../core/map-camera';
import { Place } from '../booking.models';
import { JourneyPreview, journeyCurve } from './journey-preview';

declare const google: any;
type Point = { lat: number; lng: number };

@Component({
  selector: 'app-private-place-map',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <div #canvas class="place-map" aria-label="Booking location map"></div>
    <div class="place-map-skeleton" *ngIf="loading" role="status" aria-label="Loading your map" aria-live="polite">
      <span class="map-skeleton-caption">Loading your map…</span>
      <div class="map-skeleton-card" *ngFor="let row of [1, 2, 3]" aria-hidden="true">
        <div class="map-skeleton-top"><span></span><span></span></div>
        <div class="map-skeleton-profile"><i></i><div><span></span><span></span></div></div>
        <span class="map-skeleton-line"></span>
      </div>
    </div>
    <div class="place-map-state" *ngIf="!loading && error" role="status">
      <span>{{ error }}</span>
      <button type="button" (click)="initialize()">Retry map</button>
    </div>
  `,
  styles: [`
    :host { display: block; position: relative; height: 100%; width: 100%; background: #e9efeb; }
    .place-map { width: 100%; height: 100%; }
    .place-map-state { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 20px; color: #526479; background: #f0f5f2; font-size: 13px; text-align: center; }
    .place-map-state button { border: 0; border-radius: 10px; padding: 10px 16px; background: #087f50; color: #fff; font-weight: 700; }
    .place-map-skeleton { position: absolute; inset: 0; overflow: hidden; padding: max(165px, calc(env(safe-area-inset-top) + 165px)) 16px 90px; background: #f5f7fa; }
    .map-skeleton-caption { display: block; margin: 0 0 10px; color: #6b7e98; font-size: 12px; }
    .map-skeleton-card { background: white; border: 1px solid #dfe6ef; border-radius: 18px; padding: 16px; margin-bottom: 12px; box-shadow: 0 2px 4px #10223804; }
    .map-skeleton-top { display: flex; justify-content: space-between; margin-bottom: 15px; }
    .map-skeleton-top span { width: 28%; height: 16px; }
    .map-skeleton-top span:last-child { width: 14%; }
    .map-skeleton-profile { display: flex; align-items: center; gap: 12px; }
    .map-skeleton-profile i { width: 40px; height: 40px; flex: none; border-radius: 50%; }
    .map-skeleton-profile div { flex: 1; }
    .map-skeleton-profile span { display: block; width: 65%; height: 12px; margin: 7px 0; }
    .map-skeleton-profile span:last-child { width: 43%; }
    .map-skeleton-line { display: block; height: 11px; width: 50%; margin-top: 14px; }
    .map-skeleton-card span, .map-skeleton-card i { border-radius: 8px; background: linear-gradient(100deg, #eef1f5 20%, #e4e9ef 45%, #eef1f5 70%); background-size: 220% 100%; animation: map-skeleton-shimmer 1.6s linear infinite; }
    .map-skeleton-profile i { border-radius: 50%; }
    @keyframes map-skeleton-shimmer { to { background-position: -220% 0; } }
    @media (prefers-reduced-motion: reduce) { .map-skeleton-card span, .map-skeleton-card i { animation: none; } }
  `],
})
export class PrivatePlaceMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('canvas', { static: true }) canvas!: ElementRef<HTMLDivElement>;
  @Input() place: Point | null = null;
  @Input() initialPosition: Point | null = null;
  @Input() destinationMode = false;
  @Input() readOnly = false;
  private previousDestinationMode = false;
  @Output() picked = new EventEmitter<Place>();
  @Output() currentLocation = new EventEmitter<Place>();
  loading = true;
  error: string | null = null;
  private map: any = null;
  private marker: any = null;
  private pickupMarker: any = null;
  private journey: JourneyPreview | null = null;
  private journeyKey = '';
  private center: Point | null = null;
  private watchId: string | null = null;
  private destroyed = false;
  private initializing = false;
  private selectionRequest = 0;
  private manuallySelected = false;
  private currentLocationPoint: Point | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(private places: PlacesService, private geo: GeolocationService, private cdr: ChangeDetectorRef, private zone: NgZone) {}

  ngAfterViewInit(): void { void this.initialize(); }
  ngOnChanges(): void {
    ++this.selectionRequest;
    if (this.previousDestinationMode !== this.destinationMode) this.manuallySelected = false;
    this.previousDestinationMode = this.destinationMode;
    const point = this.place || this.initialPosition || this.center;
    if (this.map && point) this.showPosition(point, !!this.place);
    else if (this.canvas && (this.place || this.initialPosition) && !this.map && !this.initializing) void this.initialize();
  }

  async initialize(): Promise<void> {
    if (this.initializing || this.destroyed) return;
    this.initializing = true;
    this.loading = true;
    this.error = null;
    try {
      let position = this.place || this.geo.recentPosition() || this.geo.lastKnownPosition() || this.initialPosition || await this.geo.getCurrentPosition();
      position = this.place || position;
      if (!position) {
        this.error = 'Location unavailable. Search for your pickup below.';
        return;
      }
      await this.places.ensureLoaded();
      if (this.destroyed) return;
      this.map = new google.maps.Map(this.canvas.nativeElement, {
        ...CUSTOMER_MAP_STYLE, center: position, mapId: 'DEMO_MAP_ID', disableDefaultUI: true, clickableIcons: false,
      });
      watchMapCamera(this.map, false);
      const canvas = this.canvas.nativeElement;
      const shell = canvas.closest('.sf');
      const header = shell?.querySelector('.pv-offer-header');
      const panel = shell?.querySelector('.sf__body');
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.map || this.destroyed) return;
        google.maps.event.trigger(this.map, 'resize');
        if (this.readOnly && this.place && this.initialPosition && header && panel) {
          const rect = canvas.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          const bounds = new google.maps.LatLngBounds();
          for (const point of journeyCurve(this.initialPosition, this.place)) bounds.extend(point);
          const top = Math.max(0, header.getBoundingClientRect().bottom - rect.top);
          const bottom = Math.max(0, rect.bottom - panel.getBoundingClientRect().top);
          this.map.fitBounds(bounds, { top: Math.ceil(top + 90), bottom: Math.ceil(bottom + 24), left: 62, right: 62 });
        }
      });
      this.resizeObserver.observe(this.canvas.nativeElement);
      if (this.readOnly && header && panel) {
        this.resizeObserver.observe(header);
        this.resizeObserver.observe(panel);
      }
      const current = this.geo.recentPosition() || this.geo.lastKnownPosition() || (!this.place ? position : null);
      if (current && !this.readOnly) void this.reportCurrentLocation(current);
      if (!this.readOnly) this.map.addListener('click', (event: any) => {
        if (event.latLng) this.zone.run(() => void this.selectAt(event.latLng.toJSON()));
      });
      this.showPosition(this.place || position, true);
      this.loading = false;
      this.cdr.markForCheck();
      if (!this.place && !this.readOnly) {
        const id = await this.geo.watchPosition({ enableHighAccuracy: true, maximumAge: 0 }, fix => {
          if (fix && !this.destroyed) void this.reportCurrentLocation(fix);
          if (this.destroyed || !fix || this.place || this.manuallySelected || this.destinationMode) return;
          this.showPosition(fix, false);
        });
        if (this.destroyed) await this.geo.clearWatch(id);
        else this.watchId = id;
      }
    } catch {
      if (!this.destroyed) {
        // A failed live watch must not hide a successfully loaded map.
        if (!this.map) this.error = 'Map unavailable. You can still search for your location below.';
      }
    } finally {
      this.initializing = false;
      this.loading = false;
      if (!this.destroyed) this.cdr.markForCheck();
    }
  }

  private showPosition(position: Point, recenter: boolean): void {
    if (!this.map || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return;
    this.center = { lat: position.lat, lng: position.lng };
    const destination = this.destinationMode && !!(this.place || this.manuallySelected);
    const label = destination ? 'Destination' : this.place || this.manuallySelected || this.destinationMode ? 'Pickup location' : 'Your current location';
    if (this.marker) {
      this.marker.position = this.center;
      if (this.marker.title !== label) {
        this.marker.title = label;
        this.marker.content = buildPrivateOriginMarker(label, destination);
      }
    }
    else {
      this.marker = new google.maps.marker.AdvancedMarkerElement({
      map: this.map, position: this.center, title: label,
      gmpDraggable: !this.readOnly,
      content: buildPrivateOriginMarker(label, destination),
      });
      this.marker.addListener('dragend', (event: any) => {
        if (event.latLng) this.zone.run(() => void this.selectAt(event.latLng.toJSON()));
      });
    }
    if (destination && this.initialPosition) {
      if (!this.pickupMarker) this.pickupMarker = new google.maps.marker.AdvancedMarkerElement({
        map: this.map, position: this.initialPosition, title: 'Pickup location',
        content: buildPrivateOriginMarker('Pickup location'), zIndex: 100,
      });
      this.pickupMarker.position = this.initialPosition;
      const key = `${this.initialPosition.lat},${this.initialPosition.lng}:${position.lat},${position.lng}`;
      if (key !== this.journeyKey) {
        this.journeyKey = key;
        this.marker.map = null;
        this.journey ??= new JourneyPreview(this.map, this.readOnly);
        this.journey.start(this.initialPosition, position, () => {
          if (this.destroyed || key !== this.journeyKey) return;
          this.marker.map = this.map;
          if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) this.marker.content?.animate?.(
            [{ opacity: 0, transform: 'translateY(-8px) scale(.8)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }],
            { duration: 220, easing: 'ease-out' });
        });
      }
      return;
    }
    this.clearJourney();
    this.marker.map = this.map;
    if (recenter) this.recenter();
    else focusCustomerNavigation(this.map, this.center);
  }

  recenter(): void {
    if (!this.map || !this.center) return;
    resumeMapCamera(this.map);
    focusCustomerNavigation(this.map, this.center);
  }

  private clearJourney(): void {
    this.journey?.clear();
    this.journeyKey = '';
    if (this.pickupMarker) this.pickupMarker.map = null;
    this.pickupMarker = null;
  }

  private async selectAt(position: Point): Promise<void> {
    this.manuallySelected = true;
    const request = ++this.selectionRequest;
    this.showPosition(position, true);
    let address: string | null = null;
    try { address = await this.places.reverseGeocode(position.lat, position.lng); } catch { /* Coordinates remain usable. */ }
    if (this.destroyed || request !== this.selectionRequest) return;
    this.picked.emit({ ...position, address: address || `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}` });
  }

  private async reportCurrentLocation(position: Point): Promise<void> {
    if (this.currentLocationPoint && Math.abs(this.currentLocationPoint.lat - position.lat) < .0004
      && Math.abs(this.currentLocationPoint.lng - position.lng) < .0004) return;
    const requested = { lat: position.lat, lng: position.lng };
    this.currentLocationPoint = requested;
    let label: string | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      label = await Promise.race([
        this.places.reverseGeocode(requested.lat, requested.lng),
        new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 8000); }),
      ]);
    } catch { /* Current GPS coordinates remain usable without an address. */ }
    finally { if (timeout) clearTimeout(timeout); }
    if (this.destroyed || this.currentLocationPoint !== requested) return;
    this.zone.run(() => this.currentLocation.emit({ ...requested, address: label || 'Current location' }));
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    ++this.selectionRequest;
    this.resizeObserver?.disconnect();
    this.clearJourney();
    if (this.watchId) void this.geo.clearWatch(this.watchId);
    if (this.marker) this.marker.map = null;
    releaseMapCamera(this.map);
    this.marker = null;
    this.map = null;
  }
}
