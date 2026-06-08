import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService, CityOption } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import {
  ButtonComponent,
  ColumnComponent,
  DataTableComponent,
  DrawerComponent,
  FilterPillComponent,
  FilterSelectComponent,
  IconComponent,
  InputComponent,
  StatusPillComponent,
} from '../../ui';

interface VehicleType {
  id: number;
  city_id: number;
  ride_type_id: number;
  ride_type_name: string;
  display_name: string;
  max_people: number;
  is_active: boolean;
}

interface RideTypeRef { id: number; name: string; }
interface VehicleTypeRef { id: number; name: string; }

type StatusFilter = 'all' | 'enabled' | 'disabled';

const STATUS_OPTIONS = [
  { label: 'Enabled', value: 'enabled' },
  { label: 'Disabled', value: 'disabled' },
];

/**
 * Vehicle Fares — the city's vehicle catalogue, scoped to the city chosen in
 * the topbar switcher. Standard data-table layout: search + filter dropdowns +
 * dismissable pills, "Details" opens the deep per-kind editor, "Add vehicle
 * type" uses the shared drawer.
 */
@Component({
  selector: 'app-vehicle-types',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonComponent, ColumnComponent, DataTableComponent,
    DrawerComponent, FilterPillComponent, FilterSelectComponent,
    IconComponent, InputComponent, StatusPillComponent,
  ],
  template: `
    <div class="page">
      <header class="page__hero">
        <div>
          <h1 class="page__title">Vehicle Fares</h1>
          <p class="page__sub">The city's vehicle catalogue — open Details to tune identity, fare, images and dispatcher settings.</p>
        </div>
        <tm-button *ngIf="cityId != null" variant="green" icon="plus" (clicked)="openCreate()">
          Add vehicle type
        </tm-button>
      </header>

      <!-- No city -->
      <div class="cue" *ngIf="cityId == null">
        <tm-icon name="map-marker" [size]="24" />
        <p class="cue__title">No city selected</p>
        <p class="cue__text">Pick a city from the switcher in the top bar to manage vehicle fares.</p>
      </div>

      <tm-data-table
        *ngIf="cityId != null"
        [rows]="pageRows"
        [total]="total"
        [page]="page"
        [pageSize]="pageSize"
        [loading]="loading"
        emptyTitle="No vehicle types"
        emptyHint="Try a different search, or clear the filters."
        (pageChange)="onPage($event)"
        (pageSizeChange)="onPageSize($event)"
      >
        <tm-input
          slot="search"
          icon="search"
          placeholder="Search by vehicle or ride type"
          [(ngModel)]="search"
          (ngModelChange)="onSearchChange()"
        />

        <ng-container slot="filters">
          <tm-filter-select
            icon="bolt"
            ariaLabel="Status filter"
            allLabel="All statuses"
            [options]="statusOptions"
            [value]="status"
            (valueChange)="onStatusChange($event)"
          />
          <tm-filter-select
            icon="car"
            ariaLabel="Ride type filter"
            allLabel="All ride types"
            [options]="rideTypeOptions"
            [value]="rideType"
            (valueChange)="onRideTypeChange($event)"
          />
        </ng-container>

        <ng-container slot="banner">
          <tm-filter-pill *ngIf="search.trim()" icon="search" label="Search" [value]="search" (clear)="clearSearch()" />
          <tm-filter-pill *ngIf="status !== 'all'" icon="bolt" label="Status" [value]="statusLabel()" (clear)="clearStatus()" />
          <tm-filter-pill *ngIf="rideType !== 'all'" icon="car" label="Ride type" [value]="rideType" (clear)="clearRideType()" />
        </ng-container>

        <tm-column key="display_name" label="Vehicle">
          <ng-template let-row>
            <div class="cell-veh">
              <span class="cell-icon"><tm-icon name="car" [size]="16" /></span>
              <div class="cell-id">
                <span class="cell-name">{{ row.display_name }}</span>
                <span class="cell-sub">{{ row.max_people }} {{ row.max_people === 1 ? 'seat' : 'seats' }}</span>
              </div>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="ride_type_name" label="Ride type" width="180">
          <ng-template let-row>
            <span *ngIf="row.ride_type_name">{{ row.ride_type_name }}</span>
            <span *ngIf="!row.ride_type_name" class="muted">—</span>
          </ng-template>
        </tm-column>

        <tm-column key="status" label="Status" width="130">
          <ng-template let-row>
            <tm-status-pill [tone]="row.is_active ? 'success' : 'neutral'">
              {{ row.is_active ? 'Enabled' : 'Disabled' }}
            </tm-status-pill>
          </ng-template>
        </tm-column>

        <tm-column key="actions" label="" width="130" align="right">
          <ng-template let-row>
            <tm-button variant="outline" size="sm" icon="arrow-right" (clicked)="openDetails(row)">
              Details
            </tm-button>
          </ng-template>
        </tm-column>
      </tm-data-table>
    </div>

    <!-- Create drawer -->
    <tm-drawer [open]="createOpen" title="Add Vehicle Type" [width]="520" (closed)="createOpen = false">
      <div slot="body" class="form">
        <label class="field">
          <span class="field__lbl">City</span>
          <input type="text" [value]="currentCityName" readonly />
          <span class="field__hint">Switch cities from the top bar to add elsewhere.</span>
        </label>
        <label class="field">
          <span class="field__lbl">Vehicle Name <i>*</i></span>
          <input type="text" [(ngModel)]="createForm.display_name" placeholder="SEDAN / SWIFT L" />
        </label>
        <label class="field">
          <span class="field__lbl">Vehicle Type <i>*</i></span>
          <select [(ngModel)]="createForm.vehicle_type_id">
            <option [ngValue]="null" disabled>Select vehicle type</option>
            <option *ngFor="let vt of vehicleTypeOptions" [ngValue]="vt.id">{{ vt.name }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field__lbl">Ride Type <i>*</i></span>
          <select [(ngModel)]="createForm.ride_type_id">
            <option [ngValue]="null" disabled>Select ride type</option>
            <option *ngFor="let rt of rideTypes" [ngValue]="rt.id">{{ rt.name }}</option>
          </select>
        </label>
        <div class="row">
          <label class="field">
            <span class="field__lbl">Display Order <i>*</i></span>
            <input type="number" min="0" max="9999" [(ngModel)]="createForm.display_order" />
          </label>
          <label class="field">
            <span class="field__lbl">Max People <i>*</i></span>
            <input type="number" min="1" max="99" [(ngModel)]="createForm.max_people" />
          </label>
        </div>

        <div class="field">
          <span class="field__lbl">Toll Applicable <i>*</i></span>
          <div class="radio-row">
            <label><input type="radio" name="toll" [value]="true" [(ngModel)]="createForm.toll_applicable" /> Yes</label>
            <label><input type="radio" name="toll" [value]="false" [(ngModel)]="createForm.toll_applicable" /> No</label>
          </div>
        </div>

        <div class="field">
          <span class="field__lbl">Commission Mode <i>*</i></span>
          <div class="radio-row">
            <label><input type="radio" name="commType" [value]="'percent'" [(ngModel)]="createForm.commission_type" /> Percentage (%)</label>
            <label><input type="radio" name="commType" [value]="'fixed'" [(ngModel)]="createForm.commission_type" /> Fixed (₹)</label>
          </div>
        </div>

        <div class="row">
          <label class="field" *ngIf="createForm.commission_type === 'percent'">
            <span class="field__lbl">Commission (%) <i>*</i></span>
            <input type="number" min="0" max="100" step="0.01" [(ngModel)]="createForm.commission_percent" />
          </label>
          <label class="field" *ngIf="createForm.commission_type === 'fixed'">
            <span class="field__lbl">Fixed commission (₹) <i>*</i></span>
            <input type="number" min="0" step="0.01" [(ngModel)]="createForm.fixed_commission" />
          </label>
          <label class="field">
            <span class="field__lbl">Luggage Capacity <i>*</i></span>
            <input type="number" min="0" max="99" [(ngModel)]="createForm.luggage_capacity" placeholder="Number of bags" />
          </label>
        </div>

      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="createOpen = false">Cancel</tm-button>
        <tm-button variant="green" [disabled]="creating || !createValid" (clicked)="submitCreate()">
          {{ creating ? 'Creating…' : 'Create' }}
        </tm-button>
      </div>
    </tm-drawer>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 16px; }
    .page__hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .page__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .page__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); max-width: 70ch; }

    .cue {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 48px 24px; text-align: center;
      background: var(--tm-surface); border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg); color: var(--tm-text-muted);
    }
    .cue__title { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .cue__text { margin: 0; font-size: 13px; }

    /* cell renderers */
    .cell-veh { display: inline-flex; align-items: center; gap: 10px; min-width: 0; }
    .cell-icon {
      width: 36px; height: 36px; border-radius: 9px; flex: none;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--tm-green-tint, #e0f7fa); color: var(--tm-green);
    }
    .cell-id { display: flex; flex-direction: column; min-width: 0; }
    .cell-name { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .cell-sub { font-size: 11px; color: var(--tm-text-muted); }
    .muted { color: var(--tm-text-muted); font-size: 12px; }

    /* drawer form */
    .form { display: flex; flex-direction: column; gap: 13px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .field { display: flex; flex-direction: column; gap: 5px; }
    .field__lbl { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .field__lbl i { color: var(--tm-danger, #ef4444); font-style: normal; }
    .field input, .field select {
      width: 100%; padding: 9px 11px;
      border: 1px solid var(--tm-line); border-radius: 9px;
      background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13px; outline: none; font-family: inherit;
    }
    .field input:focus, .field select:focus { border-color: var(--tm-green); }
    .radio-row { display: flex; gap: 22px; padding-top: 2px; }
    .radio-row label {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 13px; font-weight: 600; color: var(--tm-text); cursor: pointer;
    }
    .radio-row input { width: 15px; height: 15px; accent-color: var(--tm-green); }

    @media (max-width: 720px) {
      .page__hero { flex-direction: column; }
    }
  `],
})
export class VehicleTypesComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  rows: VehicleType[] = [];
  rideTypes: RideTypeRef[] = [];
  vehicleTypeOptions: VehicleTypeRef[] = [];
  loading = false;

  // ── Filter / pagination state ───────────────────────────────────
  search = '';
  status: StatusFilter = 'all';
  rideType = 'all';
  page = 1;
  pageSize = 25;

  statusOptions = STATUS_OPTIONS;

  // Derived view
  filteredRows: VehicleType[] = [];
  pageRows: VehicleType[] = [];
  total = 0;

  cities: CityOption[] = [];
  createOpen = false;
  creating = false;
  createForm = this.blankCreate();

  private subs: Subscription[] = [];
  private searchDebounce: any = null;

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private toast: ToastService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.subs.push(
      this.cityCtx.cities$.subscribe((list) => (this.cities = list)),
      this.cityCtx.cityId$.subscribe((id) => {
        this.cityId = id;
        if (id != null) this.fetch();
        else {
          this.rows = [];
          this.applyView();
        }
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
  }

  fetch(): void {
    if (this.cityId == null) return;
    this.loading = true;
    this.api
      .get<{
        data: VehicleType[];
        available_ride_types: RideTypeRef[];
        available_vehicle_types?: VehicleTypeRef[];
      }>(`/admin/cities/${this.cityId}/vehicle-types`)
      .subscribe({
        next: (res) => {
          this.rows = res.data ?? [];
          this.rideTypes = res.available_ride_types ?? [];
          this.vehicleTypeOptions = res.available_vehicle_types ?? [];
          this.loading = false;
          this.applyView();
        },
        error: () => {
          this.loading = false;
          this.toast.error('Failed to load vehicle types');
        },
      });
  }

  // ── Filtering + client-side pagination ──────────────────────────
  private applyView(): void {
    const q = this.search.trim().toLowerCase();
    let list = this.rows;

    if (this.status !== 'all') {
      const active = this.status === 'enabled';
      list = list.filter((r) => r.is_active === active);
    }
    if (this.rideType !== 'all') {
      list = list.filter((r) => r.ride_type_name === this.rideType);
    }
    if (q) {
      list = list.filter(
        (r) =>
          r.display_name.toLowerCase().includes(q) ||
          (r.ride_type_name ?? '').toLowerCase().includes(q),
      );
    }

    this.filteredRows = list;
    this.total = list.length;
    const maxPage = Math.max(1, Math.ceil(this.total / this.pageSize));
    if (this.page > maxPage) this.page = maxPage;
    const start = (this.page - 1) * this.pageSize;
    this.pageRows = list.slice(start, start + this.pageSize);
  }

  get rideTypeOptions(): { label: string; value: string }[] {
    const seen = new Set<string>();
    for (const r of this.rows) {
      if (r.ride_type_name) seen.add(r.ride_type_name);
    }
    return [...seen].sort().map((n) => ({ label: n, value: n }));
  }

  onSearchChange(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => {
      this.page = 1;
      this.applyView();
    }, 250);
  }
  clearSearch(): void {
    if (!this.search) return;
    this.search = '';
    this.page = 1;
    this.applyView();
  }

  statusLabel(): string {
    return this.statusOptions.find((o) => o.value === this.status)?.label ?? 'All statuses';
  }
  onStatusChange(value: string): void {
    this.status = value as StatusFilter;
    this.page = 1;
    this.applyView();
  }
  clearStatus(): void {
    if (this.status === 'all') return;
    this.status = 'all';
    this.page = 1;
    this.applyView();
  }

  onRideTypeChange(value: string): void {
    this.rideType = value;
    this.page = 1;
    this.applyView();
  }
  clearRideType(): void {
    if (this.rideType === 'all') return;
    this.rideType = 'all';
    this.page = 1;
    this.applyView();
  }

  onPage(p: number): void {
    this.page = p;
    this.applyView();
  }
  onPageSize(s: number): void {
    this.pageSize = s;
    this.page = 1;
    this.applyView();
  }

  openDetails(v: VehicleType): void {
    this.router.navigateByUrl(`/settings/vehicle-types/${v.id}`);
  }

  blankCreate() {
    return {
      city_id: this.cityId as number | null,
      ride_type_id: null as number | null,
      vehicle_type_id: null as number | null,
      display_name: '',
      display_order: null as number | null,
      max_people: null as number | null,
      luggage_capacity: null as number | null,
      commission_type: 'percent' as 'percent' | 'fixed',
      commission_percent: null as number | null,
      fixed_commission: 0 as number | null,
      min_driver_balance: 0 as number | null,
      show_low_wallet_alert: true,
      reverse_bidding_enabled: true,
      toll_applicable: false,
    };
  }

  get currentCityName(): string {
    return this.cities.find((c) => c.id === this.cityId)?.name ?? '';
  }

  openCreate(): void {
    // Vehicles are always created in the city currently selected in the top bar,
    // so the ride-type/vehicle-type options on screen always match the target.
    this.createForm = this.blankCreate();
    this.createForm.city_id = this.cityId;
    this.createOpen = true;
  }

  get createValid(): boolean {
    const f = this.createForm;
    const commissionValid =
      f.commission_type === 'percent' ? f.commission_percent != null : f.fixed_commission != null;
    return (
      f.city_id != null &&
      f.ride_type_id != null &&
      f.vehicle_type_id != null &&
      !!f.display_name.trim() &&
      f.display_order != null &&
      f.max_people != null &&
      commissionValid &&
      f.luggage_capacity != null
    );
  }

  submitCreate(): void {
    if (!this.createValid || this.creating) return;
    const f = this.createForm;

    const payload = {
      ride_type_id: f.ride_type_id,
      vehicle_type_id: f.vehicle_type_id,
      display_name: f.display_name.trim(),
      display_order: f.display_order,
      max_people: f.max_people,
      luggage_capacity: f.luggage_capacity,
      commission_type: f.commission_type,
      commission_percent: f.commission_type === 'percent' ? (f.commission_percent ?? 0) : 0,
      fixed_commission: f.commission_type === 'fixed' ? (f.fixed_commission ?? 0) : 0,
      min_driver_balance: f.min_driver_balance,
      show_low_wallet_alert: f.show_low_wallet_alert,
      reverse_bidding_enabled: f.reverse_bidding_enabled,
      toll_mode: f.toll_applicable ? 'yes' : 'no',
    };

    this.creating = true;
    this.api
      .post<{ vehicle_type: VehicleType; message: string }>(
        `/admin/cities/${f.city_id}/vehicle-types`,
        payload,
      )
      .subscribe({
        next: (res) => {
          this.creating = false;
          this.createOpen = false;
          this.toast.success(res.message || 'Vehicle type created');
          // Reflect the city we added to — switch the workspace if it differs.
          if (f.city_id === this.cityId) {
            this.fetch();
          } else if (f.city_id != null) {
            this.cityCtx.setCityId(f.city_id);
          }
        },
        error: (err) => {
          this.creating = false;
          this.toast.error(err?.error?.message || 'Failed to create vehicle type');
        },
      });
  }
}
