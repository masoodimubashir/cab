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

type MeterType = 'rides' | 'days' | 'daily' | 'earnings';
type PlanType = 'normal' | 'new_registration' | 'renewal' | 'targeted';

interface SubscriptionPlan {
  id: number;
  city_id: number;
  vehicle_type_id: number | null;
  vehicle_type_name: string | null;
  title: string;
  subtitle: string | null;
  amount: number;
  commission_percent: number;
  meter_type: MeterType;
  rides_count: number | null;
  days_count: number | null;
  earnings_threshold: number | null;
  plan_type: PlanType;
  terms: string | null;
  available_from: string | null;
  available_to: string | null;
  is_active: boolean;
  active_subscribers_count: number;
}

interface VehicleTypeOption {
  id: number;
  name: string;
}

type StatusFilter = 'all' | 'active' | 'inactive';

const METER_OPTIONS: { label: string; value: MeterType }[] = [
  { label: 'Based on ride count', value: 'rides' },
  { label: 'Based on duration', value: 'days' },
  { label: 'Based on daily subscription', value: 'daily' },
  { label: 'Based on earnings', value: 'earnings' },
];

const PLAN_TYPE_OPTIONS: { label: string; value: PlanType }[] = [
  { label: 'Normal', value: 'normal' },
  { label: 'New Registration', value: 'new_registration' },
  { label: 'Subscription Renewal', value: 'renewal' },
  { label: 'Targeted', value: 'targeted' },
];

/**
 * Subscriptions — driver subscription plans for the city chosen in the topbar
 * switcher. A plan lets a driver pay up front and keep (usually) 100% of their
 * fares for a window metered by rides / days / a daily pass / an earnings cap.
 * Layout mirrors Fleets: tm-data-table with search + filters, a right-side
 * drawer for create/edit, and a confirm modal for delete.
 */
