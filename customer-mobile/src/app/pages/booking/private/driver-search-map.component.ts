import { AfterViewInit, Component, ElementRef, Input, OnDestroy, ViewChild } from '@angular/core';
import { EMPTY, Subscription, catchError, combineLatest, exhaustMap, timer } from 'rxjs';
import { carSport } from 'ionicons/icons';
import { ApiService } from '../../../core/api.service';
import { PlacesService } from '../../../core/places.service';
import { CUSTOMER_MAP_STYLE } from '../../../core/customer-map';
import { buildReusableCarMarkerElement, updateCarMarkerBearing } from '../../../core/car-marker.helper';
import { NearbyHomeCar } from '../home/nearby-cars';
import { TripScope } from '../booking.models';
import { buildPrivateOriginMarker } from '../../../core/private-trip-pin';

declare const google: any;

@Component({
  selector: 'app-driver-search-map',
  standalone: true,
  template: `<div #canvas class="canvas" aria-label="Nearby private drivers"></div>
    <span class="error" [hidden]="!mapFailed" role="status">Map unavailable. Waiting for driver replies.</span>
    <div #origin class="origin"><i></i><i></i><span #pin></span></div>`,
  styles: [`
    :host,.canvas {display:block;width:100%;height:100%}
    .origin {position:relative;width:0;height:0}
    .origin span {position:absolute;bottom:0;left:0;transform:translateX(-50%)}
    .origin i {position:absolute;pointer-events:none;width:clamp(180px,48vw,280px);aspect-ratio:1;left:0;top:0;border-radius:50%;transform:translate(-50%,-50%);border:1px solid #00865e63;background:repeating-radial-gradient(circle,transparent 0 31%,#14795a35 32%,transparent 33%)}
    .origin i+i {border:0;background:conic-gradient(from 0deg,transparent 0deg 285deg,#0c9e7622 325deg,#087a5b65 357deg,transparent 360deg);animation:sweep 2.8s linear infinite}
    :host(.answered) i {display:none}
    @keyframes sweep {to {transform:translate(-50%,-50%) rotate(360deg)}}
    @media(prefers-reduced-motion:reduce){.origin i {animation:none;transform:translate(-50%,-50%) scale(.45);opacity:.35}.origin i+i {display:none}}
    .error {position:absolute;left:12px;top:25%;background:white;padding:10px;border-radius:10px}
  `],
})
export class DriverSearchMapComponent implements AfterViewInit, OnDestroy {
  @Input() pickup!: { lat: number; lng: number };
  @Input() scope!: TripScope | null;
  @ViewChild('canvas') canvas!: ElementRef<HTMLElement>;
  @ViewChild('origin') origin!: ElementRef<HTMLElement>;
  @ViewChild('pin') pin!: ElementRef<HTMLElement>;
  mapFailed = false;
  private destroyed = false;
  private subscription?: Subscription;
  private markers = new Map<number, any>();
  private excluded = new Set<number>();
  private exiting = new Map<number, Animation>();
  @Input() set rejectedDrivers(ids: Set<number>) {
    this.excluded = ids;
    for (const id of ids) this.hideDriver(id);
  }
  private pickupMarker: any;
  private pendingReveal?: ReturnType<typeof setTimeout>;
  private latest = new Map<number, NearbyHomeCar>();
  private popover: any;
  private selectedId?: number;

  constructor(private places: PlacesService, private api: ApiService) {}

  async ngAfterViewInit(): Promise<void> {
    try {
      await this.places.ensureLoaded();
      if (this.destroyed) return;
      const map = new google.maps.Map(this.canvas.nativeElement, {
        ...CUSTOMER_MAP_STYLE, mapId: 'DEMO_MAP_ID', center: this.pickup, zoom: 14, tilt: 0, disableDefaultUI: true,
      });
      this.pin.nativeElement.append(buildPrivateOriginMarker('Pickup location'));
      this.pickupMarker = new google.maps.marker.AdvancedMarkerElement({
        map, position: this.pickup, content: this.origin.nativeElement, title: 'Pickup',
      });
      const params = new URLSearchParams({ lat: String(this.pickup.lat), lng: String(this.pickup.lng), service_mode: 'private' });
      if (this.scope) params.set('scope', this.scope);
      this.popover = new google.maps.InfoWindow({ maxWidth: 340 });
      this.popover.addListener('closeclick', () => this.selectedId = undefined);
      map.addListener('click', () => this.closeDetails());
      const nearby = timer(0, 6000).pipe(exhaustMap(() =>
        this.api.get<{ data: NearbyHomeCar[] }>('/drivers/nearby?' + params).pipe(catchError(() => EMPTY))
      ));
      this.subscription = combineLatest([nearby, timer(2800)]).subscribe(([{data}]) => {
        this.latest = new Map(data.map(car => [car.id, car]));
        this.showDrivers(map);
      });
    } catch {
      this.mapFailed = true;
    }
  }

