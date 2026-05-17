import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ApiService } from '../../core/api.service';

interface RideTypeRow {
  id: number;
  name: string;
  description: string | null;
  sort_order: number;
}

interface VehicleTypeRow {
  id: number;
  name: string;
  description: string | null;
  image_path: string | null;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
}

@Component({
  selector: 'app-vehicles',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    TableModule,
    DialogModule,
    InputTextModule,
    InputTextareaModule,
    InputNumberModule,
    InputSwitchModule,
    ToastModule,
    ConfirmDialogModule,
  ],
  providers: [MessageService, ConfirmationService],
  template: `
    <p-toast />
    <p-confirmDialog />

    <h2 class="page-title">Vehicles</h2>

    <div class="tabs">
      <button class="tab" [class.active]="tab === 'vehicle'" (click)="tab = 'vehicle'">
        Vehicle Types <span class="count">{{ vehicleTypes.length }}</span>
      </button>
      <button class="tab" [class.active]="tab === 'ride'" (click)="tab = 'ride'">
        Ride Types <span class="count">{{ rideTypes.length }}</span>
      </button>
    </div>

    <!-- VEHICLE TYPES -->
    <section *ngIf="tab === 'vehicle'">
      <p class="muted small">
        Vehicle categories — e.g. Auto, Bike, Mini, Tuk-Tuk. Used by the
        Vehicle Fare Settings catalogue.
      </p>
      <div class="bar">
        <span class="muted small">{{ vehicleTypes.length }} vehicle type(s)</span>
        <button pButton type="button" label="Add Vehicle Type" icon="pi pi-plus"
                class="p-button-sm" (click)="openVehicleCreate()"></button>
      </div>

      <p-table [value]="vehicleTypes" styleClass="p-datatable-sm" [rowHover]="true">
        <ng-template pTemplate="header">
          <tr>
            <th>Id</th>
            <th>Image</th>
            <th>Name</th>
            <th>Description</th>
            <th class="num">Sort</th>
            <th>Active</th>
            <th style="width: 180px;">Actions</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-v>
          <tr>
            <td>{{ v.id }}</td>
            <td><img *ngIf="v.image_url" [src]="v.image_url" class="thumb" /></td>
            <td><strong>{{ v.name }}</strong></td>
            <td class="desc">{{ v.description || '—' }}</td>
            <td class="num">{{ v.sort_order }}</td>
            <td>
              <span class="pill" [class.on]="v.is_active" [class.off]="!v.is_active">
                {{ v.is_active ? 'Active' : 'Inactive' }}
              </span>
            </td>
            <td class="actions-col">
              <button pButton type="button" label="Edit" class="p-button-sm"
                      (click)="openVehicleEdit(v)"></button>
              <button pButton type="button" label="Delete"
                      class="p-button-sm p-button-text p-button-danger"
                      (click)="deleteVehicle(v)"></button>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td colspan="7" class="empty">No vehicle types yet.</td></tr>
        </ng-template>
      </p-table>
    </section>

    <!-- RIDE TYPES -->
    <section *ngIf="tab === 'ride'">
      <p class="muted small">
        Ride service categories — e.g. Airport, Delivery, Pool, Car Rental.
        Used by pricing rules and the booking flow.
      </p>
      <div class="bar">
        <span class="muted small">{{ rideTypes.length }} ride type(s)</span>
        <button pButton type="button" label="Add Ride Type" icon="pi pi-plus"
                class="p-button-sm" (click)="openRideCreate()"></button>
      </div>

      <p-table [value]="rideTypes" styleClass="p-datatable-sm" [rowHover]="true">
        <ng-template pTemplate="header">
          <tr>
            <th>Id</th>
            <th>Name</th>
            <th>Description</th>
            <th class="num">Sort</th>
            <th style="width: 180px;">Actions</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-r>
          <tr>
            <td>{{ r.id }}</td>
            <td><strong>{{ r.name }}</strong></td>
            <td class="desc">{{ r.description || '—' }}</td>
            <td class="num">{{ r.sort_order }}</td>
            <td class="actions-col">
              <button pButton type="button" label="Edit" class="p-button-sm"
                      (click)="openRideEdit(r)"></button>
              <button pButton type="button" label="Delete"
                      class="p-button-sm p-button-text p-button-danger"
                      (click)="deleteRide(r)"></button>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td colspan="5" class="empty">No ride types yet.</td></tr>
        </ng-template>
      </p-table>
    </section>

    <!-- Vehicle Type dialog -->
    <p-dialog
      [header]="vehicleEditingId ? 'Edit Vehicle Type' : 'Add Vehicle Type'"
      [(visible)]="vehicleOpen"
      [modal]="true"
      [style]="{ width: '480px' }"
      [draggable]="false"
    >
      <div class="form">
        <label class="lbl">Name *</label>
        <input pInputText [(ngModel)]="vehicleForm.name" placeholder="Auto / Bike / Mini" />

        <label class="lbl">Description</label>
        <textarea pInputTextarea rows="2" [(ngModel)]="vehicleForm.description"
                  placeholder="Short helper text shown in catalogues"></textarea>

        <label class="lbl">Image</label>
        <input type="file" accept="image/*" (change)="onVehicleImage($event)" />
        <img *ngIf="vehicleForm.previewUrl" [src]="vehicleForm.previewUrl" class="thumb" />

        <label class="lbl">Sort Order</label>
        <p-inputNumber [(ngModel)]="vehicleForm.sort_order" [min]="0" [max]="9999"></p-inputNumber>

        <div class="switch-row">
          <span class="lbl">Active</span>
          <p-inputSwitch [(ngModel)]="vehicleForm.is_active"></p-inputSwitch>
        </div>
      </div>
      <ng-template pTemplate="footer">
        <button pButton type="button" label="Cancel" class="p-button-secondary"
                (click)="vehicleOpen = false"></button>
        <button pButton type="button"
                [label]="vehicleEditingId ? 'Update' : 'Create'"
                (click)="submitVehicle()" [loading]="vehicleSaving"></button>
      </ng-template>
    </p-dialog>

    <!-- Ride Type dialog -->
    <p-dialog
      [header]="rideEditingId ? 'Edit Ride Type' : 'Add Ride Type'"
      [(visible)]="rideOpen"
      [modal]="true"
      [style]="{ width: '460px' }"
      [draggable]="false"
    >
      <div class="form">
        <label class="lbl">Name *</label>
        <input pInputText [(ngModel)]="rideForm.name" placeholder="Airport / Delivery / Pool" />

        <label class="lbl">Description</label>
        <textarea pInputTextarea rows="2" [(ngModel)]="rideForm.description"></textarea>

        <label class="lbl">Sort Order</label>
        <p-inputNumber [(ngModel)]="rideForm.sort_order" [min]="0" [max]="9999"></p-inputNumber>
      </div>
      <ng-template pTemplate="footer">
        <button pButton type="button" label="Cancel" class="p-button-secondary"
                (click)="rideOpen = false"></button>
        <button pButton type="button"
                [label]="rideEditingId ? 'Update' : 'Create'"
                (click)="submitRide()" [loading]="rideSaving"></button>
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .page-title { margin: 0 0 16px; font-size: 22px; font-weight: 800; color: #0f172a; }

      .tabs {
        display: flex;
        gap: 0;
        background: #f1f5f9;
        border-radius: 10px;
        padding: 4px;
        margin: 0 0 18px;
        max-width: 540px;
      }
      .tab {
        flex: 1;
        padding: 10px 16px;
        background: transparent;
        border: 0;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 700;
        font-size: 13px;
        color: #475569;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }
      .tab.active { background: #06b6d4; color: #fff; }
      .tab .count {
        background: rgba(255, 255, 255, 0.85);
        color: #06b6d4;
        font-size: 11px;
        padding: 1px 8px;
        border-radius: 999px;
        font-weight: 800;
      }
      .tab:not(.active) .count { background: #fff; color: #475569; }

      .muted { color: #64748b; }
      .small { font-size: 12px; }
      .bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin: 10px 0 12px;
      }
      .num { text-align: right; }
      .desc { max-width: 380px; }
      .empty { padding: 28px; text-align: center; color: #64748b; }
      .actions-col { display: flex; gap: 6px; }
      .thumb {
        width: 36px;
        height: 36px;
        object-fit: cover;
        border-radius: 6px;
        border: 1px solid #e2e8f0;
      }
      .pill {
        display: inline-block;
        padding: 2px 10px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.4px;
      }
      .pill.on { background: #dcfce7; color: #166534; }
      .pill.off { background: #f1f5f9; color: #94a3b8; }

      .form { display: flex; flex-direction: column; gap: 6px; }
      .form .lbl { font-size: 12px; font-weight: 700; color: #475569; margin-top: 6px; }
      input[pInputText], textarea { width: 100%; }
      :host ::ng-deep .form .p-inputnumber { width: 100%; }
      .switch-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 10px;
        padding: 8px 10px;
        background: #f8fafc;
        border-radius: 8px;
      }
      .switch-row .lbl { margin: 0; }
    `,
  ],
})
export class VehiclesComponent implements OnInit {
  tab: 'vehicle' | 'ride' = 'vehicle';

