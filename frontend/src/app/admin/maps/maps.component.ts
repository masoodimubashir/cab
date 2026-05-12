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
import { DropdownModule } from 'primeng/dropdown';
import { TagModule } from 'primeng/tag';
import { ApiService } from '../../core/api.service';
import { GoogleMapsLoaderService } from '../../core/google-maps-loader.service';

interface DriverRow {
  id: number;
  user_id: number;
  name: string | null;
  phone: string | null;
  vehicle_type: string | null;
  vehicle_reg_no: string | null;
  is_online: boolean;
  lat: number | null;
  lng: number | null;
  last_seen_at: string | null;
  status: 'free' | 'busy' | 'inactive';
  inactive_reason?: 'offline' | 'no_location' | 'stale_location';
}

interface TaskRow {
  id: number;
  status: string;
  pickup_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  drop_address: string | null;
  drop_lat: number | null;
  drop_lng: number | null;
  estimated_fare: number | null;
  customer: { id: number; name: string | null; phone: string | null } | null;
  driver: { id: number; name: string | null; phone: string | null } | null;
  ride_type: string | null;
  created_at: string | null;
}

interface Snapshot {
  drivers: { free: DriverRow[]; busy: DriverRow[]; inactive: DriverRow[] };
  tasks: { unassigned: TaskRow[]; assigned: TaskRow[] };
  counts: { free: number; busy: number; inactive: number; unassigned: number; assigned: number };
}

interface CityRow {
  id: number;
  name: string;
  center_lat?: number | null;
  center_lng?: number | null;
  boundary_polygon?: { lat: number; lng: number }[] | null;
}

