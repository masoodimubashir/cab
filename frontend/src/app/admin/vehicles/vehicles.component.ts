import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import {
  ButtonComponent,
  DrawerComponent,
  IconComponent,
  ModalComponent,
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

/**
 * Vehicles — manages the two global catalogues used across the platform:
 *   • Vehicle Types — Auto, Bike, Mini, Tuk-Tuk … (with image)
 *   • Ride Types    — Airport, Delivery, Pool, Rental …
 * Both are global (not city-scoped). Create/edit uses the shared drawer.
 */
@Component({
  selector: 'app-vehicles',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonComponent, DrawerComponent, ModalComponent, IconComponent,
  ],
  template: `
    <div class="veh">
      <header class="veh__head">
        <div>
          <h1 class="veh__title">Vehicles</h1>
          <p class="veh__sub">
            Global catalogues of vehicle categories and ride service types.
          </p>
        </div>
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
      <section *ngIf="tab === 'vehicle'">
        <div class="toolbar">
          <div class="search">
            <tm-icon name="search" [size]="15" />
            <input type="text" [(ngModel)]="vehicleSearch" placeholder="Search vehicle types…" />
            <button *ngIf="vehicleSearch" class="search__clear" (click)="vehicleSearch = ''" aria-label="Clear">
              <tm-icon name="x" [size]="13" />
            </button>
          </div>
          <select class="select" [(ngModel)]="vehicleStatus">
            <option value="all">All statuses</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
          <tm-button variant="green" size="sm" icon="plus" (clicked)="openVehicleCreate()">
            Add vehicle type
          </tm-button>
        </div>

        <div class="grid" *ngIf="filteredVehicles().length; else vEmpty">
          <article class="vcard" *ngFor="let v of filteredVehicles()">
            <div class="vcard__media">
              <img *ngIf="v.image_url" [src]="v.image_url" [alt]="v.name" />
              <span *ngIf="!v.image_url" class="vcard__ph"><tm-icon name="car" [size]="26" /></span>
              <span class="vcard__pill" [class.on]="v.is_active" [class.off]="!v.is_active">
                {{ v.is_active ? 'Active' : 'Inactive' }}
              </span>
            </div>
            <div class="vcard__body">
              <div class="vcard__top">
                <span class="vcard__name">{{ v.name }}</span>
                <span class="vcard__sort">#{{ v.sort_order }}</span>
              </div>
              <p class="vcard__desc">{{ v.description || 'No description' }}</p>
            </div>
            <div class="vcard__foot">
              <button class="icon-btn" (click)="openVehicleEdit(v)" aria-label="Edit"><tm-icon name="edit" [size]="15" /></button>
              <button class="icon-btn icon-btn--danger" (click)="deleteVehicle = v" aria-label="Delete"><tm-icon name="trash" [size]="15" /></button>
            </div>
          </article>
        </div>
        <ng-template #vEmpty>
          <div class="empty">
            <tm-icon name="car" [size]="24" />
            <p>{{ vehicleSearch || vehicleStatus !== 'all' ? 'No vehicle types match your filters.' : 'No vehicle types yet.' }}</p>
          </div>
        </ng-template>
      </section>

      <!-- ===================== RIDE TYPES ===================== -->
      <section *ngIf="tab === 'ride'">
        <div class="toolbar">
          <div class="search">
            <tm-icon name="search" [size]="15" />
            <input type="text" [(ngModel)]="rideSearch" placeholder="Search ride types…" />
            <button *ngIf="rideSearch" class="search__clear" (click)="rideSearch = ''" aria-label="Clear">
              <tm-icon name="x" [size]="13" />
            </button>
          </div>
          <tm-button variant="green" size="sm" icon="plus" (clicked)="openRideCreate()">
            Add ride type
          </tm-button>
        </div>

        <div class="grid" *ngIf="filteredRides().length; else rEmpty">
          <article class="vcard vcard--ride" *ngFor="let r of filteredRides()">
            <div class="vcard__body">
              <div class="vcard__top">
                <span class="vcard__icon"><tm-icon name="road" [size]="18" /></span>
                <span class="vcard__name">{{ r.name }}</span>
                <span class="vcard__sort">#{{ r.sort_order }}</span>
              </div>
              <p class="vcard__desc">{{ r.description || 'No description' }}</p>
            </div>
            <div class="vcard__foot">
              <button class="icon-btn" (click)="openRideEdit(r)" aria-label="Edit"><tm-icon name="edit" [size]="15" /></button>
              <button class="icon-btn icon-btn--danger" (click)="deleteRide = r" aria-label="Delete"><tm-icon name="trash" [size]="15" /></button>
            </div>
          </article>
        </div>
        <ng-template #rEmpty>
          <div class="empty">
            <tm-icon name="road" [size]="24" />
            <p>{{ rideSearch ? 'No ride types match your search.' : 'No ride types yet.' }}</p>
          </div>
        </ng-template>
      </section>
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
    .veh { display: flex; flex-direction: column; gap: 16px; }
    .veh__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .veh__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); }

    /* segmented tabs */
    .seg {
      display: inline-flex; gap: 4px; padding: 4px;
      background: var(--tm-canvas-2); border-radius: var(--tm-radius-md, 10px);
    }
    .seg__btn {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 8px 14px; border-radius: 8px;
      font-size: 13px; font-weight: 700; color: var(--tm-text-muted);
      background: transparent; cursor: pointer;
      transition: background var(--tm-duration-fast) var(--tm-ease), color var(--tm-duration-fast) var(--tm-ease);
    }
    .seg__btn.is-on { background: var(--tm-surface); color: var(--tm-text); box-shadow: var(--tm-shadow-sm); }
    .seg__count {
      font-size: 11px; font-weight: 800;
      padding: 1px 7px; border-radius: 999px;
      background: var(--tm-canvas); color: var(--tm-text-muted);
    }
    .seg__btn.is-on .seg__count { background: var(--tm-green-tint, #e0f7fa); color: var(--tm-green); }

    /* toolbar */
    .toolbar {
      display: flex; gap: 10px; align-items: center; margin-bottom: 14px;
      flex-wrap: wrap; justify-content: flex-end;
    }
    .search {
      display: flex; align-items: center; gap: 7px;
      min-width: 200px; max-width: 360px;
      height: 38px; padding: 0 11px;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line); border-radius: 9px;
      color: var(--tm-text-muted);
    }
    .search input { flex: 1; border: none; outline: none; background: transparent; font-size: 13px; color: var(--tm-text); }
    .search__clear {
      display: inline-flex; cursor: pointer; color: var(--tm-text-muted);
      width: 18px; height: 18px; align-items: center; justify-content: center;
      border-radius: 50%; background: var(--tm-canvas-2);
    }
    .select {
      height: 38px; padding: 0 11px;
      border: 1px solid var(--tm-line); border-radius: 9px;
      background: var(--tm-surface); color: var(--tm-text);
      font-size: 13px; outline: none;
    }

    /* card grid */
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(248px, 1fr));
      gap: 12px;
    }
    .vcard {
      display: flex; flex-direction: column;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      overflow: hidden;
      transition: border-color var(--tm-duration-fast) var(--tm-ease), box-shadow var(--tm-duration-fast) var(--tm-ease);
    }
    .vcard:hover { border-color: var(--tm-text-muted); box-shadow: var(--tm-shadow-card); }

    .vcard__media {
      position: relative;
      height: 132px;
      background: var(--tm-canvas-2);
      display: flex; align-items: center; justify-content: center;
    }
    .vcard__media img { width: 100%; height: 100%; object-fit: cover; }
    .vcard__ph { color: var(--tm-text-muted); }
    .vcard__pill {
      position: absolute; top: 8px; right: 8px;
      font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.4px;
      padding: 3px 8px; border-radius: 999px;
    }
    .vcard__pill.on { background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .vcard__pill.off { background: var(--tm-canvas); color: var(--tm-text-muted); }

    .vcard__body { padding: 12px 13px; flex: 1; }
    .vcard__top { display: flex; align-items: center; gap: 8px; }
    .vcard__icon {
      width: 30px; height: 30px; border-radius: 8px; flex: none;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--tm-green-tint, #e0f7fa); color: var(--tm-green);
    }
    .vcard__name { font-size: 14px; font-weight: 800; color: var(--tm-text); flex: 1; }
    .vcard__sort { font-size: 11px; font-weight: 700; color: var(--tm-text-muted); }
    .vcard__desc {
      margin: 6px 0 0; font-size: 12px; color: var(--tm-text-muted);
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .vcard__foot {
      display: flex; justify-content: flex-end; gap: 6px;
      padding: 9px 13px; border-top: 1px solid var(--tm-line);
    }

    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 30px; height: 30px; border-radius: 8px;
      background: var(--tm-canvas-2); color: var(--tm-text-muted); cursor: pointer;
      transition: background var(--tm-duration-fast) var(--tm-ease), color var(--tm-duration-fast) var(--tm-ease);
    }
    .icon-btn:hover { background: var(--tm-ink); color: #fff; }
    .icon-btn--danger:hover { background: var(--tm-danger, #ef4444); }

    .empty {
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      padding: 48px 20px; text-align: center;
      color: var(--tm-text-muted);
      background: var(--tm-surface);
      border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
    }
    .empty p { margin: 0; font-size: 13px; }

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
  `],
})
export class VehiclesComponent implements OnInit {
  tab: 'vehicle' | 'ride' = 'vehicle';
  busy = false;

