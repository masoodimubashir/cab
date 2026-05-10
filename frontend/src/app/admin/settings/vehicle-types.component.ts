import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { CheckboxModule } from 'primeng/checkbox';
import { RadioButtonModule } from 'primeng/radiobutton';
import { TabViewModule } from 'primeng/tabview';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MessageService } from 'primeng/api';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';

type ProductKind = 'local' | 'rental' | 'outstation';
type TollMode = 'no' | 'yes' | 'yes_locked';

interface VehicleType {
  id: number;
  city_id: number;
  ride_type_id: number;
  ride_type_name: string;
  product_kind: ProductKind;
  display_name: string;
  display_order: number;
  android_image_path: string | null;
  android_image_url: string | null;
  ios_image_path: string | null;
  ios_image_url: string | null;
  max_people: number;
  luggage_capacity: number;
  destination_mandatory: boolean;
  fare_mandatory: boolean;
  reverse_bidding_enabled: boolean;
  waiting_charges_applicable: boolean;
  customer_notes_enabled: boolean;
  multiple_destinations_enabled: boolean;
  show_low_wallet_alert: boolean;
  toll_mode: TollMode;
  commission_percent: number;
  fixed_commission: number;
  convenience_charge: number;
  convenience_customer_waiver: number;
  convenience_driver_cut: number;
  min_driver_balance: number;
  override_request_radius_m: number | null;
  override_hop_interval_sec: number | null;
  override_hop_radius_m: number | null;
  override_max_hops: number | null;
  is_active: boolean;
  updated_at: string | null;
}

interface RideTypeRef {
  id: number;
  name: string;
}

const KINDS: { label: string; value: ProductKind }[] = [
  { label: 'Local', value: 'local' },
  { label: 'Rental', value: 'rental' },
  { label: 'Out Station', value: 'outstation' },
];

const TOLL_MODES: { label: string; value: TollMode }[] = [
  { label: 'No', value: 'no' },
  { label: 'Yes', value: 'yes' },
  { label: 'Yes (driver input locked)', value: 'yes_locked' },
];

