import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
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
  ModalComponent,
  StatusPillComponent,
} from '../../ui';

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

type VehicleStatus = 'all' | 'active' | 'inactive';

const VEHICLE_STATUS_OPTIONS = [
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
];

/**
 * Vehicles — manages the two global catalogues used across the platform:
 *   • Vehicle Types — Auto, Bike, Mini, Tuk-Tuk … (with image)
 *   • Ride Types    — Airport, Delivery, Pool, Rental …
 * Both are global (not city-scoped). Standard data-table layout per tab;
 * create/edit uses the shared drawer, delete a confirm modal.
 */
@Component({
  selector: 'app-vehicles',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonComponent, ColumnComponent, DataTableComponent,
    DrawerComponent, FilterPillComponent, FilterSelectComponent,
    IconComponent, InputComponent, ModalComponent, StatusPillComponent,
  ],
  template: `
    <div class="page">
      <header class="page__hero">
        <div>
          <h1 class="page__title">Vehicles</h1>
          <p class="page__sub">Global catalogues of vehicle categories and ride service types.</p>
        </div>
        <tm-button
          variant="green" icon="plus"
          (clicked)="tab === 'vehicle' ? openVehicleCreate() : openRideCreate()"
        >
          {{ tab === 'vehicle' ? 'Add vehicle type' : 'Add ride type' }}
        </tm-button>
      </header>

      <!-- Tab switcher -->
      <div class="seg">
        <button class="seg__btn" [class.is-on]="tab === 'vehicle'" (click)="tab = 'vehicle'">
          <tm-icon name="car" [size]="15" /> Vehicle Types
          <span class="seg__count">{{ vehicleTypes.length }}</span>
        </button>
        <button class="seg__btn" [class.is-on]="tab === 'ride'" (click)="tab = 'ride'">
          <tm-icon name="road" [size]="15" /> Ride Types
          <span class="seg__count">{{ rideTypes.length }}</span>
        </button>
      </div>

      <!-- ===================== VEHICLE TYPES ===================== -->
      <tm-data-table
        *ngIf="tab === 'vehicle'"
        [rows]="vPageRows"
        [total]="vTotal"
        [page]="vPage"
        [pageSize]="vPageSize"
        [loading]="vLoading"
        emptyTitle="No vehicle types"
        emptyHint="Try a different search, or clear the filters."
        (pageChange)="onVPage($event)"
        (pageSizeChange)="onVPageSize($event)"
      >
        <tm-input
          slot="search"
          icon="search"
          placeholder="Search vehicle types…"
          [(ngModel)]="vehicleSearch"
          (ngModelChange)="onVehicleSearchChange()"
        />
        <ng-container slot="filters">
          <tm-filter-select
            icon="bolt"
            ariaLabel="Status filter"
            allLabel="All statuses"
            [options]="vehicleStatusOptions"
            [value]="vehicleStatus"
            (valueChange)="onVehicleStatusChange($event)"
          />
        </ng-container>
        <ng-container slot="banner">
          <tm-filter-pill *ngIf="vehicleSearch.trim()" icon="search" label="Search" [value]="vehicleSearch" (clear)="clearVehicleSearch()" />
          <tm-filter-pill *ngIf="vehicleStatus !== 'all'" icon="bolt" label="Status" [value]="vehicleStatusLabel()" (clear)="clearVehicleStatus()" />
        </ng-container>

        <tm-column key="name" label="Vehicle type">
          <ng-template let-row>
            <div class="cell-veh">
              <span class="cell-thumb">
                <img *ngIf="row.image_url" [src]="row.image_url" [alt]="row.name" />
                <tm-icon *ngIf="!row.image_url" name="car" [size]="16" />
              </span>
              <div class="cell-id">
                <span class="cell-name">{{ row.name }}</span>
                <span class="cell-sub">{{ row.description || 'No description' }}</span>
              </div>
            </div>
          </ng-template>
        </tm-column>
        <tm-column key="sort_order" label="Order" width="90">
          <ng-template let-row><span class="mono">#{{ row.sort_order }}</span></ng-template>
        </tm-column>
        <tm-column key="is_active" label="Status" width="130">
          <ng-template let-row>
            <tm-status-pill [tone]="row.is_active ? 'success' : 'neutral'">
              {{ row.is_active ? 'Active' : 'Inactive' }}
            </tm-status-pill>
          </ng-template>
        </tm-column>
        <tm-column key="actions" label="" width="100" align="right">
          <ng-template let-row>
            <div class="cell-actions">
              <button class="icon-btn" (click)="openVehicleEdit(row)" aria-label="Edit vehicle type"><tm-icon name="edit" [size]="14" /></button>
              <button class="icon-btn icon-btn--danger" (click)="deleteVehicle = row" aria-label="Delete vehicle type"><tm-icon name="trash" [size]="14" /></button>
            </div>
          </ng-template>
        </tm-column>
      </tm-data-table>

      <!-- ===================== RIDE TYPES ===================== -->
      <tm-data-table
        *ngIf="tab === 'ride'"
        [rows]="rPageRows"
        [total]="rTotal"
        [page]="rPage"
        [pageSize]="rPageSize"
        [loading]="rLoading"
        emptyTitle="No ride types"
        emptyHint="Try a different search."
        (pageChange)="onRPage($event)"
        (pageSizeChange)="onRPageSize($event)"
      >
        <tm-input
          slot="search"
          icon="search"
          placeholder="Search ride types…"
          [(ngModel)]="rideSearch"
          (ngModelChange)="onRideSearchChange()"
        />
        <ng-container slot="banner">
          <tm-filter-pill *ngIf="rideSearch.trim()" icon="search" label="Search" [value]="rideSearch" (clear)="clearRideSearch()" />
        </ng-container>

        <tm-column key="name" label="Ride type">
          <ng-template let-row>
            <div class="cell-veh">
              <span class="cell-thumb cell-thumb--icon"><tm-icon name="road" [size]="16" /></span>
              <div class="cell-id">
                <span class="cell-name">{{ row.name }}</span>
                <span class="cell-sub">{{ row.description || 'No description' }}</span>
              </div>
            </div>
          </ng-template>
        </tm-column>
        <tm-column key="sort_order" label="Order" width="90">
          <ng-template let-row><span class="mono">#{{ row.sort_order }}</span></ng-template>
        </tm-column>
        <tm-column key="actions" label="" width="100" align="right">
          <ng-template let-row>
            <div class="cell-actions">
              <button class="icon-btn" (click)="openRideEdit(row)" aria-label="Edit ride type"><tm-icon name="edit" [size]="14" /></button>
              <button class="icon-btn icon-btn--danger" (click)="deleteRide = row" aria-label="Delete ride type"><tm-icon name="trash" [size]="14" /></button>
            </div>
          </ng-template>
        </tm-column>
      </tm-data-table>
    </div>

    <!-- ===================== Vehicle type drawer ===================== -->
    <tm-drawer
      [open]="vehicleOpen"
      [title]="vehicleEditingId ? 'Edit vehicle type' : 'Add vehicle type'"
      (closed)="vehicleOpen = false"
    >
      <div slot="body" class="form">
        <label class="field">
          <span class="field__lbl">Name <i>*</i></span>
          <input type="text" [(ngModel)]="vehicleForm.name" (ngModelChange)="vTouched = true"
                 placeholder="Auto / Bike / Mini" />
          <span class="field__err" *ngIf="vTouched && !vehicleForm.name.trim()">Name is required.</span>
        </label>
        <label class="field">
          <span class="field__lbl">Description</span>
          <textarea rows="2" [(ngModel)]="vehicleForm.description"
                    placeholder="Short helper text shown in catalogues"></textarea>
        </label>
        <label class="field">
          <span class="field__lbl">Image</span>
          <input type="file" accept="image/*" (change)="onVehicleImage($event)" />
          <img *ngIf="vehicleForm.previewUrl" [src]="vehicleForm.previewUrl" class="preview" alt="" />
        </label>
        <label class="field">
          <span class="field__lbl">Sort order</span>
          <input type="number" min="0" max="9999" [(ngModel)]="vehicleForm.sort_order" class="field--short" />
        </label>
        <label class="toggle">
          <input type="checkbox" [(ngModel)]="vehicleForm.is_active" />
          <span>Active</span>
        </label>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="vehicleOpen = false">Cancel</tm-button>
        <tm-button variant="green" [disabled]="!vehicleForm.name.trim() || vehicleSaving" (clicked)="submitVehicle()">
          {{ vehicleSaving ? 'Saving…' : vehicleEditingId ? 'Save changes' : 'Create' }}
        </tm-button>
      </div>
    </tm-drawer>

    <!-- ===================== Ride type drawer ===================== -->
    <tm-drawer
      [open]="rideOpen"
      [title]="rideEditingId ? 'Edit ride type' : 'Add ride type'"
      (closed)="rideOpen = false"
    >
      <div slot="body" class="form">
        <label class="field">
          <span class="field__lbl">Name <i>*</i></span>
          <input type="text" [(ngModel)]="rideForm.name" (ngModelChange)="rTouched = true"
                 placeholder="Airport / Delivery / Pool" />
          <span class="field__err" *ngIf="rTouched && !rideForm.name.trim()">Name is required.</span>
        </label>
        <label class="field">
          <span class="field__lbl">Description</span>
          <textarea rows="2" [(ngModel)]="rideForm.description"></textarea>
        </label>
        <label class="field">
          <span class="field__lbl">Sort order</span>
          <input type="number" min="0" max="9999" [(ngModel)]="rideForm.sort_order" class="field--short" />
        </label>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="rideOpen = false">Cancel</tm-button>
        <tm-button variant="green" [disabled]="!rideForm.name.trim() || rideSaving" (clicked)="submitRide()">
          {{ rideSaving ? 'Saving…' : rideEditingId ? 'Save changes' : 'Create' }}
        </tm-button>
      </div>
    </tm-drawer>

    <!-- ===================== Delete confirms ===================== -->
    <tm-modal [open]="!!deleteVehicle" title="Delete vehicle type" (closed)="deleteVehicle = null">
      <div slot="body"><p>Delete <strong>{{ deleteVehicle?.name }}</strong>? This cannot be undone.</p></div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="deleteVehicle = null">Cancel</tm-button>
        <tm-button variant="danger" [disabled]="busy" (clicked)="confirmDeleteVehicle()">Delete</tm-button>
      </div>
    </tm-modal>

    <tm-modal [open]="!!deleteRide" title="Delete ride type" (closed)="deleteRide = null">
      <div slot="body"><p>Delete <strong>{{ deleteRide?.name }}</strong>? This cannot be undone.</p></div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="deleteRide = null">Cancel</tm-button>
        <tm-button variant="danger" [disabled]="busy" (clicked)="confirmDeleteRide()">Delete</tm-button>
      </div>
    </tm-modal>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 16px; }
    .page__hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .page__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .page__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); }

    /* segmented tabs */
    .seg {
      display: inline-flex; gap: 4px; padding: 4px;
      background: var(--tm-canvas-2); border-radius: var(--tm-radius-md, 10px);
      align-self: flex-start;
    }
    .seg__btn {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 8px 14px; border-radius: 8px;
      font-size: 13px; font-weight: 700; color: var(--tm-text-muted);
      background: transparent; cursor: pointer; border: 0;
      transition: background var(--tm-duration-fast) var(--tm-ease), color var(--tm-duration-fast) var(--tm-ease);
    }
    .seg__btn.is-on { background: var(--tm-surface); color: var(--tm-text); box-shadow: var(--tm-shadow-sm); }
    .seg__count {
      font-size: 11px; font-weight: 800;
      padding: 1px 7px; border-radius: 999px;
      background: var(--tm-canvas); color: var(--tm-text-muted);
    }
    .seg__btn.is-on .seg__count { background: var(--tm-green-tint, #e0f7fa); color: var(--tm-green); }

    /* cell renderers */
    .cell-veh { display: inline-flex; align-items: center; gap: 11px; min-width: 0; }
    .cell-thumb {
      width: 40px; height: 40px; border-radius: 9px; flex: none; overflow: hidden;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
      border: 1px solid var(--tm-line);
    }
    .cell-thumb img { width: 100%; height: 100%; object-fit: cover; }
    .cell-thumb--icon { background: var(--tm-green-tint, #e0f7fa); color: var(--tm-green); border-color: transparent; }
    .cell-id { display: flex; flex-direction: column; min-width: 0; }
    .cell-name { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .cell-sub {
      font-size: 11px; color: var(--tm-text-muted);
      max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .mono { font-family: var(--tm-font-mono); font-size: 12px; font-weight: 700; color: var(--tm-text-muted); }

    .cell-actions { display: inline-flex; gap: 6px; }
    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 7px;
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
      cursor: pointer; border: 0;
    }
    .icon-btn:hover { background: var(--tm-ink); color: #fff; }
    .icon-btn--danger:hover { background: var(--tm-danger, #ef4444); }

    /* drawer form */
    .form { display: flex; flex-direction: column; gap: 14px; }
    .field { display: flex; flex-direction: column; gap: 5px; }
    .field__lbl { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .field__lbl i { color: var(--tm-danger, #ef4444); font-style: normal; }
    .field input[type=text], .field input[type=number], .field textarea {
      width: 100%; padding: 9px 11px;
      border: 1px solid var(--tm-line); border-radius: 9px;
      background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13px; outline: none;
    }
    .field input:focus, .field textarea:focus { border-color: var(--tm-green); }
    .field--short { max-width: 120px; }
    .field__err { font-size: 11px; font-weight: 600; color: var(--tm-danger, #ef4444); }
    .preview { width: 96px; height: 96px; object-fit: cover; border-radius: 9px; border: 1px solid var(--tm-line); margin-top: 4px; }
    .toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--tm-text); }
    .toggle input { width: 16px; height: 16px; }

    @media (max-width: 720px) {
      .page__hero { flex-direction: column; }
    }
  `],
})
export class VehiclesComponent implements OnInit {
  tab: 'vehicle' | 'ride' = 'vehicle';
  busy = false;

