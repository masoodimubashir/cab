import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, DrawerComponent, IconComponent, ModalComponent } from '../../ui';

interface PackageRow {
  id: number;
  name: string;
  sort_order: number;
  is_active: boolean;
  fare_config: Record<string, number | null>;
}

interface FareSection {
  title: string;
  fields: { key: string; label: string; step?: string }[];
}

/** Fare fields a package carries — kept in sync with the backend FARE_KEYS. */
const FARE_SECTIONS: FareSection[] = [
  {
    title: 'Base fare',
    fields: [
      { key: 'base_fare', label: 'Base fare' },
      { key: 'min_fare', label: 'Minimum fare' },
      { key: 'per_km', label: 'Per km' },
      { key: 'per_min', label: 'Per min' },
    ],
  },
  {
    title: 'Rates',
    fields: [
      { key: 'surge_multiplier', label: 'Surge multiplier', step: '0.1' },
      { key: 'commission_percent', label: 'Commission %' },
      { key: 'tax_percent', label: 'Tax %' },
    ],
  },
  {
    title: 'Distance thresholds',
    fields: [
      { key: 'threshold_distance_1_km', label: 'Threshold 1 (km)' },
      { key: 'fare_per_km_after_threshold_1', label: 'Fare/km after T1' },
      { key: 'threshold_distance_2_km', label: 'Threshold 2 (km)' },
      { key: 'fare_per_km_after_threshold_2', label: 'Fare/km after T2' },
    ],
  },
  {
    title: 'Time thresholds',
    fields: [
      { key: 'threshold_time_1_min', label: 'Threshold 1 (min)' },
      { key: 'fare_per_min_after_threshold_time_1', label: 'Fare/min after T1' },
      { key: 'threshold_time_2_min', label: 'Threshold 2 (min)' },
      { key: 'fare_per_min_after_threshold_time_2', label: 'Fare/min after T2' },
    ],
  },
];

/**
 * Outstation Fare Packages — manages the named price lists (One Way,
 * Round Trip, …) for one outstation vehicle. Embedded in the vehicle
 * detail page and only shown for the outstation variant.
 */
@Component({
  selector: 'app-outstation-packages',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, DrawerComponent, IconComponent, ModalComponent],
  template: `
    <div class="op">
      <div class="op__head">
        <div>
          <h3 class="op__title">Fare Packages</h3>
          <p class="op__sub">Named price lists for this outstation vehicle — e.g. One Way, Round Trip.</p>
        </div>
        <tm-button variant="green" size="sm" icon="plus" [disabled]="!vehicleTypeId" (clicked)="openCreate()">
          Add Package
        </tm-button>
      </div>

      <div class="op__cue" *ngIf="loading">Loading packages…</div>

      <div class="op__cue" *ngIf="!loading && !packages.length">
        No packages yet. Add one to give this vehicle a price list.
      </div>

      <div class="op__list" *ngIf="!loading && packages.length">
        <article class="pkg" *ngFor="let p of packages">
          <div class="pkg__main">
            <span class="pkg__name">{{ p.name }}</span>
            <span class="pkg__badge" [class.is-off]="!p.is_active">{{ p.is_active ? 'Active' : 'Inactive' }}</span>
          </div>
          <span class="pkg__summary">
            Base {{ p.fare_config['base_fare'] ?? '—' }} · {{ p.fare_config['per_km'] ?? '—' }}/km · {{ p.fare_config['per_min'] ?? '—' }}/min
          </span>
          <div class="pkg__actions">
            <button class="icon-btn" (click)="openEdit(p)" aria-label="Edit"><tm-icon name="edit" [size]="14" /></button>
            <button class="icon-btn icon-btn--danger" (click)="deleteTarget = p" aria-label="Delete"><tm-icon name="trash" [size]="14" /></button>
          </div>
        </article>
      </div>
    </div>

    <!-- Create / edit drawer -->
    <tm-drawer
      [open]="drawerOpen"
      [title]="editMode ? 'Edit package' : 'Add package'"
      [width]="540"
      (closed)="closeDrawer()"
    >
      <div slot="body" class="pform">
        <label class="pfield pfield--full">
          <span class="pfield__lbl">Package name <i>*</i></span>
          <input type="text" [(ngModel)]="form.name" placeholder="One Way / Round Trip" maxlength="120" />
        </label>

        <section class="psec" *ngFor="let sec of sections">
          <h4 class="psec__title">{{ sec.title }}</h4>
          <div class="pgrid">
            <label class="pfield" *ngFor="let f of sec.fields">
              <span class="pfield__lbl">{{ f.label }}</span>
              <input
                type="number" min="0"
                [attr.step]="f.step || null"
                [ngModel]="form.fare[f.key]"
                (ngModelChange)="form.fare[f.key] = $event"
              />
            </label>
          </div>
        </section>

        <label class="toggle">
          <input type="checkbox" [(ngModel)]="form.is_active" />
          <span>Package is active</span>
        </label>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="closeDrawer()">Cancel</tm-button>
        <tm-button variant="green" [disabled]="saving || !form.name.trim()" (clicked)="save()">
          {{ saving ? 'Saving…' : editMode ? 'Save changes' : 'Create package' }}
        </tm-button>
      </div>
    </tm-drawer>

    <!-- Delete confirm -->
    <tm-modal [open]="!!deleteTarget" title="Delete package" (closed)="deleteTarget = null">
      <div slot="body"><p>Delete <strong>{{ deleteTarget?.name }}</strong>? This cannot be undone.</p></div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="deleteTarget = null">Cancel</tm-button>
        <tm-button variant="danger" [disabled]="saving" (clicked)="confirmDelete()">Delete</tm-button>
      </div>
    </tm-modal>
  `,
  styles: [`
    .op { display: flex; flex-direction: column; gap: 12px; }
    .op__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    .op__title { margin: 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .op__sub { margin: 2px 0 0; font-size: 12px; color: var(--tm-text-muted); }

    .op__cue {
      padding: 26px; text-align: center; font-size: 13px; color: var(--tm-text-muted);
      background: var(--tm-surface); border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
    }

    .op__list { display: flex; flex-direction: column; gap: 8px; }
    .pkg {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 14px;
      background: var(--tm-surface); border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-md, 10px);
    }
    .pkg__main { display: flex; align-items: center; gap: 8px; }
    .pkg__name { font-size: 14px; font-weight: 800; color: var(--tm-text); }
    .pkg__badge {
      font-size: 10px; font-weight: 800; letter-spacing: 0.3px;
      padding: 2px 8px; border-radius: 999px;
      background: var(--tm-success-bg); color: var(--tm-success-fg);
    }
    .pkg__badge.is-off { background: var(--tm-warning-bg); color: var(--tm-warning-fg); }
    .pkg__summary { flex: 1; font-size: 12px; color: var(--tm-text-muted); }
    .pkg__actions { display: flex; gap: 5px; }

    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 7px;
      background: var(--tm-canvas-2); color: var(--tm-text-muted); cursor: pointer;
    }
    .icon-btn:hover { background: var(--tm-ink); color: #fff; }
    .icon-btn--danger:hover { background: var(--tm-danger, #ef4444); }

    .pform { display: flex; flex-direction: column; gap: 16px; }
    .psec { display: flex; flex-direction: column; gap: 8px; }
    .psec__title {
      margin: 0; font-size: 12px; font-weight: 800;
      text-transform: uppercase; letter-spacing: 0.5px; color: var(--tm-text-muted);
    }
    .pgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .pfield { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .pfield--full { grid-column: 1 / -1; }
    .pfield__lbl { font-size: 11px; font-weight: 700; color: var(--tm-text); }
    .pfield__lbl i { color: var(--tm-danger, #ef4444); font-style: normal; }
    .pfield input {
      width: 100%; height: 36px; padding: 0 10px;
      border: 1px solid var(--tm-line); border-radius: 8px;
      background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13px; outline: none;
    }
    .pfield input:focus { border-color: var(--tm-green); }
    .toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--tm-text); }
    .toggle input { width: 16px; height: 16px; accent-color: var(--tm-green); }
  `],
})
export class OutstationPackagesComponent implements OnChanges {
  @Input() cityId: number | null = null;
  @Input() vehicleTypeId: number | null = null;