@Component({
  selector: 'app-maps',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, ButtonModule, DropdownModule, TagModule],
  template: `
    <div class="dispatch-shell" [class.dark]="darkMode">
      <header class="topbar">
        <div class="topbar__left">
          <p-dropdown
            [options]="cityOptions"
            [(ngModel)]="cityId"
            optionLabel="name"
            optionValue="id"
            [showClear]="true"
            placeholder="All cities"
            (onChange)="recenterMap()"
          ></p-dropdown>
          <div class="seg">
            <button type="button" class="seg__btn" [class.active]="view === 'map'" (click)="view = 'map'">
              <i class="pi pi-map"></i> Map
            </button>
            <button type="button" class="seg__btn" [class.active]="view === 'list'" (click)="view = 'list'">
              <i class="pi pi-list"></i> List
            </button>
          </div>
        </div>
        <div class="topbar__right">
          <button pButton type="button" label="Refresh" icon="pi pi-refresh" class="p-button-outlined" (click)="fetch()"></button>
          <label class="dark-toggle">
            <input type="checkbox" [(ngModel)]="darkMode" />
            <span>Dark Mode</span>
          </label>
        </div>
      </header>

      <div class="dispatch-grid">
        <aside class="panel panel--tasks">
          <header class="panel__header">
            <span>Tasks</span>
          </header>
          <div class="tabs">
            <button
              type="button"
              class="tab"
              [class.active]="taskTab === 'unassigned'"
              (click)="taskTab = 'unassigned'"
            >
              Unassigned ({{ snapshot?.counts?.unassigned || 0 }})
            </button>
            <button
              type="button"
              class="tab"
              [class.active]="taskTab === 'assigned'"
              (click)="taskTab = 'assigned'"
            >
              Assigned ({{ snapshot?.counts?.assigned || 0 }})
            </button>
          </div>
          <div class="panel__filter">
            <input
              type="search"
              [(ngModel)]="taskFilter"
              placeholder="Filter tasks…"
              class="search"
            />
          </div>
          <div class="panel__body">
            <div *ngIf="!filteredTasks.length" class="empty">No request details for today</div>
            <div
              *ngFor="let t of filteredTasks"
              class="task-card"
              [class.selected]="selectedTaskId === t.id"
              (click)="selectTask(t)"
            >
              <div class="task-card__top">
                <span class="task-card__id">#{{ t.id }}</span>
                <p-tag [value]="t.status" [severity]="taskSeverity(t.status)"></p-tag>
              </div>
              <div class="task-card__name">{{ t.customer?.name || 'Customer' }}</div>
              <div class="task-card__addr">
                <i class="pi pi-map-marker"></i> {{ t.pickup_address || pretty(t.pickup_lat, t.pickup_lng) }}
              </div>
              <div class="task-card__addr muted" *ngIf="t.drop_address">
                <i class="pi pi-flag"></i> {{ t.drop_address }}
              </div>
              <div class="task-card__meta">
                <span *ngIf="t.ride_type">{{ t.ride_type }}</span>
                <span *ngIf="t.estimated_fare">₹{{ t.estimated_fare }}</span>
                <span class="muted">{{ t.created_at | date:'shortTime' }}</span>
              </div>
              <div class="task-card__driver" *ngIf="t.driver">
                Driver: {{ t.driver.name }} ({{ t.driver.phone }})
              </div>
            </div>
          </div>
        </aside>

        <section class="map-area" *ngIf="view === 'map'">
          <div class="map-shell" #mapContainer></div>
        </section>

        <section class="list-area" *ngIf="view === 'list'">
          <h3>All tasks</h3>
          <table class="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Status</th>
                <th>Customer</th>
                <th>Driver</th>
                <th>Pickup</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let t of allTasks">
                <td>#{{ t.id }}</td>
                <td><p-tag [value]="t.status" [severity]="taskSeverity(t.status)"></p-tag></td>
                <td>{{ t.customer?.name || '-' }}</td>
                <td>{{ t.driver?.name || '-' }}</td>
                <td>{{ t.pickup_address || '-' }}</td>
                <td>{{ t.created_at | date:'short' }}</td>
              </tr>
              <tr *ngIf="!allTasks.length">
                <td colspan="6" class="empty">No tasks.</td>
              </tr>
            </tbody>
          </table>
        </section>

        <aside class="panel panel--drivers">
          <header class="panel__header">
            <span>Drivers</span>
          </header>
          <div class="tabs">
            <button
              type="button"
              class="tab"
              [class.active]="driverTab === 'free'"
              (click)="driverTab = 'free'"
            >
              Free ({{ snapshot?.counts?.free || 0 }})
            </button>
            <button
              type="button"
              class="tab"
              [class.active]="driverTab === 'busy'"
              (click)="driverTab = 'busy'"
            >
              Busy ({{ snapshot?.counts?.busy || 0 }})
            </button>
            <button
              type="button"
              class="tab"
              [class.active]="driverTab === 'inactive'"
              (click)="driverTab = 'inactive'"
            >
              Inactive ({{ snapshot?.counts?.inactive || 0 }})
            </button>
          </div>
          <div class="panel__filter">
            <input
              type="search"
              [(ngModel)]="driverFilter"
              placeholder="Filter drivers…"
              class="search"
            />
          </div>
          <div class="panel__body">
            <div *ngIf="!filteredDrivers.length" class="empty">No drivers in this bucket.</div>
            <div
              *ngFor="let d of filteredDrivers"
              class="driver-card"
              [class.selected]="selectedDriverId === d.user_id"
              (click)="selectDriver(d)"
            >
              <div class="driver-card__top">
                <span class="driver-card__id">{{ d.id }}</span>
                <span class="dot dot--{{ d.status }}"></span>
              </div>
              <div class="driver-card__name">{{ d.name || 'Unnamed' }}</div>
              <div class="driver-card__phone">{{ d.phone || '—' }}</div>
              <div class="driver-card__meta muted">
                <span *ngIf="d.vehicle_type">{{ d.vehicle_type }}</span>
                <span *ngIf="d.vehicle_reg_no">{{ d.vehicle_reg_no }}</span>
                <span *ngIf="!d.lat" class="warn">no location</span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <div *ngIf="error" class="error">{{ error }}</div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .dispatch-shell {
        display: flex;
        flex-direction: column;
        gap: 12px;
        height: calc(100vh - 100px);
        min-height: 600px;
      }
      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: #fff;
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 12px;
        gap: 12px;
        flex-wrap: wrap;
      }
      .topbar__left,
      .topbar__right {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }
      .seg {
        display: inline-flex;
        border: 1px solid rgba(15, 23, 42, 0.16);
        border-radius: 8px;
        overflow: hidden;
      }
      .seg__btn {
        padding: 6px 12px;
        border: 0;
        background: #fff;
        cursor: pointer;
        font-weight: 700;
        color: rgba(15, 23, 42, 0.7);
        display: inline-flex;
        gap: 6px;
        align-items: center;
      }
      .seg__btn.active {
        background: #3b82f6;
        color: #fff;
      }
      .dark-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-weight: 700;
        font-size: 13px;
      }
      .dispatch-grid {
        display: grid;
        grid-template-columns: 320px 1fr 320px;
        gap: 12px;
        flex: 1;
        min-height: 0;
      }
      .panel {
        background: #fff;
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
      }
      .panel__header {
        padding: 10px 14px;
        font-weight: 800;
        background: rgba(15, 23, 42, 0.04);
        border-bottom: 1px solid rgba(15, 23, 42, 0.06);
      }
      .tabs {
        display: flex;
      }
      .tab {
        flex: 1;
        padding: 8px 6px;
        background: transparent;
        border: 0;
        border-bottom: 2px solid transparent;
        cursor: pointer;
        font-weight: 700;
        font-size: 12px;
        color: rgba(15, 23, 42, 0.6);
      }
      .tab.active {
        color: #3b82f6;
        border-bottom-color: #3b82f6;
      }
      .panel__filter {
        padding: 8px 12px;
      }
      .search {
        width: 100%;
        padding: 6px 10px;
        border: 1px solid rgba(15, 23, 42, 0.16);
        border-radius: 6px;
        font-size: 13px;
      }
      .panel__body {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 6px 12px 12px;
      }
      .task-card,
      .driver-card {
        padding: 8px 10px;
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 8px;
        margin-bottom: 6px;
        cursor: pointer;
        background: rgba(248, 250, 252, 0.6);
      }
      .task-card.selected,
      .driver-card.selected {
        border-color: #3b82f6;
        background: rgba(59, 130, 246, 0.08);
      }
      .task-card__top,
      .driver-card__top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 4px;
      }
      .task-card__id,
      .driver-card__id {
        font-weight: 800;
        color: #0f172a;
        font-size: 13px;
      }
      .task-card__name,
      .driver-card__name {
        font-weight: 700;
        color: #0f172a;
        font-size: 13px;
        margin-bottom: 2px;
      }
      .task-card__addr {
        font-size: 12px;
        color: rgba(15, 23, 42, 0.7);
        margin: 2px 0;
      }
      .task-card__meta,
      .driver-card__meta {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        font-size: 12px;
        margin-top: 4px;
      }
      .task-card__driver {
        font-size: 11px;
        color: rgba(15, 23, 42, 0.65);
        margin-top: 4px;
      }
      .driver-card__phone {
        font-size: 12px;
        color: rgba(15, 23, 42, 0.7);
      }
      .muted {
        color: rgba(15, 23, 42, 0.55);
      }
      .warn {
        color: #d97706;
      }
      .empty {
        text-align: center;
        padding: 24px 12px;
        color: rgba(15, 23, 42, 0.55);
        font-size: 13px;
      }
      .map-area,
      .list-area {
        background: #fff;
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 12px;
        overflow: hidden;
        min-height: 0;
      }
      .map-shell {
        width: 100%;
        height: 100%;
        min-height: 400px;
      }
      .list-area {
        padding: 12px;
        overflow: auto;
      }
      .data-table {
        width: 100%;
        border-collapse: collapse;
      }
      .data-table th,
      .data-table td {
        padding: 8px;
        text-align: left;
        border-bottom: 1px solid rgba(15, 23, 42, 0.08);
        font-size: 13px;
      }
      .data-table th {
        background: rgba(15, 23, 42, 0.04);
        font-weight: 800;
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        display: inline-block;
      }
      .dot--free {
        background: #10b981;
      }
      .dot--busy {
        background: #f59e0b;
      }
      .dot--inactive {
        background: #94a3b8;
      }
      .error {
        color: #b00020;
        font-weight: 700;
      }

      /* Dark mode shell */
      .dispatch-shell.dark {
        background: #0f172a;
        color: #e2e8f0;
        padding: 10px;
        border-radius: 16px;
      }
      .dispatch-shell.dark .topbar,
      .dispatch-shell.dark .panel,
      .dispatch-shell.dark .map-area,
      .dispatch-shell.dark .list-area {
        background: #1e293b;
        border-color: rgba(255, 255, 255, 0.06);
        color: #e2e8f0;
      }
      .dispatch-shell.dark .panel__header,
      .dispatch-shell.dark .data-table th {
        background: rgba(255, 255, 255, 0.04);
        border-color: rgba(255, 255, 255, 0.06);
      }
      .dispatch-shell.dark .task-card,
      .dispatch-shell.dark .driver-card {
        background: rgba(255, 255, 255, 0.04);
        border-color: rgba(255, 255, 255, 0.08);
      }
      .dispatch-shell.dark .task-card__id,
      .dispatch-shell.dark .driver-card__id,
      .dispatch-shell.dark .task-card__name,
      .dispatch-shell.dark .driver-card__name {
        color: #f1f5f9;
      }
      .dispatch-shell.dark .muted,
      .dispatch-shell.dark .empty,
      .dispatch-shell.dark .driver-card__phone,
      .dispatch-shell.dark .task-card__addr {
        color: rgba(226, 232, 240, 0.65);
      }
      .dispatch-shell.dark .seg__btn {
        background: #1e293b;
        color: #cbd5e1;
      }
      .dispatch-shell.dark .seg__btn.active {
        background: #3b82f6;
        color: #fff;
      }
      .dispatch-shell.dark .search {
        background: #0f172a;
        color: #e2e8f0;
        border-color: rgba(255, 255, 255, 0.12);
      }

      @media (max-width: 1100px) {
        .dispatch-grid {
          grid-template-columns: 1fr;
          height: auto;
        }
        .dispatch-shell {
          height: auto;
        }
        .panel {
          max-height: 360px;
        }
        .map-shell {
          height: 480px;
        }
      }
    `,
  ],
})
export class MapsComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: false }) mapContainer!: ElementRef<HTMLDivElement>;

  view: 'map' | 'list' = 'map';
  darkMode = false;
  cityId: number | null = null;
  cityOptions: CityRow[] = [];

  taskTab: 'unassigned' | 'assigned' = 'unassigned';
  driverTab: 'free' | 'busy' | 'inactive' = 'free';

  taskFilter = '';
  driverFilter = '';

  snapshot: Snapshot | null = null;
  error: string | null = null;

  selectedTaskId: number | null = null;
  selectedDriverId: number | null = null;

  private map: google.maps.Map | null = null;
  private driverMarkers: google.maps.Marker[] = [];
  private taskMarkers: google.maps.Marker[] = [];
  private infoWindow: google.maps.InfoWindow | null = null;
  private mapsReady = false;
  private pendingSnapshot: Snapshot | null = null;
  private pollHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private api: ApiService,
    private zone: NgZone,
    private mapsLoader: GoogleMapsLoaderService,
  ) {}

  ngOnInit(): void {
    this.loadCities();
  }

  ngAfterViewInit(): void {
    void this.initMap();
    this.fetch();
    this.pollHandle = setInterval(() => this.fetch(), 15000);
  }

  ngOnDestroy(): void {
    if (this.pollHandle) clearInterval(this.pollHandle);
    this.clearMarkers();
    this.infoWindow?.close();
  }

  get filteredTasks(): TaskRow[] {
    if (!this.snapshot) return [];
    const list = this.snapshot.tasks[this.taskTab];
    const term = this.taskFilter.trim().toLowerCase();
    if (!term) return list;
    return list.filter(
      (t) =>
        String(t.id).includes(term) ||
        (t.customer?.name || '').toLowerCase().includes(term) ||
        (t.customer?.phone || '').toLowerCase().includes(term) ||
        (t.pickup_address || '').toLowerCase().includes(term),
    );
  }

  get filteredDrivers(): DriverRow[] {
    if (!this.snapshot) return [];
    const list = this.snapshot.drivers[this.driverTab];
    const term = this.driverFilter.trim().toLowerCase();
    if (!term) return list;
    return list.filter(
      (d) =>
        String(d.id).includes(term) ||
        (d.name || '').toLowerCase().includes(term) ||
        (d.phone || '').toLowerCase().includes(term) ||
        (d.vehicle_reg_no || '').toLowerCase().includes(term),
    );
  }

  get allTasks(): TaskRow[] {
    if (!this.snapshot) return [];
    return [...this.snapshot.tasks.unassigned, ...this.snapshot.tasks.assigned];
  }

  taskSeverity(status: string): 'success' | 'info' | 'warning' | 'danger' | undefined {
    if (status === 'COMPLETED') return 'success';
    if (status === 'CANCELLED') return 'danger';
    if (status === 'NEGOTIATION' || status === 'REQUESTED') return 'warning';
    return 'info';
  }

  pretty(lat: number | null, lng: number | null): string {
    if (lat == null || lng == null) return 'No location';
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }

  selectTask(t: TaskRow): void {
    this.selectedTaskId = t.id;
    if (t.pickup_lat != null && t.pickup_lng != null && this.map) {
      this.map.setCenter({ lat: t.pickup_lat, lng: t.pickup_lng });
      this.map.setZoom(14);
    }
  }

  selectDriver(d: DriverRow): void {
    this.selectedDriverId = d.user_id;
    if (d.lat != null && d.lng != null && this.map) {
      this.map.setCenter({ lat: d.lat, lng: d.lng });
      this.map.setZoom(14);
    }
  }

  recenterMap(): void {
    // Pan + zoom the map to the selected city, then refetch the snapshot so
    // the lists/markers reflect the city scope. If "All cities" is picked,
    // fall back to the wide default view.
    const city = this.cityOptions.find((c) => c.id === this.cityId) || null;
    if (this.map) {
      if (city?.boundary_polygon?.length) {
        const bounds = new google.maps.LatLngBounds();
        city.boundary_polygon.forEach((p) => bounds.extend(p));
        this.map.fitBounds(bounds, 40);
      } else if (city?.center_lat != null && city?.center_lng != null) {
        this.map.setCenter({ lat: city.center_lat, lng: city.center_lng });
        this.map.setZoom(12);
      } else if (!city) {
        this.map.setCenter({ lat: 33.7311, lng: 75.1487 });
        this.map.setZoom(11);
      }
    }
    this.fetch();
  }

  fetch(): void {
    this.error = null;
    const params: string[] = [];
    if (this.cityId) params.push(`city_id=${this.cityId}`);
    const qs = params.length ? `?${params.join('&')}` : '';

    this.api.get<Snapshot>(`/admin/dispatch/snapshot${qs}`).subscribe({
      next: (res) => {
        this.snapshot = res;
        if (this.mapsReady) {
          this.redrawMap();
        } else {
          this.pendingSnapshot = res;
        }
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load dispatch snapshot';
      },
    });
  }

  private loadCities(): void {
    this.api.get<{ data: CityRow[] }>('/admin/cities').subscribe({
      next: (res) => (this.cityOptions = res?.data || []),
      error: () => {},
    });
  }

  private async initMap(): Promise<void> {
    if (!this.mapContainer?.nativeElement) return;
    try {
      await this.mapsLoader.load();
    } catch (err) {
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
    this.infoWindow = new google.maps.InfoWindow();
    this.mapsReady = true;
    if (this.pendingSnapshot) {
      this.redrawMap();
      this.pendingSnapshot = null;
    }
  }

  private clearMarkers(): void {
    this.driverMarkers.forEach((m) => m.setMap(null));
    this.taskMarkers.forEach((m) => m.setMap(null));
    this.driverMarkers = [];
    this.taskMarkers = [];
  }

  private redrawMap(): void {
    if (!this.map || !this.snapshot) return;

    this.clearMarkers();

    const driverIcon = (color: string): google.maps.Symbol => ({
      path: google.maps.SymbolPath.CIRCLE,
      scale: 8,
      fillColor: color,
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2,
    });

    const taskIcon = (color: string): google.maps.Symbol => ({
      // diamond
      path: 'M 0 -10 L 10 0 L 0 10 L -10 0 Z',
      scale: 1,
      fillColor: color,
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2,
    });

    const drawDriver = (d: DriverRow, color: string) => {
      if (d.lat == null || d.lng == null) return;
      const marker = new google.maps.Marker({
        position: { lat: d.lat, lng: d.lng },
        map: this.map!,
        icon: driverIcon(color),
        title: d.name || 'Driver',
      });
      marker.addListener('click', () => {
        this.infoWindow?.setContent(
          `<b>${d.name || 'Driver'}</b><br/>${d.phone || ''}<br/>${d.vehicle_type || ''} ${d.vehicle_reg_no || ''}<br/>Status: ${d.status}`,
        );
        this.infoWindow?.open({ map: this.map!, anchor: marker });
      });
      this.driverMarkers.push(marker);
    };

    this.snapshot.drivers.free.forEach((d) => drawDriver(d, '#10b981'));
    this.snapshot.drivers.busy.forEach((d) => drawDriver(d, '#f59e0b'));
    this.snapshot.drivers.inactive.forEach((d) => drawDriver(d, '#94a3b8'));

    const drawTask = (t: TaskRow, color: string) => {
      if (t.pickup_lat == null || t.pickup_lng == null) return;
      const marker = new google.maps.Marker({
        position: { lat: t.pickup_lat, lng: t.pickup_lng },
        map: this.map!,
        icon: taskIcon(color),
        title: `Trip #${t.id}`,
      });
      marker.addListener('click', () => {
        this.infoWindow?.setContent(
          `<b>Trip #${t.id}</b><br/>${t.customer?.name || ''}<br/>${t.pickup_address || ''}<br/>Status: ${t.status}`,
        );
        this.infoWindow?.open({ map: this.map!, anchor: marker });
      });
      this.taskMarkers.push(marker);
    };

    this.snapshot.tasks.unassigned.forEach((t) => drawTask(t, '#3b82f6'));
    this.snapshot.tasks.assigned.forEach((t) => drawTask(t, '#8b5cf6'));

    const bounds = new google.maps.LatLngBounds();
    let any = false;
    [
      ...this.snapshot.drivers.free,
      ...this.snapshot.drivers.busy,
      ...this.snapshot.drivers.inactive,
    ].forEach((d) => {
      if (d.lat != null && d.lng != null) {
        bounds.extend({ lat: d.lat, lng: d.lng });
        any = true;
      }
    });
    [...this.snapshot.tasks.unassigned, ...this.snapshot.tasks.assigned].forEach((t) => {
      if (t.pickup_lat != null && t.pickup_lng != null) {
        bounds.extend({ lat: t.pickup_lat, lng: t.pickup_lng });
        any = true;
      }
    });

    if (any) {
      this.map.fitBounds(bounds, 40);
      const listener = google.maps.event.addListenerOnce(this.map, 'idle', () => {
        if (this.map && (this.map.getZoom() ?? 0) > 14) this.map.setZoom(14);
      });
      void listener;
    }
  }
}