  vehicleTypes: VehicleTypeRow[] = [];
  rideTypes: RideTypeRow[] = [];

  // Vehicle Type form state
  vehicleOpen = false;
  vehicleEditingId: number | null = null;
  vehicleSaving = false;
  vehicleFile: File | null = null;
  vehicleForm: {
    name: string;
    description: string;
    sort_order: number;
    is_active: boolean;
    previewUrl: string | null;
  } = this.blankVehicleForm();

  // Ride Type form state
  rideOpen = false;
  rideEditingId: number | null = null;
  rideSaving = false;
  rideForm: {
    name: string;
    description: string;
    sort_order: number;
  } = this.blankRideForm();

  constructor(
    private api: ApiService,
    private msg: MessageService,
    private confirm: ConfirmationService,
  ) {}

  ngOnInit(): void {
    this.loadVehicleTypes();
    this.loadRideTypes();
  }

  // ---- Vehicle types ----
  loadVehicleTypes(): void {
    this.api.get<{ data: VehicleTypeRow[] }>('/admin/vehicle-types-global').subscribe({
      next: (res) => (this.vehicleTypes = res.data ?? []),
      error: () => this.msg.add({ severity: 'error', summary: 'Failed to load vehicle types' }),
    });
  }

  blankVehicleForm() {
    return { name: '', description: '', sort_order: 0, is_active: true, previewUrl: null };
  }