  readonly sections = FARE_SECTIONS;

  packages: PackageRow[] = [];
  loading = false;

  drawerOpen = false;
  editMode = false;
  editingId: number | null = null;
  saving = false;
  deleteTarget: PackageRow | null = null;
  form: { name: string; is_active: boolean; fare: Record<string, number | null> } = this.blankForm();

  constructor(private api: ApiService, private toast: ToastService) {}

  ngOnChanges(): void {
    if (this.cityId != null && this.vehicleTypeId != null) {
      this.load();
    } else {
      this.packages = [];
    }
  }

  private base(): string {
    return `/admin/cities/${this.cityId}/vehicle-types/${this.vehicleTypeId}/packages`;
  }

  load(): void {
    if (this.cityId == null || this.vehicleTypeId == null) return;
    this.loading = true;
    this.api.get<{ data: PackageRow[] }>(this.base()).subscribe({
      next: (res) => { this.packages = res?.data ?? []; this.loading = false; },
      error: () => { this.loading = false; this.toast.error('Failed to load packages'); },
    });
  }

  openCreate(): void {
    this.editMode = false;
    this.editingId = null;
    this.form = this.blankForm();
    this.drawerOpen = true;
  }

  openEdit(p: PackageRow): void {
    this.editMode = true;
    this.editingId = p.id;
    this.form = {
      name: p.name,
      is_active: p.is_active,
      fare: { ...this.blankForm().fare, ...(p.fare_config || {}) },
    };
    this.drawerOpen = true;
  }

  closeDrawer(): void {
    this.drawerOpen = false;
    this.saving = false;
  }

  save(): void {
    if (!this.form.name.trim() || this.saving || this.cityId == null || this.vehicleTypeId == null) return;
    this.saving = true;
    const payload = {
      name: this.form.name.trim(),
      is_active: this.form.is_active,
      fare_config: this.form.fare,
    };
    const req = this.editMode && this.editingId != null
      ? this.api.patch<{ package: PackageRow }>(`${this.base()}/${this.editingId}`, payload)
      : this.api.post<{ package: PackageRow }>(this.base(), payload);

    req.subscribe({
      next: () => {
        this.saving = false;
        this.drawerOpen = false;
        this.toast.success(this.editMode ? 'Package updated' : 'Package created');
        this.load();
      },
      error: (err) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Failed to save package');
      },
    });
  }

  confirmDelete(): void {
    const p = this.deleteTarget;
    if (!p || this.saving) return;
    this.saving = true;
    this.api.delete(`${this.base()}/${p.id}`).subscribe({
      next: () => {
        this.saving = false;
        this.deleteTarget = null;
        this.packages = this.packages.filter((x) => x.id !== p.id);
        this.toast.success('Package deleted');
      },
      error: (err) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Failed to delete package');
      },
    });
  }

  private blankForm() {
    const fare: Record<string, number | null> = {};
    for (const sec of FARE_SECTIONS) {
      for (const f of sec.fields) fare[f.key] = null;
    }
    return { name: '', is_active: true, fare };
  }
}
