import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import {
  ButtonComponent,
  DrawerComponent,
  IconComponent,
  ModalComponent,
} from '../../ui';

interface Fleet {
  id: number;
  city_id: number;
  city_name: string | null;
  name: string;
  phone_number: string | null;
  bank: string | null;
  address: string | null;
  vat_enabled: boolean;
  vat_number: string | null;
  logo_path: string | null;
  logo_url: string | null;
  status: string;
  is_active: boolean;
}

const STATUS_OPTIONS = [
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
  { label: 'Suspended', value: 'suspended' },
  { label: 'Pending', value: 'pending' },
];

/**
 * Fleets — fleet operators within the city chosen in the topbar switcher.
 * Create/edit uses the shared right-side drawer; delete uses a confirm modal.
 */
@Component({
  selector: 'app-fleets-settings',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonComponent, DrawerComponent, ModalComponent, IconComponent,
  ],
  template: `
    <div class="fl">
      <header class="fl__head">
        <div>
          <h1 class="fl__title">Fleets</h1>
          <p class="fl__sub">Fleet operators that own vehicles in this city.</p>
        </div>
        <tm-button
          *ngIf="cityId != null"
          variant="green" icon="plus"
          (clicked)="openCreate()"
        >Add fleet</tm-button>
      </header>

      <!-- No city -->
      <div class="cue" *ngIf="cityId == null">
        <tm-icon name="map-marker" [size]="24" />
        <p class="cue__title">No city selected</p>
        <p class="cue__text">Pick a city from the switcher in the top bar to manage its fleets.</p>
      </div>

      <ng-container *ngIf="cityId != null">
        <div class="seg">
          <button class="seg__btn" [class.is-on]="filterStatus === null" (click)="setStatus(null)">All</button>
          <button
            *ngFor="let s of statusOptions"
            class="seg__btn"
            [class.is-on]="filterStatus === s.value"
            (click)="setStatus(s.value)"
          >{{ s.label }}</button>
        </div>

        <div class="grid" *ngIf="fleets.length; else empty">
          <article class="fcard" *ngFor="let f of fleets">
            <div class="fcard__head">
              <span class="fcard__logo">
                <img *ngIf="f.logo_url" [src]="f.logo_url" alt="" />
                <tm-icon *ngIf="!f.logo_url" name="car" [size]="20" />
              </span>
              <div class="fcard__id">
                <span class="fcard__name">{{ f.name }}</span>
                <span class="fcard__phone">{{ f.phone_number || 'No phone' }}</span>
              </div>
              <span class="fcard__status" [attr.data-s]="f.status">{{ f.status }}</span>
            </div>
            <div class="fcard__rows">
              <div class="fcard__row">
                <span class="fcard__k">VAT</span>
                <span class="fcard__v">{{ f.vat_enabled ? (f.vat_number || 'Enabled') : 'Not enabled' }}</span>
              </div>
              <div class="fcard__row" *ngIf="f.bank">
                <span class="fcard__k">Bank</span>
                <span class="fcard__v">{{ f.bank }}</span>
              </div>
              <div class="fcard__row" *ngIf="f.address">
                <span class="fcard__k">Address</span>
                <span class="fcard__v">{{ f.address }}</span>
              </div>
            </div>
            <div class="fcard__foot">
              <button class="icon-btn" (click)="openEdit(f)" aria-label="Edit fleet"><tm-icon name="edit" [size]="14" /></button>
              <button class="icon-btn icon-btn--danger" (click)="deleteTarget = f" aria-label="Delete fleet"><tm-icon name="trash" [size]="14" /></button>
            </div>
          </article>
        </div>
        <ng-template #empty>
          <div class="cue">
            <tm-icon name="car" [size]="24" />
            <p class="cue__title">No fleets yet</p>
            <p class="cue__text">Add a fleet operator for this city.</p>
          </div>
        </ng-template>
      </ng-container>
    </div>

    <!-- Create / edit drawer -->
    <tm-drawer
      [open]="open"
      [title]="editingId ? 'Edit fleet' : 'Add fleet'"
      [subtitle]="cityName"
      [width]="520"
      (closed)="open = false"
    >
      <div slot="body" class="form">
        <label class="field">
          <span class="field__lbl">Fleet name <i>*</i></span>
          <input type="text" [(ngModel)]="form.name" (ngModelChange)="touched.name = true"
                 placeholder="e.g. Baramulla Premiere" />
          <span class="field__err" *ngIf="touched.name && !form.name.trim()">Name is required.</span>
        </label>

        <label class="field">
          <span class="field__lbl">Phone number <i>*</i></span>
          <input type="text" [(ngModel)]="form.phone_number" (ngModelChange)="touched.phone = true"
                 placeholder="+91 90000 00000" />
          <span class="field__err" *ngIf="touched.phone && !form.phone_number.trim()">Phone is required.</span>
        </label>

        <label class="field">
          <span class="field__lbl">Bank</span>
          <input type="text" [(ngModel)]="form.bank" placeholder="Bank name / account label" />
        </label>

        <label class="field">
          <span class="field__lbl">Address</span>
          <textarea rows="3" [(ngModel)]="form.address"></textarea>
        </label>

        <label class="toggle">
          <input type="checkbox" [(ngModel)]="form.vat_enabled" />
          <span>VAT enabled</span>
        </label>

        <label class="field" *ngIf="form.vat_enabled">
          <span class="field__lbl">VAT number</span>
          <input type="text" [(ngModel)]="form.vat_number" />
        </label>

        <label class="field">
          <span class="field__lbl">Status</span>
          <select [(ngModel)]="form.status">
            <option *ngFor="let s of statusOptions" [value]="s.value">{{ s.label }}</option>
          </select>
        </label>

        <div class="field">
          <span class="field__lbl">Logo (optional)</span>
          <label class="upload">
            <tm-icon name="upload" [size]="13" /> Choose image
            <input type="file" accept="image/*" (change)="onLogo($event)" hidden />
          </label>
          <img *ngIf="logoPreview" [src]="logoPreview" class="preview" alt="logo preview" />
        </div>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="open = false">Cancel</tm-button>
        <tm-button variant="green" [disabled]="!formValid || saving" (clicked)="submit()">
          {{ saving ? 'Saving…' : editingId ? 'Save changes' : 'Create fleet' }}
        </tm-button>
      </div>
    </tm-drawer>

    <!-- Delete confirm -->
    <tm-modal [open]="!!deleteTarget" title="Delete fleet" (closed)="deleteTarget = null">
      <div slot="body">
        <p>Delete fleet <strong>{{ deleteTarget?.name }}</strong>? This cannot be undone.</p>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="deleteTarget = null">Cancel</tm-button>
        <tm-button variant="danger" [disabled]="saving" (clicked)="confirmDelete()">
          {{ saving ? 'Deleting…' : 'Delete' }}
        </tm-button>
      </div>
    </tm-modal>
  `,
  styles: [`
    .fl { display: flex; flex-direction: column; gap: 16px; }
    .fl__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .fl__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .fl__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); }

    .cue {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 48px 24px; text-align: center;
      background: var(--tm-surface); border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg); color: var(--tm-text-muted);
    }
    .cue__title { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .cue__text { margin: 0; font-size: 13px; }

    .seg {
      display: inline-flex; gap: 4px; padding: 4px;
      background: var(--tm-canvas-2); border-radius: var(--tm-radius-md, 10px);
      flex-wrap: wrap;
    }
    .seg__btn {
      padding: 7px 15px; border-radius: 8px;
      font-size: 13px; font-weight: 700; color: var(--tm-text-muted);
      background: transparent; cursor: pointer;
    }
    .seg__btn.is-on { background: var(--tm-surface); color: var(--tm-text); box-shadow: var(--tm-shadow-sm); }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 12px;
    }
    .fcard {
      background: var(--tm-surface); border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px); padding: 14px;
    }
    .fcard__head { display: flex; align-items: center; gap: 11px; }
    .fcard__logo {
      width: 44px; height: 44px; border-radius: 10px; flex: none; overflow: hidden;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
      border: 1px solid var(--tm-line);
    }
    .fcard__logo img { width: 100%; height: 100%; object-fit: cover; }
    .fcard__id { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .fcard__name { font-size: 14px; font-weight: 800; color: var(--tm-text); }
    .fcard__phone { font-size: 12px; color: var(--tm-text-muted); }
    .fcard__status {
      flex: none; text-transform: capitalize;
      font-size: 10px; font-weight: 800; letter-spacing: 0.3px;
      padding: 3px 8px; border-radius: 999px;
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
    }
    .fcard__status[data-s="active"] { background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .fcard__status[data-s="suspended"] { background: var(--tm-danger-bg, #fee2e2); color: var(--tm-danger-fg, #b91c1c); }
    .fcard__status[data-s="pending"] { background: var(--tm-warning-bg); color: var(--tm-warning-fg); }

    .fcard__rows {
      display: flex; flex-direction: column; gap: 6px;
      border-top: 1px solid var(--tm-line); margin-top: 12px; padding-top: 10px;
    }
    .fcard__row { display: flex; gap: 10px; font-size: 12px; }
    .fcard__k { width: 64px; flex: none; font-weight: 700; color: var(--tm-text-muted); }
    .fcard__v { color: var(--tm-text); min-width: 0; }
    .fcard__foot { display: flex; justify-content: flex-end; gap: 6px; margin-top: 12px; }

    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 7px;
      background: var(--tm-canvas-2); color: var(--tm-text-muted); cursor: pointer;
    }
    .icon-btn:hover { background: var(--tm-ink); color: #fff; }
    .icon-btn--danger:hover { background: var(--tm-danger, #ef4444); }

    .form { display: flex; flex-direction: column; gap: 14px; }
    .field { display: flex; flex-direction: column; gap: 5px; }
    .field__lbl { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .field__lbl i { color: var(--tm-danger, #ef4444); font-style: normal; }
    .field input[type=text], .field textarea, .field select {
      width: 100%; padding: 9px 11px;
      border: 1px solid var(--tm-line); border-radius: 9px;
      background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13px; outline: none; font-family: inherit;
    }
    .field input:focus, .field textarea:focus, .field select:focus { border-color: var(--tm-green); }
    .field textarea { resize: vertical; }
    .field__err { font-size: 11px; font-weight: 600; color: var(--tm-danger, #ef4444); }
    .upload {
      display: inline-flex; align-items: center; gap: 6px; justify-content: center;
      padding: 8px 12px; border-radius: 8px;
      background: var(--tm-canvas-2); color: var(--tm-text);
      font-size: 12px; font-weight: 700; cursor: pointer; width: fit-content;
    }
    .upload:hover { background: var(--tm-line); }
    .preview { width: 96px; height: 96px; object-fit: cover; border-radius: 9px; border: 1px solid var(--tm-line); margin-top: 4px; }
    .toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--tm-text); }
    .toggle input { width: 16px; height: 16px; }
  `],
})
export class FleetsSettingsComponent implements OnInit, OnDestroy {
  fleets: Fleet[] = [];
  cityId: number | null = null;
  cityName = '';

