import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { CalendarModule } from 'primeng/calendar';
import { CheckboxModule } from 'primeng/checkbox';
import { ApiService } from '../../core/api.service';
import { GoogleMapsLoaderService } from '../../core/google-maps-loader.service';

interface PolygonPoint {
  lat: number;
  lng: number;
}

interface DynamicRulePayload {
  id?: number;
  name: string;
  city_id: number | null;
  vehicle_type: string | null;
  fare_type: 'flat' | 'percentage';
  customer_fare_factor: number;
  customer_priority: number;
  driver_fare_factor: number;
  driver_priority: number;
  region_polygon: PolygonPoint[];
  date_from: string | null;
  date_to: string | null;
  days_of_week: number;
  start_time: string | null;
  end_time: string | null;
  is_active: boolean;
  is_visible: boolean;
}

interface City {
  id: number;
  name: string;
  center_lat: number | null;
  center_lng: number | null;
  boundary_polygon: PolygonPoint[] | null;
}

type PolygonSource = 'city' | 'custom';

@Component({
  selector: 'app-dynamic-pricing-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    DropdownModule,
    InputTextModule,
    InputNumberModule,
    CalendarModule,
    CheckboxModule,
  ],
  template: `
    <p-card [header]="editing ? 'Edit Dynamic Pricing' : 'Add Dynamic Pricing'">
      <div class="layout">
        <section class="map-side">
          <div class="map-toolbar">
            <span class="hint" *ngIf="polygonSource === 'custom'">
              Click inside the city's fence to add vertices ({{ polygon.length }} so far).
            </span>
            <span class="hint" *ngIf="polygonSource === 'city'">
              Using the entire <strong>{{ selectedCity?.name || 'city' }}</strong> service area.
            </span>
            <button
              pButton
              type="button"
              label="Undo last point"
              icon="pi pi-undo"
              class="p-button-text"
              [disabled]="!polygon.length || polygonSource !== 'custom'"
              (click)="undoPoint()"
            ></button>
            <button
              pButton
              type="button"
              label="Clear"
              icon="pi pi-trash"
              class="p-button-text p-button-danger"
              [disabled]="!polygon.length || polygonSource !== 'custom'"
              (click)="clearPolygon()"
            ></button>
          </div>
          <div *ngIf="outsideWarning" class="warn">{{ outsideWarning }}</div>
          <div class="map-shell" #mapContainer></div>
        </section>

        <section class="form-side">
          <label>City</label>
          <p-dropdown
            [options]="cityOptions"
            [(ngModel)]="model.city_id"
            optionLabel="label"
            optionValue="value"
            placeholder="Select a city"
            (onChange)="onCityChange()"
          ></p-dropdown>
          <small *ngIf="model.city_id && !selectedCity?.boundary_polygon?.length" class="warn-text">
            This city has no geofence yet — set one in Settings → Geofencing first.
          </small>

          <label>Polygon Source</label>
          <p-dropdown
            [options]="polygonSourceOptions"
            [(ngModel)]="polygonSource"
            optionLabel="label"
            optionValue="value"
            [disabled]="!model.city_id || !selectedCity?.boundary_polygon?.length"
            (onChange)="onPolygonSourceChange()"
          ></p-dropdown>

          <label>Region Name</label>
          <input pInputText [(ngModel)]="model.name" placeholder="e.g. Lal Chowk Surge" />

          <label>Fare Type</label>
          <p-dropdown
            [options]="fareTypeOptions"
            [(ngModel)]="model.fare_type"
            optionLabel="label"
            optionValue="value"
          ></p-dropdown>

          <div class="row">
            <div class="col">
              <label>Customer Fare Factor</label>
              <p-inputNumber [(ngModel)]="model.customer_fare_factor" [minFractionDigits]="2" [min]="0" />
            </div>
            <div class="col">
              <label>Customer Priority</label>
              <p-inputNumber [(ngModel)]="model.customer_priority" [min]="0" />
            </div>
          </div>

          <div class="row">
            <div class="col">
              <label>Driver Fare Factor</label>
              <p-inputNumber [(ngModel)]="model.driver_fare_factor" [minFractionDigits]="2" [min]="0" />
            </div>
            <div class="col">
              <label>Driver Priority</label>
              <p-inputNumber [(ngModel)]="model.driver_priority" [min]="0" />
            </div>
          </div>

          <label>Vehicle Type</label>
          <p-dropdown
            [options]="vehicleOptions"
            [(ngModel)]="model.vehicle_type"
            optionLabel="label"
            optionValue="value"
            [showClear]="true"
            placeholder="All"
          ></p-dropdown>

          <div class="row">
            <div class="col">
              <label>Date From</label>
              <p-calendar [(ngModel)]="dateFrom" dateFormat="yy-mm-dd" [showIcon]="true"></p-calendar>
            </div>
            <div class="col">
              <label>Date To</label>
              <p-calendar [(ngModel)]="dateTo" dateFormat="yy-mm-dd" [showIcon]="true"></p-calendar>
            </div>
          </div>

          <label>Select Days</label>
          <div class="day-pills">
            <button
              *ngFor="let d of dayLabels; let i = index"
              type="button"
              class="day-pill"
              [class.active]="isDayOn(i)"
              (click)="toggleDay(i)"
            >
              {{ d }}
            </button>
          </div>

          <div class="row">
            <div class="col">
              <label>Start Time</label>
              <input type="time" [(ngModel)]="model.start_time" />
            </div>
            <div class="col">
              <label>End Time</label>
              <input type="time" [(ngModel)]="model.end_time" />
            </div>
          </div>

          <label>Status</label>
          <div class="checkbox-row">
            <p-checkbox [(ngModel)]="model.is_active" [binary]="true" inputId="active"></p-checkbox>
            <label for="active">{{ model.is_active ? 'Active' : 'Deactive' }}</label>
          </div>

          <label>Is Visible</label>
          <div class="checkbox-row">
            <p-checkbox [(ngModel)]="model.is_visible" [binary]="true" inputId="visible"></p-checkbox>
            <label for="visible">{{ model.is_visible ? 'Active' : 'Deactive' }}</label>
          </div>

          <div *ngIf="error" class="error">{{ error }}</div>

          <div class="actions">
            <button
              pButton
              type="button"
              label="Cancel"
              class="p-button-text"
              (click)="cancel()"
            ></button>
            <button
              pButton
              type="button"
              [label]="editing ? 'Update' : 'Submit'"
              [disabled]="!canSubmit || submitting"
              (click)="save()"
            ></button>
          </div>
        </section>
      </div>
    </p-card>
  `,
  styles: [
    `
      .layout {
        display: grid;
        grid-template-columns: 1.4fr 1fr;
        gap: 18px;
      }
      .map-side {
        display: flex;
        flex-direction: column;
      }
      .map-toolbar {
        display: flex;
        gap: 10px;
        align-items: center;
        margin-bottom: 8px;
      }
      .hint {
        font-size: 13px;
        color: rgba(15, 23, 42, 0.6);
      }
      .map-shell {
        flex: 1;
        min-height: 540px;
        border-radius: 12px;
        border: 1px solid rgba(15, 23, 42, 0.1);
      }
      .form-side {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .form-side label {
        margin-top: 8px;
        font-size: 12px;
        font-weight: 700;
        color: rgba(15, 23, 42, 0.7);
      }
      .form-side input[type='text'],
      .form-side input[type='time'] {
        height: 38px;
        border-radius: 8px;
        border: 1px solid rgba(15, 23, 42, 0.15);
        padding: 0 10px;
      }
      .row {
        display: flex;
        gap: 10px;
      }
      .col {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      .checkbox-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 6px;
      }
      .checkbox-row label {
        margin: 0 12px 0 4px;
      }
      .day-pills {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .day-pill {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: 1px solid rgba(15, 23, 42, 0.18);
        background: #fff;
        cursor: pointer;
        font-weight: 700;
      }
      .day-pill.active {
        background: #3b82f6;
        color: #fff;
        border-color: #3b82f6;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 14px;
      }
      .error {
        margin-top: 10px;
        color: #b00020;
        font-weight: 700;
      }
      .warn {
        margin: 6px 0;
        padding: 6px 10px;
        background: rgba(245, 158, 11, 0.14);
        color: #92400e;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 600;
      }
      .warn-text {
        color: #92400e;
        font-size: 12px;
        margin-top: -4px;
      }
      @media (max-width: 980px) {
        .layout {
          grid-template-columns: 1fr;
        }
        .map-shell {
          min-height: 360px;
        }
      }
    `,
  ],
})
export class DynamicPricingFormComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: false }) mapContainer!: ElementRef<HTMLDivElement>;

  editing = false;
  submitting = false;
  error: string | null = null;

  model: DynamicRulePayload = this.defaults();
  polygon: PolygonPoint[] = [];

  dateFrom: Date | null = null;
  dateTo: Date | null = null;

  dayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  fareTypeOptions = [
    { label: 'Flat Charge', value: 'flat' },
    { label: 'Percentage', value: 'percentage' },
  ];

  vehicleOptions: { label: string; value: string | null }[] = [];

  cities: City[] = [];
  cityOptions: { label: string; value: number | null }[] = [];
  polygonSource: PolygonSource = 'custom';
  polygonSourceOptions = [
    { label: 'City Polygon', value: 'city' },
    { label: 'Custom', value: 'custom' },
  ];
  outsideWarning: string | null = null;

  private map: google.maps.Map | null = null;
  private polygonLayer: google.maps.Polygon | null = null;
  private cityReferenceLayer: google.maps.Polygon | null = null;
  private vertexMarkers: google.maps.Marker[] = [];
  private clickListener: google.maps.MapsEventListener | null = null;
  private mapsReady = false;
  private pendingPolygonCoords: { lat: number; lng: number }[] | null = null;
  private outsideWarnTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private api: ApiService,
    private route: ActivatedRoute,
    private router: Router,
    private zone: NgZone,
    private mapsLoader: GoogleMapsLoaderService,
  ) {}

  ngOnInit(): void {
    this.loadDropdowns();
    const id = this.route.snapshot.paramMap.get('id');
    if (id && id !== 'new') {
      this.editing = true;
      this.fetchExisting(parseInt(id, 10));
    }
  }

  ngAfterViewInit(): void {
    void this.initMap();
  }

  ngOnDestroy(): void {
    this.clickListener?.remove();
    this.polygonLayer?.setMap(null);
    this.cityReferenceLayer?.setMap(null);
    this.vertexMarkers.forEach((m) => m.setMap(null));
    this.vertexMarkers = [];
    if (this.outsideWarnTimer) clearTimeout(this.outsideWarnTimer);
  }

  get canSubmit(): boolean {
    return (
      !!this.model.name?.trim() &&
      this.polygon.length >= 3 &&
      this.model.customer_fare_factor > 0 &&
      this.model.driver_fare_factor > 0
    );
  }

  get selectedCity(): City | null {
    if (this.model.city_id == null) return null;
    return this.cities.find((c) => c.id === this.model.city_id) ?? null;
  }

  onCityChange(): void {
    const city = this.selectedCity;
    // Reset draft when switching cities — coords from one city aren't valid in another.
    this.polygon = [];
    if (!city || !city.boundary_polygon?.length) {
      this.polygonSource = 'custom';
    } else {
      // Default to "city" mode when a fenced city is picked, since that's the common path.
      this.polygonSource = 'city';
      this.polygon = city.boundary_polygon.map((p) => ({ lat: p.lat, lng: p.lng }));
    }
    this.redrawPolygon();
    this.redrawCityReference();
    this.fitToCity();
  }

  onPolygonSourceChange(): void {
    const city = this.selectedCity;
    if (this.polygonSource === 'city') {
      this.polygon = city?.boundary_polygon
        ? city.boundary_polygon.map((p) => ({ lat: p.lat, lng: p.lng }))
        : [];
    } else {
      // Switching to custom — start fresh inside the city's fence.
      this.polygon = [];
    }
    this.redrawPolygon();
    this.redrawCityReference();
  }

  toggleDay(idx: number): void {
    this.model.days_of_week ^= 1 << idx;
  }

  isDayOn(idx: number): boolean {
    return (this.model.days_of_week & (1 << idx)) > 0;
  }

  undoPoint(): void {
    this.polygon = this.polygon.slice(0, -1);
    this.redrawPolygon();
  }

  clearPolygon(): void {
    this.polygon = [];
    this.redrawPolygon();
  }

  cancel(): void {
    this.router.navigateByUrl('/dynamic-pricing');
  }

  save(): void {
    if (!this.canSubmit || this.submitting) return;
    this.submitting = true;
    this.error = null;

    const payload: DynamicRulePayload = {
      ...this.model,
      region_polygon: this.polygon,
      date_from: this.dateFrom ? this.formatDate(this.dateFrom) : null,
      date_to: this.dateTo ? this.formatDate(this.dateTo) : null,
    };

    const req$ = this.editing && this.model.id
      ? this.api.patch(`/admin/dynamic-pricing-rules/${this.model.id}`, payload)
      : this.api.post('/admin/dynamic-pricing-rules', payload);

    req$.subscribe({
      next: () => {
        this.router.navigateByUrl('/dynamic-pricing');
      },
      error: (err) => {
        this.error = err?.error?.message || 'Save failed';
        this.submitting = false;
      },
    });
  }

  private fetchExisting(id: number): void {
    this.api.get<{ rule: DynamicRulePayload & { region_polygon: PolygonPoint[] } }>(
      `/admin/dynamic-pricing-rules/${id}`,
    ).subscribe({
      next: (res) => {
        const r = res.rule;
        this.model = {
          ...this.defaults(),
          ...r,
        };
        this.polygon = (r.region_polygon || []).map((p) => ({ lat: p.lat, lng: p.lng }));
        this.dateFrom = r.date_from ? new Date(r.date_from) : null;
        this.dateTo = r.date_to ? new Date(r.date_to) : null;
        // Infer polygon source: if it matches the city's polygon vertex-for-vertex, treat it as "city".
        this.polygonSource = this.inferPolygonSource();
        if (this.mapsReady) {
          this.redrawPolygon();
          this.redrawCityReference();
          this.fitToPolygon();
        } else {
          this.pendingPolygonCoords = this.polygon;
        }
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load rule';
      },
    });
  }

  private async initMap(): Promise<void> {
    if (!this.mapContainer?.nativeElement) return;
    try {
      await this.mapsLoader.load();
    } catch {
      this.zone.run(() => (this.error = 'Could not load Google Maps.'));
      return;
    }
    this.map = new google.maps.Map(this.mapContainer.nativeElement, {
      center: { lat: 33.7311, lng: 75.1487 },
      zoom: 12,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
    });
    this.mapsReady = true;

    this.clickListener = this.map.addListener('click', (ev: google.maps.MapMouseEvent) => {
      if (!ev.latLng) return;
      // City mode is locked to the city polygon — clicks are no-ops.
      if (this.polygonSource === 'city') return;
      const lat = ev.latLng.lat();
      const lng = ev.latLng.lng();
      const fence = this.selectedCity?.boundary_polygon;
      if (fence?.length && !this.pointInPolygon(lat, lng, fence)) {
        this.zone.run(() => this.flashOutsideWarning());
        return;
      }
      this.zone.run(() => {
        this.polygon = [...this.polygon, { lat, lng }];
        this.redrawPolygon();
      });
    });

    if (this.pendingPolygonCoords) {
      this.polygon = this.pendingPolygonCoords;
      this.pendingPolygonCoords = null;
      this.redrawPolygon();
      this.fitToPolygon();
    }
  }

  private redrawPolygon(): void {
    if (!this.map || !this.mapsReady) return;

    if (this.polygonLayer) {
      this.polygonLayer.setMap(null);
      this.polygonLayer = null;
    }
    this.vertexMarkers.forEach((m) => m.setMap(null));
    this.vertexMarkers = [];

    if (!this.polygon.length) return;

    if (this.polygon.length >= 3) {
      this.polygonLayer = new google.maps.Polygon({
        paths: this.polygon,
        strokeColor: '#3b82f6',
        strokeWeight: 2,
        fillColor: '#3b82f6',
        fillOpacity: 0.22,
        clickable: false,
      });
      this.polygonLayer.setMap(this.map);
    }

    // Vertex handles only when the user is drawing a custom polygon.
    if (this.polygonSource === 'custom') {
      for (const p of this.polygon) {
        const marker = new google.maps.Marker({
          position: p,
          map: this.map,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 5,
            fillColor: '#ffffff',
            fillOpacity: 1,
            strokeColor: '#3b82f6',
            strokeWeight: 2,
          },
        });
        this.vertexMarkers.push(marker);
      }
    }
  }

  private redrawCityReference(): void {
    if (!this.map || !this.mapsReady) return;
    this.cityReferenceLayer?.setMap(null);
    this.cityReferenceLayer = null;

    // Only show the dimmed city reference when the user is drawing a CUSTOM polygon
    // inside it. In city-polygon mode, the active polygonLayer already represents the city.
    const fence = this.selectedCity?.boundary_polygon;
    if (this.polygonSource !== 'custom' || !fence?.length) return;

    this.cityReferenceLayer = new google.maps.Polygon({
      paths: fence,
      strokeColor: '#94a3b8',
      strokeWeight: 1,
      strokeOpacity: 0.7,
      fillColor: '#94a3b8',
      fillOpacity: 0.08,
      clickable: false,
      zIndex: 1,
    });
    this.cityReferenceLayer.setMap(this.map);
  }

  private fitToPolygon(): void {
    if (!this.map || !this.polygon.length) return;
    const bounds = new google.maps.LatLngBounds();
    this.polygon.forEach((p) => bounds.extend(p));
    this.map.fitBounds(bounds, 20);
  }

  private fitToCity(): void {
    if (!this.map) return;
    const city = this.selectedCity;
    if (!city) return;
    if (city.boundary_polygon?.length) {
      const bounds = new google.maps.LatLngBounds();
      city.boundary_polygon.forEach((p) => bounds.extend(p));
      this.map.fitBounds(bounds, 30);
    } else if (city.center_lat != null && city.center_lng != null) {
      this.map.setCenter({ lat: city.center_lat, lng: city.center_lng });
      this.map.setZoom(12);
    }
  }

  private pointInPolygon(lat: number, lng: number, polygon: PolygonPoint[]): boolean {
    let inside = false;
    const n = polygon.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = polygon[i].lng;
      const yi = polygon[i].lat;
      const xj = polygon[j].lng;
      const yj = polygon[j].lat;
      const intersect =
        yi > lat !== yj > lat &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  private inferPolygonSource(): PolygonSource {
    const fence = this.selectedCity?.boundary_polygon;
    if (!fence?.length || this.polygon.length !== fence.length) return 'custom';
    for (let i = 0; i < fence.length; i++) {
      if (
        Math.abs(fence[i].lat - this.polygon[i].lat) > 1e-6 ||
        Math.abs(fence[i].lng - this.polygon[i].lng) > 1e-6
      ) {
        return 'custom';
      }
    }
    return 'city';
  }

  private flashOutsideWarning(): void {
    this.outsideWarning = `Point is outside ${this.selectedCity?.name ?? 'the city'}'s service area — pick somewhere inside the dimmed boundary.`;
    if (this.outsideWarnTimer) clearTimeout(this.outsideWarnTimer);
    this.outsideWarnTimer = setTimeout(() => (this.outsideWarning = null), 3000);
  }

  private loadDropdowns(): void {
    this.api.get<{ data: { id: number; name: string }[] }>('/admin/ride-types').subscribe({
      next: (res) => {
        const items = res?.data || [];
        this.vehicleOptions = items.map((rt) => ({ label: rt.name, value: rt.name }));
      },
      error: () => {},
    });

    this.api.get<{ data: City[] }>('/admin/cities').subscribe({
      next: (res) => {
        this.cities = res?.data || [];
        this.cityOptions = this.cities.map((c) => ({ label: c.name, value: c.id }));
        // Once cities are in, refresh the map so the reference layer renders.
        if (this.mapsReady) {
          this.redrawCityReference();
          this.fitToCity();
        }
      },
      error: () => {},
    });
  }

  private defaults(): DynamicRulePayload {
    return {
      name: '',
      city_id: null,
      vehicle_type: null,
      fare_type: 'percentage',
      customer_fare_factor: 1.5,
      customer_priority: 10,
      driver_fare_factor: 1.3,
      driver_priority: 10,
      region_polygon: [],
      date_from: null,
      date_to: null,
      days_of_week: 127,
      start_time: null,
      end_time: null,
      is_active: true,
      is_visible: true,
    };
  }

  private formatDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
}
