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
  display_name: string;
  name?: string;
}

interface CouponRow {
  id: number;
  title: string;
  subtitle: string | null;
  benefit_type: string;
  description: string | null;
  promo_type: string;
  location_type: string | null;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
  location_name: string | null;
  per_user_limit: number | null;
  discount_type: string;
  discount_value: number;
  discount_maximum: number | null;
  allowed_vehicle_display_names: string[];
  is_active: boolean;
}

interface CustomerRow {
  id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
}

const PROMO_TYPES = [
  { label: 'Location insensitive', value: 'location_insensitive' },
  { label: 'Location sensitive', value: 'location_sensitive' },
];

/** Coupons — redeemable discounts for the city chosen in the topbar switcher. */
@Component({
  selector: 'app-coupons',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonComponent, ColumnComponent, DataTableComponent,
    DrawerComponent, FilterPillComponent, FilterSelectComponent,
    IconComponent, InputComponent, ModalComponent, StatusPillComponent,
  ],
  template: `
    <div class="cp">
      <header class="cp__head">
        <div>
          <h1 class="cp__title">Coupons</h1>
          <p class="cp__sub">Redeemable discount coupons for riders in this city.</p>
        </div>
        <tm-button variant="green" icon="plus" [disabled]="cityId == null" (clicked)="openCreate()">
          Add coupon
        </tm-button>
      </header>

      <div class="cue" *ngIf="cityId == null">
        <tm-icon name="map-marker" [size]="24" />
        <p class="cue__title">No city selected</p>
        <p class="cue__text">Pick a city from the switcher in the top bar to manage coupons.</p>
      </div>

      <tm-data-table
        *ngIf="cityId != null"
        [rows]="rows"
        [total]="total"
        [page]="currentPage"
        [pageSize]="perPage"
        [loading]="loading"
        emptyTitle="No coupons found"
        emptyHint="Try a different search, or clear the filters."
        (pageChange)="onPage($event)"
        (pageSizeChange)="onPageSize($event)"
      >
        <tm-input
          slot="search"
          icon="search"
          placeholder="Search by title or subtitle"
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
          <tm-filter-select
            icon="car"
            ariaLabel="Vehicle filter"
            allLabel="All vehicles"
            [options]="vehicleFilterOptions"
            [value]="vehicleFilterValue"
            (valueChange)="onVehicleFilterChange($event)"
          />
        </ng-container>

        <ng-container slot="banner">
          <tm-filter-pill *ngIf="searchQuery.trim()" icon="search" label="Search" [value]="searchQuery" (clear)="clearSearch()" />
          <tm-filter-pill *ngIf="status !== 'active'" icon="bolt" label="Status" [value]="statusLabel()" (clear)="clearStatus()" />
          <tm-filter-pill *ngIf="vehicleFilter != null" icon="car" label="Vehicle" [value]="vehicleName(vehicleFilter)" (clear)="clearVehicleFilter()" />
        </ng-container>

        <tm-column key="title" label="Title">
          <ng-template let-row>
            <div class="cell-id">
              <span class="strong">{{ row.title }}</span>
              <span class="muted small" *ngIf="row.subtitle">{{ row.subtitle }}</span>
            </div>
          </ng-template>
        </tm-column>
        <tm-column key="promo_type" label="Type" width="170">
          <ng-template let-row>
            {{ humanPromoType(row.promo_type) }}
            <span class="muted small" *ngIf="row.promo_type === 'location_sensitive' && row.location_type">
              · {{ row.location_type === 'pickup' ? 'Pickup' : 'Drop' }}
            </span>
          </ng-template>
        </tm-column>
        <tm-column key="discount" label="Discount" width="160">
          <ng-template let-row>
            <span class="strong">{{ row.discount_value }}{{ row.discount_type === 'percentage' ? '%' : '' }} off</span>
            <span class="muted small" *ngIf="row.discount_maximum"> · max {{ row.discount_maximum }}</span>
          </ng-template>
        </tm-column>
        <tm-column key="vehicles" label="Vehicles" [wrap]="true">
          <ng-template let-row>
            <span class="muted" *ngIf="!row.allowed_vehicle_display_names?.length">All</span>
            <span class="tagx" *ngFor="let name of row.allowed_vehicle_display_names">{{ vehicleName(name) }}</span>
          </ng-template>
        </tm-column>
        <tm-column key="per_user_limit" label="Per-user" width="100">
          <ng-template let-row>
            <span *ngIf="row.per_user_limit != null">{{ row.per_user_limit }}</span>
            <span class="muted" *ngIf="row.per_user_limit == null">∞</span>
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
        <tm-column key="actions" label="" width="130" align="right">
          <ng-template let-row>
            <div class="cell-actions">
              <button class="icon-btn" (click)="openGive(row)" aria-label="Give to users" title="Give to users"><tm-icon name="eye" [size]="14" /></button>
              <button class="icon-btn" (click)="openEdit(row)" aria-label="Edit coupon"><tm-icon name="edit" [size]="14" /></button>
              <button class="icon-btn icon-btn--danger" (click)="deleteTarget = row" aria-label="Delete coupon"><tm-icon name="trash" [size]="14" /></button>
            </div>
          </ng-template>
        </tm-column>
      </tm-data-table>
    </div>

    <!-- Drawer: create / edit coupon -->
    <tm-drawer
      [open]="open"
      [title]="editingId ? 'Edit coupon' : 'Add coupon'"
      [width]="560"
      (closed)="open = false"
    >
      <div slot="body" class="form">
        <label class="field">
          <span class="field__lbl">Title <i>*</i></span>
          <input type="text" [(ngModel)]="form.title" (ngModelChange)="touched = true" placeholder="Name of the coupon" />
          <span class="field__err" *ngIf="touched && !form.title.trim()">Title is required.</span>
        </label>
        <label class="field">
          <span class="field__lbl">Subtitle</span>
          <input type="text" [(ngModel)]="form.subtitle" placeholder="What it's for" />
        </label>
        <label class="field">
          <span class="field__lbl">Description</span>
          <textarea rows="2" [(ngModel)]="form.description" placeholder="Any description"></textarea>
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
        <div class="row">
          <label class="field">
            <span class="field__lbl">Max discount</span>
            <input type="number" min="0" step="0.01" [(ngModel)]="form.discount_maximum" />
          </label>
          <label class="field">
            <span class="field__lbl">Per-user limit</span>
            <input type="number" min="0" [(ngModel)]="form.per_user_limit" />
          </label>
        </div>

        <div class="field">
          <span class="field__lbl">Allowed vehicle types</span>
          <div class="vchips" *ngIf="vehicleOptions.length; else noVeh">
            <button
              *ngFor="let v of vehicleOptions"
              type="button"
              class="vchip"
              [class.is-on]="form.allowed_vehicle_display_names.includes(v.display_name)"
              (click)="toggleVehicle(v.display_name)"
            >
              <tm-icon [name]="form.allowed_vehicle_display_names.includes(v.display_name) ? 'check' : 'plus'" [size]="12" />
              {{ v.display_name }}
            </button>
          </div>
          <ng-template #noVeh>
            <span class="field__hint">No vehicle types for this city yet.</span>
          </ng-template>
        </div>

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

    <!-- Give-to-users modal: Select customers OR Import CSV -->
    <tm-modal [open]="!!giveTarget" [title]="'Give coupon: ' + (giveTarget?.title || '')" (closed)="closeGive()">
      <div slot="body" class="give">
        <div class="give-tabs">
          <button class="give-tab" [class.is-on]="giveTab === 'customers'" (click)="setGiveTab('customers')">
            Select from customers
          </button>
          <button class="give-tab" [class.is-on]="giveTab === 'csv'" (click)="setGiveTab('csv')">
            Import from CSV
          </button>
        </div>

        <ng-container *ngIf="giveTab === 'customers'">
          <label class="search search--inline">
            <tm-icon name="search" [size]="14" />
            <input
              type="search"
              placeholder="Search by name, phone or email"
              [ngModel]="customerSearch"
              (ngModelChange)="onCustomerSearchChange($event)"
            />
          </label>
          <div class="cust-list" *ngIf="customerRows.length; else noCust">
            <label class="cust-row" *ngFor="let c of customerRows">
              <input
                type="checkbox"
                [checked]="selectedUserIds.has(c.id)"
                (change)="toggleSelectedUser(c.id, $event)"
              />
              <div class="cust-info">
                <div class="strong">{{ c.name || 'Customer #' + c.id }}</div>
                <div class="muted small">{{ c.phone || '—' }}<span *ngIf="c.email"> · {{ c.email }}</span></div>
              </div>
            </label>
          </div>
          <ng-template #noCust>
            <div class="muted small ion-text-center" style="padding:18px 0">No customers found.</div>
          </ng-template>
          <div class="paginator" *ngIf="customerRows.length">
            <span class="paginator__count">{{ selectedUserIds.size }} selected · Showing page {{ customerPage }} of {{ customerLastPage }}</span>
            <div class="paginator__nav">
              <button class="pg-btn" [disabled]="customerPage <= 1" (click)="goToCustomerPage(customerPage - 1)">Prev</button>
              <button class="pg-btn" [disabled]="customerPage >= customerLastPage" (click)="goToCustomerPage(customerPage + 1)">Next</button>
            </div>
          </div>
        </ng-container>

        <ng-container *ngIf="giveTab === 'csv'">
          <label class="csv-drop">
            <input type="file" accept=".csv,text/csv" (change)="onCsvSelected($event)" hidden />
            <tm-icon name="upload" [size]="20" />
            <div>
              <div class="strong">{{ csvFile?.name || 'Choose CSV' }}</div>
              <div class="muted small">CSV with a <code>user_id</code> column. One id per row.</div>
            </div>
          </label>
          <button type="button" class="link-btn" (click)="downloadSampleCsv()">
            <tm-icon name="download" [size]="13" /> Download sample CSV
          </button>
        </ng-container>

        <div class="give-fields">
          <label class="field">
            <span class="field__lbl">Reason <i>*</i></span>
            <input type="text" [(ngModel)]="giveForm.reason" placeholder="Why this coupon is being issued" />
          </label>
          <label class="field">
            <span class="field__lbl">Push message</span>
            <textarea rows="3" [(ngModel)]="giveForm.push_message" placeholder="Optional message to send via notification"></textarea>
          </label>
          <label class="field">
            <span class="field__lbl">Expiry date</span>
            <input type="datetime-local" [(ngModel)]="giveForm.expires_at" />
          </label>
        </div>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="closeGive()">Cancel</tm-button>
        <tm-button variant="green" [disabled]="!canSubmitGive() || giving" (clicked)="submitGive()">
          {{ giving ? 'Sending…' : 'Send' }}
        </tm-button>
      </div>
    </tm-modal>

    <!-- Delete confirm -->
    <tm-modal [open]="!!deleteTarget" title="Delete coupon" (closed)="deleteTarget = null">
      <div slot="body"><p>Delete coupon <strong>{{ deleteTarget?.title }}</strong>? This cannot be undone.</p></div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="deleteTarget = null">Cancel</tm-button>
        <tm-button variant="danger" [disabled]="saving" (clicked)="confirmDelete()">Delete</tm-button>
      </div>
    </tm-modal>
  `,
  styles: [`
    .cp { display: flex; flex-direction: column; gap: 16px; }
    .cp__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .cp__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .cp__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); }

    .cue {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 48px 24px; text-align: center;
      background: var(--tm-surface); border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg); color: var(--tm-text-muted);
    }
    .cue__title { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .cue__text { margin: 0; font-size: 13px; }

    /* search field — shared with the give-to-users modal */
    .search {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 7px 10px; min-width: 280px;
      background: var(--tm-canvas); border: 1px solid var(--tm-line); border-radius: 8px;
      color: var(--tm-text-muted);
    }
    .search--inline { width: 100%; min-width: 0; margin-bottom: 10px; }
    .search input {
      border: none; outline: none; background: transparent;
      color: var(--tm-text); font-size: 13px; flex: 1; min-width: 0;
    }

    /* cell renderers */
    .cell-id { display: flex; flex-direction: column; min-width: 0; }
    .cell-loc { display: inline-flex; align-items: center; gap: 4px; }
    .cell-actions { display: inline-flex; gap: 6px; }
    .strong { color: var(--tm-text); font-weight: 700; }
    .muted { color: var(--tm-text-muted); }
    .small { font-size: 11px; }
    .tagx {
      display: inline-flex; align-items: center; gap: 3px;
      font-size: 10px; font-weight: 700;
      padding: 3px 7px; border-radius: 6px;
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
      margin-right: 4px;
    }

    /* paginator — used by the give-to-users modal's customer list */
    .paginator {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; padding: 4px 2px;
    }
    .paginator__count { font-size: 12px; color: var(--tm-text-muted); }
    .paginator__nav { display: inline-flex; align-items: center; gap: 8px; }
    .pg-btn {
      padding: 6px 12px; border-radius: 8px;
      border: 1px solid var(--tm-line); background: var(--tm-surface);
      color: var(--tm-text); font-size: 12px; font-weight: 700; cursor: pointer;
    }
    .pg-btn:disabled { opacity: 0.45; cursor: not-allowed; }

    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 7px;
      background: var(--tm-canvas-2); color: var(--tm-text-muted); cursor: pointer; border: 0;
    }
    .icon-btn:hover { background: var(--tm-ink); color: #fff; }
    .icon-btn--danger:hover { background: var(--tm-danger, #ef4444); }

    .form { display: flex; flex-direction: column; gap: 13px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
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
    .toggle--inline { gap: 6px; cursor: pointer; }
    .toggle input { width: 16px; height: 16px; }

    /* Give-to-users modal */
    .give {
      display: flex; flex-direction: column; gap: 14px;
      width: 100%; box-sizing: border-box;
    }
    .give *, .give *::before, .give *::after { box-sizing: border-box; }
    .give-tabs {
      display: flex; gap: 4px; padding: 4px; width: 100%;
      background: var(--tm-canvas-2); border-radius: 10px;
    }
    .give-tab {
      flex: 1; padding: 8px 14px; border-radius: 8px;
      background: transparent; cursor: pointer;
      font-size: 13px; font-weight: 700; color: var(--tm-text-muted);
      text-align: center; border: none;
    }
    .give-tab.is-on { background: var(--tm-surface); color: var(--tm-text); box-shadow: var(--tm-shadow-sm); }
    .cust-list {
      max-height: 240px; overflow: auto;
      border: 1px solid var(--tm-line); border-radius: 9px;
    }
    .cust-row {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px; cursor: pointer;
      border-bottom: 1px solid var(--tm-line);
    }
    .cust-row:last-child { border-bottom: 0; }
    .cust-row:hover { background: var(--tm-canvas-2); }
    .cust-info { display: flex; flex-direction: column; min-width: 0; }
    .csv-drop {
      display: flex; align-items: center; gap: 12px;
      padding: 18px; cursor: pointer;
      background: var(--tm-canvas); border: 1px dashed var(--tm-line); border-radius: 10px;
    }
    .csv-drop:hover { border-color: var(--tm-green); color: var(--tm-text); }
    .link-btn {
      display: inline-flex; align-items: center; gap: 4px;
      color: var(--tm-green); font-size: 12px; font-weight: 700;
      background: transparent; cursor: pointer; padding: 0;
    }
    .give-fields { display: flex; flex-direction: column; gap: 12px; padding-top: 8px; border-top: 1px solid var(--tm-line); }
  `],
})
export class CouponsComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  rows: CouponRow[] = [];
  vehicleOptions: VehicleTypeOption[] = [];

  // Listing filters / pagination
  searchQuery = '';
  status: 'active' | 'inactive' = 'active';
  statusOptions = [{ label: 'Inactive', value: 'inactive' }];
  vehicleFilter: string | null = null;
  loading = false;
  currentPage = 1;
  lastPage = 1;
  perPage = 10;
  total = 0;
  private search$ = new Subject<string>();
  private searchSub?: Subscription;

  get vehicleFilterValue(): string {
    return this.vehicleFilter == null ? 'all' : String(this.vehicleFilter);
  }
  get vehicleFilterOptions(): { label: string; value: string }[] {
    return this.vehicleOptions.map((v) => ({ label: v.display_name, value: v.display_name }));
  }

  open = false;
  editingId: number | null = null;
  saving = false;
  touched = false;
  form = this.blankForm();
  deleteTarget: CouponRow | null = null;

  promoTypes = PROMO_TYPES;

  // Give-to-users state
  giveTarget: CouponRow | null = null;
  giveTab: 'customers' | 'csv' = 'customers';
  giving = false;
  giveForm: { reason: string; push_message: string; expires_at: string } = {
    reason: '',
    push_message: '',
    expires_at: '',
  };
  customerRows: CustomerRow[] = [];
  customerSearch = '';
  customerPage = 1;
  customerLastPage = 1;
  customerPerPage = 10;
  selectedUserIds = new Set<number>();
  csvFile: File | null = null;
  private custSearch$ = new Subject<string>();
  private custSearchSub?: Subscription;

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
    this.custSearchSub = this.custSearch$
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(() => {
        this.customerPage = 1;
        this.fetchCustomers();
      });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.searchSub?.unsubscribe();
    this.custSearchSub?.unsubscribe();
    this.detachAutocomplete();
  }

  // ── Listing ─────────────────────────────────────────────────────────
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

  onVehicleFilterChange(value: string): void {
    this.vehicleFilter = value === 'all' ? null : value;
    this.currentPage = 1;
    this.fetch();
  }
  clearVehicleFilter(): void {
    if (this.vehicleFilter == null) return;
    this.vehicleFilter = null;
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

  vehicleName(name: string): string {
    return name;
  }

  toggleVehicle(name: string): void {
    const list = this.form.allowed_vehicle_display_names;
    this.form.allowed_vehicle_display_names = list.includes(name)
      ? list.filter((x) => x !== name)
      : [...list, name];
  }

  fetch(): void {
    if (this.cityId == null) return;
    const params = new URLSearchParams();
    params.set('is_active', this.status === 'inactive' ? '0' : '1');
    if (this.searchQuery.trim()) params.set('q', this.searchQuery.trim());
    if (this.vehicleFilter != null) params.set('vehicle_display_name', this.vehicleFilter);
    params.set('page', String(this.currentPage));
    params.set('per_page', String(this.perPage));
    this.loading = true;
    this.api
      .get<{
        data: CouponRow[];
        meta?: { current_page: number; last_page: number; per_page: number; total: number };
      }>(`/admin/cities/${this.cityId}/coupons?${params.toString()}`)
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
          this.toast.error('Failed to load coupons');
        },
      });
  }

  fetchVehicles(): void {
    if (this.cityId == null) return;
    this.api.get<{ data: VehicleTypeOption[] }>(`/admin/cities/${this.cityId}/vehicle-types`)
      .subscribe({
        next: (r) => {
          const map = new Map<string, VehicleTypeOption>();
          for (const raw of r.data ?? []) {
            const display = (raw.display_name || raw.name || `#${raw.id}`).trim();
            if (!map.has(display)) {
              map.set(display, { id: raw.id, display_name: display });
            }
          }
          this.vehicleOptions = [...map.values()];
        },
        error: () => (this.vehicleOptions = []),
      });
  }

  // ── Create / edit drawer ────────────────────────────────────────────
  blankForm() {
    return {
      title: '',
      subtitle: '',
      benefit_type: 'discount',
      description: '',
      promo_type: 'location_insensitive',
      location_type: 'pickup',
      location_name: '' as string | null,
      latitude: null as number | null,
      longitude: null as number | null,
      radius_meters: null as number | null,
      per_user_limit: 1 as number | null,
      discount_type: 'percentage',
      discount_value: 0,
      discount_maximum: 0 as number | null,
      allowed_vehicle_display_names: [] as string[],
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

  openEdit(r: CouponRow): void {
    this.editingId = r.id;
    this.touched = false;
    this.form = {
      title: r.title,
      subtitle: r.subtitle || '',
      benefit_type: r.benefit_type,
      description: r.description || '',
      promo_type: r.promo_type,
      location_type: r.location_type || 'pickup',
      location_name: r.location_name || '',
      latitude: r.latitude,
      longitude: r.longitude,
      radius_meters: r.radius_meters,
      per_user_limit: r.per_user_limit,
      discount_type: r.discount_type,
      discount_value: r.discount_value,
      discount_maximum: r.discount_maximum,
      allowed_vehicle_display_names: r.allowed_vehicle_display_names ?? [],
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
        this.toast.warning('Request radius is required for location-sensitive coupons');
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
      ? `/admin/cities/${this.cityId}/coupons/${this.editingId}`
      : `/admin/cities/${this.cityId}/coupons`;
    const req$ = this.editingId ? this.api.patch(path, body) : this.api.post(path, body);
    req$.subscribe({
      next: () => {
        this.saving = false;
        this.open = false;
        this.detachAutocomplete();
        this.toast.success(this.editingId ? 'Coupon updated' : 'Coupon created');
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
    this.api.delete(`/admin/cities/${this.cityId}/coupons/${r.id}`).subscribe({
      next: () => {
        this.saving = false;
        this.deleteTarget = null;
        this.toast.success('Coupon deleted');
        this.fetch();
      },
      error: (e) => {
        this.saving = false;
        this.toast.error(e?.error?.message || 'Delete failed');
      },
    });
  }

  // ── Give-to-users modal ─────────────────────────────────────────────
  openGive(r: CouponRow): void {
    this.giveTarget = r;
    this.giveTab = 'customers';
    this.giveForm = { reason: '', push_message: '', expires_at: '' };
    this.selectedUserIds = new Set<number>();
    this.csvFile = null;
    this.customerSearch = '';
    this.customerPage = 1;
    this.fetchCustomers();
  }

  closeGive(): void {
    this.giveTarget = null;
    this.giving = false;
  }

  setGiveTab(tab: 'customers' | 'csv'): void {
    this.giveTab = tab;
  }

  onCustomerSearchChange(val: string): void {
    this.customerSearch = val;
    this.custSearch$.next(val);
  }

  goToCustomerPage(page: number): void {
    if (page < 1 || page > this.customerLastPage || page === this.customerPage) return;
    this.customerPage = page;
    this.fetchCustomers();
  }

  toggleSelectedUser(id: number, ev: Event): void {
    const checked = (ev.target as HTMLInputElement).checked;
    if (checked) this.selectedUserIds.add(id);
    else this.selectedUserIds.delete(id);
  }

  onCsvSelected(ev: Event): void {
    const file = (ev.target as HTMLInputElement).files?.[0];
    this.csvFile = file ?? null;
  }

  downloadSampleCsv(): void {
    const csv = 'user_id\n123\n456\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'coupon_recipients_sample.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  canSubmitGive(): boolean {
    if (!this.giveTarget) return false;
    if (!this.giveForm.reason.trim()) return false;
    if (this.giveTab === 'customers') return this.selectedUserIds.size > 0;
    return !!this.csvFile;
  }

  fetchCustomers(): void {
    const params = new URLSearchParams();
    if (this.customerSearch.trim()) params.set('search', this.customerSearch.trim());
    params.set('page', String(this.customerPage));
    params.set('per_page', String(this.customerPerPage));
    this.api
      .get<any>(`/admin/customers?${params.toString()}`)
      .subscribe({
        next: (r) => {
          // AdminCustomersController returns Laravel's native paginator nested
          // under `data` — i.e. { data: { data: [...], current_page, ... } }.
          // Normalise both that shape and the simpler { data, meta } shape.
          const payload = r?.data ?? {};
          const rows: CustomerRow[] = Array.isArray(payload) ? payload : (payload.data ?? []);
          this.customerRows = rows;
          if (!Array.isArray(payload) && typeof payload === 'object') {
            this.customerPage = payload.current_page ?? this.customerPage;
            this.customerLastPage = payload.last_page ?? this.customerLastPage;
            this.customerPerPage = payload.per_page ?? this.customerPerPage;
          } else if (r?.meta) {
            this.customerPage = r.meta.current_page;
            this.customerLastPage = r.meta.last_page;
            this.customerPerPage = r.meta.per_page;
          }
        },
        error: () => (this.customerRows = []),
      });
  }

  submitGive(): void {
    if (!this.giveTarget || this.cityId == null || !this.canSubmitGive() || this.giving) return;
    this.giving = true;

    const fd = new FormData();
    fd.append('mode', this.giveTab);
    fd.append('reason', this.giveForm.reason.trim());
    if (this.giveForm.push_message.trim()) fd.append('push_message', this.giveForm.push_message.trim());
    if (this.giveForm.expires_at) {
      // datetime-local → ISO; backend's date validator accepts both.
      fd.append('expires_at', new Date(this.giveForm.expires_at).toISOString());
    }
    if (this.giveTab === 'customers') {
      Array.from(this.selectedUserIds).forEach((id) => fd.append('user_ids[]', String(id)));
    } else if (this.csvFile) {
      fd.append('csv', this.csvFile);
    }

    this.api
      .postMultipart<{ assigned_count: number; skipped_invalid: number; message: string }>(
        `/admin/cities/${this.cityId}/coupons/${this.giveTarget.id}/give`,
        fd,
      )
      .subscribe({
        next: (r) => {
          this.giving = false;
          this.toast.success(r?.message || 'Coupon issued.');
          this.closeGive();
        },
        error: (e) => {
          this.giving = false;
          this.toast.error(e?.error?.message || 'Failed to issue coupon');
        },
      });
  }
}