  openVehicleCreate(): void {
    this.vehicleEditingId = null;
    this.vehicleFile = null;
    this.vehicleForm = this.blankVehicleForm();
    this.vehicleOpen = true;
  }

  openVehicleEdit(v: VehicleTypeRow): void {
    this.vehicleEditingId = v.id;
    this.vehicleFile = null;
    this.vehicleForm = {
      name: v.name,
      description: v.description || '',
      sort_order: v.sort_order,
      is_active: v.is_active,
      previewUrl: v.image_url,
    };
    this.vehicleOpen = true;
  }

  onVehicleImage(ev: Event): void {
    const f = (ev.target as HTMLInputElement).files?.[0];
    this.vehicleFile = f ?? null;
    if (f) {
      const reader = new FileReader();
      reader.onload = () => (this.vehicleForm.previewUrl = reader.result as string);
      reader.readAsDataURL(f);
    }
  }

  submitVehicle(): void {
    if (!this.vehicleForm.name.trim()) {
      this.msg.add({ severity: 'warn', summary: 'Name is required' });
      return;
    }
    this.vehicleSaving = true;
    const fd = new FormData();
    if (this.vehicleEditingId) fd.append('_method', 'PATCH');
    fd.append('name', this.vehicleForm.name.trim());
    fd.append('description', this.vehicleForm.description.trim());
    fd.append('sort_order', String(this.vehicleForm.sort_order ?? 0));
    fd.append('is_active', this.vehicleForm.is_active ? '1' : '0');
    if (this.vehicleFile) fd.append('image', this.vehicleFile);

    const url = this.vehicleEditingId
      ? `/admin/vehicle-types-global/${this.vehicleEditingId}`
      : `/admin/vehicle-types-global`;

    this.api.postMultipart<{ vehicle_type: VehicleTypeRow }>(url, fd).subscribe({
      next: (res) => {
        this.vehicleSaving = false;
        this.vehicleOpen = false;
        const idx = this.vehicleTypes.findIndex((v) => v.id === res.vehicle_type.id);
        if (idx >= 0) this.vehicleTypes[idx] = res.vehicle_type;
        else this.vehicleTypes = [...this.vehicleTypes, res.vehicle_type];
        this.msg.add({ severity: 'success', summary: 'Saved' });
      },
      error: (err) => {
        this.vehicleSaving = false;
        this.msg.add({
          severity: 'error',
          summary: err?.error?.message || 'Failed to save vehicle type',
        });
      },
    });
  }

