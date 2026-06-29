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

type ServiceMode = 'private' | 'fixed' | 'shuttle';
type StatusFilter = 'all' | 'enabled' | 'disabled';

interface VehicleRow {
  id: number;
  city_id: number;
  ride_type_id: number;
  vehicle_type_id: number | null;
  vehicle_type_name?: string | null;
  ride_type_name: string;
  display_name: string;
  display_order: number;
  max_people: number;
  luggage_capacity: number;
  commission_type: 'percent' | 'fixed';
  commission_percent: number;
  fixed_commission: number;
  min_driver_balance: number;
  reverse_bidding_enabled: boolean;
  show_low_wallet_alert: boolean;
  toll_mode: 'yes' | 'no';
  is_active: boolean;
  is_outstation?: boolean;
}

interface RideTypeRef { id: number; name: string; }
interface VehicleTypeRef { id: number; name: string; }

const STATUS_OPTIONS = [
  { label: 'Enabled', value: 'enabled' },
  { label: 'Disabled', value: 'disabled' },
];

@Component({
  selector: 'app-vehicle-setup-new',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    ColumnComponent,
    DataTableComponent,
    DrawerComponent,
    FilterPillComponent,
    FilterSelectComponent,
    IconComponent,
    InputComponent,
    StatusPillComponent,
  ],
  template: `
    <div class="page">
      <header class="page__hero">
        <div>
          <h1 class="page__title">Vehicle Setup</h1>
          <p class="page__sub">Vehicle catalogue only. Use the eye to edit common vehicle fields, and the rupee icon to manage fares.</p>
        </div>
        <tm-button *ngIf="cityId != null" variant="green" icon="plus" (clicked)="openCreate()">Add vehicle</tm-button>
      </header>

      <div class="cue" *ngIf="cityId == null">
        <tm-icon name="map-marker" [size]="24" />
        <p class="cue__title">No city selected</p>
        <p class="cue__text">Pick a city from the top bar to manage vehicles.</p>
      </div>

      <tm-data-table
        *ngIf="cityId != null"
        [rows]="pageRows"
        [total]="total"
        [page]="page"
        [pageSize]="pageSize"
        [loading]="loading"
        emptyTitle="No vehicles"
        emptyHint="Try a different search, or clear the filters."
        (pageChange)="onPage($event)"
        (pageSizeChange)="onPageSize($event)"
      >
        <tm-input
          slot="search"
          icon="search"
          placeholder="Search by vehicle, type, or service"
          [(ngModel)]="search"
          (ngModelChange)="onSearchChange()"
        />

        <ng-container slot="filters">
          <tm-filter-select icon="bolt" ariaLabel="Status filter" allLabel="All statuses" [options]="statusOptions" [value]="status" (valueChange)="onStatusChange($event)" />
          <tm-filter-select icon="car" ariaLabel="Service filter" allLabel="All services" [options]="serviceOptions" [value]="service" (valueChange)="onServiceChange($event)" />
        </ng-container>

        <ng-container slot="banner">
          <tm-filter-pill *ngIf="search.trim()" icon="search" label="Search" [value]="search" (clear)="clearSearch()" />
          <tm-filter-pill *ngIf="status !== 'all'" icon="bolt" label="Status" [value]="statusLabel()" (clear)="clearStatus()" />
          <tm-filter-pill *ngIf="service !== 'all'" icon="car" label="Service" [value]="serviceLabel()" (clear)="clearService()" />
        </ng-container>

        <tm-column key="display_name" label="Vehicle">
          <ng-template let-row>
            <div class="cell-veh">
              <span class="cell-icon"><tm-icon name="car" [size]="16" /></span>
              <div class="cell-id">
                <span class="cell-name">{{ row.display_name }}</span>
                <span class="cell-sub">{{ row.vehicle_type_name || 'Vehicle type not set' }}</span>
              </div>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="service" label="Service" width="140">
          <ng-template let-row>
            <span class="service">{{ serviceFor(row) }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="capacity" label="Capacity" width="150">
          <ng-template let-row>
            <span>{{ row.max_people }} seats · {{ row.luggage_capacity }} bags</span>
          </ng-template>
        </tm-column>

        <tm-column key="commercials" label="Commercials" width="180">
          <ng-template let-row>
            <span>{{ row.toll_mode === 'yes' ? 'Toll on' : 'Toll off' }} · {{ row.commission_type === 'fixed' ? 'Fixed' : 'Percent' }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="status" label="Status" width="120">
          <ng-template let-row>
            <tm-status-pill [tone]="row.is_active ? 'success' : 'neutral'">{{ row.is_active ? 'Enabled' : 'Disabled' }}</tm-status-pill>
          </ng-template>
        </tm-column>

        <tm-column key="actions" label="" width="140" align="right">
          <ng-template let-row>
            <div class="actionsInline">
              <button type="button" class="iconAction" title="Common setup" (click)="openCommon(row)"><tm-icon name="eye" [size]="15" /></button>
              <button type="button" class="iconAction" title="Fare settings" (click)="openFare(row)"><tm-icon name="rupee" [size]="15" /></button>
            </div>
          </ng-template>
        </tm-column>
      </tm-data-table>
    </div>

    <tm-drawer [open]="commonOpen" title="Common vehicle setup" [width]="620" (closed)="commonOpen = false">
      <div slot="body" class="form" *ngIf="selected">
        <div class="drawerTitle">
          <span class="cell-icon"><tm-icon name="car" [size]="16" /></span>
          <div>
            <strong>{{ selected.display_name }}</strong>
            <small>{{ serviceFor(selected) }} · {{ selected.vehicle_type_name || selected.ride_type_name }}</small>
          </div>
        </div>

        <div class="grid">
          <label class="field field--wide"><span>Vehicle name</span><input [(ngModel)]="edit.display_name" /></label>
          <label class="field field--wide"><span>Vehicle type</span><input [value]="selected.vehicle_type_name || selected.ride_type_name" readonly /></label>
          <label class="field"><span>Max people</span><input type="number" min="1" [(ngModel)]="edit.max_people" /></label>
          <label class="field"><span>Luggage capacity</span><input type="number" min="0" [(ngModel)]="edit.luggage_capacity" /></label>
          <label class="field"><span>Display order</span><input type="number" min="0" [(ngModel)]="edit.display_order" /></label>
          <label class="field"><span>Min driver balance</span><input type="number" min="0" [(ngModel)]="edit.min_driver_balance" /></label>
        </div>

        <div class="segGroup">
          <span>Commission mode</span>
          <button type="button" [class.is-on]="edit.commission_type === 'percent'" (click)="edit.commission_type = 'percent'">Percent</button>
          <button type="button" [class.is-on]="edit.commission_type === 'fixed'" (click)="edit.commission_type = 'fixed'">Fixed</button>
        </div>

        <div class="grid">
          <label class="field" *ngIf="edit.commission_type === 'percent'"><span>Commission %</span><input type="number" min="0" max="100" [(ngModel)]="edit.commission_percent" /></label>
          <label class="field" *ngIf="edit.commission_type === 'fixed'"><span>Commission</span><input type="number" min="0" [(ngModel)]="edit.fixed_commission" /></label>
        </div>

        <div class="toggles">
          <label><input type="checkbox" [ngModel]="edit.toll_mode === 'yes'" (ngModelChange)="edit.toll_mode = $event ? 'yes' : 'no'" /> Toll applicable</label>
          <label><input type="checkbox" [(ngModel)]="edit.show_low_wallet_alert" /> Low wallet alert</label>
          <label><input type="checkbox" [ngModel]="edit.is_active" (ngModelChange)="edit.is_active = $event" /> Active</label>
        </div>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="commonOpen = false">Cancel</tm-button>
        <tm-button variant="green" icon="check" [disabled]="saving" (clicked)="saveCommon()">{{ saving ? 'Saving...' : 'Save common setup' }}</tm-button>
      </div>
    </tm-drawer>

    <tm-drawer [open]="createOpen" title="Add vehicle" [width]="620" (closed)="createOpen = false">
      <div slot="body" class="create">
        <div class="steps"><span [class.is-on]="createStep === 1">1 Service</span><span [class.is-on]="createStep === 2">2 Vehicle</span></div>

        <ng-container *ngIf="createStep === 1">
          <button *ngFor="let mode of modes" type="button" class="choice" [class.is-on]="create.service === mode.key" (click)="chooseCreateService(mode.key)">
            <tm-icon [name]="mode.icon" [size]="18" />
            <span><strong>{{ mode.label }}</strong><small>{{ mode.hint }}</small></span>
          </button>
        </ng-container>

        <ng-container *ngIf="createStep === 2">
          <div class="choiceGrid">
            <button *ngFor="let rt of createRideTypes" type="button" class="miniChoice" [class.is-on]="create.ride_type_id === rt.id" (click)="create.ride_type_id = rt.id">{{ rt.name }}</button>
          </div>

          <label class="field field--wide"><span>Vehicle type</span>
            <select [(ngModel)]="create.vehicle_type_id">
              <option [ngValue]="null" disabled>Select vehicle type</option>
              <option *ngFor="let vt of vehicleTypeOptions" [ngValue]="vt.id">{{ vt.name }}</option>
            </select>
          </label>

          <div class="grid">
            <label class="field field--wide"><span>Vehicle name</span><input [(ngModel)]="create.display_name" placeholder="Sedan / SUV / Shuttle Van" /></label>
            <label class="field"><span>Max people</span><input type="number" min="1" [(ngModel)]="create.max_people" /></label>
            <label class="field"><span>Luggage capacity</span><input type="number" min="0" [(ngModel)]="create.luggage_capacity" /></label>
            <label class="field"><span>Display order</span><input type="number" min="0" [(ngModel)]="create.display_order" /></label>
          </div>

          <div class="segGroup">
            <span>Commission mode</span>
            <button type="button" [class.is-on]="create.commission_type === 'percent'" (click)="create.commission_type = 'percent'">Percent</button>
            <button type="button" [class.is-on]="create.commission_type === 'fixed'" (click)="create.commission_type = 'fixed'">Fixed</button>
          </div>

          <div class="grid">
            <label class="field" *ngIf="create.commission_type === 'percent'"><span>Commission %</span><input type="number" min="0" max="100" [(ngModel)]="create.commission_percent" /></label>
            <label class="field" *ngIf="create.commission_type === 'fixed'"><span>Commission</span><input type="number" min="0" [(ngModel)]="create.fixed_commission" /></label>
          </div>

          <div class="toggles">
            <label><input type="checkbox" [(ngModel)]="create.toll_applicable" /> Toll applicable</label>
            <label><input type="checkbox" [(ngModel)]="create.show_low_wallet_alert" /> Low wallet alert</label>
            <label *ngIf="create.service === 'private'"><input type="checkbox" [(ngModel)]="create.reverse_bidding_enabled" /> Reverse bidding</label>
          </div>
        </ng-container>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="createStep === 1 ? createOpen = false : createStep = 1">{{ createStep === 1 ? 'Cancel' : 'Back' }}</tm-button>
        <tm-button *ngIf="createStep === 1" variant="green" [disabled]="!create.service" (clicked)="createStep = 2">Continue</tm-button>
        <tm-button *ngIf="createStep === 2" variant="green" [disabled]="creating || !createValid" (clicked)="submitCreate()">{{ creating ? 'Creating...' : 'Create vehicle' }}</tm-button>
      </div>
    </tm-drawer>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 16px; }
    .page__hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .page__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .page__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); max-width: 80ch; }
    .cue { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 48px 24px; text-align: center; background: var(--tm-surface); border: 1px dashed var(--tm-line); border-radius: 14px; color: var(--tm-text-muted); }
    .cue__title { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .cue__text { margin: 0; font-size: 13px; }
    .cell-veh { display: inline-flex; align-items: center; gap: 10px; min-width: 0; }
    .cell-icon { width: 36px; height: 36px; border-radius: 9px; flex: none; display: inline-flex; align-items: center; justify-content: center; background: var(--tm-green-tint, #e0f7fa); color: var(--tm-green); }
    .cell-id { display: flex; flex-direction: column; min-width: 0; }
    .cell-name { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .cell-sub { font-size: 11px; color: var(--tm-text-muted); }
    .service { font-size: 12px; font-weight: 800; color: var(--tm-text); }
    .actionsInline { display: inline-flex; justify-content: flex-end; gap: 6px; }
    .iconAction { width: 32px; height: 32px; border: 1px solid var(--tm-line); border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; background: var(--tm-surface); color: var(--tm-text-muted); cursor: pointer; }
    .iconAction:hover { border-color: var(--tm-green); color: var(--tm-green); background: var(--tm-green-tint, #e0f7fa); }
    .form, .create { display: flex; flex-direction: column; gap: 14px; }
    .drawerTitle { display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--tm-line); border-radius: 10px; background: var(--tm-canvas); }
    .drawerTitle div { display: flex; flex-direction: column; gap: 2px; }
    .drawerTitle strong { font-size: 13px; color: var(--tm-text); }
    .drawerTitle small { font-size: 11px; color: var(--tm-text-muted); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .field--wide { grid-column: 1 / -1; }
    .field span, .segGroup span { font-size: 11px; font-weight: 800; color: var(--tm-text); }
    .field input, .field select { width: 100%; height: 36px; padding: 0 10px; border: 1px solid var(--tm-line); border-radius: 8px; background: var(--tm-canvas); color: var(--tm-text); font: inherit; font-size: 13px; outline: none; }
    .field input:focus, .field select:focus { border-color: var(--tm-green); }
    .segGroup { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
    .segGroup button, .miniChoice { padding: 7px 11px; border: 1px solid var(--tm-line); border-radius: 999px; background: var(--tm-canvas); color: var(--tm-text-muted); font: inherit; font-size: 12px; font-weight: 800; cursor: pointer; }
    .segGroup button.is-on, .miniChoice.is-on { border-color: var(--tm-green); color: var(--tm-green); background: var(--tm-green-tint, #e0f7fa); }
    .toggles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; }
    .toggles label { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: var(--tm-text); }
    .toggles input { width: 16px; height: 16px; accent-color: var(--tm-green); }
    .steps { display: flex; gap: 8px; }
    .steps span { padding: 5px 10px; border-radius: 999px; background: var(--tm-canvas-2); color: var(--tm-text-muted); font-size: 11px; font-weight: 800; }
    .steps span.is-on { background: var(--tm-green-tint, #e0f7fa); color: var(--tm-green); }
    .choice { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 12px; border: 1px solid var(--tm-line); border-radius: 10px; background: var(--tm-surface); color: var(--tm-text-muted); cursor: pointer; font-family: inherit; text-align: left; }
    .choice.is-on { border-color: var(--tm-green); color: var(--tm-green); background: var(--tm-green-tint, #e0f7fa); }
    .choice span { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
    .choice strong { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .choice small { font-size: 11px; color: var(--tm-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .choiceGrid { display: flex; flex-wrap: wrap; gap: 8px; }
    @media (max-width: 720px) { .page__hero { flex-direction: column; } .grid, .toggles { grid-template-columns: 1fr; } }
  `],
})
export class VehicleSetupNewComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  cities: CityOption[] = [];
  rows: VehicleRow[] = [];
  rideTypes: RideTypeRef[] = [];
  vehicleTypeOptions: VehicleTypeRef[] = [];
  loading = false;
  saving = false;
  creating = false;
  search = '';
  status: StatusFilter = 'all';
  service: ServiceMode | 'all' = 'all';
  page = 1;
  pageSize = 25;
  total = 0;
  pageRows: VehicleRow[] = [];
  commonOpen = false;
  selected: VehicleRow | null = null;
  edit = this.blankEdit();
  createOpen = false;
  createStep = 1;
  create = this.blankCreate();
  readonly statusOptions = STATUS_OPTIONS;
  readonly serviceOptions = [
    { label: 'Normal', value: 'private' },
    { label: 'Fixed', value: 'fixed' },
    { label: 'Shuttle', value: 'shuttle' },
  ];
  readonly modes = [
    { key: 'private' as const, label: 'Normal', icon: 'car' as const, hint: 'Normal, local, outstation and rental vehicles' },
    { key: 'fixed' as const, label: 'Fixed', icon: 'road' as const, hint: 'Fixed ride vehicles' },
    { key: 'shuttle' as const, label: 'Shuttle', icon: 'rupee' as const, hint: 'Dynamic Shuttle vehicles, planned until active' },
  ];
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
    this.api.get<{ data: VehicleRow[]; available_ride_types: RideTypeRef[]; available_vehicle_types?: VehicleTypeRef[] }>(`/admin/cities/${this.cityId}/vehicle-types`).subscribe({
      next: (res) => {
        this.rows = res.data ?? [];
        this.rideTypes = res.available_ride_types ?? [];
        this.vehicleTypeOptions = res.available_vehicle_types ?? [];
        this.loading = false;
        this.applyView();
      },
      error: () => {
        this.loading = false;
        this.toast.error('Failed to load vehicles');
      },
    });
  }

  private applyView(): void {
    const q = this.search.trim().toLowerCase();
    let list = this.rows;
    if (this.status !== 'all') {
      const active = this.status === 'enabled';
      list = list.filter((r) => r.is_active === active);
    }
    if (this.service !== 'all') {
      list = list.filter((r) => this.modeFor(r) === this.service);
    }
    if (q) {
      list = list.filter((r) =>
        r.display_name.toLowerCase().includes(q) ||
        (r.ride_type_name ?? '').toLowerCase().includes(q) ||
        (r.vehicle_type_name ?? '').toLowerCase().includes(q),
      );
    }
    this.total = list.length;
    const maxPage = Math.max(1, Math.ceil(this.total / this.pageSize));
    if (this.page > maxPage) this.page = maxPage;
    const start = (this.page - 1) * this.pageSize;
    this.pageRows = list.slice(start, start + this.pageSize);
  }

  onSearchChange(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => {
      this.page = 1;
      this.applyView();
    }, 250);
  }
  clearSearch(): void { this.search = ''; this.page = 1; this.applyView(); }
  onStatusChange(value: string): void { this.status = value as StatusFilter; this.page = 1; this.applyView(); }
  clearStatus(): void { this.status = 'all'; this.page = 1; this.applyView(); }
  statusLabel(): string { return this.statusOptions.find((o) => o.value === this.status)?.label ?? 'All statuses'; }
  onServiceChange(value: string): void { this.service = value as ServiceMode | 'all'; this.page = 1; this.applyView(); }
  clearService(): void { this.service = 'all'; this.page = 1; this.applyView(); }
  serviceLabel(): string { return this.serviceOptions.find((o) => o.value === this.service)?.label ?? 'All services'; }
  onPage(p: number): void { this.page = p; this.applyView(); }
  onPageSize(s: number): void { this.pageSize = s; this.page = 1; this.applyView(); }

  openCommon(row: VehicleRow): void {
    this.selected = row;
    this.resetEdit();
    this.commonOpen = true;
  }

  openFare(row: VehicleRow): void {
    this.router.navigateByUrl(`/vehicle-setup-new/${row.id}/fares`);
  }

  resetEdit(): void {
    const r = this.selected;
    this.edit = r ? {
      display_name: r.display_name,
      display_order: r.display_order,
      max_people: r.max_people,
      luggage_capacity: r.luggage_capacity,
      commission_type: r.commission_type ?? 'percent',
      commission_percent: r.commission_percent ?? 0,
      fixed_commission: r.fixed_commission ?? 0,
      min_driver_balance: r.min_driver_balance ?? 0,
      reverse_bidding_enabled: !!r.reverse_bidding_enabled,
      show_low_wallet_alert: !!r.show_low_wallet_alert,
      toll_mode: r.toll_mode ?? 'no',
      is_active: !!r.is_active,
    } : this.blankEdit();
  }

  saveCommon(): void {
    if (!this.selected || this.cityId == null || this.saving) return;
    const payload = {
      display_name: this.edit.display_name.trim(),
      display_order: this.edit.display_order,
      max_people: this.edit.max_people,
      luggage_capacity: this.edit.luggage_capacity,
      commission_type: this.edit.commission_type,
      commission_percent: this.edit.commission_type === 'percent' ? this.edit.commission_percent : 0,
      fixed_commission: this.edit.commission_type === 'fixed' ? this.edit.fixed_commission : 0,
      min_driver_balance: this.edit.min_driver_balance,
      show_low_wallet_alert: this.edit.show_low_wallet_alert,
      reverse_bidding_enabled: this.modeFor(this.selected) === 'private' ? this.edit.reverse_bidding_enabled : false,
      toll_mode: this.edit.toll_mode,
      is_active: this.edit.is_active,
    };
    this.saving = true;
    this.api.patch<{ vehicle_type: VehicleRow; message?: string }>(`/admin/cities/${this.cityId}/vehicle-types/${this.selected.id}`, payload).subscribe({
      next: () => {
        this.saving = false;
        this.commonOpen = false;
        this.toast.success('Vehicle saved');
        this.fetch();
      },
      error: (err) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Failed to save vehicle');
      },
    });
  }

  openCreate(): void {
    this.create = this.blankCreate();
    this.createOpen = true;
    this.createStep = 1;
  }

  chooseCreateService(service: ServiceMode): void {
    this.create.service = service;
    this.create.ride_type_id = this.createRideTypes[0]?.id ?? null;
  }

  submitCreate(): void {
    if (!this.createValid || this.creating || this.cityId == null) return;
    const f = this.create;
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
      min_driver_balance: 0,
      show_low_wallet_alert: f.show_low_wallet_alert,
      reverse_bidding_enabled: f.service === 'private' ? f.reverse_bidding_enabled : false,
      toll_mode: f.toll_applicable ? 'yes' : 'no',
    };
    this.creating = true;
    this.api.post<{ vehicle_type: VehicleRow; message?: string }>(`/admin/cities/${this.cityId}/vehicle-types`, payload).subscribe({
      next: () => {
        this.creating = false;
        this.createOpen = false;
        this.toast.success('Vehicle created');
        this.fetch();
      },
      error: (err) => {
        this.creating = false;
        this.toast.error(err?.error?.message || 'Failed to create vehicle');
      },
    });
  }

  get createRideTypes(): RideTypeRef[] {
    return this.rideTypes.filter((rt) => this.modeForName(rt.name) === this.create.service);
  }

  get createValid(): boolean {
    const f = this.create;
    const commissionValid = f.commission_type === 'percent' ? f.commission_percent != null : f.fixed_commission != null;
    return !!f.service && f.ride_type_id != null && f.vehicle_type_id != null && !!f.display_name.trim() && f.display_order != null && f.max_people != null && f.luggage_capacity != null && commissionValid;
  }

  serviceFor(row: VehicleRow): string {
    const mode = this.modeFor(row);
    return mode === 'private' ? 'Normal' : mode === 'fixed' ? 'Fixed' : 'Shuttle';
  }

  private modeFor(row: VehicleRow): ServiceMode {
    return this.modeForName(row.ride_type_name);
  }

  private modeForName(name: string): ServiceMode {
    const lower = (name ?? '').toLowerCase();
    if (lower.includes('shuttle')) return 'shuttle';
    if (lower.includes('fixed')) return 'fixed';
    return 'private';
  }

  private blankEdit() {
    return {
      display_name: '',
      display_order: 0,
      max_people: 1,
      luggage_capacity: 0,
      commission_type: 'percent' as 'percent' | 'fixed',
      commission_percent: 0,
      fixed_commission: 0,
      min_driver_balance: 0,
      reverse_bidding_enabled: true,
      show_low_wallet_alert: true,
      toll_mode: 'no' as 'yes' | 'no',
      is_active: true,
    };
  }

  private blankCreate() {
    return {
      service: 'private' as ServiceMode,
      ride_type_id: null as number | null,
      vehicle_type_id: null as number | null,
      display_name: '',
      display_order: 0 as number | null,
      max_people: 4 as number | null,
      luggage_capacity: 0 as number | null,
      commission_type: 'percent' as 'percent' | 'fixed',
      commission_percent: 0 as number | null,
      fixed_commission: 0 as number | null,
      toll_applicable: false,
      show_low_wallet_alert: true,
      reverse_bidding_enabled: true,
    };
  }
}
