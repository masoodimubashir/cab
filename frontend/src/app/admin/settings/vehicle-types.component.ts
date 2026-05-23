import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService, CityOption } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, DrawerComponent, IconComponent } from '../../ui';

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

/**
 * Vehicle Fares — the city's vehicle catalogue (one card per vehicle class),
 * scoped to the city chosen in the topbar switcher. "Details" opens the deep
 * per-kind editor; "Add vehicle type" uses the shared drawer.
 */
@Component({
  selector: 'app-vehicle-types',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, DrawerComponent, IconComponent],
  template: `
    <p class="intro">
      One card per vehicle. Open <strong>Details</strong> to tune its identity, fare,
      images and dispatcher settings.
    </p>

    <div class="cue" *ngIf="!cityId">
      <tm-icon name="map-marker" [size]="24" />
      <p class="cue__title">No city selected</p>
      <p class="cue__text">Pick a city from the switcher in the top bar.</p>
    </div>

    <ng-container *ngIf="cityId">
      <div class="toolbar">
        <div class="seg">
          <button class="seg__btn" [class.is-on]="filter === 'enabled'" (click)="filter = 'enabled'">
            Enabled <span class="seg__count">{{ countEnabled() }}</span>
          </button>
          <button class="seg__btn" [class.is-on]="filter === 'disabled'" (click)="filter = 'disabled'">
            Disabled <span class="seg__count">{{ countDisabled() }}</span>
          </button>
        </div>
        <tm-button variant="green" size="sm" icon="plus" (clicked)="openCreate()">
          Add vehicle type
        </tm-button>
      </div>

      <div class="grid" *ngIf="visibleRows().length; else empty">
        <article class="vcard" *ngFor="let v of visibleRows()">
          <div class="vcard__head">
            <span class="vcard__icon"><tm-icon name="car" [size]="16" /></span>
            <div class="vcard__id">
              <span class="vcard__name">{{ v.display_name }}</span>
              <span class="vcard__rt">{{ v.ride_type_name }}</span>
            </div>
            <span class="vcard__seats"><tm-icon name="users" [size]="13" /> {{ v.max_people }}</span>
          </div>
          <div class="vcard__kinds">
            <span class="kpill" [class.on]="v.is_active" [class.missing]="!v.is_active">
              {{ v.is_active ? 'Enabled' : 'Disabled' }}
            </span>
          </div>
          <div class="vcard__foot">
            <tm-button variant="outline" size="sm" icon="arrow-right" (clicked)="openDetails(v)">
              Details
            </tm-button>
          </div>
        </article>
      </div>
      <ng-template #empty>
        <div class="cue">
          <tm-icon name="car" [size]="24" />
          <p class="cue__title">No {{ filter }} vehicle types</p>
          <p class="cue__text" *ngIf="filter === 'enabled'">Add a vehicle type to start offering rides.</p>
        </div>
      </ng-template>
    </ng-container>

    <!-- Create drawer -->
    <tm-drawer [open]="createOpen" title="Add Vehicle Type" [width]="520" (closed)="createOpen = false">
      <div slot="body" class="form">
        <label class="field">
          <span class="field__lbl">City <i>*</i></span>
          <select [(ngModel)]="createForm.city_id">
            <option [ngValue]="null" disabled>Select city</option>
            <option *ngFor="let c of cities" [ngValue]="c.id">{{ c.name }}</option>
          </select>
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
          <span class="field__lbl">Destination Mandatory <i>*</i></span>
          <div class="radio-row">
            <label><input type="radio" name="destMand" [value]="true" [(ngModel)]="createForm.destination_mandatory" /> Yes</label>
            <label><input type="radio" name="destMand" [value]="false" [(ngModel)]="createForm.destination_mandatory" /> No</label>
          </div>
        </div>
        <div class="field">
          <span class="field__lbl">Fare Mandatory <i>*</i></span>
          <div class="radio-row">
            <label><input type="radio" name="fareMand" [value]="true" [(ngModel)]="createForm.fare_mandatory" /> Yes</label>
            <label><input type="radio" name="fareMand" [value]="false" [(ngModel)]="createForm.fare_mandatory" /> No</label>
          </div>
        </div>
        <div class="field">
          <span class="field__lbl">Toll Applicable <i>*</i></span>
          <div class="radio-row">
            <label><input type="radio" name="toll" [value]="true" [(ngModel)]="createForm.toll_applicable" /> Yes</label>
            <label><input type="radio" name="toll" [value]="false" [(ngModel)]="createForm.toll_applicable" /> No</label>
          </div>
        </div>

        <div class="row">
          <label class="field">
            <span class="field__lbl">Commission (%) <i>*</i></span>
            <input type="number" min="0" max="100" step="0.01" [(ngModel)]="createForm.commission_percent" />
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
    .intro { margin: 0 0 14px; font-size: 13px; color: var(--tm-text-muted); }

    .cue {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 48px 24px; text-align: center;
      background: var(--tm-surface); border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg); color: var(--tm-text-muted);
    }
    .cue__title { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .cue__text { margin: 0; font-size: 13px; }

    .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; }
    .seg {
      display: inline-flex; gap: 4px; padding: 4px;
      background: var(--tm-canvas-2); border-radius: var(--tm-radius-md, 10px);
    }
    .seg__btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 7px 14px; border-radius: 8px;
      font-size: 13px; font-weight: 700; color: var(--tm-text-muted);
      background: transparent; cursor: pointer;
    }
    .seg__btn.is-on { background: var(--tm-surface); color: var(--tm-text); box-shadow: var(--tm-shadow-sm); }
    .seg__count {
      font-size: 11px; font-weight: 800;
      padding: 1px 7px; border-radius: 999px;
      background: var(--tm-canvas); color: var(--tm-text-muted);
    }
    .seg__btn.is-on .seg__count { background: var(--tm-green-tint, #e0f7fa); color: var(--tm-green); }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(248px, 1fr));
      gap: 12px;
    }
    .vcard {
      background: var(--tm-surface); border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px); padding: 14px;
    }
    .vcard__head { display: flex; align-items: center; gap: 10px; }
    .vcard__icon {
      width: 32px; height: 32px; border-radius: 8px; flex: none;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--tm-green-tint, #e0f7fa); color: var(--tm-green);
    }
    .vcard__id { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .vcard__name { font-size: 14px; font-weight: 800; color: var(--tm-text); }
    .vcard__rt { font-size: 11px; color: var(--tm-text-muted); }
    .vcard__seats {
      display: inline-flex; align-items: center; gap: 4px; flex: none;
      font-size: 12px; font-weight: 700; color: var(--tm-text-muted);
    }
    .vcard__kinds {
      display: flex; gap: 6px; flex-wrap: wrap;
      border-top: 1px solid var(--tm-line); margin-top: 12px; padding-top: 12px;
    }
    .kpill {
      font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.3px;
      padding: 3px 8px; border-radius: 6px;
    }
    .kpill.on { background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .kpill.has { background: var(--tm-warning-bg); color: var(--tm-warning-fg); }
    .kpill.missing { background: var(--tm-canvas-2); color: var(--tm-text-muted); opacity: 0.6; }
    .vcard__foot { display: flex; justify-content: flex-end; margin-top: 12px; }

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
    .field__hint { font-size: 11px; color: var(--tm-text-muted); }
    .chips { display: flex; gap: 8px; flex-wrap: wrap; }
    .chip {
      padding: 8px 14px; border-radius: 999px;
      border: 1px solid var(--tm-line); background: var(--tm-canvas);
      color: var(--tm-text-muted); font-size: 13px; font-weight: 700; cursor: pointer;
    }
    .chip.is-on { background: var(--tm-green-tint, #e0f7fa); border-color: var(--tm-green); color: var(--tm-green); }
    .toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--tm-text); }
    .toggle input { width: 16px; height: 16px; }
    .radio-row { display: flex; gap: 22px; padding-top: 2px; }
    .radio-row label {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 13px; font-weight: 600; color: var(--tm-text); cursor: pointer;
    }
    .radio-row input { width: 15px; height: 15px; accent-color: var(--tm-green); }
  `],
})
export class VehicleTypesComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  rows: VehicleType[] = [];
  rideTypes: RideTypeRef[] = [];
  vehicleTypeOptions: VehicleTypeRef[] = [];

  filter: 'enabled' | 'disabled' = 'enabled';

  cities: CityOption[] = [];
  createOpen = false;
  creating = false;
  createForm = this.blankCreate();

  private subs: Subscription[] = [];

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
        else this.rows = [];
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  fetch(): void {
    if (this.cityId == null) return;
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
        },
        error: () => this.toast.error('Failed to load vehicle types'),
      });
  }

  /** One card per vehicle row. */
  visibleRows(): VehicleType[] {
    return this.filter === 'enabled'
      ? this.rows.filter((r) => r.is_active)
      : this.rows.filter((r) => !r.is_active);
  }

  countEnabled(): number {
    return this.rows.filter((r) => r.is_active).length;
  }
  countDisabled(): number {
    return this.rows.filter((r) => !r.is_active).length;
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
      commission_percent: null as number | null,
      destination_mandatory: false,
      fare_mandatory: false,
      toll_applicable: false,
    };
  }

  openCreate(): void {
    this.createForm = this.blankCreate();
    this.createOpen = true;
  }

  get createValid(): boolean {
    const f = this.createForm;
    return (
      f.city_id != null &&
      f.ride_type_id != null &&
      f.vehicle_type_id != null &&
      !!f.display_name.trim() &&
      f.display_order != null &&
      f.max_people != null &&
      f.commission_percent != null &&
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
      commission_percent: f.commission_percent,
      destination_mandatory: f.destination_mandatory,
      fare_mandatory: f.fare_mandatory,
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