  deleteVehicle(v: VehicleTypeRow): void {
    this.confirm.confirm({
      message: `Delete vehicle type "${v.name}"? This cannot be undone.`,
      header: 'Delete vehicle type',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.api.delete(`/admin/vehicle-types-global/${v.id}`).subscribe({
          next: () => {
            this.vehicleTypes = this.vehicleTypes.filter((x) => x.id !== v.id);
            this.msg.add({ severity: 'success', summary: 'Deleted' });
          },
          error: () => this.msg.add({ severity: 'error', summary: 'Failed to delete' }),
        });
      },
    });
  }

  // ---- Ride types ----
  loadRideTypes(): void {
    this.api.get<{ data: RideTypeRow[] }>('/admin/ride-types-crud').subscribe({
      next: (res) => (this.rideTypes = res.data ?? []),
      error: () => this.msg.add({ severity: 'error', summary: 'Failed to load ride types' }),
    });
  }

  blankRideForm() {
    return { name: '', description: '', sort_order: 0 };
  }

  openRideCreate(): void {
    this.rideEditingId = null;
    this.rideForm = this.blankRideForm();
    this.rideOpen = true;
  }

  openRideEdit(r: RideTypeRow): void {
    this.rideEditingId = r.id;
    this.rideForm = {
      name: r.name,
      description: r.description || '',
      sort_order: r.sort_order,
    };
    this.rideOpen = true;
  }

  submitRide(): void {
    if (!this.rideForm.name.trim()) {
      this.msg.add({ severity: 'warn', summary: 'Name is required' });
      return;
    }
    this.rideSaving = true;
    const payload = {
      name: this.rideForm.name.trim(),
      description: this.rideForm.description.trim() || null,
      sort_order: this.rideForm.sort_order ?? 0,
    };
    const req = this.rideEditingId
      ? this.api.patch<{ ride_type: RideTypeRow }>(`/admin/ride-types-crud/${this.rideEditingId}`, payload)
      : this.api.post<{ ride_type: RideTypeRow }>(`/admin/ride-types-crud`, payload);

    req.subscribe({
      next: (res) => {
        this.rideSaving = false;
        this.rideOpen = false;
        const idx = this.rideTypes.findIndex((r) => r.id === res.ride_type.id);
        if (idx >= 0) this.rideTypes[idx] = res.ride_type;
        else this.rideTypes = [...this.rideTypes, res.ride_type];
        this.msg.add({ severity: 'success', summary: 'Saved' });
      },
      error: (err) => {
        this.rideSaving = false;
        this.msg.add({
          severity: 'error',
          summary: err?.error?.message || 'Failed to save ride type',
        });
      },
    });
  }

  deleteRide(r: RideTypeRow): void {
    this.confirm.confirm({
      message: `Delete ride type "${r.name}"?`,
      header: 'Delete ride type',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.api.delete(`/admin/ride-types-crud/${r.id}`).subscribe({
          next: () => {
            this.rideTypes = this.rideTypes.filter((x) => x.id !== r.id);
            this.msg.add({ severity: 'success', summary: 'Deleted' });
          },
          error: (err) => this.msg.add({
            severity: 'error',
            summary: err?.error?.message || 'Failed to delete',
          }),
        });
      },
    });
  }
}