  vehicleTypes: VehicleTypeRow[] = [];
  rideTypes: RideTypeRow[] = [];

  // ── Vehicle list: filters + pagination ──────────────────────────
  vehicleSearch = '';
  vehicleStatus: VehicleStatus = 'all';
  vehicleStatusOptions = VEHICLE_STATUS_OPTIONS;
  vPage = 1;
  vPageSize = 25;
  vLoading = false;
  vPageRows: VehicleTypeRow[] = [];
  vTotal = 0;

  // ── Ride list: search + pagination ──────────────────────────────
  rideSearch = '';
  rPage = 1;
  rPageSize = 25;
  rLoading = false;
  rPageRows: RideTypeRow[] = [];
  rTotal = 0;

  // Vehicle Type form state
  vehicleOpen = false;
  vehicleEditingId: number | null = null;
  vehicleSaving = false;
  vTouched = false;
  vehicleFile: File | null = null;
  vehicleForm: {
    name: string;
    description: string;
    sort_order: number;
    is_active: boolean;
    previewUrl: string | null;
  } = this.blankVehicleForm();
  deleteVehicle: VehicleTypeRow | null = null;

  // Ride Type form state
  rideOpen = false;
  rideEditingId: number | null = null;
  rideSaving = false;
  rTouched = false;
  rideForm: { name: string; description: string; sort_order: number } = this.blankRideForm();
  deleteRide: RideTypeRow | null = null;

