import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
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
  logo_path: string | null;
  logo_url: string | null;
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
    DrawerComponent, IconComponent, InputComponent, ModalComponent,
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
            <!-- Status dropdown -->
            <div class="state-select" [class.has-value]="status !== 'all'" [class.is-open]="statusOpen">
              <button
                type="button"
                class="state-select__trigger"
                (click)="toggleStatusMenu($event)"
                [attr.aria-expanded]="statusOpen"
                aria-haspopup="listbox"
                aria-label="Status filter"
              >
                <span class="state-select__icon" aria-hidden="true">
                  <tm-icon name="shield" [size]="14" />
                </span>
                <span class="state-select__value">{{ statusLabel() }}</span>
                <tm-icon name="chevron-down" [size]="12" class="state-select__caret" />
              </button>
              <ul
                class="state-select__menu"
                *ngIf="statusOpen"
                role="listbox"
                (click)="$event.stopPropagation()"
              >
                <li
                  class="state-select__option"
                  [class.is-selected]="status === 'all'"
                  role="option"
                  [attr.aria-selected]="status === 'all'"
                  (click)="selectStatus('all')"
                >
                  <tm-icon *ngIf="status === 'all'" name="check" [size]="12" class="state-select__option-check" />
                  <span class="state-select__option-label">All statuses</span>
                </li>
                <li
                  *ngFor="let opt of statusOptions"
                  class="state-select__option"
                  [class.is-selected]="status === opt.value"
                  role="option"
                  [attr.aria-selected]="status === opt.value"
                  (click)="selectStatus(opt.value)"
                >
                  <tm-icon *ngIf="status === opt.value" name="check" [size]="12" class="state-select__option-check" />
                  <span class="state-select__option-label">{{ opt.label }}</span>
                </li>
              </ul>
            </div>

            <!-- VAT dropdown -->
            <div class="state-select" [class.has-value]="vat !== 'all'" [class.is-open]="vatOpen">
              <button
                type="button"
                class="state-select__trigger"
                (click)="toggleVatMenu($event)"
                [attr.aria-expanded]="vatOpen"
                aria-haspopup="listbox"
                aria-label="VAT filter"
              >
                <span class="state-select__icon" aria-hidden="true">
                  <tm-icon name="tag" [size]="14" />
                </span>
                <span class="state-select__value">{{ vatLabel() }}</span>
                <tm-icon name="chevron-down" [size]="12" class="state-select__caret" />
              </button>
              <ul
                class="state-select__menu"
                *ngIf="vatOpen"
                role="listbox"
                (click)="$event.stopPropagation()"
              >
                <li
                  *ngFor="let opt of vatOptions"
                  class="state-select__option"
                  [class.is-selected]="vat === opt.value"
                  role="option"
                  [attr.aria-selected]="vat === opt.value"
                  (click)="selectVat(opt.value)"
                >
                  <tm-icon *ngIf="vat === opt.value" name="check" [size]="12" class="state-select__option-check" />
                  <span class="state-select__option-label">{{ opt.label }}</span>
                </li>
              </ul>
            </div>
          </ng-container>

          <!-- Active filter pills below the toolbar -->
          <ng-container slot="banner">
            <span class="filter-pill" *ngIf="search.trim()">
              <span class="filter-pill__icon"><tm-icon name="search" [size]="11" /></span>
              <span class="filter-pill__label">Search</span>
              <span class="filter-pill__value">{{ search }}</span>
              <button type="button" class="filter-pill__close" (click)="clearSearch()" aria-label="Clear search">
                <tm-icon name="x" [size]="12" />
              </button>
            </span>
            <span class="filter-pill" *ngIf="status !== 'all'">
              <span class="filter-pill__icon"><tm-icon name="shield" [size]="11" /></span>
              <span class="filter-pill__label">Status</span>
              <span class="filter-pill__value">{{ statusLabel() }}</span>
              <button type="button" class="filter-pill__close" (click)="clearStatus()" aria-label="Clear status filter">
                <tm-icon name="x" [size]="12" />
              </button>
            </span>
            <span class="filter-pill" *ngIf="vat !== 'all'">
              <span class="filter-pill__icon"><tm-icon name="tag" [size]="11" /></span>
              <span class="filter-pill__label">VAT</span>
              <span class="filter-pill__value">{{ vatLabel() }}</span>
              <button type="button" class="filter-pill__close" (click)="clearVat()" aria-label="Clear VAT filter">
                <tm-icon name="x" [size]="12" />
              </button>
            </span>
          </ng-container>

          <!-- ============ Columns ============ -->
          <tm-column key="name" label="Fleet">
            <ng-template let-row>
              <div class="cell-fleet">
                <span class="cell-logo">
                  <img *ngIf="row.logo_url" [src]="row.logo_url" alt="" />
                  <tm-icon *ngIf="!row.logo_url" name="car" [size]="16" />
                </span>
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

    /* ---------- Custom state-select dropdown (button + popover) ---------- */
    .state-select { position: relative; display: inline-block; }
    .state-select__trigger {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 9px 14px;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      background: transparent;
      font-family: var(--tm-font-body);
      font-size: 13px; font-weight: 700;
      color: var(--tm-text);
      cursor: pointer;
      line-height: 1.2;
      transition: border-color var(--tm-duration-fast) var(--tm-ease),
                  background var(--tm-duration-fast) var(--tm-ease);
    }
    .state-select__trigger:hover { border-color: var(--tm-ink); }
    .state-select.is-open .state-select__trigger { border-color: var(--tm-ink); }
    .state-select.has-value .state-select__trigger {
      background: var(--tm-green-tint);
      border-color: var(--tm-green-deep);
    }
    .state-select__icon { color: var(--tm-text-muted); display: inline-flex; }
    .state-select.has-value .state-select__icon { color: var(--tm-green-deep); }
    .state-select__value { min-width: 110px; text-align: left; }
    .state-select__caret {
      color: var(--tm-text-soft);
      transition: transform var(--tm-duration-fast) var(--tm-ease);
    }
    .state-select.is-open .state-select__caret { transform: rotate(180deg); }
    .state-select.has-value .state-select__caret { color: var(--tm-green-deep); }

    .state-select__menu {
      position: absolute; top: calc(100% + 6px); left: 0; right: 0;
      min-width: 180px; margin: 0; padding: 6px;
      list-style: none;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      box-shadow: var(--tm-shadow-pop);
      z-index: 1100;
      animation: state-select-in 140ms var(--tm-ease) both;
    }
    @keyframes state-select-in {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .state-select__option {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; border-radius: var(--tm-radius-sm);
      font-size: 12px; font-weight: 600; color: var(--tm-text);
      cursor: pointer;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .state-select__option:hover { background: var(--tm-canvas-2); }
    .state-select__option.is-selected {
      background: var(--tm-green-tint);
      color: var(--tm-green-deep);
      font-weight: 700;
    }
    .state-select__option-check { color: var(--tm-green-deep); flex-shrink: 0; }
    .state-select__option-label { flex: 1; }

    /* ---------- Filter pills (below toolbar) ---------- */
    .filter-pill {
      display: inline-flex; align-items: center; gap: 8px;
      margin-right: 8px;
      padding: 6px 6px 6px 12px;
      border-radius: var(--tm-radius-pill);
      background: var(--tm-surface);
      border: 1px solid var(--tm-line-2);
      font-size: 12px; font-weight: 700;
      color: var(--tm-text);
    }
    .filter-pill__icon { display: inline-flex; color: var(--tm-text-muted); }
    .filter-pill__label {
      font-size: 10px; font-weight: 800;
      letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--tm-text-muted);
    }
    .filter-pill__value {
      font-family: var(--tm-font-mono);
      font-weight: 700;
      color: var(--tm-text);
    }
    .filter-pill__close {
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px;
      border-radius: 50%;
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .filter-pill__close:hover { background: var(--tm-ink); color: #fff; }

    /* ---------- Cell renderers ---------- */
    .cell-fleet { display: inline-flex; align-items: center; gap: 10px; min-width: 0; }
    .cell-logo {
      width: 36px; height: 36px; border-radius: 9px; flex: none; overflow: hidden;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
      border: 1px solid var(--tm-line);
    }
    .cell-logo img { width: 100%; height: 100%; object-fit: cover; }
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
  loading = false;
  cityId: number | null = null;
  cityName = '';

  // ── Filter state ────────────────────────────────────────────────
  search = '';
  status: StatusFilter = 'all';
  vat: VatFilter = 'all';
  statusOpen = false;
  vatOpen = false;

  statusOptions = STATUS_OPTIONS;
  vatOptions: { label: string; value: VatFilter }[] = [
    { label: 'Any VAT', value: 'all' },
    { label: 'VAT enabled', value: 'enabled' },
    { label: 'VAT disabled', value: 'disabled' },
  ];

  // ── Drawer / delete state ───────────────────────────────────────
  open = false;
  editingId: number | null = null;
  saving = false;
  deleteTarget: Fleet | null = null;

  form = this.blankForm();
  touched = { name: false, phone: false };
  logoFile: File | null = null;
  logoPreview: string | null = null;

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
  toggleStatusMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.vatOpen = false;
    this.statusOpen = !this.statusOpen;
  }
  selectStatus(value: StatusFilter): void {
    this.statusOpen = false;
    if (this.status === value) return;
    this.status = value;
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
  toggleVatMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.statusOpen = false;
    this.vatOpen = !this.vatOpen;
  }
  selectVat(value: VatFilter): void {
    this.vatOpen = false;
    if (this.vat === value) return;
    this.vat = value;
    this.fetchFleets();
  }
  clearVat(): void {
    if (this.vat === 'all') return;
    this.vat = 'all';
    this.fetchFleets();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.statusOpen) this.statusOpen = false;
    if (this.vatOpen) this.vatOpen = false;
  }

  @HostListener('document:keydown.escape')
  onDocumentEscape(): void {
    if (this.statusOpen) this.statusOpen = false;
    if (this.vatOpen) this.vatOpen = false;
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
