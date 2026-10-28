import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MapsLoaderService } from '../core/maps-loader.service';
import { buildReusableCarMarkerElement, buildStopMarkerElement } from '../core/car-marker.helper';

declare const google: any;
type Position = { lat: number; lng: number };

@Component({
  selector: 'app-stop-arrival-map', standalone: true, imports: [CommonModule],
  template: `
    <div #mapHost class="arrival-map-canvas" aria-label="Stop and driver map"></div>
    <span class="arrival-map-error" *ngIf="error">{{ error }}</span>
  `,
  styles: [`
    :host { display: block; position: relative; height: 100%; background: #e5eee6; }
    .arrival-map-canvas { height: 100%; width: 100%; }
    .arrival-map-error { position: absolute; inset: 0; display: grid; place-items: center; font-size: 13px; color: #48616b; padding: 18px; text-align: center; }
  `],
})
export class StopArrivalMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() stop: { name: string; seq?: number; lat?: number | null; lng?: number | null } | null = null;
  @Input() driver: Position | null = null;
  @Input() reached = false;
  @Input() markerUrl: string | null = null;
  @ViewChild('mapHost') host?: ElementRef<HTMLElement>;
  error = '';
  private ready = false;
  private generation = 0;
  private map: any;
  private markers: any[] = [];
  constructor(private loader: MapsLoaderService) {}
  ngAfterViewInit(): void {
    this.ready = true;
    void Promise.resolve().then(() => { if (this.ready) void this.render(); });
  }
  ngOnChanges(): void { if (this.ready) void this.render(); }
  ngOnDestroy(): void {
    this.ready = false; this.generation++;
    this.markers.forEach(marker => marker.map = null); this.markers = [];
    this.map = null;
  }
  private valid(position: { lat?: number | null; lng?: number | null } | null): position is Position {
    return position?.lat != null && position.lng != null && Number.isFinite(position.lat) &&
      Number.isFinite(position.lng) && Math.abs(position.lat) <= 90 && Math.abs(position.lng) <= 180;
  }
  private async render(): Promise<void> {
    const generation = ++this.generation;
    if (!this.valid(this.stop)) { this.error = 'Stop location unavailable'; return; }
    this.error = '';
    try {
      await this.loader.ensureLoaded();
      if (!this.ready || generation !== this.generation || !this.host) return;
      const stop = { lat: Number(this.stop!.lat), lng: Number(this.stop!.lng) };
      this.map ??= new google.maps.Map(this.host.nativeElement, {
        center: stop, zoom: 15, maxZoom: 18, mapId: 'DEMO_MAP_ID', disableDefaultUI: true,
        gestureHandling: 'cooperative', clickableIcons: false,
      });
      this.markers.forEach(marker => marker.map = null); this.markers = [];
      const pin = buildStopMarkerElement({
        seq: this.stop!.seq ?? 1, name: this.stop!.name, isNext: true, isReached: this.reached,
      });
      this.markers.push(new google.maps.marker.AdvancedMarkerElement({
        map: this.map, position: stop, content: pin, title: this.stop!.name,
      }));
      const bounds = new google.maps.LatLngBounds(); bounds.extend(stop);
      if (this.valid(this.driver)) {
        const driver = buildReusableCarMarkerElement({
          label: 'You (Car)', markerUrl: this.markerUrl,
        });
        this.markers.push(new google.maps.marker.AdvancedMarkerElement({
          map: this.map, position: this.driver, content: driver,
          title: 'Your current location', zIndex: 2,
        }));
        bounds.extend(this.driver); this.map.fitBounds(bounds, 52);
        // A compact arrival map needs surrounding streets as well as the two nearby markers.
        google.maps.event.addListenerOnce(this.map, 'idle', () => {
          if (this.ready && generation === this.generation && this.map.getZoom() > 15) this.map.setZoom(15);
        });
      } else { this.map.setCenter(stop); this.map.setZoom(16); }
    } catch {
      if (this.ready && generation === this.generation) this.error = 'Map unavailable. You can still view passengers below.';
    }
  }
}