@Component({
  selector: 'app-subscriptions',
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
          <h1 class="page__title">Subscriptions</h1>
          <p class="page__sub">Commission-free driver plans sold in this city.</p>
        </div>
        <tm-button
          *ngIf="cityId != null"
          variant="green" icon="plus"
          (clicked)="openCreate()"
        >Add subscription</tm-button>
      </header>

      <!-- No city -->
      <div class="cue" *ngIf="cityId == null">
        <tm-icon name="map-marker" [size]="24" />
        <p class="cue__title">No city selected</p>
        <p class="cue__text">Pick a city from the switcher in the top bar to manage its subscription plans.</p>
      </div>

      <ng-container *ngIf="cityId != null">
        <tm-data-table
          [rows]="plans"
          [total]="plans.length"
          [loading]="loading"
          emptyTitle="No subscription plans"
          emptyHint="Create a plan, or clear the filters."
        >
          <tm-input
            slot="search"
            icon="search"
            placeholder="Search by title or subtitle."
            [(ngModel)]="search"
            (ngModelChange)="onSearchChange()"
          />

          <ng-container slot="filters">
            <tm-filter-select
              icon="shield"
              ariaLabel="Status filter"
              allLabel="All statuses"
              [options]="statusFilterOptions"
              [value]="status"
              (valueChange)="onStatusChange($event)"
            />
            <tm-filter-select
              icon="bolt"
              ariaLabel="Plan type filter"
              allLabel="All types"
              [options]="meterFilterOptions"
              [value]="meter"
              (valueChange)="onMeterChange($event)"
            />
          </ng-container>

          <ng-container slot="banner">
            <tm-filter-pill *ngIf="search.trim()" icon="search" label="Search" [value]="search" (clear)="clearSearch()" />
            <tm-filter-pill *ngIf="status !== 'all'" icon="shield" label="Status" [value]="statusLabel()" (clear)="clearStatus()" />
            <tm-filter-pill *ngIf="meter !== 'all'" icon="bolt" label="Type" [value]="meterLabel(meter)" (clear)="clearMeter()" />
          </ng-container>

          <!-- ============ Columns ============ -->
          <tm-column key="title" label="Plan">
            <ng-template let-row>
              <div class="cell-id">
                <span class="cell-name">{{ row.title }}</span>
                <span class="cell-sub">{{ row.subtitle || planTypeLabel(row.plan_type) }}</span>
              </div>
            </ng-template>
          </tm-column>

          <tm-column key="meter" label="Type" width="190">
            <ng-template let-row>
              <div class="cell-id">
                <span class="cell-name">{{ meterLabel(row.meter_type) }}</span>
                <span class="cell-sub">{{ limitLabel(row) }}</span>
              </div>
            </ng-template>
          </tm-column>

          <tm-column key="amount" label="Price" width="110">
            <ng-template let-row>
              <span class="cell-amt">₹{{ row.amount | number: '1.0-2' }}</span>
            </ng-template>
          </tm-column>

          <tm-column key="commission" label="Commission" width="120">
            <ng-template let-row>
              <span *ngIf="row.commission_percent > 0">{{ row.commission_percent }}%</span>
              <span *ngIf="row.commission_percent <= 0" class="cell-free">Commission-free</span>
            </ng-template>
          </tm-column>

          <tm-column key="vehicle" label="Vehicle" width="130">
            <ng-template let-row>
              <span *ngIf="row.vehicle_type_name">{{ row.vehicle_type_name }}</span>
              <span *ngIf="!row.vehicle_type_name" class="muted">All vehicles</span>
            </ng-template>
          </tm-column>

          <tm-column key="subscribers" label="Active" width="90" align="right">
            <ng-template let-row>
              <span class="muted">{{ row.active_subscribers_count }}</span>
            </ng-template>
          </tm-column>

          <tm-column key="status" label="Status" width="110">
            <ng-template let-row>
              <span class="status-pill" [attr.data-s]="row.is_active ? 'active' : 'inactive'">
                {{ row.is_active ? 'active' : 'inactive' }}
              </span>
            </ng-template>
          </tm-column>

          <tm-column key="actions" label="" width="100" align="right">
            <ng-template let-row>
              <div class="cell-actions">
                <button class="icon-btn" (click)="openEdit(row)" aria-label="Edit plan">
                  <tm-icon name="edit" [size]="14" />
                </button>
                <button class="icon-btn icon-btn--danger" (click)="deleteTarget = row" aria-label="Delete plan">
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
      [title]="editingId ? 'Edit subscription' : 'Add subscription'"
      [subtitle]="cityName"
      [width]="560"
      (closed)="open = false"
    >
      <div slot="body" class="form">
        <div class="grid2">
          <label class="field">
            <span class="field__lbl">Amount <i>*</i></span>
            <input type="number" min="0" step="0.01" [(ngModel)]="form.amount" (ngModelChange)="touched.amount = true"
                   placeholder="e.g. 49" />
            <span class="field__err" *ngIf="touched.amount && (form.amount == null || form.amount < 0)">Enter a valid amount.</span>
          </label>
          <label class="field">
            <span class="field__lbl">Commission (%)</span>
            <input type="number" min="0" max="100" step="0.01" [(ngModel)]="form.commission_percent"
                   placeholder="0 = commission-free" />
          </label>
        </div>

        <label class="field">
          <span class="field__lbl">Title <i>*</i></span>
          <input type="text" [(ngModel)]="form.title" (ngModelChange)="touched.title = true"
                 placeholder="e.g. Daily Saver" />
          <span class="field__err" *ngIf="touched.title && !form.title.trim()">Title is required.</span>
        </label>

        <label class="field">
          <span class="field__lbl">Subtitle</span>
          <input type="text" [(ngModel)]="form.subtitle" placeholder="Short description shown to the driver" />
        </label>

        <div class="grid2">
          <label class="field">
            <span class="field__lbl">Type <i>*</i></span>
            <select [(ngModel)]="form.meter_type">
              <option *ngFor="let m of meterOptions" [value]="m.value">{{ m.label }}</option>
            </select>
          </label>

          <!-- Conditional limit field driven by Type -->
          <label class="field" *ngIf="form.meter_type === 'rides'">
            <span class="field__lbl">No. of rides <i>*</i></span>
            <input type="number" min="1" [(ngModel)]="form.rides_count" (ngModelChange)="touched.limit = true" />
            <span class="field__err" *ngIf="touched.limit && !form.rides_count">Required.</span>
          </label>
          <label class="field" *ngIf="form.meter_type === 'days'">
            <span class="field__lbl">No. of days <i>*</i></span>
            <input type="number" min="1" [(ngModel)]="form.days_count" (ngModelChange)="touched.limit = true" />
            <span class="field__err" *ngIf="touched.limit && !form.days_count">Required.</span>
          </label>
          <label class="field" *ngIf="form.meter_type === 'daily'">
            <span class="field__lbl">No. of days</span>
            <input type="number" [value]="1" disabled />
          </label>
          <label class="field" *ngIf="form.meter_type === 'earnings'">
            <span class="field__lbl">Earnings threshold <i>*</i></span>
            <input type="number" min="1" step="0.01" [(ngModel)]="form.earnings_threshold" (ngModelChange)="touched.limit = true" />
            <span class="field__err" *ngIf="touched.limit && !form.earnings_threshold">Required.</span>
          </label>
        </div>

        <div class="grid2">
          <label class="field">
            <span class="field__lbl">Plan type</span>
            <select [(ngModel)]="form.plan_type">
              <option *ngFor="let p of planTypeOptions" [value]="p.value">{{ p.label }}</option>
            </select>
          </label>
          <label class="field">
            <span class="field__lbl">Vehicle type</span>
            <select [(ngModel)]="form.vehicle_type_id">
              <option [ngValue]="null">All vehicle types</option>
              <option *ngFor="let v of vehicleTypes" [ngValue]="v.id">{{ v.name }}</option>
            </select>
          </label>
        </div>

        <div class="grid2">
          <label class="field">
            <span class="field__lbl">Available from</span>
            <input type="date" [(ngModel)]="form.available_from" />
          </label>
          <label class="field">
            <span class="field__lbl">Available to</span>
            <input type="date" [(ngModel)]="form.available_to" />
          </label>
        </div>

        <label class="field">
          <span class="field__lbl">Terms</span>
          <textarea rows="3" [(ngModel)]="form.terms" placeholder="Terms shown before the driver subscribes"></textarea>
        </label>

        <label class="toggle">
          <input type="checkbox" [(ngModel)]="form.is_active" />
          <span>Active (purchasable by drivers)</span>
        </label>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="open = false">Cancel</tm-button>
        <tm-button variant="green" [disabled]="!formValid || saving" (clicked)="submit()">
          {{ saving ? 'Saving…' : editingId ? 'Save changes' : 'Create plan' }}
        </tm-button>
      </div>
    </tm-drawer>

    <!-- Delete confirm -->
    <tm-modal [open]="!!deleteTarget" title="Delete subscription" (closed)="deleteTarget = null">
      <div slot="body">
        <p>Delete plan <strong>{{ deleteTarget?.title }}</strong>? This cannot be undone.</p>
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

    .cell-id { display: flex; flex-direction: column; min-width: 0; }
    .cell-name { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .cell-sub { font-size: 11px; color: var(--tm-text-muted); }
    .cell-amt { font-family: var(--tm-font-mono); font-weight: 700; color: var(--tm-text); }
    .cell-free { color: var(--tm-green-deep); font-weight: 700; font-size: 12px; }

    .status-pill {
      display: inline-flex; align-items: center;
      text-transform: capitalize;
      font-size: 10px; font-weight: 800; letter-spacing: 0.3px;
      padding: 3px 10px; border-radius: var(--tm-radius-pill);
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
    }
    .status-pill[data-s="active"] { background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .status-pill[data-s="inactive"] { background: var(--tm-canvas-2); color: var(--tm-text-muted); }

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
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .field { display: flex; flex-direction: column; gap: 5px; }
    .field__lbl { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .field__lbl i { color: var(--tm-danger, #ef4444); font-style: normal; }
    .field input, .field textarea, .field select {
      width: 100%; padding: 9px 11px;
      border: 1px solid var(--tm-line); border-radius: 9px;
      background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13px; outline: none; font-family: inherit;
    }
    .field input:focus, .field textarea:focus, .field select:focus { border-color: var(--tm-green); }
    .field input:disabled { opacity: 0.6; }
    .field textarea { resize: vertical; }
    .field__err { font-size: 11px; font-weight: 600; color: var(--tm-danger, #ef4444); }
    .toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--tm-text); }
    .toggle input { width: 16px; height: 16px; }
  `],
})
export class SubscriptionsComponent implements OnInit, OnDestroy {
  plans: SubscriptionPlan[] = [];
  vehicleTypes: VehicleTypeOption[] = [];
  loading = false;
  cityId: number | null = null;
  cityName = '';

  // ── Filter state ────────────────────────────────────────────────
  search = '';
  status: StatusFilter = 'all';
  meter: MeterType | 'all' = 'all';

  meterOptions = METER_OPTIONS;
  planTypeOptions = PLAN_TYPE_OPTIONS;
  statusFilterOptions: { label: string; value: string }[] = [
    { label: 'Active', value: 'active' },
    { label: 'Inactive', value: 'inactive' },
  ];
  get meterFilterOptions(): { label: string; value: string }[] {
    return METER_OPTIONS.map((m) => ({ label: m.label, value: m.value }));
  }

  // ── Drawer / delete state ───────────────────────────────────────
  open = false;
  editingId: number | null = null;
  saving = false;
  deleteTarget: SubscriptionPlan | null = null;

  form = this.blankForm();
  touched = { title: false, amount: false, limit: false };

  private subs: Subscription[] = [];
  private searchDebounce: any = null;

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.loadVehicleTypes();
    this.subs.push(
      this.cityCtx.cityId$.subscribe((id) => {
        this.cityId = id;
        this.fetchPlans();
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
  loadVehicleTypes(): void {
    this.api.get<{ data: VehicleTypeOption[] }>('/admin/vehicle-types-global?active_only=1').subscribe({
      next: (res) => (this.vehicleTypes = res?.data || []),
      error: () => (this.vehicleTypes = []),
    });
  }

  fetchPlans(): void {
    if (this.cityId == null) {
      this.plans = [];
      return;
    }
    const params = new URLSearchParams();
    if (this.status !== 'all') params.set('is_active', this.status === 'active' ? '1' : '0');
    if (this.meter !== 'all') params.set('meter_type', this.meter);
    const q = this.search.trim();
    if (q) params.set('q', q);

    this.loading = true;
    const qs = params.toString();
    this.api.get<{ data: SubscriptionPlan[] }>(`/admin/cities/${this.cityId}/subscription-plans${qs ? '?' + qs : ''}`).subscribe({
      next: (res) => {
        this.plans = res?.data || [];
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.toast.error(err?.error?.message || 'Failed to load subscription plans');
      },
    });
  }

  // ── Filter handlers ─────────────────────────────────────────────
  onSearchChange(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => this.fetchPlans(), 300);
  }
  clearSearch(): void {
    if (!this.search) return;
    this.search = '';
    this.fetchPlans();
  }

  statusLabel(): string {
    if (this.status === 'all') return 'All statuses';
    return this.status === 'active' ? 'Active' : 'Inactive';
  }
  onStatusChange(value: string): void {
    this.status = value as StatusFilter;
    this.fetchPlans();
  }
  clearStatus(): void {
    if (this.status === 'all') return;
    this.status = 'all';
    this.fetchPlans();
  }

  onMeterChange(value: string): void {
    this.meter = value as MeterType | 'all';
    this.fetchPlans();
  }
  clearMeter(): void {
    if (this.meter === 'all') return;
    this.meter = 'all';
    this.fetchPlans();
  }

  // ── Display helpers ─────────────────────────────────────────────
  meterLabel(m: MeterType | 'all'): string {
    return METER_OPTIONS.find((o) => o.value === m)?.label ?? 'All types';
  }
  planTypeLabel(p: PlanType): string {
    return PLAN_TYPE_OPTIONS.find((o) => o.value === p)?.label ?? '';
  }
  limitLabel(row: SubscriptionPlan): string {
    switch (row.meter_type) {
      case 'rides': return `${row.rides_count ?? 0} rides`;
      case 'days': return `${row.days_count ?? 0} days`;
      case 'daily': return 'Per-day pass';
      case 'earnings': return `Up to ₹${row.earnings_threshold ?? 0}`;
      default: return '';
    }
  }

  // ── Drawer / form ───────────────────────────────────────────────
  blankForm() {
    return {
      title: '',
      subtitle: '',
      amount: null as number | null,
      commission_percent: 0 as number | null,
      meter_type: 'daily' as MeterType,
      rides_count: null as number | null,
      days_count: null as number | null,
      earnings_threshold: null as number | null,
      plan_type: 'normal' as PlanType,
      vehicle_type_id: null as number | null,
      terms: '',
      available_from: '' as string | null,
      available_to: '' as string | null,
      is_active: true,
    };
  }

  openCreate(): void {
    this.editingId = null;
    this.form = this.blankForm();
    this.touched = { title: false, amount: false, limit: false };
    this.open = true;
  }

  openEdit(p: SubscriptionPlan): void {
    this.editingId = p.id;
    this.touched = { title: false, amount: false, limit: false };
    this.form = {
      title: p.title,
      subtitle: p.subtitle || '',
      amount: p.amount,
      commission_percent: p.commission_percent,
      meter_type: p.meter_type,
      rides_count: p.rides_count,
      days_count: p.days_count,
      earnings_threshold: p.earnings_threshold,
      plan_type: p.plan_type,
      vehicle_type_id: p.vehicle_type_id,
      terms: p.terms || '',
      available_from: p.available_from || '',
      available_to: p.available_to || '',
      is_active: p.is_active,
    };
    this.open = true;
  }

  get formValid(): boolean {
    if (!this.form.title.trim()) return false;
    if (this.form.amount == null || this.form.amount < 0) return false;
    if (this.form.meter_type === 'rides' && !this.form.rides_count) return false;
    if (this.form.meter_type === 'days' && !this.form.days_count) return false;
    if (this.form.meter_type === 'earnings' && !this.form.earnings_threshold) return false;
    return true;
  }

  submit(): void {
    this.touched = { title: true, amount: true, limit: true };
    if (!this.formValid || this.saving || this.cityId == null) return;

    const f = this.form;
    const body: Record<string, unknown> = {
      title: f.title.trim(),
      subtitle: f.subtitle?.trim() || null,
      amount: f.amount,
      commission_percent: f.commission_percent ?? 0,
      meter_type: f.meter_type,
      plan_type: f.plan_type,
      vehicle_type_id: f.vehicle_type_id,
      terms: f.terms?.trim() || null,
      available_from: f.available_from || null,
      available_to: f.available_to || null,
      is_active: f.is_active,
      // Only the limit field relevant to the chosen meter type.
      rides_count: f.meter_type === 'rides' ? f.rides_count : null,
      days_count: f.meter_type === 'days' ? f.days_count : (f.meter_type === 'daily' ? 1 : null),
      earnings_threshold: f.meter_type === 'earnings' ? f.earnings_threshold : null,
    };

    this.saving = true;
    const base = `/admin/cities/${this.cityId}/subscription-plans`;
    const req = this.editingId
      ? this.api.patch<{ plan: SubscriptionPlan }>(`${base}/${this.editingId}`, body)
      : this.api.post<{ plan: SubscriptionPlan }>(base, body);
    req.subscribe({
      next: () => {
        this.saving = false;
        this.open = false;
        this.toast.success(this.editingId ? 'Subscription updated' : 'Subscription created');
        this.fetchPlans();
      },
      error: (err) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Save failed');
      },
    });
  }

  confirmDelete(): void {
    const p = this.deleteTarget;
    if (!p || this.saving || this.cityId == null) return;
    this.saving = true;
    this.api.delete(`/admin/cities/${this.cityId}/subscription-plans/${p.id}`).subscribe({
      next: () => {
        this.saving = false;
        this.deleteTarget = null;
        this.toast.success('Subscription deleted');
        this.fetchPlans();
      },
      error: (err) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Delete failed');
      },
    });
  }
}