  private vSearchDebounce: any = null;
  private rSearchDebounce: any = null;

  constructor(private api: ApiService, private toast: ToastService) {}

  ngOnInit(): void {
    this.loadVehicleTypes();
    this.loadRideTypes();
  }

  // ---- Vehicle view (filter + paginate) ----
  private applyVehicleView(): void {
    const q = this.vehicleSearch.trim().toLowerCase();
    let list = this.vehicleTypes;
    if (this.vehicleStatus === 'active') list = list.filter((v) => v.is_active);
    else if (this.vehicleStatus === 'inactive') list = list.filter((v) => !v.is_active);
    if (q) {
      list = list.filter(
        (v) => v.name.toLowerCase().includes(q) || (v.description ?? '').toLowerCase().includes(q),
      );
    }
    this.vTotal = list.length;
    const maxPage = Math.max(1, Math.ceil(this.vTotal / this.vPageSize));
    if (this.vPage > maxPage) this.vPage = maxPage;
    const start = (this.vPage - 1) * this.vPageSize;
    this.vPageRows = list.slice(start, start + this.vPageSize);
  }

  vehicleStatusLabel(): string {
    return this.vehicleStatusOptions.find((o) => o.value === this.vehicleStatus)?.label ?? 'All statuses';
  }
  onVehicleSearchChange(): void {
    if (this.vSearchDebounce) clearTimeout(this.vSearchDebounce);
    this.vSearchDebounce = setTimeout(() => {
      this.vPage = 1;
      this.applyVehicleView();
    }, 250);
  }
  clearVehicleSearch(): void {
    this.vehicleSearch = '';
    this.vPage = 1;
    this.applyVehicleView();
  }
  onVehicleStatusChange(value: string): void {
    this.vehicleStatus = value as VehicleStatus;
    this.vPage = 1;
    this.applyVehicleView();
  }
  clearVehicleStatus(): void {
    this.vehicleStatus = 'all';
    this.vPage = 1;
    this.applyVehicleView();
  }
  onVPage(p: number): void {
    this.vPage = p;
    this.applyVehicleView();
  }
  onVPageSize(s: number): void {
    this.vPageSize = s;
    this.vPage = 1;
    this.applyVehicleView();
  }

