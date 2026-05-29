import { Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { GoogleMapsLoaderService } from '../../core/google-maps-loader.service';
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

interface VehicleTypeOption {
  id: number;
  display_name?: string;
  name?: string;
}

interface PromotionRow {
  id: number;
  title: string;
  benefit_type: string;
  promo_type: string;
  location_type: string | null;
  location_name: string | null;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
  discount_type: string;
  discount_value: number;
  discount_maximum: number | null;
  start_date: string;
  end_date: string;
  maximum_allowed: number | null;
  per_user_limit: number | null;
  per_day_limit: number | null;
  allowed_vehicle_type_ids: number[];
  terms_and_conditions: string | null;
  is_active: boolean;
}

const PROMO_TYPES = [
  { label: 'Location insensitive', value: 'location_insensitive' },
  { label: 'Location sensitive', value: 'location_sensitive' },
  { label: 'QR code booking', value: 'qr_code_booking' },
];

/** City-wide promotions for the city chosen in the topbar switcher. */
@Component({
  selector: 'app-city-wide-promotions',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonComponent, ColumnComponent, DataTableComponent,
    DrawerComponent, FilterPillComponent, FilterSelectComponent,
    IconComponent, InputComponent, ModalComponent, StatusPillComponent,
  ],
  template: `
    <div class="cwp">
      <header class="cwp__head">
        <div>
          <h1 class="cwp__title">City-Wide Promotions</h1>
          <p class="cwp__sub">Bulk discount campaigns running across this city.</p>
        </div>
        <tm-button variant="green" icon="plus" [disabled]="cityId == null" (clicked)="openCreate()">
          Add promotion
        </tm-button>
      </header>

      <div class="cue" *ngIf="cityId == null">
        <tm-icon name="map-marker" [size]="24" />
        <p class="cue__title">No city selected</p>
        <p class="cue__text">Pick a city from the switcher in the top bar to manage promotions.</p>
      </div>

      <tm-data-table
        *ngIf="cityId != null"
        [rows]="rows"
        [total]="total"
        [page]="currentPage"
        [pageSize]="perPage"
        [loading]="loading"
        emptyTitle="No promotions found"
        emptyHint="Try a different search, or clear the filters."
        (pageChange)="onPage($event)"
        (pageSizeChange)="onPageSize($event)"
      >
        <tm-input
          slot="search"
          icon="search"
          placeholder="Search by title"
          [ngModel]="searchQuery"
          (ngModelChange)="onSearchChange($event)"
        />

        <ng-container slot="filters">
          <tm-filter-select
            icon="bolt"
            ariaLabel="Status filter"
            allLabel="Active"
            allValue="active"
            [options]="statusOptions"
            [value]="status"
            (valueChange)="onStatusChange($event)"
          />
        </ng-container>

        <ng-container slot="banner">
          <tm-filter-pill *ngIf="searchQuery.trim()" icon="search" label="Search" [value]="searchQuery" (clear)="clearSearch()" />
          <tm-filter-pill *ngIf="status !== 'active'" icon="bolt" label="Status" [value]="statusLabel()" (clear)="clearStatus()" />
        </ng-container>

        <tm-column key="title" label="Title">
          <ng-template let-row><span class="cell-strong">{{ row.title }}</span></ng-template>
        </tm-column>
        <tm-column key="promo_type" label="Type" width="150">
          <ng-template let-row>{{ humanPromoType(row.promo_type) }}</ng-template>
        </tm-column>
        <tm-column key="discount" label="Discount" width="160">
          <ng-template let-row>
            <span class="cell-strong">{{ row.discount_value }}{{ row.discount_type === 'percentage' ? '%' : '' }} off</span>
            <span class="muted" *ngIf="row.discount_maximum"> · max {{ row.discount_maximum }}</span>
          </ng-template>
        </tm-column>
        <tm-column key="dates" label="Dates" width="180">
          <ng-template let-row>
            <ng-container *ngIf="row.start_date || row.end_date; else noDates">
              {{ row.start_date || '—' }} → {{ row.end_date || '—' }}
            </ng-container>
            <ng-template #noDates><span class="muted">Always</span></ng-template>
          </ng-template>
        </tm-column>
        <tm-column key="limits" label="Limits" [wrap]="true">
          <ng-template let-row>
            <span class="tagx" *ngIf="row.per_user_limit != null">{{ row.per_user_limit }}/user</span>
            <span class="tagx" *ngIf="row.per_day_limit != null">{{ row.per_day_limit }}/day</span>
            <span class="tagx" *ngIf="row.maximum_allowed != null">{{ row.maximum_allowed }} total</span>
            <span class="muted" *ngIf="row.per_user_limit == null && row.per_day_limit == null && row.maximum_allowed == null">—</span>
          </ng-template>
        </tm-column>
        <tm-column key="location" label="Location">
          <ng-template let-row>
            <span *ngIf="row.location_name; else noLoc" class="cell-loc"><tm-icon name="pin" [size]="12" /> {{ row.location_name }}</span>
            <ng-template #noLoc><span class="muted">—</span></ng-template>
          </ng-template>
        </tm-column>
        <tm-column key="status" label="Status" width="120">
          <ng-template let-row>
            <tm-status-pill [tone]="row.is_active ? 'success' : 'neutral'">
              {{ row.is_active ? 'Active' : 'Inactive' }}
            </tm-status-pill>
          </ng-template>
        </tm-column>
        <tm-column key="actions" label="" width="100" align="right">
          <ng-template let-row>
            <div class="cell-actions">
              <button class="icon-btn" (click)="openEdit(row)" aria-label="Edit promotion"><tm-icon name="edit" [size]="14" /></button>
              <button class="icon-btn icon-btn--danger" (click)="deleteTarget = row" aria-label="Delete promotion"><tm-icon name="trash" [size]="14" /></button>
            </div>
          </ng-template>
        </tm-column>
      </tm-data-table>
    </div>

    <!-- Drawer -->
    <tm-drawer
      [open]="open"
      [title]="editingId ? 'Edit promotion' : 'Add promotion'"
      [width]="560"
      (closed)="open = false"
    >
      <div slot="body" class="form">
        <label class="field">
          <span class="field__lbl">Title <i>*</i></span>
          <input type="text" [(ngModel)]="form.title" (ngModelChange)="touched = true" />
          <span class="field__err" *ngIf="touched && !form.title.trim()">Title is required.</span>
        </label>

        <label class="field">
          <span class="field__lbl">Promo type</span>
          <select [(ngModel)]="form.promo_type" (ngModelChange)="onPromoTypeChange()">
            <option *ngFor="let p of promoTypes" [value]="p.value">{{ p.label }}</option>
          </select>
        </label>

        <ng-container *ngIf="form.promo_type === 'location_sensitive'">
          <div class="row">
            <label class="field">
              <span class="field__lbl">Location type</span>
              <select [(ngModel)]="form.location_type">
                <option value="pickup">Pick-up</option>
                <option value="drop">Drop</option>
              </select>
            </label>
            <label class="field">
              <span class="field__lbl">Request radius (m) <i>*</i></span>
              <input type="number" min="0" [(ngModel)]="form.radius_meters" />
            </label>
          </div>
          <label class="field">
            <span class="field__lbl">Location <i>*</i></span>
            <input #locationInput type="text" [(ngModel)]="form.location_name"
                   placeholder="Search a location" (input)="onLocationTyped()" />
            <span class="field__ok" *ngIf="form.location_name && form.latitude">
              <tm-icon name="check" [size]="12" /> Location pinned
            </span>
          </label>
        </ng-container>

        <div class="row">
          <label class="field">
            <span class="field__lbl">Discount type</span>
            <select [(ngModel)]="form.discount_type">
              <option value="percentage">Percentage</option>
              <option value="flat">Flat</option>
            </select>
          </label>
          <label class="field">
            <span class="field__lbl">Discount {{ form.discount_type === 'percentage' ? '(%)' : '(amount)' }} <i>*</i></span>
            <input type="number" min="0" step="0.01" [(ngModel)]="form.discount_value" />
          </label>
        </div>
        <label class="field">
          <span class="field__lbl">Maximum discount</span>
          <input type="number" min="0" step="0.01" [(ngModel)]="form.discount_maximum" />
        </label>

        <div class="row">
          <label class="field">
            <span class="field__lbl">Start date</span>
            <input type="date" [(ngModel)]="form.start_date" />
          </label>
          <label class="field">
            <span class="field__lbl">End date</span>
            <input type="date" [(ngModel)]="form.end_date" />
          </label>
        </div>

        <div class="row row--3">
          <label class="field">
            <span class="field__lbl">Max allowed</span>
            <input type="number" min="0" [(ngModel)]="form.maximum_allowed" />
          </label>
          <label class="field">
            <span class="field__lbl">Per user</span>
            <input type="number" min="0" [(ngModel)]="form.per_user_limit" />
          </label>
          <label class="field">
            <span class="field__lbl">Per day</span>
            <input type="number" min="0" [(ngModel)]="form.per_day_limit" />
          </label>
        </div>

        <div class="field">
          <span class="field__lbl">Allowed vehicle types</span>
          <div class="vchips" *ngIf="vehicleOptions.length; else noVeh">
            <button
              *ngFor="let v of vehicleOptions"
              type="button"
              class="vchip"
              [class.is-on]="form.allowed_vehicle_type_ids.includes(v.id)"
              (click)="toggleVehicle(v.id)"
            >
              <tm-icon [name]="form.allowed_vehicle_type_ids.includes(v.id) ? 'check' : 'plus'" [size]="12" />
              {{ v.display_name }}
            </button>
          </div>
          <ng-template #noVeh>
            <span class="field__hint">No vehicle types for this city yet.</span>
          </ng-template>
        </div>

        <label class="field">
          <span class="field__lbl">Terms & conditions</span>
          <textarea rows="5" [(ngModel)]="form.terms_and_conditions"></textarea>
        </label>

        <label class="toggle">
          <input type="checkbox" [(ngModel)]="form.is_active" />
          <span>Active</span>
        </label>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="open = false">Cancel</tm-button>
        <tm-button variant="green" [disabled]="!form.title.trim() || saving" (clicked)="submit()">
          {{ saving ? 'Saving…' : editingId ? 'Save changes' : 'Create' }}
        </tm-button>
      </div>
    </tm-drawer>

    <!-- Delete confirm -->
    <tm-modal [open]="!!deleteTarget" title="Delete promotion" (closed)="deleteTarget = null">
      <div slot="body"><p>Delete promotion <strong>{{ deleteTarget?.title }}</strong>? This cannot be undone.</p></div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="deleteTarget = null">Cancel</tm-button>
        <tm-button variant="danger" [disabled]="saving" (clicked)="confirmDelete()">Delete</tm-button>
      </div>
    </tm-modal>
  `,
  styles: [`
    .cwp { display: flex; flex-direction: column; gap: 16px; }
    .cwp__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .cwp__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .cwp__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); }

    .cue {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 48px 24px; text-align: center;
      background: var(--tm-surface); border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg); color: var(--tm-text-muted);
    }
    .cue__title { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .cue__text { margin: 0; font-size: 13px; }

    /* cell renderers */
    .cell-strong { color: var(--tm-text); font-weight: 700; }
    .cell-loc { display: inline-flex; align-items: center; gap: 4px; }
    .muted { color: var(--tm-text-muted); }
    .tagx {
      display: inline-flex; align-items: center; gap: 3px;
      font-size: 10px; font-weight: 700;
      padding: 3px 7px; border-radius: 6px;
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
      margin-right: 4px;
    }

    .cell-actions { display: inline-flex; gap: 6px; }
    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 7px;
      background: var(--tm-canvas-2); color: var(--tm-text-muted); cursor: pointer; border: 0;
    }
    .icon-btn:hover { background: var(--tm-ink); color: #fff; }
    .icon-btn--danger:hover { background: var(--tm-danger, #ef4444); }

    .form { display: flex; flex-direction: column; gap: 13px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .row--3 { grid-template-columns: 1fr 1fr 1fr; }
    .field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .field__lbl { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .field__lbl i { color: var(--tm-danger, #ef4444); font-style: normal; }
    .field input, .field select, .field textarea {
      width: 100%; padding: 9px 11px;
      border: 1px solid var(--tm-line); border-radius: 9px;
      background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13px; outline: none; font-family: inherit;
    }
    .field input:focus, .field select:focus, .field textarea:focus { border-color: var(--tm-green); }
    .field textarea { resize: vertical; }
    .field__err { font-size: 11px; font-weight: 600; color: var(--tm-danger, #ef4444); }
    .field__ok { font-size: 11px; font-weight: 600; color: var(--tm-success-fg); display: flex; align-items: center; gap: 3px; }
    .field__hint { font-size: 11px; color: var(--tm-text-muted); }

    .vchips { display: flex; gap: 6px; flex-wrap: wrap; }
    .vchip {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 6px 10px; border-radius: 999px;
      border: 1px solid var(--tm-line); background: var(--tm-canvas);
      color: var(--tm-text-muted); font-size: 12px; font-weight: 700; cursor: pointer;
    }
    .vchip.is-on { background: var(--tm-green-tint, #e0f7fa); border-color: var(--tm-green); color: var(--tm-green); }

    .toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--tm-text); }
    .toggle input { width: 16px; height: 16px; }
  `],
})
export class CityWidePromotionsComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  rows: PromotionRow[] = [];
  vehicleOptions: VehicleTypeOption[] = [];

  // Filter / search / pagination state — kept in sync with the backend index params.
  searchQuery = '';
  status: 'active' | 'inactive' = 'active';
  statusOptions = [{ label: 'Inactive', value: 'inactive' }];
  loading = false;
  currentPage = 1;
  lastPage = 1;
  perPage = 10;
  total = 0;
  private search$ = new Subject<string>();
  private searchSub?: Subscription;

  open = false;
  editingId: number | null = null;
  saving = false;
  touched = false;
  form = this.blankForm();
  deleteTarget: PromotionRow | null = null;

  promoTypes = PROMO_TYPES;

  @ViewChild('locationInput') locationInputRef?: ElementRef<HTMLInputElement>;
  private autocomplete: google.maps.places.Autocomplete | null = null;
  private autocompleteListener: google.maps.MapsEventListener | null = null;

  private sub?: Subscription;

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private maps: GoogleMapsLoaderService,
    private zone: NgZone,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.maps.load().catch(() => {});
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.sub = this.cityCtx.cityId$.subscribe((id) => {
      this.cityId = id;
      if (id != null) {
        this.fetchVehicles();
        this.fetch();
      } else {
        this.rows = [];
        this.vehicleOptions = [];
      }
    });
    this.searchSub = this.search$
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(() => {
        this.currentPage = 1;
        this.fetch();
      });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.searchSub?.unsubscribe();
    this.detachAutocomplete();
  }

  onSearchChange(val: string): void {
    this.searchQuery = val;
    this.search$.next(val);
  }
  clearSearch(): void {
    this.searchQuery = '';
    this.currentPage = 1;
    this.fetch();
  }

  statusLabel(): string {
    return this.status === 'inactive' ? 'Inactive' : 'Active';
  }
  onStatusChange(value: string): void {
    this.status = value as 'active' | 'inactive';
    this.currentPage = 1;
    this.fetch();
  }
  clearStatus(): void {
    if (this.status === 'active') return;
    this.status = 'active';
    this.currentPage = 1;
    this.fetch();
  }

  onPage(page: number): void {
    if (page === this.currentPage) return;
    this.currentPage = page;
    this.fetch();
  }
  onPageSize(size: number): void {
    this.perPage = size;
    this.currentPage = 1;
    this.fetch();
  }

  humanPromoType(p: string): string {
    return PROMO_TYPES.find((x) => x.value === p)?.label || p;
  }

  toggleVehicle(id: number): void {
    const list = this.form.allowed_vehicle_type_ids;
    this.form.allowed_vehicle_type_ids = list.includes(id)
      ? list.filter((x) => x !== id)
      : [...list, id];
  }

  fetch(): void {
    if (this.cityId == null) return;
    const params = new URLSearchParams();
    params.set('is_active', this.status === 'inactive' ? '0' : '1');
    if (this.searchQuery.trim()) params.set('q', this.searchQuery.trim());
    params.set('page', String(this.currentPage));
    params.set('per_page', String(this.perPage));
    this.loading = true;
    this.api
      .get<{
        data: PromotionRow[];
        meta?: { current_page: number; last_page: number; per_page: number; total: number };
      }>(`/admin/cities/${this.cityId}/promotions?${params.toString()}`)
      .subscribe({
        next: (r) => {
          this.rows = r.data ?? [];
          const meta = r.meta;
          if (meta) {
            this.currentPage = meta.current_page;
            this.lastPage = meta.last_page;
            this.perPage = meta.per_page;
            this.total = meta.total;
          }
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.toast.error('Failed to load promotions');
        },
      });
  }

  fetchVehicles(): void {
    if (this.cityId == null) return;
    this.api.get<{ data: VehicleTypeOption[] }>(`/admin/cities/${this.cityId}/vehicle-types`)
      .subscribe({
        next: (r) => (this.vehicleOptions = (r.data ?? []).map((v) => ({
          id: v.id,
          display_name: v.display_name || v.name || `#${v.id}`,
        }))),
        error: () => (this.vehicleOptions = []),
      });
  }

  blankForm() {
    return {
      title: '',
      benefit_type: 'discount',
      promo_type: 'location_insensitive',
      location_type: 'pickup',
      location_name: '' as string | null,
      latitude: null as number | null,
      longitude: null as number | null,
      radius_meters: null as number | null,
      discount_type: 'percentage',
      discount_value: 0,
      discount_maximum: 0 as number | null,
      start_date: '' as string,
      end_date: '' as string,
      maximum_allowed: null as number | null,
      per_user_limit: null as number | null,
      per_day_limit: null as number | null,
      allowed_vehicle_type_ids: [] as number[],
      terms_and_conditions:
        'Terms of Use:\n1. Only one promotion can be applied on a ride.\n2. We reserve the right to discontinue the promotion at its discretion.',
      is_active: true,
    };
  }

  openCreate(): void {
    this.editingId = null;
    this.touched = false;
    this.form = this.blankForm();
    this.open = true;
    this.maybeAttachAutocomplete();
  }

  openEdit(r: PromotionRow): void {
    this.editingId = r.id;
    this.touched = false;
    this.form = {
      title: r.title,
      benefit_type: r.benefit_type,
      promo_type: r.promo_type,
      location_type: r.location_type || 'pickup',
      location_name: r.location_name || '',
      latitude: r.latitude,
      longitude: r.longitude,
      radius_meters: r.radius_meters,
      discount_type: r.discount_type,
      discount_value: r.discount_value,
      discount_maximum: r.discount_maximum,
      start_date: (r.start_date || '').slice(0, 10),
      end_date: (r.end_date || '').slice(0, 10),
      maximum_allowed: r.maximum_allowed,
      per_user_limit: r.per_user_limit,
      per_day_limit: r.per_day_limit,
      allowed_vehicle_type_ids: r.allowed_vehicle_type_ids ?? [],
      terms_and_conditions: r.terms_and_conditions || '',
      is_active: r.is_active,
    };
    this.open = true;
    this.maybeAttachAutocomplete();
  }

  onPromoTypeChange(): void {
    if (this.form.promo_type === 'location_sensitive') {
      this.maybeAttachAutocomplete();
    } else {
      this.detachAutocomplete();
      this.form.location_type = 'pickup';
      this.form.location_name = '';
      this.form.latitude = null;
      this.form.longitude = null;
    }
  }

  onLocationTyped(): void {
    if (!this.form.location_name) {
      this.form.latitude = null;
      this.form.longitude = null;
    }
  }

  private maybeAttachAutocomplete(): void {
    if (this.form.promo_type !== 'location_sensitive') return;
    setTimeout(() => this.attachAutocomplete(), 320);
  }

  private attachAutocomplete(): void {
    if (!window.google?.maps?.places || !this.locationInputRef?.nativeElement) return;
    this.detachAutocomplete();
    const el = this.locationInputRef.nativeElement;
    this.autocomplete = new google.maps.places.Autocomplete(el, {
      fields: ['name', 'formatted_address', 'geometry'],
    });
    this.autocompleteListener = this.autocomplete.addListener('place_changed', () => {
      const place = this.autocomplete!.getPlace();
      if (!place?.geometry?.location) return;
      this.zone.run(() => {
        this.form.location_name = place.formatted_address || place.name || '';
        this.form.latitude = place.geometry!.location!.lat();
        this.form.longitude = place.geometry!.location!.lng();
      });
    });
  }

  private detachAutocomplete(): void {
    this.autocompleteListener?.remove();
    this.autocompleteListener = null;
    this.autocomplete = null;
    document.querySelectorAll('.pac-container').forEach((el) => el.remove());
  }

  submit(): void {
    this.touched = true;
    if (this.cityId == null || !this.form.title.trim() || this.saving) return;
    if (this.form.promo_type === 'location_sensitive') {
      if (!this.form.radius_meters || this.form.radius_meters <= 0) {
        this.toast.warning('Request radius is required for location-sensitive promotions');
        return;
      }
      if (!this.form.latitude || !this.form.longitude) {
        this.toast.warning('Pick a location from the suggestions');
        return;
      }
    }

    const body: any = { ...this.form };
    if (this.form.promo_type !== 'location_sensitive') {
      body.location_type = null;
      body.location_name = null;
      body.latitude = null;
      body.longitude = null;
      body.radius_meters = null;
    }

    this.saving = true;
    const path = this.editingId
      ? `/admin/cities/${this.cityId}/promotions/${this.editingId}`
      : `/admin/cities/${this.cityId}/promotions`;
    const req$ = this.editingId ? this.api.patch(path, body) : this.api.post(path, body);
    req$.subscribe({
      next: () => {
        this.saving = false;
        this.open = false;
        this.detachAutocomplete();
        this.toast.success(this.editingId ? 'Promotion updated' : 'Promotion created');
        this.fetch();
      },
      error: (e) => {
        this.saving = false;
        this.toast.error(e?.error?.message || 'Save failed');
      },
    });
  }

  confirmDelete(): void {
    const r = this.deleteTarget;
    if (!r || this.cityId == null || this.saving) return;
    this.saving = true;
    this.api.delete(`/admin/cities/${this.cityId}/promotions/${r.id}`).subscribe({
      next: () => {
        this.saving = false;
        this.deleteTarget = null;
        this.toast.success('Promotion deleted');
        this.fetch();
      },
      error: (e) => {
        this.saving = false;
        this.toast.error(e?.error?.message || 'Delete failed');
      },
    });
  }

  private toIso(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
}
