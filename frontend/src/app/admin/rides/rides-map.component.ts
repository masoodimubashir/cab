import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { ApiService } from '../../core/api.service';

interface OngoingTrip {
  id: number;
  status: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  drop_lat: number | null;
  drop_lng: number | null;
  customer?: { name?: string; phone?: string };
  driver?: { name?: string; phone?: string };
}

@Component({
  selector: 'app-rides-map',
  standalone: true,
  imports: [CommonModule, CardModule, ButtonModule],
  template: `
    <p-card header="Map View — Ongoing Rides">
      <div class="map-shell">
        <iframe
          *ngIf="bbox"
          class="map-frame"
          [src]="mapSrc"
          referrerpolicy="no-referrer-when-downgrade"
          loading="lazy"
        ></iframe>
        <div class="map-placeholder" *ngIf="!bbox">
          <i class="pi pi-map" style="font-size: 28px;"></i>
          <div>{{ loading ? 'Loading ongoing rides…' : 'No ongoing rides with pickup coordinates to plot.' }}</div>
        </div>
      </div>

      <div class="legend" *ngIf="trips.length">
        <div class="legend__title">{{ trips.length }} ongoing ride(s)</div>
        <ul>
          <li *ngFor="let t of trips">
            <strong>#{{ t.id }}</strong>
            <span class="muted">{{ t.status }}</span>
            — {{ t.customer?.name || 'Customer' }}
            <span *ngIf="t.driver?.name"> ↔ {{ t.driver?.name }}</span>
            <span class="coords" *ngIf="t.pickup_lat != null">
              ({{ t.pickup_lat | number: '1.4-4' }}, {{ t.pickup_lng | number: '1.4-4' }})
            </span>
          </li>
        </ul>
      </div>

      <button
        pButton
        type="button"
        icon="pi pi-refresh"
        label="Refresh"
        (click)="load()"
        class="p-button-sm"
        style="margin-top: 12px;"
      ></button>

      <div *ngIf="error" class="error">{{ error }}</div>
    </p-card>
  `,
  styles: [
    `
      .map-shell {
        width: 100%;
        height: 480px;
        border-radius: 12px;
        overflow: hidden;
        border: 1px solid rgba(15, 23, 42, 0.08);
        background: #f1f5f9;
      }
      .map-frame {
        width: 100%;
        height: 100%;
        border: 0;
      }
      .map-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 10px;
        align-items: center;
        justify-content: center;
        color: rgba(15, 23, 42, 0.6);
        font-weight: 700;
      }
      .legend {
        margin-top: 16px;
        background: #f8fafc;
        border-radius: 12px;
        padding: 12px 14px;
        border: 1px solid rgba(15, 23, 42, 0.06);
      }
      .legend__title {
        font-weight: 800;
        margin-bottom: 6px;
        color: #0f172a;
      }
      .legend ul {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .muted {
        color: rgba(15, 23, 42, 0.55);
        font-size: 12px;
        margin-left: 6px;
      }
      .coords {
        margin-left: 8px;
        font-size: 12px;
        color: rgba(15, 23, 42, 0.7);
      }
      .error {
        margin-top: 12px;
        color: #b00020;
        font-weight: 700;
      }
    `,
  ],
})
export class RidesMapComponent implements OnInit {
  trips: OngoingTrip[] = [];
  loading = false;
  error: string | null = null;
  bbox: string | null = null;
  mapSrc: SafeResourceUrl | null = null;

  constructor(private api: ApiService, private sanitizer: DomSanitizer) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.api.get<any>('/admin/trips?category=ongoing').subscribe({
      next: (res) => {
        this.trips = (res?.data?.data ?? []) as OngoingTrip[];
        this.computeBbox();
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load ongoing rides';
        this.loading = false;
      },
    });
  }

  private computeBbox(): void {
    const points = this.trips
      .map((t) => [t.pickup_lat, t.pickup_lng] as [number | null, number | null])
      .filter(([lat, lng]) => lat != null && lng != null) as [number, number][];

    if (!points.length) {
      this.bbox = null;
      this.mapSrc = null;
      return;
    }

    const lats = points.map((p) => p[0]);
    const lngs = points.map((p) => p[1]);
    let minLat = Math.min(...lats);
    let maxLat = Math.max(...lats);
    let minLng = Math.min(...lngs);
    let maxLng = Math.max(...lngs);

    // Pad by ~0.01 deg so a single point still gets a sensible viewport.
    if (minLat === maxLat) { minLat -= 0.02; maxLat += 0.02; }
    if (minLng === maxLng) { minLng -= 0.02; maxLng += 0.02; }

    this.bbox = `${minLng},${minLat},${maxLng},${maxLat}`;
    // Use first point as marker — OSM embed only supports one. The legend below
    // lists every trip; a true multi-marker render needs Leaflet which we'll
    // wire up if/when this view becomes load-bearing.
    const [mLat, mLng] = points[0];
    const url = `https://www.openstreetmap.org/export/embed.html?bbox=${this.bbox}&layer=mapnik&marker=${mLat},${mLng}`;
    this.mapSrc = this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }
}