  // ---- Ride view (search + paginate) ----
  private applyRideView(): void {
    const q = this.rideSearch.trim().toLowerCase();
    let list = this.rideTypes;
    if (q) {
      list = list.filter(
        (r) => r.name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q),
      );
    }
    this.rTotal = list.length;
    const maxPage = Math.max(1, Math.ceil(this.rTotal / this.rPageSize));
    if (this.rPage > maxPage) this.rPage = maxPage;
    const start = (this.rPage - 1) * this.rPageSize;
    this.rPageRows = list.slice(start, start + this.rPageSize);
  }
  onRideSearchChange(): void {
    if (this.rSearchDebounce) clearTimeout(this.rSearchDebounce);
    this.rSearchDebounce = setTimeout(() => {
      this.rPage = 1;
      this.applyRideView();
    }, 250);
  }
  clearRideSearch(): void {
    this.rideSearch = '';
    this.rPage = 1;
    this.applyRideView();
  }
  onRPage(p: number): void {
    this.rPage = p;
    this.applyRideView();
  }
  onRPageSize(s: number): void {
    this.rPageSize = s;
    this.rPage = 1;
    this.applyRideView();
  }

  // ---- Vehicle types ----
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

  blankVehicleForm() {
    return { name: '', description: '', sort_order: 0, is_active: true, previewUrl: null };
  }

  openVehicleCreate(): void {
    this.vehicleEditingId = null;
    this.vehicleFile = null;
    this.vTouched = false;
    this.vehicleForm = this.blankVehicleForm();
    this.vehicleOpen = true;
  }

  openVehicleEdit(v: VehicleTypeRow): void {
    this.vehicleEditingId = v.id;
    this.vehicleFile = null;
    this.vTouched = false;
    this.vehicleForm = {
      name: v.name,
      description: v.description || '',
      sort_order: v.sort_order,
      is_active: v.is_active,
      previewUrl: v.image_url,
    };
    this.vehicleOpen = true;
  }

  async onVehicleImage(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      this.vehicleFile = null;
      return;
    }
    try {
      const prepared = await this.prepareImage(file);
      this.vehicleFile = prepared;
      const reader = new FileReader();
      reader.onload = () => (this.vehicleForm.previewUrl = reader.result as string);
      reader.readAsDataURL(prepared);
    } catch {
      input.value = '';
      this.vehicleFile = null;
      this.toast.error('Could not process that image — please use a JPG or PNG.');
    }
  }

  /**
   * Downscales large images in the browser before upload. A full-resolution
   * phone photo exceeds PHP's upload_max_filesize and gets rejected with
   * "the image failed to upload" before validation even runs — resizing to a
   * thumbnail-sized image keeps every upload well under the limit.
   */
  private prepareImage(file: File): Promise<File> {
    const MAX_DIM = 1000;
    const PASS_THROUGH = 1.5 * 1024 * 1024; // small files: keep untouched
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const oversized = img.width > MAX_DIM || img.height > MAX_DIM;
        if (!oversized && file.size <= PASS_THROUGH) {
          resolve(file);
          return;
        }
        const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(file);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        // Keep PNGs as PNG to preserve transparency; everything else → JPEG.
        const isPng = file.type === 'image/png';
        const type = isPng ? 'image/png' : 'image/jpeg';
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }
            const name = file.name.replace(/\.[^.]+$/, isPng ? '.png' : '.jpg');
            resolve(new File([blob], name, { type }));
          },
          type,
          0.85,
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('image decode failed'));
      };
      img.src = url;
    });
  }

  submitVehicle(): void {
    this.vTouched = true;
    if (!this.vehicleForm.name.trim() || this.vehicleSaving) return;
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
        this.applyVehicleView();
        this.toast.success(this.vehicleEditingId ? 'Vehicle type updated' : 'Vehicle type created');
      },
      error: (err) => {
        this.vehicleSaving = false;
        this.toast.error(err?.error?.message || 'Failed to save vehicle type');
      },
    });
  }

  confirmDeleteVehicle(): void {
    const v = this.deleteVehicle;
    if (!v || this.busy) return;
    this.busy = true;
    this.api.delete(`/admin/vehicle-types-global/${v.id}`).subscribe({
      next: () => {
        this.busy = false;
        this.deleteVehicle = null;
        this.vehicleTypes = this.vehicleTypes.filter((x) => x.id !== v.id);
        this.applyVehicleView();
        this.toast.success('Vehicle type deleted');
      },
      error: (err) => {
        this.busy = false;
        this.toast.error(err?.error?.message || 'Failed to delete');
      },
    });
  }

  // ---- Ride types ----
  loadRideTypes(): void {
    this.rLoading = true;
    this.api.get<{ data: RideTypeRow[] }>('/admin/ride-types-crud').subscribe({
      next: (res) => {
        this.rideTypes = res.data ?? [];
        this.rLoading = false;
        this.applyRideView();
      },
      error: () => {
        this.rLoading = false;
        this.toast.error('Failed to load ride types');
      },
    });
  }

  blankRideForm() {
    return { name: '', description: '', sort_order: 0 };
  }

  openRideCreate(): void {
    this.rideEditingId = null;
    this.rTouched = false;
    this.rideForm = this.blankRideForm();
    this.rideOpen = true;
  }

  openRideEdit(r: RideTypeRow): void {
    this.rideEditingId = r.id;
    this.rTouched = false;
    this.rideForm = { name: r.name, description: r.description || '', sort_order: r.sort_order };
    this.rideOpen = true;
  }

  submitRide(): void {
    this.rTouched = true;
    if (!this.rideForm.name.trim() || this.rideSaving) return;
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
        this.applyRideView();
        this.toast.success(this.rideEditingId ? 'Ride type updated' : 'Ride type created');
      },
      error: (err) => {
        this.rideSaving = false;
        this.toast.error(err?.error?.message || 'Failed to save ride type');
      },
    });
  }

  confirmDeleteRide(): void {
    const r = this.deleteRide;
    if (!r || this.busy) return;
    this.busy = true;
    this.api.delete(`/admin/ride-types-crud/${r.id}`).subscribe({
      next: () => {
        this.busy = false;
        this.deleteRide = null;
        this.rideTypes = this.rideTypes.filter((x) => x.id !== r.id);
        this.applyRideView();
        this.toast.success('Ride type deleted');
      },
      error: (err) => {
        this.busy = false;
        this.toast.error(err?.error?.message || 'Failed to delete');
      },
    });
  }
}