  private showDrivers(map: any): void {
    const visible = new Set<number>();
    const bounds = new google.maps.LatLngBounds();
    bounds.extend(this.pickup);
    let reframe = false;
    for (const car of this.latest.values()) {
      if (this.excluded.has(car.id) || !Number.isFinite(car.lat) || !Number.isFinite(car.lng)) continue;
      const position = {lat: car.lat, lng: car.lng};
      visible.add(car.id);
      bounds.extend(position);
      const marker = this.markers.get(car.id);
      if (marker) {
        this.exiting.get(car.id)?.cancel();
        this.exiting.delete(car.id);
        marker.position = position;
        updateCarMarkerBearing(marker, car.bearing_deg ?? 0);
        continue;
      }
      if (this.pendingReveal !== undefined) continue;
      const content = document.createElement('div');
      content.style.cssText = 'display:grid;place-items:center;width:44px;height:44px;cursor:pointer';
      content.append(buildReusableCarMarkerElement({ markerUrl: car.map_marker_url || carSport, bearing: car.bearing_deg ?? 0 }));
      const hint = document.createElement('span');
      hint.className = 'private-car-details-hint';
      hint.textContent = 'View car details';
      content.append(hint);
      const added = new google.maps.marker.AdvancedMarkerElement({ map, position, content, anchorTop: '-50%', title: 'View car details for ' + (car.driver_name || 'nearby driver'), zIndex: 10 });
      added.addListener('click', () => this.openDetails(map, car.id));
      this.markers.set(car.id, added);
      this.pendingReveal = setTimeout(() => {
        this.pendingReveal = undefined;
        this.showDrivers(map);
      }, 550);
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        content.animate([{ opacity: 0, scale: '.76', translate: '0 5px' }, { opacity: 1, scale: '1', translate: '0 0' }],
          {duration: 440, easing: 'cubic-bezier(.2,.75,.25,1)'});
      }
      reframe ||= !map.getBounds()?.contains(position);
    }
    for (const id of this.markers.keys()) {
      if (!visible.has(id)) this.hideDriver(id);
    }
    if (reframe && !bounds.getNorthEast().equals(bounds.getSouthWest())) {
      map.fitBounds(bounds, {top: 110, bottom: Math.round(this.canvas.nativeElement.clientHeight * .35), left: 48, right: 48});
    }
  }

  private openDetails(map: any, id: number): void {
    const car = this.latest.get(id);
    if (!car || this.excluded.has(id) || this.exiting.has(id)) return;
    const details = document.createElement('div');
    details.className = 'private-car-details';
    const name = document.createElement('strong');
    name.textContent = car.driver_name || 'Nearby driver';
    name.className = 'private-car-details-name';
    this.popover.setHeaderContent(name);
    const vehicle = car.vehicle;
    const family = vehicle?.name || vehicle?.type || 'Vehicle';
    const photo = document.createElement('img');
    photo.alt = family;
    photo.src = car.image_url || vehicle?.image_url || carSport;
    photo.onerror = () => { photo.onerror = null; photo.src = carSport; };
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = family;
    info.append(title);
    for (const value of [[vehicle?.brand, vehicle?.model].filter(Boolean).join(' '), vehicle?.color, vehicle?.reg_no]) {
      if (!value || value === family) continue;
      const line = document.createElement('span');
      line.textContent = value;
      info.append(line);
    }
    details.append(photo, info);
    this.selectedId = id;
    this.popover.setContent(details);
    this.popover.open({map, anchor: this.markers.get(id), shouldFocus: false});
  }

  private closeDetails(): void {
    this.popover?.close();
    this.selectedId = undefined;
  }

  private hideDriver(id: number): void {
    if (this.selectedId === id) this.closeDetails();
    const marker = this.markers.get(id);
    if (!marker || this.exiting.has(id)) return;
    const remove = () => {
      marker.map = null;
      this.markers.delete(id);
      this.exiting.delete(id);
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { remove(); return; }
    const anim = marker.content.animate([{ opacity: 1, scale: '1' }, { opacity: 0, scale: '.82' }],
      { duration: 240, easing: 'ease-in', fill: 'forwards' });
    this.exiting.set(id, anim);
    anim.onfinish = () => { if (this.exiting.get(id) === anim) remove(); };
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.subscription?.unsubscribe();
    clearTimeout(this.pendingReveal);
    this.closeDetails();
    for (const animation of this.exiting.values()) animation.cancel();
    this.exiting.clear();
    if (this.pickupMarker) this.pickupMarker.map = null;
    for (const marker of this.markers.values()) marker.map = null;
    this.markers.clear();
  }
}
