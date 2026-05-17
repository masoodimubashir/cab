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
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ApiService } from '../../core/api.service';
import { GoogleMapsLoaderService } from '../../core/google-maps-loader.service';

type Filter = 'ongoing' | 'pending' | 'all';

interface RideRow {
  id: number;
  status: string;
  pickup_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  drop_address: string | null;
  drop_lat: number | null;
  drop_lng: number | null;
  estimated_fare: number | null;
  final_fare: number | null;
  customer?: { name?: string; phone?: string } | null;
  driver?: { name?: string; phone?: string } | null;
}

@Component({
  selector: 'app-rides-map',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, ButtonModule, TagModule],
  template: `
    <p-card header="Map View — Rides">
      <div class="toolbar">
        <div class="seg">
          <button
            type="button"
            class="seg__btn"
            [class.active]="filter === 'ongoing'"
            (click)="setFilter('ongoing')"
          >
            Ongoing
          </button>
          <button
            type="button"
            class="seg__btn"
            [class.active]="filter === 'pending'"
            (click)="setFilter('pending')"
          >
            Pending
          </button>
          <button
            type="button"
            class="seg__btn"
            [class.active]="filter === 'all'"
            (click)="setFilter('all')"
          >
            All
          </button>
        </div>
        <div class="toolbar__right">
          <span class="muted" *ngIf="!loading">{{ rides.length }} ride(s)</span>
          <button
            pButton
            type="button"
            icon="pi pi-refresh"
            label="Refresh"
            class="p-button-sm p-button-outlined"
            (click)="load()"
          ></button>
        </div>
      </div>

      <div class="map-shell">
        <div #mapContainer class="map-frame"></div>
        <div class="map-placeholder" *ngIf="!loading && !rides.length">
          <i class="pi pi-map" style="font-size: 28px;"></i>
          <div>No rides in this bucket.</div>
        </div>
      </div>

      <div class="legend" *ngIf="rides.length">
        <ul>
          <li *ngFor="let r of rides" (click)="focusRide(r)" [class.selected]="selectedId === r.id">
            <strong>#{{ r.id }}</strong>
            <p-tag [value]="r.status" [severity]="severityFor(r.status)"></p-tag>
            <span class="who">{{ r.customer?.name || 'Customer' }}</span>
            <span class="who muted" *ngIf="r.driver?.name">↔ {{ r.driver?.name }}</span>
            <span class="addr muted" *ngIf="r.pickup_address">· {{ r.pickup_address }}</span>
          </li>
        </ul>
      </div>

      <div *ngIf="error" class="error">{{ error }}</div>
    </p-card>
  `,
  styles: [
    `
      .toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-bottom: 10px;
        flex-wrap: wrap;
      }
      .toolbar__right {
        display: inline-flex;
        align-items: center;
        gap: 10px;
      }
      .seg {
        display: inline-flex;
        border: 1px solid rgba(15, 23, 42, 0.16);
        border-radius: 8px;
        overflow: hidden;
      }
      .seg__btn {
        padding: 6px 14px;
        border: 0;
        background: #fff;
        cursor: pointer;
        font-weight: 700;
        font-size: 13px;
        color: rgba(15, 23, 42, 0.7);
      }
      .seg__btn.active {
        background: #3b82f6;
        color: #fff;
      }
      .map-shell {
        position: relative;
        width: 100%;
        height: 520px;
        border-radius: 12px;
        overflow: hidden;
        border: 1px solid rgba(15, 23, 42, 0.08);
        background: #f1f5f9;
      }
      .map-frame {
        width: 100%;
        height: 100%;
      }
      .map-placeholder {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
        align-items: center;
        justify-content: center;
        color: rgba(15, 23, 42, 0.6);
        font-weight: 700;
        background: rgba(241, 245, 249, 0.85);
        pointer-events: none;
      }
      .legend {
        margin-top: 14px;
        background: #f8fafc;
        border-radius: 12px;
        padding: 10px 12px;
        border: 1px solid rgba(15, 23, 42, 0.06);
        max-height: 220px;
        overflow: auto;
      }
      .legend ul {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .legend li {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
      }
      .legend li:hover {
        background: rgba(59, 130, 246, 0.08);
      }
      .legend li.selected {
        background: rgba(59, 130, 246, 0.14);
      }
      .who {
        font-weight: 600;
      }
      .addr {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .muted {
        color: rgba(15, 23, 42, 0.6);
      }
      .error {
        margin-top: 12px;
        color: #b00020;
        font-weight: 700;
      }
    `,
  ],
})
export class RidesMapComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: false }) mapContainer!: ElementRef<HTMLDivElement>;

  rides: RideRow[] = [];
  filter: Filter = 'ongoing';
  loading = false;
  error: string | null = null;
  selectedId: number | null = null;

  private map: google.maps.Map | null = null;
  private mapsReady = false;
  private pickupMarkers: google.maps.Marker[] = [];
  private dropMarkers: google.maps.Marker[] = [];
  private polylines: google.maps.Polyline[] = [];
  private infoWindow: google.maps.InfoWindow | null = null;
  private pendingRides: RideRow[] | null = null;

  constructor(
    private api: ApiService,
    private zone: NgZone,
    private mapsLoader: GoogleMapsLoaderService,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  ngAfterViewInit(): void {
    void this.initMap();
  }

  ngOnDestroy(): void {
    this.clearOverlays();
    this.infoWindow?.close();
  }

  setFilter(f: Filter): void {
    if (this.filter === f) return;
    this.filter = f;
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.api.get<any>(`/admin/trips?category=${this.filter}`).subscribe({
      next: (res) => {
        this.rides = (res?.data?.data ?? []) as RideRow[];
        if (this.mapsReady) {
          this.redraw();
        } else {
          this.pendingRides = this.rides;
        }
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load rides';
        this.loading = false;
      },
    });
  }

  focusRide(r: RideRow): void {
    this.selectedId = r.id;
    if (!this.map) return;
    if (r.pickup_lat != null && r.pickup_lng != null) {
      this.map.setCenter({ lat: r.pickup_lat, lng: r.pickup_lng });
      this.map.setZoom(14);
    }
  }

  severityFor(status: string): 'success' | 'info' | 'warning' | 'danger' | undefined {
    if (status === 'COMPLETED') return 'success';
    if (status === 'CANCELLED') return 'danger';
    if (status === 'NEGOTIATION' || status === 'REQUESTED') return 'warning';
    return 'info';
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
      clickableIcons: false,
    });
    this.infoWindow = new google.maps.InfoWindow();
    this.mapsReady = true;
    if (this.pendingRides) {
      this.redraw();
      this.pendingRides = null;
    }
  }

  private clearOverlays(): void {
    this.pickupMarkers.forEach((m) => m.setMap(null));
    this.dropMarkers.forEach((m) => m.setMap(null));
    this.polylines.forEach((p) => p.setMap(null));
    this.pickupMarkers = [];
    this.dropMarkers = [];
    this.polylines = [];
  }

  private redraw(): void {
    if (!this.map) return;
    this.clearOverlays();
    if (!this.rides.length) return;

    const bounds = new google.maps.LatLngBounds();
    let any = false;

    const pickupIcon: google.maps.Symbol = {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 7,
      fillColor: '#10b981',
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2,
    };
    const dropIcon: google.maps.Symbol = {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 7,
      fillColor: '#ef4444',
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2,
    };

    for (const r of this.rides) {
      const hasPickup = r.pickup_lat != null && r.pickup_lng != null;
      const hasDrop = r.drop_lat != null && r.drop_lng != null;
      if (!hasPickup && !hasDrop) continue;

      if (hasPickup) {
        const pos = { lat: r.pickup_lat!, lng: r.pickup_lng! };
        const marker = new google.maps.Marker({
          position: pos,
          map: this.map,
          icon: pickupIcon,
          title: `Pickup · #${r.id}`,
        });
        marker.addListener('click', () => this.openInfo(marker, r, 'pickup'));
        this.pickupMarkers.push(marker);
        bounds.extend(pos);
        any = true;
      }
      if (hasDrop) {
        const pos = { lat: r.drop_lat!, lng: r.drop_lng! };
        const marker = new google.maps.Marker({
          position: pos,
          map: this.map,
          icon: dropIcon,
          title: `Drop · #${r.id}`,
        });
        marker.addListener('click', () => this.openInfo(marker, r, 'drop'));
        this.dropMarkers.push(marker);
        bounds.extend(pos);
        any = true;
      }
      if (hasPickup && hasDrop) {
        const line = new google.maps.Polyline({
          map: this.map,
          path: [
            { lat: r.pickup_lat!, lng: r.pickup_lng! },
            { lat: r.drop_lat!, lng: r.drop_lng! },
          ],
          strokeColor: '#3b82f6',
          strokeOpacity: 0.85,
          strokeWeight: 3,
        });
        this.polylines.push(line);
      }
    }

    if (any) {
      this.map.fitBounds(bounds, 60);
      // Clamp the auto-zoom so a single ride doesn't drop us into street level.
      const listener = google.maps.event.addListenerOnce(this.map, 'idle', () => {
        if (this.map && (this.map.getZoom() ?? 0) > 15) this.map.setZoom(15);
      });
      void listener;
    }
  }

  private openInfo(marker: google.maps.Marker, r: RideRow, which: 'pickup' | 'drop'): void {
    if (!this.infoWindow || !this.map) return;
    const fare = r.final_fare ?? r.estimated_fare;
    const addr = which === 'pickup' ? r.pickup_address : r.drop_address;
    const html = `
      <div style="font-family: inherit; min-width: 200px;">
        <div style="font-weight: 800; margin-bottom: 4px;">
          Trip #${r.id} · ${r.status}
        </div>
        <div style="font-size: 12px; margin-bottom: 2px;">
          <b>${which === 'pickup' ? 'Pickup' : 'Drop'}:</b> ${addr || '—'}
        </div>
        <div style="font-size: 12px;">Customer: ${r.customer?.name || '—'}</div>
        <div style="font-size: 12px;">Driver: ${r.driver?.name || '—'}</div>
        ${fare != null ? `<div style="font-size: 12px; margin-top: 4px;">Fare: ₹${fare}</div>` : ''}
      </div>
    `;
    this.infoWindow.setContent(html);
    this.infoWindow.open({ map: this.map, anchor: marker });
    this.selectedId = r.id;
  }
}