  vehicleTypes: VehicleTypeRow[] = [];
  rideTypes: RideTypeRow[] = [];

  vehicleSearch = '';
  vehicleStatus: 'all' | 'active' | 'inactive' = 'all';
  rideSearch = '';

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

  constructor(private api: ApiService, private toast: ToastService) {}

  ngOnInit(): void {
    this.loadVehicleTypes();
    this.loadRideTypes();
  }

  // ---- filters ----
  filteredVehicles(): VehicleTypeRow[] {
    const q = this.vehicleSearch.trim().toLowerCase();
    return this.vehicleTypes.filter((v) => {
      if (this.vehicleStatus === 'active' && !v.is_active) return false;
      if (this.vehicleStatus === 'inactive' && v.is_active) return false;
      if (!q) return true;
      return (
        v.name.toLowerCase().includes(q) ||
        (v.description ?? '').toLowerCase().includes(q)
      );
    });
  }

  filteredRides(): RideTypeRow[] {
    const q = this.rideSearch.trim().toLowerCase();
    if (!q) return this.rideTypes;
    return this.rideTypes.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q),
    );
  }

  // ---- Vehicle types ----
  loadVehicleTypes(): void {
    this.api.get<{ data: VehicleTypeRow[] }>('/admin/vehicle-types-global').subscribe({
      next: (res) => (this.vehicleTypes = res.data ?? []),
      error: () => this.toast.error('Failed to load vehicle types'),
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
    this.api.get<{ data: RideTypeRow[] }>('/admin/ride-types-crud').subscribe({
      next: (res) => (this.rideTypes = res.data ?? []),
      error: () => this.toast.error('Failed to load ride types'),
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
        this.toast.success('Ride type deleted');
      },
      error: (err) => {
        this.busy = false;
        this.toast.error(err?.error?.message || 'Failed to delete');
      },
    });
  }
}
