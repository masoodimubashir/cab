import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
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
  status: string;
  is_active: boolean;
}

type StatusFilter = 'all' | 'active' | 'inactive' | 'suspended' | 'pending';
type VatFilter = 'all' | 'enabled' | 'disabled';

const STATUS_OPTIONS: { label: string; value: Exclude<StatusFilter, 'all'> }[] = [
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
  { label: 'Suspended', value: 'suspended' },
  { label: 'Pending', value: 'pending' },
];

/**
 * Fleets — fleet operators within the city chosen in the topbar switcher.
 * Layout mirrors the Drivers list: tm-data-table with search on the left,
 * filter dropdowns on the right, and a row of dismissable filter pills below.
 * Create/edit uses the shared right-side drawer; delete uses a confirm modal.
 */
@Component({
  selector: 'app-fleets-settings',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonComponent, ColumnComponent, DataTableComponent,
    DrawerComponent, FilterPillComponent, FilterSelectComponent,
    IconComponent, InputComponent, ModalComponent,
  ],
  template: `
    <div class="page">
      <header class="page__hero">
        <div>
          <h1 class="page__title">Fleets</h1>
          <p class="page__sub">Fleet operators that own vehicles in this city.</p>
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
        <tm-data-table
          [rows]="fleets"
          [total]="fleets.length"
          [loading]="loading"
          emptyTitle="No fleets"
          emptyHint="Try a different search, or clear the filters."
        >
          <!-- Toolbar: search on the LEFT -->
          <tm-input
            slot="search"
            icon="search"
            placeholder="Search by name, phone, bank or VAT no."
            [(ngModel)]="search"
            (ngModelChange)="onSearchChange()"
          />

          <!-- Toolbar: filters on the RIGHT -->
          <ng-container slot="filters">
            <tm-filter-select
              icon="shield"
              ariaLabel="Status filter"
              allLabel="All statuses"
              [options]="statusOptions"
              [value]="status"
              (valueChange)="onStatusChange($event)"
            />
            <tm-filter-select
              icon="tag"
              ariaLabel="VAT filter"
              allLabel="Any VAT"
              [options]="vatFilterOptions"
              [value]="vat"
              (valueChange)="onVatChange($event)"
            />
          </ng-container>

          <!-- Active filter pills below the toolbar -->
          <ng-container slot="banner">
            <tm-filter-pill *ngIf="search.trim()" icon="search" label="Search" [value]="search" (clear)="clearSearch()" />
            <tm-filter-pill *ngIf="status !== 'all'" icon="shield" label="Status" [value]="statusLabel()" (clear)="clearStatus()" />
            <tm-filter-pill *ngIf="vat !== 'all'" icon="tag" label="VAT" [value]="vatLabel()" (clear)="clearVat()" />
          </ng-container>

          <!-- ============ Columns ============ -->
          <tm-column key="name" label="Fleet">
            <ng-template let-row>
              <div class="cell-fleet">
                <div class="cell-id">
                  <span class="cell-name">{{ row.name }}</span>
                  <span class="cell-sub">{{ row.phone_number || 'No phone' }}</span>
                </div>
              </div>
            </ng-template>
          </tm-column>

          <tm-column key="status" label="Status" width="120">
            <ng-template let-row>
              <span class="status-pill" [attr.data-s]="row.status">{{ row.status }}</span>
            </ng-template>
          </tm-column>

          <tm-column key="vat" label="VAT" width="160">
            <ng-template let-row>
              <span *ngIf="row.vat_enabled" class="cell-vat">
                <tm-icon name="check" [size]="12" />
                <span class="cell-vat__num">{{ row.vat_number || 'Enabled' }}</span>
              </span>
              <span *ngIf="!row.vat_enabled" class="muted">Not enabled</span>
            </ng-template>
          </tm-column>

          <tm-column key="bank" label="Bank">
            <ng-template let-row>
              <span *ngIf="row.bank">{{ row.bank }}</span>
              <span *ngIf="!row.bank" class="muted">—</span>
            </ng-template>
          </tm-column>

          <tm-column key="address" label="Address" [wrap]="true">
            <ng-template let-row>
              <span *ngIf="row.address" class="cell-addr">{{ row.address }}</span>
              <span *ngIf="!row.address" class="muted">—</span>
            </ng-template>
          </tm-column>

          <tm-column key="actions" label="" width="100" align="right">
            <ng-template let-row>
              <div class="cell-actions">
                <button class="icon-btn" (click)="openEdit(row)" aria-label="Edit fleet">
                  <tm-icon name="edit" [size]="14" />
                </button>
                <button class="icon-btn icon-btn--danger" (click)="deleteTarget = row" aria-label="Delete fleet">
                  <tm-icon name="trash" [size]="14" />
                </button>
              </div>
            </ng-template>
          </tm-column>
        </tm-data-table>
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
    .page { display: flex; flex-direction: column; gap: 16px; }
    .page__hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .page__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .page__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); }

    .cue {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 48px 24px; text-align: center;
      background: var(--tm-surface); border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg); color: var(--tm-text-muted);
    }
    .cue__title { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .cue__text { margin: 0; font-size: 13px; }

    /* Filter dropdowns + active-filter pills now use the shared
       tm-filter-select / tm-filter-pill primitives. */

    /* ---------- Cell renderers ---------- */
    .cell-fleet { display: inline-flex; align-items: center; min-width: 0; }
    .cell-id { display: flex; flex-direction: column; min-width: 0; }
    .cell-name { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .cell-sub { font-size: 11px; color: var(--tm-text-muted); }

    .status-pill {
      display: inline-flex; align-items: center;
      text-transform: capitalize;
      font-size: 10px; font-weight: 800; letter-spacing: 0.3px;
      padding: 3px 10px; border-radius: var(--tm-radius-pill);
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
    }
    .status-pill[data-s="active"] { background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .status-pill[data-s="suspended"] { background: var(--tm-danger-bg, #fee2e2); color: var(--tm-danger-fg, #b91c1c); }
    .status-pill[data-s="pending"] { background: var(--tm-warning-bg); color: var(--tm-warning-fg); }

    .cell-vat {
      display: inline-flex; align-items: center; gap: 6px;
      color: var(--tm-green-deep);
      font-family: var(--tm-font-mono);
      font-size: 12px; font-weight: 700;
    }
    .cell-vat__num { color: var(--tm-text); }

    .cell-addr {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      font-size: 12px;
      color: var(--tm-text);
    }

    .muted { color: var(--tm-text-muted); font-size: 12px; }

    .cell-actions { display: inline-flex; gap: 6px; }
    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 7px;
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
      cursor: pointer; border: 0;
    }
    .icon-btn:hover { background: var(--tm-ink); color: #fff; }
    .icon-btn--danger:hover { background: var(--tm-danger, #ef4444); }

    /* ---------- Drawer form ---------- */
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
    .toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--tm-text); }
    .toggle input { width: 16px; height: 16px; }
  `],
})
export class FleetsSettingsComponent implements OnInit, OnDestroy {
  fleets: Fleet[] = [];
  loading = false;
  cityId: number | null = null;
  cityName = '';

