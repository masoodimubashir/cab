import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, Subscription } from 'rxjs';
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

interface VehicleTypeRow {
  id: number;
  name: string;
  sort_order: number;
  is_active: boolean;
}

type VehicleStatus = 'all' | 'active' | 'inactive';
type ServiceMode = 'private' | 'fixed' | 'shuttle';
type VehicleMode = ServiceMode | 'unassigned';
type CityVehicleStatus = 'all' | 'enabled' | 'disabled';

interface CityVehicleRow {
  id: number;
  city_id: number;
  ride_type_id: number | null;
  vehicle_type_id: number | null;
  vehicle_type_name?: string | null;
  ride_type_name: string | null;
  display_name: string;
  display_order: number;
  max_people: number;
  luggage_capacity: number;
  reverse_bidding_enabled: boolean;
  is_active: boolean;
  is_outstation?: boolean;
  fare_modes?: ServiceMode[];
}

interface RideTypeRef { id: number; name: string; }
interface VehicleTypeRef { id: number; name: string; }

const VEHICLE_STATUS_OPTIONS = [
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
];

const CITY_VEHICLE_STATUS_OPTIONS = [
  { label: 'Enabled', value: 'enabled' },
  { label: 'Disabled', value: 'disabled' },
];

@Component({
  selector: 'app-vehicles',
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
          <h1 class="page__title">Vehicles</h1>
          <p class="page__sub">Create vehicle types first, then use those types to create vehicles for the selected city.</p>
        </div>
      </header>

      <section class="flow">
        <button type="button" class="flowStep" [class.is-active]="activePanel === 'types'" (click)="activePanel = 'types'">
          <span class="flowStep__num">1</span>
          <div>
            <strong>Vehicle Types</strong>
            <small>Master categories like Auto, Bike, Sedan and SUV.</small>
          </div>
          <span class="flowStep__count">{{ vTotal }}</span>
        </button>
        <span class="flowArrow"><tm-icon name="arrow-right" [size]="16" /></span>
        <button type="button" class="flowStep flowStep--city" [class.is-active]="activePanel === 'city'" (click)="activePanel = 'city'">
          <span class="flowStep__num">2</span>
          <div>
            <strong>City Vehicles</strong>
            <small>Vehicles for the selected city. Each one must be linked to a vehicle type.</small>
          </div>
          <span class="flowStep__count">{{ cityTotal }}</span>
        </button>
      </section>

      <section class="section" *ngIf="activePanel === 'types'">
        <div class="sectionHead">
          <div>
            <p class="sectionKicker">Step 1</p>
            <h2>Vehicle Types</h2>
            <p>These are reusable master types. City vehicles below depend on this list.</p>
          </div>
          <tm-button variant="green" icon="plus" (clicked)="openVehicleCreate()">Add vehicle type</tm-button>
        </div>

        <tm-data-table
          [rows]="vPageRows"
          [total]="vTotal"
          [page]="vPage"
          [pageSize]="vPageSize"
          [loading]="vLoading"
          emptyTitle="No vehicle types"
          emptyHint="Create a type first, then city vehicles can use it."
          (pageChange)="onVPage($event)"
          (pageSizeChange)="onVPageSize($event)"
        >
          <tm-input slot="search" icon="search" placeholder="Search vehicle types..." [(ngModel)]="vehicleSearch" (ngModelChange)="onVehicleSearchChange()" />
          <ng-container slot="filters">
            <tm-filter-select icon="bolt" ariaLabel="Status filter" allLabel="All statuses" [options]="vehicleStatusOptions" [value]="vehicleStatus" (valueChange)="onVehicleStatusChange($event)" />
          </ng-container>
          <ng-container slot="banner">
            <tm-filter-pill *ngIf="vehicleSearch.trim()" icon="search" label="Search" [value]="vehicleSearch" (clear)="clearVehicleSearch()" />
            <tm-filter-pill *ngIf="vehicleStatus !== 'all'" icon="bolt" label="Status" [value]="vehicleStatusLabel()" (clear)="clearVehicleStatus()" />
          </ng-container>

          <tm-column key="name" label="Vehicle name">
            <ng-template let-row>
              <div class="cell-veh">
                <span class="cell-thumb"><tm-icon name="car" [size]="16" /></span>
                <div class="cell-id">
                  <span class="cell-name">{{ row.name }}</span>
                  <span class="cell-sub">Used by city vehicles</span>
                </div>
              </div>
            </ng-template>
          </tm-column>
          <tm-column key="sort_order" label="Order" width="90"><ng-template let-row><span class="mono">#{{ row.sort_order }}</span></ng-template></tm-column>
          <tm-column key="is_active" label="Status" width="130">
            <ng-template let-row><tm-status-pill [tone]="row.is_active ? 'success' : 'neutral'">{{ row.is_active ? 'Active' : 'Inactive' }}</tm-status-pill></ng-template>
          </tm-column>
          <tm-column key="actions" label="" width="70" align="right">
            <ng-template let-row>
              <button class="icon-btn" (click)="openVehicleEdit(row)" aria-label="Edit vehicle type"><tm-icon name="edit" [size]="14" /></button>
            </ng-template>
          </tm-column>
        </tm-data-table>
      </section>

      <section class="section section--city" *ngIf="activePanel === 'city'">
        <div class="sectionHead">
          <div>
            <p class="sectionKicker">Step 2</p>
            <h2>City Vehicles</h2>
            <p>Add city vehicles by choosing one of the vehicle types created above, then configure fares.</p>
          </div>
          <tm-button *ngIf="cityId != null" variant="green" icon="plus" [disabled]="!vehicleTypeOptions.length" (clicked)="openCreateCityVehicle()">Add vehicle</tm-button>
        </div>

        <div class="cue" *ngIf="cityId == null">
          <tm-icon name="map-marker" [size]="24" />
          <p class="cue__title">No city selected</p>
          <p class="cue__text">Pick a city from the top bar to manage city vehicles.</p>
        </div>

        <div class="cue" *ngIf="cityId != null && !vehicleTypeOptions.length && !cityLoading">
          <tm-icon name="car" [size]="24" />
          <p class="cue__title">Create a vehicle type first</p>
          <p class="cue__text">City vehicles must be linked to a vehicle type like Sedan, SUV or Auto.</p>
        </div>

        <tm-data-table
          *ngIf="cityId != null"
          [rows]="cityPageRows"
          [total]="cityTotal"
          [page]="cityPage"
          [pageSize]="cityPageSize"
          [loading]="cityLoading"
          emptyTitle="No city vehicles"
          emptyHint="Add a city vehicle after creating vehicle types."
          (pageChange)="onCityPage($event)"
          (pageSizeChange)="onCityPageSize($event)"
        >
          <tm-input slot="search" icon="search" placeholder="Search city vehicles..." [(ngModel)]="citySearch" (ngModelChange)="onCitySearchChange()" />
          <ng-container slot="filters">
            <tm-filter-select icon="bolt" ariaLabel="City vehicle status filter" allLabel="All statuses" [options]="cityStatusOptions" [value]="cityStatus" (valueChange)="onCityStatusChange($event)" />
          </ng-container>
          <ng-container slot="banner">
            <tm-filter-pill *ngIf="citySearch.trim()" icon="search" label="Search" [value]="citySearch" (clear)="clearCitySearch()" />
            <tm-filter-pill *ngIf="cityStatus !== 'all'" icon="bolt" label="Status" [value]="cityStatusLabel()" (clear)="clearCityStatus()" />
          </ng-container>

          <tm-column key="display_name" label="City vehicle">
            <ng-template let-row>
              <div class="cell-veh">
                <span class="cell-icon"><tm-icon name="car" [size]="16" /></span>
                <div class="cell-id">
                  <span class="cell-name">{{ row.display_name }}</span>
                  <span class="cell-sub">Type: {{ row.vehicle_type_name || 'Vehicle type not set' }}</span>
                </div>
              </div>
            </ng-template>
          </tm-column>
          <tm-column key="capacity" label="Capacity" width="150"><ng-template let-row><span>{{ row.max_people }} seats · {{ row.luggage_capacity }} bags</span></ng-template></tm-column>
          <tm-column key="fare_modes" label="Fare setup" width="190"><ng-template let-row><span class="service">{{ fareModesLabel(row) }}</span></ng-template></tm-column>
          <tm-column key="status" label="Status" width="120"><ng-template let-row><tm-status-pill [tone]="row.is_active ? 'success' : 'neutral'">{{ row.is_active ? 'Enabled' : 'Disabled' }}</tm-status-pill></ng-template></tm-column>
          <tm-column key="actions" label="" width="170" align="right">
            <ng-template let-row>
              <div class="actionsInline">
                <button type="button" class="iconAction" title="Common setup" (click)="openCommon(row)"><tm-icon name="eye" [size]="15" /></button>
                <button type="button" class="fareAction" title="Configure fare" (click)="openFare(row)"><span>Configure fare</span></button>
              </div>
            </ng-template>
          </tm-column>
        </tm-data-table>
      </section>
    </div>

    <tm-drawer [open]="vehicleOpen" [title]="vehicleEditingId ? 'Edit vehicle type' : 'Add vehicle type'" (closed)="vehicleOpen = false">
      <div slot="body" class="form">
        <label class="field"><span class="field__lbl">Vehicle name <i>*</i></span><input type="text" [(ngModel)]="vehicleForm.name" (ngModelChange)="vTouched = true" placeholder="Auto / Bike / Sedan" /><span class="field__err" *ngIf="vTouched && !vehicleForm.name.trim()">Vehicle name is required.</span></label>
        <label class="field"><span class="field__lbl">Sort order</span><input type="number" min="0" max="9999" [(ngModel)]="vehicleForm.sort_order" class="field--short" /></label>
        <label class="toggle"><input type="checkbox" [(ngModel)]="vehicleForm.is_active" /><span>Active</span></label>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="vehicleOpen = false">Cancel</tm-button>
        <tm-button variant="green" [disabled]="!vehicleForm.name.trim() || vehicleSaving" (clicked)="submitVehicle()">{{ vehicleSaving ? 'Saving...' : vehicleEditingId ? 'Save changes' : 'Create' }}</tm-button>
      </div>
    </tm-drawer>

    <tm-drawer [open]="commonOpen" title="Common city vehicle setup" [width]="620" (closed)="commonOpen = false">
      <div slot="body" class="form" *ngIf="selected">
        <div class="drawerTitle"><span class="cell-icon"><tm-icon name="car" [size]="16" /></span><div><strong>{{ selected.display_name }}</strong><small>Depends on type: {{ selected.vehicle_type_name || 'Vehicle type not set' }}</small></div></div>
        <div class="grid">
          <label class="field field--wide"><span class="field__lbl">Vehicle name</span><input type="text" [(ngModel)]="edit.display_name" /></label>
          <label class="field"><span class="field__lbl">Max people</span><input type="number" min="1" [(ngModel)]="edit.max_people" /></label>
          <label class="field"><span class="field__lbl">Luggage capacity</span><input type="number" min="0" [(ngModel)]="edit.luggage_capacity" /></label>
        </div>
        <div class="toggles"><label><input type="checkbox" [ngModel]="edit.is_active" (ngModelChange)="edit.is_active = $event" /> Active</label></div>
      </div>
      <div slot="footer"><tm-button variant="ghost" (clicked)="commonOpen = false">Cancel</tm-button><tm-button variant="green" icon="check" [disabled]="saving" (clicked)="saveCommon()">{{ saving ? 'Saving...' : 'Save common setup' }}</tm-button></div>
    </tm-drawer>

    <tm-drawer [open]="createOpen" title="Add vehicle" [width]="620" (closed)="createOpen = false">
      <div slot="body" class="create">
        <div class="setupNote"><strong>Vehicle type is required.</strong> Create the type in Step 1 first, then choose it here to create the city vehicle.</div>
        <label class="field field--wide"><span class="field__lbl">Vehicle name <i>*</i></span><select [(ngModel)]="create.vehicle_type_id" (ngModelChange)="onCreateVehicleTypeChange($event)"><option [ngValue]="null" disabled>Select vehicle name</option><option *ngFor="let vt of vehicleTypeOptions" [ngValue]="vt.id">{{ vt.name }}</option></select></label>
        <label class="field field--wide"><span class="field__lbl">Display name <i>*</i></span><input type="text" [(ngModel)]="create.display_name" placeholder="Display name shown in fare setup and apps" /></label>
        <div class="grid">
          <label class="field"><span class="field__lbl">Max people</span><input type="number" min="1" [(ngModel)]="create.max_people" /></label>
          <label class="field"><span class="field__lbl">Luggage capacity</span><input type="number" min="0" [(ngModel)]="create.luggage_capacity" /></label>
        </div>
        <div class="toggles"><label><input type="checkbox" [(ngModel)]="create.is_active" /> Active</label></div>
      </div>
      <div slot="footer"><tm-button variant="ghost" (clicked)="createOpen = false">Cancel</tm-button><tm-button variant="green" [disabled]="creating || !createValid" (clicked)="submitCreateCityVehicle()">{{ creating ? 'Creating...' : 'Create vehicle' }}</tm-button></div>
    </tm-drawer>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 18px; }
    .page__hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .page__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .page__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); max-width: 78ch; }
    .flow { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 10px; padding: 12px; border: 1px solid var(--tm-line); border-radius: 8px; background: var(--tm-surface); }
    .flowStep { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 10px; border-radius: 8px; background: var(--tm-canvas); border: 1px solid var(--tm-line); text-align: left; font: inherit; cursor: pointer; }
    .flowStep:hover, .flowStep.is-active { border-color: var(--tm-green); background: var(--tm-green-tint, #e0f7fa); }
    .flowStep--city { }
    .flowStep__num { width: 28px; height: 28px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; flex: none; background: var(--tm-ink); color: #fff; font-size: 12px; font-weight: 900; }
    .flowStep.is-active .flowStep__num { background: var(--tm-green); }
    .flowStep strong { display: block; font-size: 13px; color: var(--tm-text); }
    .flowStep small { display: block; margin-top: 2px; font-size: 11px; color: var(--tm-text-muted); }
    .flowStep__count { margin-left: auto; min-width: 30px; height: 24px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; padding: 0 8px; background: var(--tm-canvas-2); color: var(--tm-text); font-size: 11px; font-weight: 900; }
    .flowArrow { color: var(--tm-text-muted); }
    .section { display: flex; flex-direction: column; gap: 12px; padding-top: 2px; }
    .section + .section { border-top: 1px solid var(--tm-line); padding-top: 18px; }
    .sectionHead { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .sectionHead h2 { margin: 0; font-size: 17px; font-weight: 900; color: var(--tm-text); }
    .sectionHead p { margin: 3px 0 0; font-size: 12px; color: var(--tm-text-muted); }
    .sectionKicker { margin: 0 0 3px !important; text-transform: uppercase; letter-spacing: .08em; font-size: 10px !important; font-weight: 900; color: var(--tm-green) !important; }
    .cue { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 34px 20px; text-align: center; background: var(--tm-surface); border: 1px dashed var(--tm-line); border-radius: 8px; color: var(--tm-text-muted); }
    .cue__title { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .cue__text { margin: 0; font-size: 13px; }
    .cell-veh { display: inline-flex; align-items: center; gap: 11px; min-width: 0; }
    .cell-thumb, .cell-icon { width: 40px; height: 40px; border-radius: 8px; flex: none; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--tm-line); }
    .cell-thumb { background: var(--tm-canvas-2); color: var(--tm-text-muted); }
    .cell-thumb img { width: 100%; height: 100%; object-fit: cover; }
    .cell-icon { background: var(--tm-green-tint, #e0f7fa); color: var(--tm-green); border-color: transparent; }
    .cell-id { display: flex; flex-direction: column; min-width: 0; }
    .cell-name { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .cell-sub { font-size: 11px; color: var(--tm-text-muted); max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mono { font-family: var(--tm-font-mono); font-size: 12px; font-weight: 700; color: var(--tm-text-muted); }
    .service { font-size: 12px; font-weight: 800; color: var(--tm-text); }
    .icon-btn, .iconAction { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 7px; background: var(--tm-canvas-2); color: var(--tm-text-muted); cursor: pointer; border: 0; }
    .icon-btn:hover, .iconAction:hover { background: var(--tm-ink); color: #fff; }
    .actionsInline { display: inline-flex; justify-content: flex-end; gap: 6px; }
    .iconAction { width: 32px; height: 32px; border: 1px solid var(--tm-line); background: var(--tm-surface); }
    .fareAction { height: 32px; padding: 0 10px; border: 1px solid var(--tm-line); border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; background: var(--tm-surface); color: var(--tm-text-muted); cursor: pointer; font: inherit; font-size: 12px; font-weight: 800; white-space: nowrap; }
    .iconAction:hover, .fareAction:hover { border-color: var(--tm-green); color: var(--tm-green); background: var(--tm-green-tint, #e0f7fa); }
    .form, .create { display: flex; flex-direction: column; gap: 14px; }
    .field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .field--wide { grid-column: 1 / -1; }
    .field__lbl, .field span, .segGroup span { font-size: 12px; font-weight: 800; color: var(--tm-text); }
    .field__lbl i { color: var(--tm-danger, #ef4444); font-style: normal; }
    .field input[type=text], .field input[type=number], .field textarea, .field select { width: 100%; padding: 9px 11px; border: 1px solid var(--tm-line); border-radius: 8px; background: var(--tm-canvas); color: var(--tm-text); font-size: 13px; outline: none; }
    .field select, .field input[type=number] { height: 36px; }
    .field input:focus, .field textarea:focus, .field select:focus { border-color: var(--tm-green); }
    .field--short { max-width: 120px; }
    .field__err { font-size: 11px; font-weight: 600; color: var(--tm-danger, #ef4444); }
    .toggle, .toggles label { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: var(--tm-text); }
    .toggle input, .toggles input { width: 16px; height: 16px; accent-color: var(--tm-green); }
    .drawerTitle { display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--tm-line); border-radius: 8px; background: var(--tm-canvas); }
    .drawerTitle div { display: flex; flex-direction: column; gap: 2px; }
    .drawerTitle strong { font-size: 13px; color: var(--tm-text); }
    .drawerTitle small { font-size: 11px; color: var(--tm-text-muted); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .segGroup { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
    .segGroup button { padding: 7px 11px; border: 1px solid var(--tm-line); border-radius: 999px; background: var(--tm-canvas); color: var(--tm-text-muted); font: inherit; font-size: 12px; font-weight: 800; cursor: pointer; }
    .segGroup button.is-on { border-color: var(--tm-green); color: var(--tm-green); background: var(--tm-green-tint, #e0f7fa); }
    .toggles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; }
    .setupNote { padding: 10px 12px; border: 1px solid var(--tm-line); border-radius: 8px; background: var(--tm-canvas); color: var(--tm-text-muted); font-size: 12px; font-weight: 700; }
    .setupNote strong { color: var(--tm-text); }
    @media (max-width: 760px) { .page__hero, .sectionHead { flex-direction: column; } .flow { grid-template-columns: 1fr; } .flowArrow { display: none; } .grid, .toggles { grid-template-columns: 1fr; } }
  `],
})
export class VehiclesComponent implements OnInit, OnDestroy {
  activePanel: 'types' | 'city' = 'types';
  vehicleTypes: VehicleTypeRow[] = [];
  vehicleSearch = '';
  vehicleStatus: VehicleStatus = 'all';
  vehicleStatusOptions = VEHICLE_STATUS_OPTIONS;
  vPage = 1;
  vPageSize = 25;
  vLoading = false;
  vPageRows: VehicleTypeRow[] = [];
  vTotal = 0;
  vehicleOpen = false;
  vehicleEditingId: number | null = null;
  vehicleSaving = false;
  vTouched = false;
  vehicleForm = this.blankVehicleForm();

  cityId: number | null = null;
  cities: CityOption[] = [];
  cityRows: CityVehicleRow[] = [];
  rideTypes: RideTypeRef[] = [];
  vehicleTypeOptions: VehicleTypeRef[] = [];
  cityLoading = false;
  saving = false;
  creating = false;
  citySearch = '';
  cityStatus: CityVehicleStatus = 'all';
  cityStatusOptions = CITY_VEHICLE_STATUS_OPTIONS;
  cityPage = 1;
  cityPageSize = 25;
  cityTotal = 0;
  cityPageRows: CityVehicleRow[] = [];
  commonOpen = false;
  selected: CityVehicleRow | null = null;
  edit = this.blankEdit();
  createOpen = false;
  create = this.blankCreate();

  private subs: Subscription[] = [];
  private vSearchDebounce: any = null;
  private citySearchDebounce: any = null;

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private toast: ToastService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.loadVehicleTypes();
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.subs.push(
      this.cityCtx.cities$.subscribe((list) => (this.cities = list)),
      this.cityCtx.cityId$.subscribe((id) => {
        this.cityId = id;
        if (id != null) this.fetchCityVehicles();
        else {
          this.cityRows = [];
          this.applyCityView();
        }
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    if (this.vSearchDebounce) clearTimeout(this.vSearchDebounce);
    if (this.citySearchDebounce) clearTimeout(this.citySearchDebounce);
  }

  private applyVehicleView(): void {
    const q = this.vehicleSearch.trim().toLowerCase();
    let list = this.vehicleTypes;
    if (this.vehicleStatus === 'active') list = list.filter((v) => v.is_active);
    else if (this.vehicleStatus === 'inactive') list = list.filter((v) => !v.is_active);
    if (q) list = list.filter((v) => v.name.toLowerCase().includes(q));
    this.vTotal = list.length;
    const maxPage = Math.max(1, Math.ceil(this.vTotal / this.vPageSize));
    if (this.vPage > maxPage) this.vPage = maxPage;
    this.vPageRows = list.slice((this.vPage - 1) * this.vPageSize, (this.vPage - 1) * this.vPageSize + this.vPageSize);
  }

  vehicleStatusLabel(): string { return this.vehicleStatusOptions.find((o) => o.value === this.vehicleStatus)?.label ?? 'All statuses'; }
  onVehicleSearchChange(): void { if (this.vSearchDebounce) clearTimeout(this.vSearchDebounce); this.vSearchDebounce = setTimeout(() => { this.vPage = 1; this.applyVehicleView(); }, 250); }
  clearVehicleSearch(): void { this.vehicleSearch = ''; this.vPage = 1; this.applyVehicleView(); }
  onVehicleStatusChange(value: string): void { this.vehicleStatus = value as VehicleStatus; this.vPage = 1; this.applyVehicleView(); }
  clearVehicleStatus(): void { this.vehicleStatus = 'all'; this.vPage = 1; this.applyVehicleView(); }
  onVPage(p: number): void { this.vPage = p; this.applyVehicleView(); }
  onVPageSize(s: number): void { this.vPageSize = s; this.vPage = 1; this.applyVehicleView(); }

  loadVehicleTypes(): void {
    this.vLoading = true;
    this.api.get<{ data: VehicleTypeRow[] }>('/admin/vehicle-types-global').subscribe({
      next: (res) => {
        this.vehicleTypes = res.data ?? [];
        this.vLoading = false;
        this.applyVehicleView();
      },
      error: () => {
        this.vLoading = false;
        this.toast.error('Failed to load vehicle types');
      },
    });
  }

  blankVehicleForm() { return { name: '', sort_order: 0, is_active: true }; }
  openVehicleCreate(): void { this.vehicleEditingId = null; this.vTouched = false; this.vehicleForm = this.blankVehicleForm(); this.vehicleOpen = true; }
  openVehicleEdit(v: VehicleTypeRow): void { this.vehicleEditingId = v.id; this.vTouched = false; this.vehicleForm = { name: v.name, sort_order: v.sort_order, is_active: v.is_active }; this.vehicleOpen = true; }

  submitVehicle(): void {
    this.vTouched = true;
    if (!this.vehicleForm.name.trim() || this.vehicleSaving) return;
    this.vehicleSaving = true;
    const payload = {
      name: this.vehicleForm.name.trim(),
      sort_order: this.vehicleForm.sort_order ?? 0,
      is_active: this.vehicleForm.is_active,
    };
    const req = this.vehicleEditingId
      ? this.api.patch<{ vehicle_type: VehicleTypeRow }>(`/admin/vehicle-types-global/${this.vehicleEditingId}`, payload)
      : this.api.post<{ vehicle_type: VehicleTypeRow }>('/admin/vehicle-types-global', payload);
    req.subscribe({
      next: (res) => {
        this.vehicleSaving = false;
        this.vehicleOpen = false;
        const idx = this.vehicleTypes.findIndex((v) => v.id === res.vehicle_type.id);
        if (idx >= 0) this.vehicleTypes[idx] = res.vehicle_type;
        else this.vehicleTypes = [...this.vehicleTypes, res.vehicle_type];
        this.applyVehicleView();
        this.fetchCityVehicles(false);
        this.toast.success(this.vehicleEditingId ? 'Vehicle type updated' : 'Vehicle type created');
      },
      error: (err) => {
        this.vehicleSaving = false;
        this.toast.error(err?.error?.message || 'Failed to save vehicle type');
      },
    });
  }

  fetchCityVehicles(showLoader = true): void {
    if (this.cityId == null) return;
    if (showLoader) this.cityLoading = true;
    this.api.get<{ data: CityVehicleRow[]; available_ride_types: RideTypeRef[]; available_vehicle_types?: VehicleTypeRef[] }>(`/admin/cities/${this.cityId}/vehicle-types`).subscribe({
      next: (res) => {
        this.cityRows = res.data ?? [];
        this.rideTypes = res.available_ride_types ?? [];
        this.vehicleTypeOptions = res.available_vehicle_types ?? [];
        this.cityLoading = false;
        this.applyCityView();
      },
      error: () => {
        this.cityLoading = false;
        this.toast.error('Failed to load city vehicles');
      },
    });
  }

  private applyCityView(): void {
    const q = this.citySearch.trim().toLowerCase();
    let list = this.groupCityVehicleRows(this.cityRows);
    if (this.cityStatus !== 'all') {
      const active = this.cityStatus === 'enabled';
      list = list.filter((r) => r.is_active === active);
    }
    if (q) {
      list = list.filter((r) =>
        r.display_name.toLowerCase().includes(q) ||
        (r.ride_type_name ?? '').toLowerCase().includes(q) ||
        (r.vehicle_type_name ?? '').toLowerCase().includes(q) ||
        this.fareModesLabel(r).toLowerCase().includes(q),
      );
    }
    this.cityTotal = list.length;
    const maxPage = Math.max(1, Math.ceil(this.cityTotal / this.cityPageSize));
    if (this.cityPage > maxPage) this.cityPage = maxPage;
    this.cityPageRows = list.slice((this.cityPage - 1) * this.cityPageSize, (this.cityPage - 1) * this.cityPageSize + this.cityPageSize);
  }

  onCitySearchChange(): void { if (this.citySearchDebounce) clearTimeout(this.citySearchDebounce); this.citySearchDebounce = setTimeout(() => { this.cityPage = 1; this.applyCityView(); }, 250); }
  clearCitySearch(): void { this.citySearch = ''; this.cityPage = 1; this.applyCityView(); }
  onCityStatusChange(value: string): void { this.cityStatus = value as CityVehicleStatus; this.cityPage = 1; this.applyCityView(); }
  clearCityStatus(): void { this.cityStatus = 'all'; this.cityPage = 1; this.applyCityView(); }
  cityStatusLabel(): string { return this.cityStatusOptions.find((o) => o.value === this.cityStatus)?.label ?? 'All statuses'; }
  onCityPage(p: number): void { this.cityPage = p; this.applyCityView(); }
  onCityPageSize(s: number): void { this.cityPageSize = s; this.cityPage = 1; this.applyCityView(); }

  openCommon(row: CityVehicleRow): void { this.selected = row; this.resetEdit(); this.commonOpen = true; }
  openFare(row: CityVehicleRow): void { this.router.navigateByUrl(`/vehicles/${row.id}/fares`); }

  resetEdit(): void {
    const r = this.selected;
    this.edit = r ? {
      display_name: r.display_name,
      max_people: r.max_people,
      luggage_capacity: r.luggage_capacity,
      is_active: !!r.is_active,
    } : this.blankEdit();
  }

  saveCommon(): void {
    if (!this.selected || this.cityId == null || this.saving) return;
    const payload = {
      display_name: this.edit.display_name.trim(),
      max_people: this.edit.max_people,
      luggage_capacity: this.edit.luggage_capacity,
      is_active: this.edit.is_active,
    };
    this.saving = true;
    const group = this.groupRowsFor(this.selected);
    forkJoin(group.map((row) => this.api.patch<{ vehicle_type: CityVehicleRow; message?: string }>(`/admin/cities/${this.cityId}/vehicle-types/${row.id}`, payload))).subscribe({
      next: () => { this.saving = false; this.commonOpen = false; this.toast.success('City vehicle saved'); this.fetchCityVehicles(); },
      error: (err) => { this.saving = false; this.toast.error(err?.error?.message || 'Failed to save city vehicle'); },
    });
  }

  openCreateCityVehicle(): void { this.create = this.blankCreate(); this.createOpen = true; }

  submitCreateCityVehicle(): void {
    if (!this.createValid || this.creating || this.cityId == null) return;
    const f = this.create;
    const payload = {
      vehicle_type_id: f.vehicle_type_id,
      display_name: f.display_name.trim(),
      max_people: f.max_people,
      luggage_capacity: f.luggage_capacity,
      is_active: f.is_active,
    };
    this.creating = true;
    this.api.post<{ vehicle_type: CityVehicleRow; message?: string }>(`/admin/cities/${this.cityId}/vehicle-types`, payload).subscribe({
      next: () => { this.creating = false; this.createOpen = false; this.toast.success('City vehicle created'); this.fetchCityVehicles(); },
      error: (err) => { this.creating = false; this.toast.error(err?.error?.message || 'Failed to create city vehicle'); },
    });
  }

  get createValid(): boolean {
    const f = this.create;
    return f.vehicle_type_id != null && f.display_name.trim().length > 0 && f.max_people != null && f.luggage_capacity != null;
  }

  onCreateVehicleTypeChange(_id: number | null): void {
    this.create.display_name = '';
  }

  fareModesLabel(row: CityVehicleRow): string {
    const modes = row.fare_modes ?? [this.modeFor(row)];
    const labels = modes.filter((m): m is ServiceMode => m !== 'unassigned').map((m) => m === 'private' ? 'Normal' : m === 'fixed' ? 'Fixed' : 'Shuttle');
    return labels.length ? labels.join(', ') : 'Not configured';
  }

  private groupRowsFor(row: CityVehicleRow): CityVehicleRow[] {
    const key = `${row.vehicle_type_id ?? 'none'}:${row.display_name.trim().toLowerCase()}`;
    return this.cityRows.filter((r) => `${r.vehicle_type_id ?? 'none'}:${r.display_name.trim().toLowerCase()}` === key);
  }

  private groupCityVehicleRows(rows: CityVehicleRow[]): CityVehicleRow[] {
    const groups = new Map<string, CityVehicleRow[]>();
    rows.forEach((row) => {
      const key = `${row.vehicle_type_id ?? 'none'}:${row.display_name.trim().toLowerCase()}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    });
    return Array.from(groups.values()).map((group) => {
      const rep = group.find((r) => this.modeFor(r) === 'private') ?? group[0];
      const order: ServiceMode[] = ['private', 'fixed', 'shuttle'];
      const modes = order.filter((mode) => group.some((row) => this.modeFor(row) === mode));
      return { ...rep, fare_modes: modes };
    });
  }

  private modeFor(row: CityVehicleRow): VehicleMode { return this.modeForName(row.ride_type_name); }
  private modeForName(name: string | null): VehicleMode { const lower = (name ?? '').toLowerCase(); if (!lower) return 'unassigned'; if (lower.includes('shuttle')) return 'shuttle'; if (lower.includes('fixed')) return 'fixed'; return 'private'; }

  private blankEdit() {
    return { display_name: '', max_people: 1, luggage_capacity: 0, is_active: true };
  }

  private blankCreate() {
    return { vehicle_type_id: null as number | null, display_name: '', max_people: 4 as number | null, luggage_capacity: 0 as number | null, is_active: true };
  }
}
