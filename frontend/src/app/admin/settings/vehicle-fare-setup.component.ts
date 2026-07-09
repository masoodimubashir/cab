import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, IconComponent, IconName, StatusPillComponent } from '../../ui';
import { OutstationPackagesComponent } from './outstation-packages.component';
import { VehicleBasePricingComponent } from './vehicle-base-pricing.component';
import { FixedRoutesComponent } from '../fixed/fixed-routes.component';

type ServiceMode = 'private' | 'fixed' | 'shuttle';

interface VehicleRow {
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
}

interface ModeOption {
  key: ServiceMode;
  label: string;
  icon: IconName;
  hint: string;
}

interface RideTypeRef { id: number; name: string; }

@Component({
  selector: 'app-vehicle-fare-setup',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, IconComponent, StatusPillComponent, OutstationPackagesComponent, VehicleBasePricingComponent, FixedRoutesComponent],
  template: `
    <div class="page">
      <header class="hero">
        <button type="button" class="back" (click)="back()" aria-label="Back"><tm-icon name="chevron-left" [size]="18" /></button>
        <div class="heroMain">
          <div class="heroVehicle" *ngIf="selectedVehicle">
            <span class="heroVehicle__icon"><tm-icon name="car" [size]="15" /></span>
            <span class="heroVehicle__text">
              <strong>{{ selectedVehicle.display_name }}</strong>
              <small>{{ selectedVehicle.vehicle_type_name || 'Vehicle type not set' }}</small>
            </span>
            <tm-status-pill [tone]="selectedVehicle.is_active ? 'success' : 'neutral'">{{ selectedVehicle.is_active ? 'Active' : 'Off' }}</tm-status-pill>
          </div>
        </div>
      </header>

      <div class="cue" *ngIf="cityId == null">
        <tm-icon name="map-marker" [size]="24" />
        <strong>No city selected</strong>
        <span>Pick a city from the top bar to manage fare settings.</span>
      </div>

      <ng-container *ngIf="cityId != null">
        <nav class="tabs" aria-label="Fare sections">
          <button *ngFor="let mode of modes" type="button" [class.is-active]="activeMode === mode.key" (click)="setMode(mode.key)">
            <tm-icon [name]="mode.icon" [size]="15" />
            <span>{{ mode.label }}</span>
            <small>{{ countFor(mode.key) }}</small>
          </button>
        </nav>

        <section class="layout">
          <main class="editor">
            <div class="empty editorEmpty" *ngIf="!selectedVehicle">
              <tm-icon name="rupee" [size]="24" />
              <strong>Vehicle not found</strong>
              <span>Go back and choose a vehicle again.</span>
            </div>

            <div class="empty editorEmpty" *ngIf="selectedVehicle && !selected && activeMode !== 'fixed'">
              <tm-icon name="rupee" [size]="24" />
              <strong>{{ activeModeLabel }} fare is not configured yet</strong>
              <span>Create {{ activeModeLabel }} fare setup for {{ selectedVehicle.display_name }}. It will copy the common vehicle fields and then open the fare card.</span>
              <tm-button variant="green" icon="plus" [disabled]="creatingMode === activeMode" (clicked)="createFareSetup(activeMode)">{{ creatingMode === activeMode ? 'Creating...' : 'Create ' + activeModeLabel + ' fare setup' }}</tm-button>
            </div>

            <ng-container *ngIf="activeMode === 'fixed' && selectedVehicle">
              <section class="fareBox fareBox--fixed">
                <app-fixed-routes [cityVehicleTypeId]="selectedVehicle.id"></app-fixed-routes>
              </section>
            </ng-container>

            <ng-container *ngIf="selected && activeMode !== 'fixed'">
              <header class="editorHead">
                <div>
                  <h2>{{ selected.display_name }}</h2>
                  <p>{{ selected.vehicle_type_name || selected.ride_type_name }} · {{ activeModeLabel }}</p>
                </div>
                <div class="editorActions">
                  <tm-button variant="outline" size="sm" icon="refresh" [disabled]="loading" (clicked)="fetch()">Refresh</tm-button>
                  <tm-button variant="outline" size="sm" icon="eye" (clicked)="openCommonSetup()">Common setup</tm-button>
                </div>
              </header>

              <section class="uniqueBox">
                <div class="uniqueBox__head">
                  <h3>{{ activeModeLabel }} unique fields</h3>
                  <span *ngIf="activeMode === 'private'">Reverse bidding belongs only to Normal/Private.</span>
                  <span *ngIf="activeMode === 'shuttle'">Shuttle booking is still planned until quote/booking APIs are active.</span>
                </div>

                <div class="uniqueEdit" *ngIf="activeMode === 'private'">
                  <label>
                    <input type="checkbox" [(ngModel)]="uniqueForm.reverse_bidding_enabled" />
                    <span>Reverse bidding</span>
                  </label>
                  <tm-button variant="green" size="sm" icon="check" [disabled]="savingUnique" (clicked)="saveUniqueFields()">
                    {{ savingUnique ? 'Saving...' : 'Save unique fields' }}
                  </tm-button>
                </div>
                <div class="uniqueField" *ngIf="activeMode === 'shuttle'">
                  <tm-icon name="shield" [size]="16" />
                  <span>No extra live vehicle-level Shuttle fields yet. Shuttle fare is prepared below; booking remains planned.</span>
                </div>
              </section>

              <section class="fareBox">
                <app-vehicle-base-pricing
                  *ngIf="!isOutstation(selected)"
                  [cityId]="cityId"
                  [cityVehicleTypeId]="selected.id"
                  [title]="activeModeLabel + ' Fare Settings'"
                  [subtitle]="fareSubtitle"
                ></app-vehicle-base-pricing>
                <app-outstation-packages *ngIf="isOutstation(selected)" [cityId]="cityId" [vehicleTypeId]="selected.id"></app-outstation-packages>
              </section>
            </ng-container>
          </main>
        </section>
      </ng-container>
    </div>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 16px; }
    .hero { display: flex; align-items: center; gap: 12px; }
    .back { width: 34px; height: 34px; border: 0; border-radius: 9px; background: var(--tm-canvas-2); color: var(--tm-text-muted); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
    .back:hover { background: var(--tm-ink, #111827); color: #fff; }
    .cue, .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; min-height: 220px; padding: 30px; text-align: center; color: var(--tm-text-muted); background: var(--tm-surface); border: 1px dashed var(--tm-line); border-radius: 14px; }
    .cue strong, .empty strong { color: var(--tm-text); font-size: 14px; }
    .tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .tabs button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 42px; border: 1px solid var(--tm-line); border-radius: 10px; background: var(--tm-surface); color: var(--tm-text-muted); font: inherit; font-size: 13px; font-weight: 800; cursor: pointer; }
    .tabs button.is-active { border-color: var(--tm-green); background: var(--tm-green-tint, #e0f7fa); color: var(--tm-green); }
    .tabs small { font-size: 10px; opacity: .75; }
    .heroMain { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .heroVehicle { display: inline-flex; align-items: center; gap: 9px; width: fit-content; padding: 8px 10px; border: 1px solid var(--tm-line); border-radius: 10px; background: var(--tm-surface); }
    .heroVehicle__icon { width: 30px; height: 30px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; background: var(--tm-green-tint, #e0f7fa); color: var(--tm-green); }
    .heroVehicle__text { display: flex; flex-direction: column; gap: 1px; }
    .heroVehicle__text strong { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .heroVehicle__text small { font-size: 11px; color: var(--tm-text-muted); }
    .layout { display: block; }
    .editor, .fareBox, .uniqueBox { background: var(--tm-surface); border: 1px solid var(--tm-line); border-radius: 14px; overflow: hidden; }
    .editorHead { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--tm-line); }
    .editorHead h2 { margin: 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .editorHead p { margin: 2px 0 0; font-size: 12px; color: var(--tm-text-muted); }
    .editorActions { display: inline-flex; gap: 8px; }
    .editor { min-height: 520px; display: flex; flex-direction: column; gap: 14px; padding-bottom: 14px; }
    .editorEmpty { min-height: 520px; border: 0; background: transparent; }
    .uniqueBox, .fareBox { margin: 0 14px; padding: 14px; }
    .uniqueBox__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--tm-line); }
    .uniqueBox__head h3 { margin: 0; font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .uniqueBox__head span { font-size: 11px; color: var(--tm-text-muted); font-weight: 700; }
    .uniqueField, .uniqueEdit { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding: 10px 12px; border: 1px solid var(--tm-line); border-radius: 9px; background: var(--tm-canvas); color: var(--tm-text-muted); font-size: 12px; font-weight: 700; }
    .uniqueEdit { justify-content: space-between; }
    .uniqueEdit label { display: inline-flex; align-items: center; gap: 8px; color: var(--tm-text); }
    .uniqueEdit input { width: 16px; height: 16px; accent-color: var(--tm-green); }
    @media (max-width: 980px) { .tabs { grid-template-columns: 1fr; } .editorHead { flex-direction: column; } }
  `],
})
export class VehicleFareSetupComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  vehicleRowId: number | null = null;
  rows: VehicleRow[] = [];
  rideTypes: RideTypeRef[] = [];
  loading = false;
  savingUnique = false;
  creatingMode: ServiceMode | null = null;
  uniqueForm = { reverse_bidding_enabled: false };
  activeMode: ServiceMode = 'private';
  selectedVehicle: VehicleRow | null = null;
  selected: VehicleRow | null = null;
  readonly modes: ModeOption[] = [
    { key: 'private', label: 'Normal', icon: 'car', hint: 'Normal/private fare settings' },
    { key: 'fixed', label: 'Fixed', icon: 'road', hint: 'Fixed fare settings' },
    { key: 'shuttle', label: 'Shuttle', icon: 'rupee', hint: 'Shuttle fare settings' },
  ];
  private subs: Subscription[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private cityCtx: CityContextService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.subs.push(
      this.cityCtx.cityId$.subscribe((id) => {
        this.cityId = id;
        if (id != null) this.fetch();
      }),
      this.route.paramMap.subscribe((p) => {
        const raw = p.get('vehicleRowId');
        this.vehicleRowId = raw ? Number(raw) : null;
        this.pickInitialVehicle();
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  fetch(): void {
    if (this.cityId == null) return;
    this.loading = true;
    this.api.get<{ data: VehicleRow[]; available_ride_types?: RideTypeRef[] }>(`/admin/cities/${this.cityId}/vehicle-types`).subscribe({
      next: (res) => {
        this.rows = res.data ?? [];
        this.rideTypes = res.available_ride_types ?? [];
        this.loading = false;
        this.pickInitialVehicle();
      },
      error: () => {
        this.loading = false;
        this.toast.error('Failed to load fare vehicles');
      },
    });
  }

  setMode(mode: ServiceMode): void {
    this.activeMode = mode;
    this.selected = this.rowForMode(mode);
    this.syncUniqueForm();
  }

  createFareSetup(mode: ServiceMode): void {
    if (!this.selectedVehicle || this.cityId == null || this.creatingMode) return;
    const rideTypeId = this.rideTypeIdForMode(mode);
    if (rideTypeId == null) {
      this.toast.error(`${this.labelForMode(mode)} ride type is not available`);
      return;
    }

    const base = this.selectedVehicle;
    this.creatingMode = mode;
    this.api.post<{ vehicle_type: VehicleRow; message?: string }>(`/admin/cities/${this.cityId}/vehicle-types`, {
      ride_type_id: rideTypeId,
      vehicle_type_id: base.vehicle_type_id,
      display_name: base.display_name,
      max_people: base.max_people,
      luggage_capacity: base.luggage_capacity,
      reverse_bidding_enabled: mode === 'private' ? !!base.reverse_bidding_enabled : false,
    }).subscribe({
      next: (res) => {
        this.creatingMode = null;
        this.rows = [...this.rows, res.vehicle_type];
        this.vehicleRowId = res.vehicle_type.id;
        this.activeMode = mode;
        this.pickInitialVehicle();
        this.toast.success(res.message || `${this.labelForMode(mode)} fare setup created`);
      },
      error: (err) => {
        this.creatingMode = null;
        this.toast.error(err?.error?.message || `Failed to create ${this.labelForMode(mode)} fare setup`);
      },
    });
  }

  saveUniqueFields(): void {
    if (!this.selected || this.cityId == null || this.activeMode !== 'private' || this.savingUnique) return;
    this.savingUnique = true;
    this.api.patch<{ vehicle_type: VehicleRow; message?: string }>(`/admin/cities/${this.cityId}/vehicle-types/${this.selected.id}`, {
      reverse_bidding_enabled: this.uniqueForm.reverse_bidding_enabled,
    }).subscribe({
      next: (res) => {
        this.savingUnique = false;
        const updated = res.vehicle_type;
        this.rows = this.rows.map((r) => r.id === updated.id ? { ...r, ...updated } : r);
        this.pickInitialVehicle();
        this.syncUniqueForm();
        this.toast.success(res.message || 'Unique fields saved');
      },
      error: (err) => {
        this.savingUnique = false;
        this.toast.error(err?.error?.message || 'Failed to save unique fields');
      },
    });
  }

  openCommonSetup(): void {
    this.back();
  }

  back(): void {
    this.router.navigateByUrl('/vehicles');
  }


  get activeModeLabel(): string {
    return this.modes.find((m) => m.key === this.activeMode)?.label ?? 'Normal';
  }

  get fareSubtitle(): string {
    if (this.activeMode === 'shuttle') return 'Prepared Shuttle fare card. Customer and driver Shuttle booking is not active yet.';
    if (this.activeMode === 'fixed') return 'Fixed route path, stops, seats and flat fare are managed below.';
    return 'Existing Normal/Private fare card used by the current customer and driver flow.';
  }

  countFor(mode: ServiceMode): number {
    return this.rowForMode(mode) ? 1 : 0;
  }

  serviceFor(row: VehicleRow): string {
    const mode = this.modeFor(row);
    return mode === 'private' ? 'Normal' : mode === 'fixed' ? 'Fixed' : mode === 'shuttle' ? 'Shuttle' : 'Not configured';
  }

  isOutstation(row: VehicleRow): boolean {
    return row.is_outstation === true || (row.ride_type_name ?? '').toLowerCase().includes('outstation');
  }

  private pickInitialVehicle(): void {
    if (!this.rows.length) {
      this.selectedVehicle = null;
      this.selected = null;
      return;
    }
    const byId = this.vehicleRowId ? this.rows.find((r) => r.id === this.vehicleRowId) ?? null : null;
    if (!byId) {
      this.selectedVehicle = null;
      this.selected = null;
      this.syncUniqueForm();
      return;
    }

    const group = this.groupFor(byId);
    this.selectedVehicle = group.find((r) => this.modeFor(r) === 'private') ?? group[0];
    if (!this.selected || !group.some((r) => r.id === this.selected?.id)) {
      this.activeMode = this.modeFor(byId) ?? 'private';
    }
    this.selected = this.rowForMode(this.activeMode);
    this.syncUniqueForm();
  }

  private rowForMode(mode: ServiceMode): VehicleRow | null {
    if (!this.selectedVehicle) return null;
    return this.groupFor(this.selectedVehicle).find((r) => this.modeFor(r) === mode) ?? null;
  }

  private groupFor(row: VehicleRow): VehicleRow[] {
    const key = this.groupKey(row);
    return this.rows.filter((r) => this.groupKey(r) === key);
  }

  private groupKey(row: VehicleRow): string {
    return `${row.vehicle_type_id ?? 'none'}:${row.display_name.trim().toLowerCase()}`;
  }

  private rideTypeIdForMode(mode: ServiceMode): number | null {
    return this.rideTypes.find((rt) => this.modeForName(rt.name) === mode)?.id ?? null;
  }

  private labelForMode(mode: ServiceMode): string {
    return mode === 'private' ? 'Normal' : mode === 'fixed' ? 'Fixed' : 'Shuttle';
  }

  private syncUniqueForm(): void {

    this.uniqueForm = {
      reverse_bidding_enabled: !!this.selected?.reverse_bidding_enabled,
    };
  }

  private modeFor(row: VehicleRow): ServiceMode | null {
    return this.modeForName(row.ride_type_name);
  }

  private modeForName(name: string | null): ServiceMode | null {
    const lower = (name ?? '').toLowerCase();
    if (!lower) return null;
    if (lower.includes('shuttle')) return 'shuttle';
    if (lower.includes('fixed')) return 'fixed';
    return 'private';
  }
}