@Component({
  selector: 'app-vehicle-types',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    CardModule,
    DialogModule,
    DropdownModule,
    InputTextModule,
    InputNumberModule,
    CheckboxModule,
    RadioButtonModule,
    TabViewModule,
    ToastModule,
    ConfirmDialogModule,
  ],
  providers: [MessageService, ConfirmationService],
  template: `
    <p-toast />
    <p-confirmDialog />

    <p class="muted">
      Per-city catalogue of bookable vehicles. Each row is one product
      (city × vehicle class × kind) with its own toggles, commercials, and
      optional dispatcher overrides.
    </p>

    <div *ngIf="!cityId" class="empty">Pick a city from the left rail.</div>

    <div *ngIf="cityId" class="head-bar">
      <div class="tabs">
        <button
          class="tab"
          [class.active]="activeTab === 'enabled'"
          (click)="activeTab = 'enabled'"
        >Enabled ({{ countEnabled() }})</button>
        <button
          class="tab"
          [class.active]="activeTab === 'disabled'"
          (click)="activeTab = 'disabled'"
        >Disabled ({{ countDisabled() }})</button>
      </div>
      <p-button
        label="Add Vehicle Type"
        icon="pi pi-plus"
        size="small"
        (onClick)="openCreate()"
      ></p-button>
    </div>

    <p-table
      *ngIf="cityId"
      [value]="visibleRows()"
      [paginator]="true"
      [rows]="20"
      [rowHover]="true"
      styleClass="p-datatable-sm"
      [globalFilterFields]="['display_name','ride_type_name','product_kind']"
    >
      <ng-template pTemplate="header">
        <tr>
          <th>Vehicle Name</th>
          <th>Ride Type</th>
          <th>Product</th>
          <th class="num">Max</th>
          <th>Dest. Mand.</th>
          <th class="num">Comm.%</th>
          <th>Toll</th>
          <th>Status</th>
          <th></th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-v>
        <tr>
          <td><strong>{{ v.display_name }}</strong></td>
          <td>{{ v.ride_type_name }}</td>
          <td><span class="pill">{{ kindLabel(v.product_kind) }}</span></td>
          <td class="num">{{ v.max_people }}</td>
          <td>{{ v.destination_mandatory ? 'Yes' : 'No' }}</td>
          <td class="num">{{ v.commission_percent }}</td>
          <td>{{ tollLabel(v.toll_mode) }}</td>
          <td>
            <span class="status" [class.on]="v.is_active">
              {{ v.is_active ? 'Enabled' : 'Disabled' }}
            </span>
          </td>
          <td class="actions-col">
            <p-button
              label="Details"
              size="small"
              (onClick)="openEdit(v)"
            ></p-button>
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr>
          <td colspan="9" class="empty">
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
      [style]="{ width: '480px' }"
      [draggable]="false"
    >
      <div class="form">
        <label class="lbl">Ride Type *</label>
        <p-dropdown
          [options]="rideTypes"
          [(ngModel)]="createForm.ride_type_id"
          optionLabel="name"
          optionValue="id"
          placeholder="Select vehicle class"
          [style]="{ width: '100%' }"
        ></p-dropdown>

        <label class="lbl">Product Kind *</label>
        <p-dropdown
          [options]="kinds"
          [(ngModel)]="createForm.product_kind"
          optionLabel="label"
          optionValue="value"
          [style]="{ width: '100%' }"
        ></p-dropdown>

        <label class="lbl">Display Name *</label>
        <input pInputText [(ngModel)]="createForm.display_name" placeholder="SEDAN/SWIFT L" />

        <label class="lbl">Max People *</label>
        <p-inputNumber [(ngModel)]="createForm.max_people" [min]="1" [max]="20"></p-inputNumber>

        <label class="lbl">Luggage Capacity</label>
        <p-inputNumber [(ngModel)]="createForm.luggage_capacity" [min]="0" [max]="20"></p-inputNumber>

        <label class="lbl">Commission (%)</label>
        <p-inputNumber [(ngModel)]="createForm.commission_percent" [min]="0" [max]="100" mode="decimal" [maxFractionDigits]="2"></p-inputNumber>

        <label class="row">
          <p-checkbox [(ngModel)]="createForm.destination_mandatory" [binary]="true"></p-checkbox>
          Destination mandatory
        </label>
      </div>
      <ng-template pTemplate="footer">
        <p-button label="Cancel" severity="secondary" (onClick)="createOpen = false"></p-button>
        <p-button label="Create" (onClick)="submitCreate()" [loading]="creating"></p-button>
      </ng-template>
    </p-dialog>

    <!-- Edit dialog (full editor — sectioned) -->
    <p-dialog
      header="Edit Vehicle Type"
      [(visible)]="editOpen"
      [modal]="true"
      [style]="{ width: '880px' }"
      [draggable]="false"
    >
      <div *ngIf="editForm" class="edit-shell">
        <div class="edit-head">
          <div>
            <h3 class="vt-title">{{ editForm.display_name }}</h3>
            <span class="pill">{{ kindLabel(editForm.product_kind) }}</span>
            <span class="pill light">{{ editForm.ride_type_name }}</span>
          </div>
          <p-button
            [label]="editForm.is_active ? 'Disable' : 'Enable'"
            [severity]="editForm.is_active ? 'danger' : 'success'"
            size="small"
            (onClick)="editForm.is_active = !editForm.is_active"
          ></p-button>
        </div>

        <p-tabView>
          <p-tabPanel header="Identity & Capacity">
            <div class="grid two">
              <div class="field">
                <label class="lbl">Display Name</label>
                <input pInputText [(ngModel)]="editForm.display_name" />
              </div>
              <div class="field">
                <label class="lbl">Display Order</label>
                <p-inputNumber [(ngModel)]="editForm.display_order" [min]="0" [max]="9999"></p-inputNumber>
              </div>
              <div class="field">
                <label class="lbl">Max People</label>
                <p-inputNumber [(ngModel)]="editForm.max_people" [min]="1" [max]="20"></p-inputNumber>
              </div>
              <div class="field">
                <label class="lbl">Luggage Capacity</label>
                <p-inputNumber [(ngModel)]="editForm.luggage_capacity" [min]="0" [max]="20"></p-inputNumber>
              </div>
              <div class="field">
                <label class="lbl">Android Image</label>
                <input type="file" accept="image/*" (change)="onAndroidImg($event)" />
                <img *ngIf="editForm.android_image_url" [src]="editForm.android_image_url" class="thumb" />
              </div>
              <div class="field">
                <label class="lbl">iOS Image</label>
                <input type="file" accept="image/*" (change)="onIosImg($event)" />
                <img *ngIf="editForm.ios_image_url" [src]="editForm.ios_image_url" class="thumb" />
              </div>
            </div>
          </p-tabPanel>

          <p-tabPanel header="Behaviour">
            <div class="grid two">
              <label class="row">
                <p-checkbox [(ngModel)]="editForm.destination_mandatory" [binary]="true"></p-checkbox>
                Destination mandatory
              </label>
              <label class="row">
                <p-checkbox [(ngModel)]="editForm.fare_mandatory" [binary]="true"></p-checkbox>
                Fare mandatory (no bidding)
              </label>
              <label class="row">
                <p-checkbox [(ngModel)]="editForm.reverse_bidding_enabled" [binary]="true"></p-checkbox>
                Reverse bidding enabled
              </label>
              <label class="row">
                <p-checkbox [(ngModel)]="editForm.waiting_charges_applicable" [binary]="true"></p-checkbox>
                Waiting charges applicable
              </label>
              <label class="row">
                <p-checkbox [(ngModel)]="editForm.customer_notes_enabled" [binary]="true"></p-checkbox>
                Customer notes enabled
              </label>
              <label class="row">
                <p-checkbox [(ngModel)]="editForm.multiple_destinations_enabled" [binary]="true"></p-checkbox>
                Multiple destinations enabled
              </label>
              <label class="row">
                <p-checkbox [(ngModel)]="editForm.show_low_wallet_alert" [binary]="true"></p-checkbox>
                Show low-wallet alert (driver)
              </label>
              <div class="field">
                <label class="lbl">Toll Mode</label>
                <div class="radio-group">
                  <label *ngFor="let t of tollModes">
                    <p-radioButton
                      name="toll-mode"
                      [value]="t.value"
                      [(ngModel)]="editForm.toll_mode"
                    ></p-radioButton>
                    {{ t.label }}
                  </label>
                </div>
              </div>
            </div>
          </p-tabPanel>

          <p-tabPanel header="Commercials">
            <div class="grid two">
              <div class="field">
                <label class="lbl">Commission (%)</label>
                <p-inputNumber [(ngModel)]="editForm.commission_percent" [min]="0" [max]="100" mode="decimal" [maxFractionDigits]="2"></p-inputNumber>
              </div>
              <div class="field">
                <label class="lbl">Fixed Commission</label>
                <p-inputNumber [(ngModel)]="editForm.fixed_commission" [min]="0" mode="decimal" [maxFractionDigits]="2"></p-inputNumber>
              </div>
              <div class="field">
                <label class="lbl">Convenience Charge</label>
                <p-inputNumber [(ngModel)]="editForm.convenience_charge" [min]="0" mode="decimal" [maxFractionDigits]="2"></p-inputNumber>
              </div>
              <div class="field">
                <label class="lbl">Convenience — Customer Waiver</label>
                <p-inputNumber [(ngModel)]="editForm.convenience_customer_waiver" [min]="0" mode="decimal" [maxFractionDigits]="2"></p-inputNumber>
              </div>
              <div class="field">
                <label class="lbl">Convenience — Driver Cut</label>
                <p-inputNumber [(ngModel)]="editForm.convenience_driver_cut" [min]="0" mode="decimal" [maxFractionDigits]="2"></p-inputNumber>
              </div>
              <div class="field">
                <label class="lbl">Min Driver Balance</label>
                <p-inputNumber [(ngModel)]="editForm.min_driver_balance" [min]="0" mode="decimal" [maxFractionDigits]="2"></p-inputNumber>
              </div>
            </div>
          </p-tabPanel>

          <p-tabPanel header="Dispatcher Overrides">
            <p class="muted">
              Leave a field blank to inherit the city-level Dispatcher Settings value
              for this product kind.
            </p>
            <div class="grid two">
              <div class="field">
                <label class="lbl">Request radius (m) — override</label>
                <p-inputNumber [(ngModel)]="editForm.override_request_radius_m" [min]="0" [max]="50000"></p-inputNumber>
              </div>
              <div class="field">
                <label class="lbl">Hop interval (sec) — override</label>
                <p-inputNumber [(ngModel)]="editForm.override_hop_interval_sec" [min]="1" [max]="600"></p-inputNumber>
              </div>
              <div class="field">
                <label class="lbl">Hop radius (m) — override</label>
                <p-inputNumber [(ngModel)]="editForm.override_hop_radius_m" [min]="0" [max]="50000"></p-inputNumber>
              </div>
              <div class="field">
                <label class="lbl">Max hops — override</label>
                <p-inputNumber [(ngModel)]="editForm.override_max_hops" [min]="1" [max]="50"></p-inputNumber>
              </div>
            </div>
          </p-tabPanel>
        </p-tabView>
      </div>

      <ng-template pTemplate="footer">
        <p-button label="Delete" severity="danger" [text]="true" (onClick)="confirmDelete()"></p-button>
        <p-button label="Cancel" severity="secondary" (onClick)="editOpen = false"></p-button>
        <p-button label="Save" (onClick)="submitEdit()" [loading]="savingEdit"></p-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .muted { color: #64748b; font-size: 13px; margin: 0 0 12px; }
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
        background: #e0f2fe;
        color: #075985;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.4px;
      }
      .pill.light { background: #f1f5f9; color: #475569; margin-left: 6px; }
      .status {
        display: inline-block;
        padding: 2px 10px;
        border-radius: 999px;
        background: #fee2e2;
        color: #991b1b;
        font-size: 11px;
        font-weight: 700;
      }
      .status.on { background: #dcfce7; color: #166534; }
      .actions-col { width: 110px; }
      .form { display: flex; flex-direction: column; gap: 6px; }
      .form .lbl { font-size: 12px; font-weight: 700; color: #475569; margin-top: 6px; }
      .edit-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      .vt-title { margin: 0 0 4px; font-size: 17px; }
      .grid { display: grid; gap: 14px; }
      .grid.two { grid-template-columns: 1fr 1fr; }
      .field { display: flex; flex-direction: column; gap: 4px; }
      .lbl { font-size: 12px; font-weight: 700; color: #475569; }
      .row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 600;
        color: #334155;
      }
      .radio-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .radio-group label {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 600;
      }
      .thumb {
        max-width: 120px;
        max-height: 80px;
        border-radius: 6px;
        margin-top: 6px;
        border: 1px solid #e2e8f0;
      }
      :host ::ng-deep .p-inputnumber { width: 100%; }
      @media (max-width: 720px) {
        .grid.two { grid-template-columns: 1fr; }
      }
    `,
  ],
})
export class VehicleTypesComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  rows: VehicleType[] = [];
  rideTypes: RideTypeRef[] = [];
  kinds = KINDS;
  tollModes = TOLL_MODES;

  activeTab: 'enabled' | 'disabled' = 'enabled';

  createOpen = false;
  creating = false;
  createForm: Partial<VehicleType> = this.blankCreate();

  editOpen = false;
  savingEdit = false;
  editForm: VehicleType | null = null;
  androidFile: File | null = null;
  iosFile: File | null = null;

  private sub?: Subscription;

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private msg: MessageService,
    private confirm: ConfirmationService,
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
      .get<{ data: VehicleType[]; available_ride_types: RideTypeRef[] }>(
        `/admin/cities/${this.cityId}/vehicle-types`,
      )
      .subscribe({
        next: (res) => {
          this.rows = res.data ?? [];
          this.rideTypes = res.available_ride_types ?? [];
        },
        error: () => this.msg.add({ severity: 'error', summary: 'Failed to load vehicle types' }),
      });
  }

  visibleRows(): VehicleType[] {
    return this.rows.filter((r) =>
      this.activeTab === 'enabled' ? r.is_active : !r.is_active,
    );
  }
  countEnabled(): number { return this.rows.filter((r) => r.is_active).length; }
  countDisabled(): number { return this.rows.filter((r) => !r.is_active).length; }

  kindLabel(k: ProductKind): string {
    return KINDS.find((x) => x.value === k)?.label ?? k;
  }
  tollLabel(m: TollMode): string {
    return TOLL_MODES.find((x) => x.value === m)?.label ?? m;
  }

  // ---- Create ----
  blankCreate(): Partial<VehicleType> {
    return {
      ride_type_id: undefined,
      product_kind: 'local',
      display_name: '',
      max_people: 4,
      luggage_capacity: 2,
      commission_percent: 10,
      destination_mandatory: true,
    };
  }
  openCreate(): void {
    this.createForm = this.blankCreate();
    this.createOpen = true;
  }
  submitCreate(): void {
    if (this.cityId == null) return;
    if (!this.createForm.ride_type_id || !this.createForm.product_kind || !this.createForm.display_name) {
      this.msg.add({ severity: 'warn', summary: 'Ride type, product kind and display name are required' });
      return;
    }
    this.creating = true;
    this.api
      .post<{ vehicle_type: VehicleType }>(`/admin/cities/${this.cityId}/vehicle-types`, this.createForm)
      .subscribe({
        next: (res) => {
          this.creating = false;
          this.createOpen = false;
          this.rows = [...this.rows, res.vehicle_type].sort(
            (a, b) => a.display_order - b.display_order || a.id - b.id,
          );
          this.msg.add({ severity: 'success', summary: 'Vehicle type created' });
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

  // ---- Edit ----
  openEdit(v: VehicleType): void {
    this.editForm = { ...v };
    this.androidFile = null;
    this.iosFile = null;
    this.editOpen = true;
  }
  onAndroidImg(ev: Event): void {
    const f = (ev.target as HTMLInputElement).files?.[0];
    this.androidFile = f ?? null;
  }
  onIosImg(ev: Event): void {
    const f = (ev.target as HTMLInputElement).files?.[0];
    this.iosFile = f ?? null;
  }
  submitEdit(): void {
    if (!this.editForm || this.cityId == null) return;
    this.savingEdit = true;

    const fd = new FormData();
    fd.append('_method', 'PATCH');

    const f = this.editForm;
    const fields: [string, unknown][] = [
      ['display_name', f.display_name],
      ['display_order', f.display_order],
      ['max_people', f.max_people],
      ['luggage_capacity', f.luggage_capacity],
      ['destination_mandatory', f.destination_mandatory ? 1 : 0],
      ['fare_mandatory', f.fare_mandatory ? 1 : 0],
      ['reverse_bidding_enabled', f.reverse_bidding_enabled ? 1 : 0],
      ['waiting_charges_applicable', f.waiting_charges_applicable ? 1 : 0],
      ['customer_notes_enabled', f.customer_notes_enabled ? 1 : 0],
      ['multiple_destinations_enabled', f.multiple_destinations_enabled ? 1 : 0],
      ['show_low_wallet_alert', f.show_low_wallet_alert ? 1 : 0],
      ['toll_mode', f.toll_mode],
      ['commission_percent', f.commission_percent],
      ['fixed_commission', f.fixed_commission],
      ['convenience_charge', f.convenience_charge],
      ['convenience_customer_waiver', f.convenience_customer_waiver],
      ['convenience_driver_cut', f.convenience_driver_cut],
      ['min_driver_balance', f.min_driver_balance],
      ['is_active', f.is_active ? 1 : 0],
    ];

    for (const [k, v] of fields) {
      if (v !== null && v !== undefined) fd.append(k, String(v));
    }

    // Nullable overrides — send only when set; skip otherwise so server stores NULL.
    for (const k of [
      'override_request_radius_m',
      'override_hop_interval_sec',
      'override_hop_radius_m',
      'override_max_hops',
    ] as const) {
      const v = f[k];
      if (v !== null && v !== undefined && v !== ('' as unknown)) {
        fd.append(k, String(v));
      }
    }

    if (this.androidFile) fd.append('android_image', this.androidFile);
    if (this.iosFile) fd.append('ios_image', this.iosFile);

    this.api
      .postMultipart<{ vehicle_type: VehicleType }>(
        `/admin/cities/${this.cityId}/vehicle-types/${f.id}`,
        fd,
      )
      .subscribe({
        next: (res) => {
          this.savingEdit = false;
          this.editOpen = false;
          const idx = this.rows.findIndex((r) => r.id === res.vehicle_type.id);
          if (idx >= 0) this.rows[idx] = res.vehicle_type;
          this.msg.add({ severity: 'success', summary: 'Saved' });
        },
        error: () => {
          this.savingEdit = false;
          this.msg.add({ severity: 'error', summary: 'Failed to save' });
        },
      });
  }

  confirmDelete(): void {
    if (!this.editForm || this.cityId == null) return;
    const id = this.editForm.id;
    this.confirm.confirm({
      message: `Delete "${this.editForm.display_name}"? This cannot be undone.`,
      header: 'Delete vehicle type',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.api.delete(`/admin/cities/${this.cityId}/vehicle-types/${id}`).subscribe({
          next: () => {
            this.rows = this.rows.filter((r) => r.id !== id);
            this.editOpen = false;
            this.msg.add({ severity: 'success', summary: 'Deleted' });
          },
          error: () => this.msg.add({ severity: 'error', summary: 'Failed to delete' }),
        });
      },
    });
  }
}