  // ── Filter state ────────────────────────────────────────────────
  search = '';
  status: StatusFilter = 'all';
  vat: VatFilter = 'all';

  statusOptions = STATUS_OPTIONS;
  vatOptions: { label: string; value: VatFilter }[] = [
    { label: 'Any VAT', value: 'all' },
    { label: 'VAT enabled', value: 'enabled' },
    { label: 'VAT disabled', value: 'disabled' },
  ];

  // Filter-select options exclude the "all" entry — the component renders it.
  get vatFilterOptions(): { label: string; value: string }[] {
    return this.vatOptions.filter((o) => o.value !== 'all');
  }

  // ── Drawer / delete state ───────────────────────────────────────
  open = false;
  editingId: number | null = null;
  saving = false;
  deleteTarget: Fleet | null = null;

  form = this.blankForm();
  touched = { name: false, phone: false };

  private subs: Subscription[] = [];
  private searchDebounce: any = null;

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
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
  }

  // ── Fetch ───────────────────────────────────────────────────────
  fetchFleets(): void {
    if (this.cityId == null) {
      this.fleets = [];
      return;
    }
    const params = new URLSearchParams();
    params.set('city_id', String(this.cityId));
    if (this.status !== 'all') params.set('status', this.status);
    if (this.vat !== 'all') params.set('vat', this.vat);
    const q = this.search.trim();
    if (q) params.set('q', q);

    this.loading = true;
    this.api.get<{ data: Fleet[] }>(`/admin/fleets?${params.toString()}`).subscribe({
      next: (res) => {
        this.fleets = res?.data || [];
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.toast.error(err?.error?.message || 'Failed to load fleets');
      },
    });
  }

  // ── Filter handlers ─────────────────────────────────────────────
  onSearchChange(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => this.fetchFleets(), 300);
  }

  clearSearch(): void {
    if (!this.search) return;
    this.search = '';
    this.fetchFleets();
  }

  statusLabel(): string {
    if (this.status === 'all') return 'All statuses';
    return this.statusOptions.find((o) => o.value === this.status)?.label ?? 'All statuses';
  }
  onStatusChange(value: string): void {
    this.status = value as StatusFilter;
    this.fetchFleets();
  }
  clearStatus(): void {
    if (this.status === 'all') return;
    this.status = 'all';
    this.fetchFleets();
  }

  vatLabel(): string {
    return this.vatOptions.find((o) => o.value === this.vat)?.label ?? 'Any VAT';
  }
  onVatChange(value: string): void {
    this.vat = value as VatFilter;
    this.fetchFleets();
  }
  clearVat(): void {
    if (this.vat === 'all') return;
    this.vat = 'all';
    this.fetchFleets();
  }

  // ── Drawer / form ───────────────────────────────────────────────
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

  openCreate(): void {
    this.editingId = null;
    this.form = this.blankForm();
    this.touched = { name: false, phone: false };
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
    this.open = true;
  }

  get formValid(): boolean {
    return !!this.form.name.trim() && !!this.form.phone_number.trim();
  }

  submit(): void {
    this.touched = { name: true, phone: true };
    if (!this.formValid || this.saving || this.cityId == null) return;

    const payload = {
      city_id: this.cityId,
      name: this.form.name.trim(),
      phone_number: this.form.phone_number.trim(),
      bank: this.form.bank || null,
      address: this.form.address || null,
      vat_enabled: this.form.vat_enabled,
      vat_number: this.form.vat_enabled && this.form.vat_number ? this.form.vat_number : null,
      status: this.form.status,
    };

    this.saving = true;
    const request = this.editingId
      ? this.api.patch<{ fleet: Fleet }>(`/admin/fleets/${this.editingId}`, payload)
      : this.api.post<{ fleet: Fleet }>('/admin/fleets', payload);
    request.subscribe({
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
