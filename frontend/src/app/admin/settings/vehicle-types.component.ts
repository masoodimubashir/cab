import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { CheckboxModule } from 'primeng/checkbox';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';

type ProductKind = 'local' | 'rental' | 'outstation';

interface VehicleType {
  id: number;
  city_id: number;
  ride_type_id: number;
  ride_type_name: string;
  product_kind: ProductKind;
  display_name: string;
  max_people: number;
  is_active: boolean;
}

interface RideTypeRef {
  id: number;
  name: string;
}

interface VehicleTypeRef {
  id: number;
  name: string;
}

interface VehicleGroup {
  ride_type_id: number;
  ride_type_name: string;
  display_name: string;
  max_people: number;
  kinds: ProductKind[];        // kinds that exist
  enabled_kinds: ProductKind[]; // subset with is_active=true
}

@Component({
  selector: 'app-vehicle-types',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    DialogModule,
    DropdownModule,
    InputTextModule,
    InputNumberModule,
    CheckboxModule,
    ToastModule,
  ],
  providers: [MessageService],
  template: `
    <p-toast />

    <p class="muted">
      One row per vehicle class. Each vehicle is created across all three product kinds
      (Local · Rental · Out Station) — open <strong>Details</strong> to enable the kinds
      you actually offer and tune them independently.
    </p>

    <div *ngIf="!cityId" class="empty">Pick a city from the left rail.</div>

    <div *ngIf="cityId" class="head-bar">
      <div class="tabs">
        <button class="tab" [class.active]="filter === 'enabled'" (click)="filter = 'enabled'">
          Enabled ({{ countEnabled() }})
        </button>
        <button class="tab" [class.active]="filter === 'disabled'" (click)="filter = 'disabled'">
          Disabled ({{ countDisabled() }})
        </button>
      </div>
      <button
        pButton
        type="button"
        label="Add Vehicle Type"
        icon="pi pi-plus"
        class="p-button-sm"
        (click)="openCreate()"
      ></button>
    </div>

    <p-table
      *ngIf="cityId"
      [value]="visibleGroups()"
      [paginator]="true"
      [rows]="20"
      [rowHover]="true"
      styleClass="p-datatable-sm"
    >
      <ng-template pTemplate="header">
        <tr>
          <th>Vehicle Name</th>
          <th>Kinds</th>
          <th class="num">Max</th>
          <th></th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-g>
        <tr>
          <td><strong>{{ g.display_name }}</strong></td>
          <td>
            <span
              *ngFor="let k of g.kinds"
              class="pill"
              [class.on]="g.enabled_kinds.includes(k)"
              [class.off]="!g.enabled_kinds.includes(k)"
            >
              {{ kindLabel(k) }}
            </span>
          </td>
          <td class="num">{{ g.max_people }}</td>
          <td class="actions-col">
            <button
              pButton
              type="button"
              label="Details"
              class="p-button-sm"
              (click)="openDetails(g)"
            ></button>
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr>
          <td colspan="4" class="empty">
            No vehicle types yet. Click "Add Vehicle Type" to create one.
          </td>
        </tr>
      </ng-template>
    </p-table>

    <!-- Create dialog -->
    <p-dialog
      header="Add Vehicle Type"
      [(visible)]="createOpen"
      [modal]="true"
      [style]="{ width: '460px' }"
      [draggable]="false"
    >
      <div class="form">
        <label class="lbl">Ride Type *</label>
        <p-dropdown
          [options]="rideTypes"
          [(ngModel)]="createForm.ride_type_id"
          optionLabel="name"
          optionValue="id"
          placeholder="Select ride service"
          appendTo="body"
          [style]="{ width: '100%' }"
        ></p-dropdown>

        <label class="lbl">Vehicle Type</label>
        <p-dropdown
          [options]="vehicleTypeOptions"
          [(ngModel)]="createForm.vehicle_type_id"
          optionLabel="name"
          optionValue="id"
          placeholder="Select vehicle category (Auto, Bike, Mini…)"
          [showClear]="true"
          appendTo="body"
          [style]="{ width: '100%' }"
        ></p-dropdown>

        <label class="lbl">Display Name *</label>
        <input pInputText [(ngModel)]="createForm.display_name" placeholder="SEDAN/SWIFT L" />

        <label class="lbl">Max People *</label>
        <p-inputNumber [(ngModel)]="createForm.max_people" [min]="1" [max]="20"></p-inputNumber>

        <label class="lbl">Luggage Capacity</label>
        <p-inputNumber [(ngModel)]="createForm.luggage_capacity" [min]="0" [max]="20"></p-inputNumber>

        <label class="lbl">Commission (%)</label>
        <p-inputNumber
          [(ngModel)]="createForm.commission_percent"
          [min]="0"
          [max]="100"
          mode="decimal"
          [maxFractionDigits]="2"
        ></p-inputNumber>

        <label class="row">
          <p-checkbox [(ngModel)]="createForm.destination_mandatory" [binary]="true"></p-checkbox>
          Destination mandatory
        </label>

        <label class="lbl" style="margin-top: 12px;">Enabled in * <span class="muted small">(pick at least one)</span></label>
        <div class="kind-row">
          <label class="row">
            <p-checkbox [(ngModel)]="createForm.kind_local" [binary]="true"></p-checkbox>
            Local
          </label>
          <label class="row">
            <p-checkbox [(ngModel)]="createForm.kind_rental" [binary]="true"></p-checkbox>
            Rental
          </label>
          <label class="row">
            <p-checkbox [(ngModel)]="createForm.kind_outstation" [binary]="true"></p-checkbox>
            Out Station
          </label>
        </div>

        <p class="hint muted small">
          Picked kinds are created <strong>enabled</strong>. You can add a missing kind
          later from the Details page by flipping its switch on.
        </p>
      </div>
      <ng-template pTemplate="footer">
        <button pButton type="button" label="Cancel" class="p-button-secondary" (click)="createOpen = false"></button>
        <button pButton type="button" label="Create" (click)="submitCreate()" [loading]="creating"></button>
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .muted { color: #64748b; font-size: 13px; margin: 0 0 12px; }
      .small { font-size: 12px; }
      .empty { padding: 30px; text-align: center; color: #64748b; }
      .head-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin: 4px 0 14px;
      }
      .tabs { display: flex; gap: 6px; }
      .tab {
        background: #fff;
        border: 1px solid #cbd5e1;
        border-radius: 999px;
        padding: 6px 14px;
        font-size: 12px;
        font-weight: 700;
        color: #475569;
        cursor: pointer;
      }
      .tab.active { background: #06b6d4; color: #fff; border-color: #06b6d4; }
      .num { text-align: right; }
      .pill {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        margin-right: 4px;
      }
      .pill.on { background: #dcfce7; color: #166534; }
      .pill.off { background: #f1f5f9; color: #94a3b8; }
      .actions-col { width: 110px; }
      .form { display: flex; flex-direction: column; gap: 6px; }
      .form .lbl { font-size: 12px; font-weight: 700; color: #475569; margin-top: 6px; }
      .row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 600;
        color: #334155;
        margin-top: 6px;
      }
      .hint { margin-top: 10px; }
      .kind-row {
        display: flex;
        gap: 18px;
        flex-wrap: wrap;
        background: #f8fafc;
        padding: 8px 12px;
        border-radius: 8px;
        margin-top: 4px;
      }
      .kind-row .row { margin: 0; }
      :host ::ng-deep .p-inputnumber { width: 100%; }
    `,
  ],
})
export class VehicleTypesComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  rows: VehicleType[] = [];
  rideTypes: RideTypeRef[] = [];
  vehicleTypeOptions: VehicleTypeRef[] = [];

  filter: 'enabled' | 'disabled' = 'enabled';

  createOpen = false;
  creating = false;
  createForm: {
    ride_type_id: number | null;
    vehicle_type_id: number | null;
    display_name: string;
    max_people: number;
    luggage_capacity: number;
    commission_percent: number;
    destination_mandatory: boolean;
    kind_local: boolean;
    kind_rental: boolean;
    kind_outstation: boolean;
  } = this.blankCreate();

  private sub?: Subscription;

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private msg: MessageService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.sub = this.cityCtx.cityId$.subscribe((id) => {
      this.cityId = id;
      if (id != null) this.fetch();
      else this.rows = [];
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
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
        error: () => this.msg.add({ severity: 'error', summary: 'Failed to load vehicle types' }),
      });
  }

  groups(): VehicleGroup[] {
    const byRideType = new Map<number, VehicleType[]>();
    for (const r of this.rows) {
      const arr = byRideType.get(r.ride_type_id) ?? [];
      arr.push(r);
      byRideType.set(r.ride_type_id, arr);
    }
    return Array.from(byRideType.values()).map((rowsForRT) => {
      const first = rowsForRT[0];
      return {
        ride_type_id: first.ride_type_id,
        ride_type_name: first.ride_type_name,
        display_name: first.display_name,
        max_people: first.max_people,
        kinds: rowsForRT.map((r) => r.product_kind),
        enabled_kinds: rowsForRT.filter((r) => r.is_active).map((r) => r.product_kind),
      };
    });
  }

  visibleGroups(): VehicleGroup[] {
    const all = this.groups();
    if (this.filter === 'enabled') return all.filter((g) => g.enabled_kinds.length > 0);
    return all.filter((g) => g.enabled_kinds.length === 0);
  }

  countEnabled(): number {
    return this.groups().filter((g) => g.enabled_kinds.length > 0).length;
  }
  countDisabled(): number {
    return this.groups().filter((g) => g.enabled_kinds.length === 0).length;
  }

  kindLabel(k: ProductKind): string {
    if (k === 'local') return 'Local';
    if (k === 'rental') return 'Rental';
    return 'Out Station';
  }

  openDetails(g: VehicleGroup): void {
    this.router.navigateByUrl(`/settings/vehicle-types/${g.ride_type_id}`);
  }

  // ---- Create ----
  blankCreate(): typeof this.createForm {
    return {
      ride_type_id: null,
      vehicle_type_id: null,
      display_name: '',
      max_people: 4,
      luggage_capacity: 2,
      commission_percent: 10,
      destination_mandatory: true,
      kind_local: true,
      kind_rental: true,
      kind_outstation: true,
    };
  }
  openCreate(): void {
    this.createForm = this.blankCreate();
    this.createOpen = true;
  }
  submitCreate(): void {
    if (this.cityId == null) return;
    const f = this.createForm;
    if (!f.ride_type_id || !f.display_name.trim()) {
      this.msg.add({ severity: 'warn', summary: 'Ride type and display name are required' });
      return;
    }
    const kinds: ProductKind[] = [];
    if (f.kind_local) kinds.push('local');
    if (f.kind_rental) kinds.push('rental');
    if (f.kind_outstation) kinds.push('outstation');
    if (kinds.length === 0) {
      this.msg.add({ severity: 'warn', summary: 'Enable at least one of Local / Rental / Out Station' });
      return;
    }

    const payload = {
      ride_type_id: f.ride_type_id,
      vehicle_type_id: f.vehicle_type_id,
      display_name: f.display_name.trim(),
      max_people: f.max_people,
      luggage_capacity: f.luggage_capacity,
      commission_percent: f.commission_percent,
      destination_mandatory: f.destination_mandatory,
      kinds,
    };

    this.creating = true;
    this.api
      .post<{ data: VehicleType[]; created_count: number; message: string }>(
        `/admin/cities/${this.cityId}/vehicle-types`,
        payload,
      )
      .subscribe({
        next: (res) => {
          this.creating = false;
          this.createOpen = false;
          // Merge new rows in — the response returns all 3 rows for this ride type.
          const newIds = new Set((res.data ?? []).map((r) => r.id));
          this.rows = [
            ...this.rows.filter((r) => !newIds.has(r.id)),
            ...(res.data ?? []),
          ];
          this.msg.add({
            severity: res.created_count > 0 ? 'success' : 'info',
            summary: res.message,
          });
        },
        error: (err) => {
          this.creating = false;
          this.msg.add({
            severity: 'error',
            summary: err?.error?.message || 'Failed to create',
          });
        },
      });
  }
}
