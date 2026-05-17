import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DropdownModule } from 'primeng/dropdown';
import { TagModule } from 'primeng/tag';
import { ApiService } from '../../core/api.service';
import { GoogleMapsLoaderService } from '../../core/google-maps-loader.service';

interface DynamicRule {
  id: number;
  name: string;
  city_id: number | null;
  ride_type_id: number | null;
  vehicle_type: string | null;
  fare_type: string;
  customer_fare_factor: number;
  driver_fare_factor: number;
  region_polygon: { lat: number; lng: number }[];
  date_from: string | null;
  date_to: string | null;
  start_time: string | null;
  end_time: string | null;
  days_of_week: number;
  is_active: boolean;
  city?: { name?: string };
  rideType?: { name?: string };
}

@Component({
  selector: 'app-dynamic-pricing-list',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, TableModule, ButtonModule, DropdownModule, TagModule],
  template: `
    <p-card header="Dynamic Pricing">
      <div class="toolbar">
        <div class="filter">
          <label>Vehicle Type</label>
          <p-dropdown
            [options]="vehicleOptions"
            [(ngModel)]="vehicleType"
            optionLabel="label"
            optionValue="value"
            [showClear]="true"
            placeholder="All"
            (onChange)="fetch()"
          ></p-dropdown>
        </div>
        <button pButton type="button" label="Add" icon="pi pi-plus" (click)="goCreate()"></button>
      </div>

      <div class="map-shell" #mapContainer></div>

      <p-table [value]="rules" [loading]="loading" responsiveLayout="scroll" class="rules-table">
        <ng-template pTemplate="header">
          <tr>
            <th>Name</th>
            <th>Ride Type</th>
            <th>Fare Type</th>
            <th>Customer ×</th>
            <th>Driver ×</th>
            <th>When</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr>
            <td>{{ row.name }}</td>
            <td>{{ row.rideType?.name || row.vehicle_type || 'All' }}</td>
            <td><p-tag [value]="row.fare_type"></p-tag></td>
            <td>{{ row.customer_fare_factor }}</td>
            <td>{{ row.driver_fare_factor }}</td>
            <td>
              <div *ngIf="row.start_time">{{ row.start_time }} – {{ row.end_time }}</div>
              <div *ngIf="row.date_from" class="muted">{{ row.date_from }} → {{ row.date_to }}</div>
              <div class="muted">{{ daysLabel(row.days_of_week) }}</div>
            </td>
            <td>
              <p-tag
                [value]="row.is_active ? 'active' : 'inactive'"
                [severity]="row.is_active ? 'success' : 'info'"
              ></p-tag>
            </td>
            <td>
              <button pButton type="button" icon="pi pi-pencil" class="p-button-text" (click)="goEdit(row)"></button>
              <button
                pButton
                type="button"
                icon="pi pi-trash"
                class="p-button-text p-button-danger"
                (click)="remove(row)"
              ></button>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="8" class="empty">No surge for this region</td>
          </tr>
        </ng-template>
      </p-table>

      <div *ngIf="error" class="error">{{ error }}</div>
    </p-card>
  `,
  styles: [
    `
      .toolbar {
        display: flex;
        gap: 12px;
        align-items: end;
        margin-bottom: 14px;
        flex-wrap: wrap;
      }
      .filter {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .filter label {
        font-size: 12px;
        font-weight: 700;
        color: rgba(15, 23, 42, 0.65);
      }
      .map-shell {
        width: 100%;
        height: 360px;
        border-radius: 12px;
        border: 1px solid rgba(15, 23, 42, 0.1);
        margin-bottom: 14px;
      }
      .rules-table {
        margin-top: 8px;
      }
      .muted {
        font-size: 12px;
        color: rgba(15, 23, 42, 0.55);
      }
      .empty {
        text-align: center;
        padding: 24px;
        color: rgba(15, 23, 42, 0.55);
      }
      .error {
        margin-top: 12px;
        color: #b00020;
        font-weight: 700;
      }
    `,
  ],
})
export class DynamicPricingListComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: false }) mapContainer!: ElementRef<HTMLDivElement>;

  rules: DynamicRule[] = [];
  loading = false;
  error: string | null = null;
  vehicleType: string | null = null;
  vehicleOptions: { label: string; value: string | null }[] = [{ label: 'All', value: null }];

  private map: google.maps.Map | null = null;
  private polygons: google.maps.Polygon[] = [];
  private mapsReady = false;

  constructor(
    private api: ApiService,
    private router: Router,
    private zone: NgZone,
    private mapsLoader: GoogleMapsLoaderService,
  ) {}

  ngOnInit(): void {
    this.loadVehicleTypes();
  }

  ngAfterViewInit(): void {
    void this.initMap();
    this.fetch();
  }

  ngOnDestroy(): void {
    this.polygons.forEach((p) => p.setMap(null));
    this.polygons = [];
  }

  goCreate(): void {
    this.router.navigateByUrl('/dynamic-pricing/new');
  }

  goEdit(row: DynamicRule): void {
    this.router.navigateByUrl(`/dynamic-pricing/${row.id}`);
  }

  remove(row: DynamicRule): void {
    if (!window.confirm(`Delete dynamic pricing rule "${row.name}"?`)) return;
    this.api.delete(`/admin/dynamic-pricing-rules/${row.id}`).subscribe({
      next: () => {
        this.rules = this.rules.filter((r) => r.id !== row.id);
        this.drawAllPolygons();
      },
      error: (err) => {
        this.error = err?.error?.message || 'Delete failed';
      },
    });
  }

  fetch(): void {
    this.loading = true;
    this.error = null;
    const params: string[] = [];
    if (this.vehicleType) params.push(`vehicle_type=${encodeURIComponent(this.vehicleType)}`);
    const qs = params.length ? `?${params.join('&')}` : '';

    this.api.get<{ data: DynamicRule[] }>(`/admin/dynamic-pricing-rules${qs}`).subscribe({
      next: (res) => {
        this.rules = res?.data ?? [];
        this.loading = false;
        this.drawAllPolygons();
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load rules';
        this.loading = false;
      },
    });
  }

  daysLabel(mask: number): string {
    if (mask === 127) return 'Every day';
    const labels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const out: string[] = [];
    for (let i = 0; i < 7; i++) if (mask & (1 << i)) out.push(labels[i]);
    return out.join(', ') || '—';
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
      zoom: 11,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
    this.mapsReady = true;
    if (this.rules.length) {
      this.drawAllPolygons();
    }
  }

  private drawAllPolygons(): void {
    if (!this.map || !this.mapsReady) return;
    this.polygons.forEach((p) => p.setMap(null));
    this.polygons = [];

    const bounds = new google.maps.LatLngBounds();
    let any = false;
    const infoWindow = new google.maps.InfoWindow();

    for (const rule of this.rules) {
      const coords = (rule.region_polygon || [])
        .map((p) => ({ lat: p.lat, lng: p.lng }))
        .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng));
      if (coords.length < 3) continue;

      const color = rule.fare_type === 'flat' ? '#10b981' : '#3b82f6';
      const polygon = new google.maps.Polygon({
        paths: coords,
        strokeColor: color,
        strokeWeight: 2,
        fillColor: color,
        fillOpacity: 0.18,
        clickable: true,
      });
      polygon.setMap(this.map);

      polygon.addListener('click', (ev: google.maps.PolyMouseEvent) => {
        infoWindow.setContent(
          `<b>${rule.name}</b><br/>${rule.fare_type} ×${rule.customer_fare_factor}`,
        );
        if (ev.latLng) infoWindow.setPosition(ev.latLng);
        infoWindow.open(this.map!);
      });

      coords.forEach((c) => {
        bounds.extend(c);
        any = true;
      });
      this.polygons.push(polygon);
    }

    if (any) {
      this.map.fitBounds(bounds, 20);
    }
  }

  private loadVehicleTypes(): void {
    this.api.get<{ data: { name: string }[] }>('/admin/ride-types').subscribe({
      next: (res) => {
        const items = res?.data || [];
        this.vehicleOptions = [
          { label: 'All', value: null },
          ...items.map((rt) => ({ label: rt.name, value: rt.name })),
        ];
      },
      error: () => {},
    });
  }
}