  filterStatus: string | null = null;
  statusOptions = STATUS_OPTIONS;

  open = false;
  editingId: number | null = null;
  saving = false;
  deleteTarget: Fleet | null = null;

  form = this.blankForm();
  touched = { name: false, phone: false };
  logoFile: File | null = null;
  logoPreview: string | null = null;

  private subs: Subscription[] = [];

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.subs.push(
      this.cityCtx.cityId$.subscribe((id) => {
        this.cityId = id;
        this.fetchFleets();
      }),
      this.cityCtx.cities$.subscribe((list) => {
        this.cityName = list.find((c) => c.id === this.cityId)?.name ?? '';
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  setStatus(s: string | null): void {
    if (this.filterStatus === s) return;
    this.filterStatus = s;
    this.fetchFleets();
  }

  blankForm() {
    return {
      name: '',
      phone_number: '',
      bank: '',
      address: '',
      vat_enabled: false,
      vat_number: '',
      status: 'active',
      is_active: true,
    };
  }

  fetchFleets(): void {
    if (this.cityId == null) {
      this.fleets = [];
      return;
    }
    const params = new URLSearchParams();
    params.set('city_id', String(this.cityId));
    if (this.filterStatus) params.set('status', this.filterStatus);
    this.api.get<{ data: Fleet[] }>(`/admin/fleets?${params.toString()}`).subscribe({
      next: (res) => (this.fleets = res?.data || []),
      error: (err) => this.toast.error(err?.error?.message || 'Failed to load fleets'),
    });
  }

  openCreate(): void {
    this.editingId = null;
    this.form = this.blankForm();
    this.touched = { name: false, phone: false };
    this.logoFile = null;
    this.logoPreview = null;
    this.open = true;
  }

  openEdit(f: Fleet): void {
    this.editingId = f.id;
    this.touched = { name: false, phone: false };
    this.form = {
      name: f.name,
      phone_number: f.phone_number || '',
      bank: f.bank || '',
      address: f.address || '',
      vat_enabled: f.vat_enabled,
      vat_number: f.vat_number || '',
      status: f.status || 'active',
      is_active: f.is_active,
    };
    this.logoFile = null;
    this.logoPreview = f.logo_url;
    this.open = true;
  }

  onLogo(ev: Event): void {
    const file = (ev.target as HTMLInputElement).files?.[0];
    this.logoFile = file ?? null;
    if (file) {
      const reader = new FileReader();
      reader.onload = () => (this.logoPreview = reader.result as string);
      reader.readAsDataURL(file);
    }
  }

  get formValid(): boolean {
    return !!this.form.name.trim() && !!this.form.phone_number.trim();
  }

  submit(): void {
    this.touched = { name: true, phone: true };
    if (!this.formValid || this.saving || this.cityId == null) return;

    const fd = new FormData();
    if (this.editingId) fd.append('_method', 'PATCH');
    fd.append('city_id', String(this.cityId));
    fd.append('name', this.form.name.trim());
    fd.append('phone_number', this.form.phone_number.trim());
    if (this.form.bank) fd.append('bank', this.form.bank);
    if (this.form.address) fd.append('address', this.form.address);
    fd.append('vat_enabled', this.form.vat_enabled ? '1' : '0');
    if (this.form.vat_enabled && this.form.vat_number) {
      fd.append('vat_number', this.form.vat_number);
    }
    fd.append('status', this.form.status);
    fd.append('is_active', this.form.is_active ? '1' : '0');
    if (this.logoFile) fd.append('logo', this.logoFile);

    this.saving = true;
    const path = this.editingId ? `/admin/fleets/${this.editingId}` : '/admin/fleets';
    this.api.postMultipart<{ fleet: Fleet }>(path, fd).subscribe({
      next: () => {
        this.saving = false;
        this.open = false;
        this.toast.success(this.editingId ? 'Fleet updated' : 'Fleet created');
        this.fetchFleets();
      },
      error: (err) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Save failed');
      },
    });
  }

  confirmDelete(): void {
    const f = this.deleteTarget;
    if (!f || this.saving) return;
    this.saving = true;
    this.api.delete(`/admin/fleets/${f.id}`).subscribe({
      next: () => {
        this.saving = false;
        this.deleteTarget = null;
        this.toast.success('Fleet deleted');
        this.fetchFleets();
      },
      error: (err) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Delete failed');
      },
    });
  }
}
