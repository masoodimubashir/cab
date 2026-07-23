import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, IconComponent, StatusPillComponent } from '../../ui';
import { SeatGridComponent } from '../vehicle-seat-layouts/seat-grid.component';
import { VehicleSeatLayout, VehicleSeatLayoutsService } from '../vehicle-seat-layouts/vehicle-seat-layouts.service';

interface VehicleTypeRow { id: number; name: string; is_active: boolean; }
interface CityVehicleRow {
  id: number;
  vehicle_type_id: number | null;
  vehicle_type_name?: string | null;
  display_name: string;
  max_people: number;
  luggage_capacity: number;
  is_active: boolean;
}
interface VehicleTypeRef { id: number; name: string; }

/**
 * Fleet Setup — one page that owns the entire Vehicle Types → Vehicles →
 * Seat Layouts chain, no page navigation required. 3-column layout:
 *
 *   [ Vehicle Types ]   [ Vehicles (per selected type) ]   [ Seat Layouts (per selected type) ]
 *
 * All three columns are city-aware and cross-link off the same selection.
 * Add / edit forms are inline; the seat-layout designer still lives at
 * its own URL (too large to embed cleanly) and returns here on save.
 */
@Component({
  selector: 'app-fleet-setup',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonComponent, IconComponent, StatusPillComponent,
    SeatGridComponent,
  ],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1>Fleet Setup</h1>
          <p>Types, city vehicles and seat layouts — pick a type on the left, everything else follows.</p>
        </div>
      </header>

      <div class="cue" *ngIf="cityId == null">
        <tm-icon name="map-marker" [size]="22" />
        <strong>Pick a city from the top bar</strong>
        <span>Vehicles and seat layouts are city-scoped. Select one to begin.</span>
      </div>

      <section class="triple" *ngIf="cityId != null">
        <!-- ============ Column 1: Vehicle Types ============ -->
        <article class="col">
          <header class="col__head">
            <h2>Vehicle Types</h2>
            <small>Global — shared across cities</small>
          </header>

          <ul class="rows" *ngIf="types.length; else emptyTypes">
            <li *ngFor="let t of types"
                class="row row--tap"
                [class.row--active]="t.id === selectedTypeId"
                (click)="selectType(t.id)">
              <div class="row__body">
                <span class="row__title">{{ t.name }}</span>
                <tm-status-pill [tone]="t.is_active ? 'success' : 'neutral'">{{ t.is_active ? 'Active' : 'Off' }}</tm-status-pill>
              </div>
              <button class="row__edit" (click)="startEditType(t, $event)" aria-label="Edit type"><tm-icon name="edit" [size]="12" /></button>
            </li>
          </ul>
          <ng-template #emptyTypes>
            <div class="empty" *ngIf="!loadingTypes">No vehicle types yet.</div>
            <div class="empty" *ngIf="loadingTypes">Loading…</div>
          </ng-template>

          <form class="form" (submit)="saveType($event)">
            <label class="field">
              <span>{{ editingTypeId ? 'Edit vehicle type' : 'New vehicle type' }}</span>
              <input type="text" [(ngModel)]="typeForm.name" name="typeName" placeholder="Sedan / SUV / Bike" required />
            </label>
            <label class="toggle" *ngIf="editingTypeId">
              <input type="checkbox" [(ngModel)]="typeForm.is_active" name="typeActive" /> <span>Active</span>
            </label>
            <div class="form__actions">
              <tm-button *ngIf="editingTypeId" variant="ghost" size="sm" (clicked)="resetTypeForm()">Cancel</tm-button>
              <tm-button type="submit" variant="green" size="sm" [disabled]="!typeForm.name.trim() || typeSaving">
                {{ typeSaving ? 'Saving…' : editingTypeId ? 'Save' : '+ Add type' }}
              </tm-button>
            </div>
          </form>
        </article>

        <!-- ============ Column 2: Vehicles ============ -->
        <article class="col">
          <header class="col__head">
            <h2>Vehicles <span class="col__scope" *ngIf="selectedType">· {{ selectedType.name }}</span></h2>
            <small>Vehicles of the selected type in this city</small>
          </header>

          <div class="cue cue--mini" *ngIf="!selectedType">
            <tm-icon name="chevron-left" [size]="14" /> Pick a vehicle type on the left first.
          </div>

          <ng-container *ngIf="selectedType">
            <ul class="rows" *ngIf="vehiclesForType.length; else emptyVehicles">
              <li *ngFor="let v of vehiclesForType" class="row">
                <div class="row__body">
                  <span class="row__title">{{ v.display_name }}</span>
                  <span class="row__meta">{{ v.max_people }} seats · {{ v.luggage_capacity }} bags</span>
                </div>
                <div class="row__side">
                  <tm-status-pill [tone]="v.is_active ? 'success' : 'neutral'">{{ v.is_active ? 'On' : 'Off' }}</tm-status-pill>
                  <a class="row__link" (click)="openFares(v, $event)" href="#">Fares →</a>
                  <button class="row__edit" (click)="startEditVehicle(v)" aria-label="Edit vehicle"><tm-icon name="edit" [size]="12" /></button>
                </div>
              </li>
            </ul>
            <ng-template #emptyVehicles>
              <div class="empty" *ngIf="!loadingVehicles">No {{ selectedType.name }} vehicles in this city yet.</div>
              <div class="empty" *ngIf="loadingVehicles">Loading…</div>
            </ng-template>

            <form class="form" (submit)="saveVehicle($event)">
              <label class="field">
                <span>{{ editingVehicleId ? 'Edit vehicle' : 'New ' + selectedType.name + ' vehicle' }}</span>
                <input type="text" [(ngModel)]="vehicleForm.display_name" name="vDisplay" placeholder="Display name shown in apps" required />
              </label>
              <div class="form__row">
                <label class="field">
                  <span>Max people</span>
                  <input type="number" min="1" [(ngModel)]="vehicleForm.max_people" name="vMax" required />
                </label>
                <label class="field">
                  <span>Luggage cap</span>
                  <input type="number" min="0" [(ngModel)]="vehicleForm.luggage_capacity" name="vLug" required />
                </label>
              </div>
              <label class="toggle" *ngIf="editingVehicleId">
                <input type="checkbox" [(ngModel)]="vehicleForm.is_active" name="vActive" /> <span>Active</span>
              </label>
              <div class="form__actions">
                <tm-button *ngIf="editingVehicleId" variant="ghost" size="sm" (clicked)="resetVehicleForm()">Cancel</tm-button>
                <tm-button type="submit" variant="green" size="sm" [disabled]="!vehicleFormValid || vehicleSaving">
                  {{ vehicleSaving ? 'Saving…' : editingVehicleId ? 'Save' : '+ Add vehicle' }}
                </tm-button>
              </div>
            </form>
          </ng-container>
        </article>

        <!-- ============ Column 3: Seat Layouts ============ -->
        <article class="col">
          <header class="col__head">
            <h2>Seat Layouts <span class="col__scope" *ngIf="selectedType">· {{ selectedType.name }}</span></h2>
            <small>Grid designs for the selected type</small>
          </header>

          <div class="cue cue--mini" *ngIf="!selectedType">
            <tm-icon name="chevron-left" [size]="14" /> Pick a vehicle type on the left first.
          </div>

          <ng-container *ngIf="selectedType">
            <ul class="layouts" *ngIf="layoutsForType.length; else emptyLayouts">
              <li *ngFor="let l of layoutsForType" class="layout">
                <div class="layout__preview"><app-seat-grid [rows]="l.rows" [cols]="l.cols" [cells]="l.cells"></app-seat-grid></div>
                <div class="layout__meta">
                  <span class="layout__name">{{ l.name }}</span>
                  <span class="layout__sub">{{ l.rows }}×{{ l.cols }} · {{ l.seat_count }} seats <ng-container *ngIf="l.in_use"> · in use</ng-container></span>
                </div>
                <div class="layout__actions">
                  <a class="row__link" (click)="openLayout(l.id, $event)" href="#">Edit</a>
                  <button class="row__edit" *ngIf="!l.in_use" (click)="deleteLayout(l)" aria-label="Delete layout"><tm-icon name="x" [size]="12" /></button>
                </div>
              </li>
            </ul>
            <ng-template #emptyLayouts>
              <div class="empty" *ngIf="!loadingLayouts">No {{ selectedType.name }} layouts yet.</div>
              <div class="empty" *ngIf="loadingLayouts">Loading…</div>
            </ng-template>

            <div class="form">
              <tm-button variant="green" size="sm" icon="plus" (clicked)="openLayoutDesigner()">
                Design {{ selectedType.name }} layout
              </tm-button>
              <p class="form__hint">Opens the seat-grid designer and returns to Fleet Setup on save.</p>
            </div>
          </ng-container>
        </article>
      </section>
    </div>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 16px; }
    .page__head h1 { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .page__head p { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); }
    .cue { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 36px 20px; text-align: center; color: var(--tm-text-muted); background: var(--tm-surface); border: 1px dashed var(--tm-line); border-radius: 12px; }
    .cue strong { color: var(--tm-text); font-size: 14px; }
    .cue--mini { flex-direction: row; padding: 14px; gap: 6px; font-size: 12.5px; }

    .triple { display: grid; grid-template-columns: minmax(240px, 1fr) minmax(280px, 1.3fr) minmax(280px, 1.4fr); gap: 12px; align-items: start; }
    @media (max-width: 1100px) { .triple { grid-template-columns: 1fr; } }

    .col { display: flex; flex-direction: column; gap: 10px; padding: 14px; background: var(--tm-surface); border: 1px solid var(--tm-line); border-radius: 12px; min-height: 320px; }
    .col__head h2 { margin: 0; font-size: 14px; font-weight: 800; color: var(--tm-text); }
    .col__head small { display: block; margin-top: 2px; font-size: 11.5px; color: var(--tm-text-muted); }
    .col__scope { color: var(--tm-green, #16a34a); }

    .rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .row { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; padding: 9px 12px; background: var(--tm-canvas); border: 1px solid var(--tm-line); border-radius: 8px; }
    .row--tap { cursor: pointer; transition: border-color 120ms; }
    .row--tap:hover { border-color: var(--tm-text-muted); }
    .row--active { border-color: var(--tm-green, #16a34a); background: var(--tm-green-tint, #ecfdf5); }
    .row__body { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .row__title { font-size: 13px; font-weight: 700; color: var(--tm-text); }
    .row__meta { font-size: 11.5px; color: var(--tm-text-muted); margin-left: 6px; }
    .row__side { display: inline-flex; align-items: center; gap: 8px; }
    .row__link { font-size: 12px; color: var(--tm-green, #16a34a); font-weight: 700; text-decoration: none; }
    .row__link:hover { text-decoration: underline; }
    .row__edit { border: 0; background: transparent; color: var(--tm-text-muted); cursor: pointer; padding: 4px; border-radius: 6px; }
    .row__edit:hover { color: var(--tm-text); background: var(--tm-canvas-2, #f3f4f6); }

    .empty { padding: 20px 14px; text-align: center; font-size: 12.5px; color: var(--tm-text-muted); border: 1px dashed var(--tm-line); border-radius: 8px; }

    .form { display: flex; flex-direction: column; gap: 8px; padding-top: 10px; margin-top: 6px; border-top: 1px solid var(--tm-line); }
    .form__row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field > span { font-size: 11.5px; font-weight: 700; color: var(--tm-text); }
    .field input { padding: 8px 10px; border: 1px solid var(--tm-line); border-radius: 8px; font-size: 13px; background: var(--tm-canvas); color: var(--tm-text); }
    .field input:focus { outline: none; border-color: var(--tm-green, #16a34a); }
    .toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; }
    .toggle input { width: 15px; height: 15px; accent-color: var(--tm-green); }
    .form__actions { display: inline-flex; justify-content: flex-end; gap: 8px; }
    .form__hint { margin: 0; font-size: 11px; color: var(--tm-text-muted); }

    .layouts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .layout { display: grid; grid-template-columns: 74px 1fr auto; gap: 10px; padding: 10px 12px; background: var(--tm-canvas); border: 1px solid var(--tm-line); border-radius: 8px; align-items: center; }
    .layout__preview { width: 70px; height: 70px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .layout__preview :is(app-seat-grid) { transform: scale(0.4); transform-origin: top left; }
    .layout__meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .layout__name { font-size: 13px; font-weight: 700; color: var(--tm-text); }
    .layout__sub { font-size: 11px; color: var(--tm-text-muted); }
    .layout__actions { display: inline-flex; align-items: center; gap: 8px; }
  `],
})
export class FleetSetupComponent implements OnInit, OnDestroy {
  cityId: number | null = null;

  types: VehicleTypeRow[] = [];
  vehicles: CityVehicleRow[] = [];
  layouts: VehicleSeatLayout[] = [];

  selectedTypeId: number | null = null;

  loadingTypes = false;
  loadingVehicles = false;
  loadingLayouts = false;

  editingTypeId: number | null = null;
  typeForm: { name: string; is_active: boolean } = { name: '', is_active: true };
  typeSaving = false;

  editingVehicleId: number | null = null;
  vehicleForm: { display_name: string; max_people: number; luggage_capacity: number; is_active: boolean } = {
    display_name: '', max_people: 4, luggage_capacity: 0, is_active: true,
  };
  vehicleSaving = false;

  private subs: Subscription[] = [];

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private toast: ToastService,
    private router: Router,
    private layoutsSvc: VehicleSeatLayoutsService,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.subs.push(this.cityCtx.cityId$.subscribe((id) => {
      this.cityId = id;
      if (id != null) this.fetchAll();
    }));
  }

  ngOnDestroy(): void { this.subs.forEach((s) => s.unsubscribe()); }

  // ── selection ─────────────────────────────────────────────
  get selectedType(): VehicleTypeRow | null {
    return this.types.find((t) => t.id === this.selectedTypeId) ?? null;
  }
  get vehiclesForType(): CityVehicleRow[] {
    if (this.selectedTypeId == null) return [];
    return this.vehicles.filter((v) => v.vehicle_type_id === this.selectedTypeId);
  }
  get layoutsForType(): VehicleSeatLayout[] {
    if (this.selectedTypeId == null) return [];
    return this.layouts.filter((l) => l.vehicle_type_id === this.selectedTypeId);
  }
  selectType(id: number): void {
    this.selectedTypeId = id;
    this.resetVehicleForm();
  }

  // ── data ──────────────────────────────────────────────────
  fetchAll(): void {
    if (this.cityId == null) return;
    this.loadingTypes = this.loadingVehicles = this.loadingLayouts = true;
    forkJoin({
      types: this.api.get<{ data: VehicleTypeRow[] }>('/admin/vehicle-types-global'),
      vehicles: this.api.get<{ data: CityVehicleRow[] }>(`/admin/cities/${this.cityId}/vehicle-types`),
      layouts: this.layoutsSvc.list(this.cityId),
    }).subscribe({
      next: (res) => {
        this.types = res.types.data || [];
        this.vehicles = res.vehicles.data || [];
        this.layouts = res.layouts.data || [];
        this.loadingTypes = this.loadingVehicles = this.loadingLayouts = false;
        if (this.selectedTypeId == null && this.types.length) this.selectedTypeId = this.types[0].id;
      },
      error: () => {
        this.loadingTypes = this.loadingVehicles = this.loadingLayouts = false;
        this.toast.error('Failed to load fleet data');
      },
    });
  }

  // ── types ─────────────────────────────────────────────────
  startEditType(t: VehicleTypeRow, ev: MouseEvent): void {
    ev.stopPropagation();
    this.editingTypeId = t.id;
    this.typeForm = { name: t.name, is_active: t.is_active };
  }
  resetTypeForm(): void {
    this.editingTypeId = null;
    this.typeForm = { name: '', is_active: true };
  }
  saveType(ev: Event): void {
    ev.preventDefault();
    if (!this.typeForm.name.trim() || this.typeSaving) return;
    this.typeSaving = true;
    const payload: { name: string; is_active?: boolean } = { name: this.typeForm.name.trim() };
    if (this.editingTypeId) payload.is_active = this.typeForm.is_active;
    const req = this.editingTypeId
      ? this.api.patch<{ vehicle_type: VehicleTypeRow }>(`/admin/vehicle-types-global/${this.editingTypeId}`, payload)
      : this.api.post<{ vehicle_type: VehicleTypeRow }>('/admin/vehicle-types-global', payload);
    req.subscribe({
      next: () => {
        this.typeSaving = false;
        this.toast.success(this.editingTypeId ? 'Type updated' : 'Type added');
        this.resetTypeForm();
        this.fetchAll();
      },
      error: (err) => {
        this.typeSaving = false;
        this.toast.error(err?.error?.message || 'Failed to save vehicle type');
      },
    });
  }

  // ── vehicles ──────────────────────────────────────────────
  get vehicleFormValid(): boolean {
    return this.selectedType != null
      && this.vehicleForm.display_name.trim().length > 0
      && this.vehicleForm.max_people >= 1;
  }
  startEditVehicle(v: CityVehicleRow): void {
    this.editingVehicleId = v.id;
    this.vehicleForm = {
      display_name: v.display_name,
      max_people: v.max_people,
      luggage_capacity: v.luggage_capacity,
      is_active: v.is_active,
    };
  }
  resetVehicleForm(): void {
    this.editingVehicleId = null;
    this.vehicleForm = { display_name: '', max_people: 4, luggage_capacity: 0, is_active: true };
  }
  saveVehicle(ev: Event): void {
    ev.preventDefault();
    if (!this.vehicleFormValid || this.vehicleSaving || this.cityId == null) return;
    this.vehicleSaving = true;
    const base = {
      display_name: this.vehicleForm.display_name.trim(),
      max_people: this.vehicleForm.max_people,
      luggage_capacity: this.vehicleForm.luggage_capacity,
      is_active: this.vehicleForm.is_active,
    };
    const req = this.editingVehicleId
      ? this.api.patch<{ vehicle_type: CityVehicleRow }>(`/admin/cities/${this.cityId}/vehicle-types/${this.editingVehicleId}`, base)
      : this.api.post<{ vehicle_type: CityVehicleRow }>(`/admin/cities/${this.cityId}/vehicle-types`, { ...base, vehicle_type_id: this.selectedTypeId });
    req.subscribe({
      next: () => {
        this.vehicleSaving = false;
        this.toast.success(this.editingVehicleId ? 'Vehicle updated' : 'Vehicle added');
        this.resetVehicleForm();
        this.fetchAll();
      },
      error: (err) => {
        this.vehicleSaving = false;
        this.toast.error(err?.error?.message || 'Failed to save vehicle');
      },
    });
  }
  openFares(v: CityVehicleRow, ev: MouseEvent): void {
    ev.preventDefault();
    this.router.navigateByUrl(`/vehicles/${v.id}/fares?from=fleet`);
  }

  // ── layouts ───────────────────────────────────────────────
  openLayoutDesigner(): void {
    if (this.selectedTypeId == null) return;
    this.router.navigate(['/vehicle-seat-layouts/new'], { queryParams: { vehicle_type_id: this.selectedTypeId, from: 'fleet' } });
  }
  openLayout(id: number, ev: MouseEvent): void {
    ev.preventDefault();
    this.router.navigate([`/vehicle-seat-layouts/${id}`], { queryParams: { from: 'fleet' } });
  }
  deleteLayout(l: VehicleSeatLayout): void {
    if (this.cityId == null || l.in_use) return;
    if (!confirm(`Delete layout “${l.name}”? This cannot be undone.`)) return;
    this.layoutsSvc.destroy(this.cityId, l.id).subscribe({
      next: () => { this.toast.success('Layout deleted'); this.fetchAll(); },
      error: (err) => this.toast.error(err?.error?.message || 'Failed to delete layout'),
    });
  }
}
