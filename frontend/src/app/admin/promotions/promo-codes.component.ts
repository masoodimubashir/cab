import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
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
  StatusPillComponent,
} from '../../ui';

interface PromoCodeRow {
  id: number;
  code: string;
  max_number: number | null;
  start_date: string;
  end_date: string;
  validity_in_days: number | null;
  bonus_type: string;
  can_use_with_referral: boolean;
  amount: number;
  is_active: boolean;
}

interface CustomerRow {
  id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
}

/**
 * Promo Codes — code-based cash bonuses for the city chosen in the topbar
 * switcher. Create/edit uses the shared drawer; delete uses a confirm modal.
 */
@Component({
  selector: 'app-promo-codes',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonComponent, ColumnComponent, DataTableComponent,
    DrawerComponent, FilterPillComponent, FilterSelectComponent,
    IconComponent, InputComponent, ModalComponent, StatusPillComponent,
  ],
  template: `
    <div class="pc">
      <header class="pc__head">
        <div>
          <h1 class="pc__title">Promo Codes</h1>
          <p class="pc__sub">Code-based cash bonuses riders can redeem in this city.</p>
        </div>
        <tm-button variant="green" icon="plus" [disabled]="cityId == null" (clicked)="openCreate()">
          Add promo code
        </tm-button>
      </header>

      <!-- No city -->
      <div class="cue" *ngIf="cityId == null">
        <tm-icon name="map-marker" [size]="24" />
        <p class="cue__title">No city selected</p>
        <p class="cue__text">Pick a city from the switcher in the top bar to manage promo codes.</p>
      </div>

      <tm-data-table
        *ngIf="cityId != null"
        [rows]="pageRows"
        [total]="total"
        [page]="page"
        [pageSize]="pageSize"
        [loading]="loading"
        emptyTitle="No promo codes"
        emptyHint="Create a promo code, or try a different search."
        (pageChange)="onPage($event)"
        (pageSizeChange)="onPageSize($event)"
      >
        <tm-input
          slot="search"
          icon="search"
          placeholder="Search by code"
          [(ngModel)]="search"
          (ngModelChange)="onSearchChange()"
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
          <tm-filter-pill *ngIf="search.trim()" icon="search" label="Search" [value]="search" (clear)="clearSearch()" />
          <tm-filter-pill *ngIf="status !== 'active'" icon="bolt" label="Status" [value]="statusLabel()" (clear)="clearStatus()" />
        </ng-container>

        <tm-column key="code" label="Code" width="200">
          <ng-template let-row>
            <div class="cell-id">
              <span class="cell-code">{{ row.code }}</span>
              <span class="cell-sub" *ngIf="row.can_use_with_referral">Stacks with referral</span>
            </div>
          </ng-template>
        </tm-column>
        <tm-column key="amount" label="Bonus" width="150">
          <ng-template let-row>
            <span class="cell-strong">{{ row.amount }}</span>
            <span class="muted"> {{ row.bonus_type }}</span>
          </ng-template>
        </tm-column>
        <tm-column key="dates" label="Window" width="200">
          <ng-template let-row>{{ row.start_date }} → {{ row.end_date }}</ng-template>
        </tm-column>
        <tm-column key="validity_in_days" label="Validity" width="120">
          <ng-template let-row>{{ row.validity_in_days != null ? row.validity_in_days + ' days' : '—' }}</ng-template>
        </tm-column>
        <tm-column key="max_number" label="Max uses" width="120">
          <ng-template let-row>{{ row.max_number ?? 'Unlimited' }}</ng-template>
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
              <button class="icon-btn" (click)="openEdit(row)" aria-label="Edit promo code"><tm-icon name="edit" [size]="14" /></button>
              <button class="icon-btn icon-btn--danger" (click)="deleteTarget = row" aria-label="Delete promo code"><tm-icon name="trash" [size]="14" /></button>
            </div>
          </ng-template>
        </tm-column>
      </tm-data-table>
    </div>

    <!-- Drawer -->
    <tm-drawer
      [open]="open"
      [title]="editingId ? 'Edit promo code' : 'Add promo code'"
      [width]="520"
      (closed)="open = false"
    >
      <div slot="body" class="form">
        <label class="field">
          <span class="field__lbl">Promo code <i>*</i></span>
          <input type="text" [(ngModel)]="form.code" (ngModelChange)="touched = true"
                 placeholder="WELCOME10" class="mono" />
          <span class="field__err" *ngIf="touched && !form.code.trim()">Code is required.</span>
        </label>
        <div class="row">
          <label class="field">
            <span class="field__lbl">Bonus amount <i>*</i></span>
            <input type="number" min="0" step="0.01" [(ngModel)]="form.amount" />
          </label>
          <label class="field">
            <span class="field__lbl">Bonus type</span>
            <select [(ngModel)]="form.bonus_type">
              <option value="cash">Cash</option>
            </select>
          </label>
        </div>
        <div class="row">
          <label class="field">
            <span class="field__lbl">Max uses</span>
            <input type="number" min="0" [(ngModel)]="form.max_number" />
          </label>
          <label class="field">
            <span class="field__lbl">Validity (days)</span>
            <input type="number" min="0" [(ngModel)]="form.validity_in_days" />
          </label>
        </div>
        <div class="row">
          <label class="field">
            <span class="field__lbl">Start date <i>*</i></span>
            <input type="date" [(ngModel)]="form.start_date" (ngModelChange)="touched = true" />
            <span class="field__err" *ngIf="touched && !form.start_date">Start date is required.</span>
          </label>
          <label class="field">
            <span class="field__lbl">End date <i>*</i></span>
            <input type="date" [(ngModel)]="form.end_date" (ngModelChange)="touched = true" />
            <span class="field__err" *ngIf="touched && !form.end_date">End date is required.</span>
          </label>
        </div>
        <label class="toggle">
          <input type="checkbox" [(ngModel)]="form.can_use_with_referral" />
          <span>Can be used together with a referral</span>
        </label>
        <label class="toggle">
          <input type="checkbox" [(ngModel)]="form.is_active" />
          <span>Active</span>
        </label>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="open = false">Cancel</tm-button>
        <tm-button variant="green" [disabled]="!form.code.trim() || saving" (clicked)="submit()">
          {{ saving ? 'Saving…' : editingId ? 'Save changes' : 'Create' }}
        </tm-button>
      </div>
    </tm-drawer>

    <!-- Give-to-users modal: Select customers OR Import CSV -->
    <tm-modal [open]="!!giveTarget" [title]="'Give code: ' + (giveTarget?.code || '')" (closed)="closeGive()">
      <div slot="body" class="give">
        <div class="give-tabs">
          <button class="give-tab" [class.is-on]="giveTab === 'customers'" (click)="giveTab = 'customers'">
            Select from customers
          </button>
          <button class="give-tab" [class.is-on]="giveTab === 'csv'" (click)="giveTab = 'csv'">
            Import from CSV
          </button>
        </div>

        <ng-container *ngIf="giveTab === 'customers'">
          <label class="search--inline">
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
            <div class="muted small" style="padding:18px 0; text-align:center">No customers found.</div>
          </ng-template>
          <div class="give-paginator" *ngIf="customerRows.length">
            <span class="muted small">{{ selectedUserIds.size }} selected · Page {{ customerPage }} of {{ customerLastPage }}</span>
            <div>
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
            <input type="text" [(ngModel)]="giveForm.reason" placeholder="Why this code is being issued" />
          </label>
          <label class="field">
            <span class="field__lbl">Push message</span>
            <textarea rows="3" [(ngModel)]="giveForm.push_message" placeholder="Optional notification message"></textarea>
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
    <tm-modal [open]="!!deleteTarget" title="Delete promo code" (closed)="deleteTarget = null">
      <div slot="body"><p>Delete promo code <strong>{{ deleteTarget?.code }}</strong>? This cannot be undone.</p></div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="deleteTarget = null">Cancel</tm-button>
        <tm-button variant="danger" [disabled]="saving" (clicked)="confirmDelete()">Delete</tm-button>
      </div>
    </tm-modal>
  `,
  styles: [`
    .pc { display: flex; flex-direction: column; gap: 16px; }
    .pc__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .pc__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .pc__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); }

    .cue {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 48px 24px; text-align: center;
      background: var(--tm-surface);
      border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg);
      color: var(--tm-text-muted);
    }
    .cue__title { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .cue__text { margin: 0; font-size: 13px; }

    /* cell renderers */
    .cell-id { display: flex; flex-direction: column; min-width: 0; }
    .cell-code {
      font-family: var(--tm-font-mono, monospace);
      font-size: 14px; font-weight: 800; color: var(--tm-text); letter-spacing: 0.5px;
    }
    .cell-sub { font-size: 11px; color: var(--tm-text-muted); }
    .cell-strong { color: var(--tm-text); font-weight: 700; }
    .cell-actions { display: inline-flex; gap: 6px; }

    /* Give-to-users modal — mirrors the coupons admin modal. */
    .give { display: flex; flex-direction: column; gap: 14px; width: 100%; box-sizing: border-box; }
    .give *, .give *::before, .give *::after { box-sizing: border-box; }
    .give-tabs {
      display: flex; gap: 4px; padding: 4px; width: 100%;
      background: var(--tm-canvas-2); border-radius: 10px;
    }
    .give-tab {
      flex: 1; padding: 8px 14px; border-radius: 8px;
      background: transparent; cursor: pointer; border: none;
      font-size: 13px; font-weight: 700; color: var(--tm-text-muted); text-align: center;
    }
    .give-tab.is-on { background: var(--tm-surface); color: var(--tm-text); box-shadow: var(--tm-shadow-sm); }
    .search--inline {
      display: flex; align-items: center; gap: 6px;
      padding: 7px 10px; width: 100%;
      background: var(--tm-canvas); border: 1px solid var(--tm-line); border-radius: 8px;
      color: var(--tm-text-muted);
    }
    .search--inline input {
      border: none; outline: none; background: transparent; flex: 1; min-width: 0;
      color: var(--tm-text); font-size: 13px; font-family: inherit;
    }
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
    .strong { color: var(--tm-text); font-weight: 700; }
    .muted { color: var(--tm-text-muted); }
    .small { font-size: 11px; }
    .give-paginator {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
    }
    .pg-btn {
      padding: 6px 12px; border-radius: 8px;
      border: 1px solid var(--tm-line); background: var(--tm-surface);
      color: var(--tm-text); font-size: 12px; font-weight: 700; cursor: pointer; margin-left: 4px;
    }
    .pg-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .csv-drop {
      display: flex; align-items: center; gap: 12px;
      padding: 18px; cursor: pointer;
      background: var(--tm-canvas); border: 1px dashed var(--tm-line); border-radius: 10px;
    }
    .csv-drop:hover { border-color: var(--tm-green); }
    .link-btn {
      display: inline-flex; align-items: center; gap: 4px;
      color: var(--tm-green); font-size: 12px; font-weight: 700;
      background: transparent; cursor: pointer; padding: 0; border: none;
    }
    .give-fields {
      display: flex; flex-direction: column; gap: 12px;
      padding-top: 8px; border-top: 1px solid var(--tm-line);
    }
    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 7px;
      background: var(--tm-canvas-2); color: var(--tm-text-muted); cursor: pointer;
    }
    .icon-btn:hover { background: var(--tm-ink); color: #fff; }
    .icon-btn--danger:hover { background: var(--tm-danger, #ef4444); }

    /* form */
    .form { display: flex; flex-direction: column; gap: 14px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .field__lbl { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .field__lbl i { color: var(--tm-danger, #ef4444); font-style: normal; }
    .field input, .field select {
      width: 100%; padding: 9px 11px;
      border: 1px solid var(--tm-line); border-radius: 9px;
      background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13px; outline: none; font-family: inherit;
    }
    .field input:focus, .field select:focus { border-color: var(--tm-green); }
    .field input.mono { font-family: var(--tm-font-mono, monospace); text-transform: uppercase; }
    .field__err { font-size: 11px; font-weight: 600; color: var(--tm-danger, #ef4444); }
    .toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--tm-text); }
    .toggle input { width: 16px; height: 16px; }
  `],
})
export class PromoCodesComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  rows: PromoCodeRow[] = [];

  // ── Filter / search / pagination ────────────────────────────────
  status: 'active' | 'inactive' = 'active';
  statusOptions = [{ label: 'Inactive', value: 'inactive' }];
  search = '';
  page = 1;
  pageSize = 25;
  loading = false;
  pageRows: PromoCodeRow[] = [];
  total = 0;
  private searchDebounce: any = null;

  open = false;
  editingId: number | null = null;
  saving = false;
  touched = false;
  form = this.blankForm();
  deleteTarget: PromoCodeRow | null = null;

  // Give-to-users state — same shape as the coupons admin page.
  giveTarget: PromoCodeRow | null = null;
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

  private sub?: Subscription;

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.sub = this.cityCtx.cityId$.subscribe((id) => {
      this.cityId = id;
      if (id != null) this.fetch();
      else this.rows = [];
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
    this.custSearchSub?.unsubscribe();
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
  }

  fetch(): void {
    if (this.cityId == null) return;
    const active = this.status === 'active' ? '1' : '0';
    this.loading = true;
    this.api.get<{ data: PromoCodeRow[] }>(`/admin/cities/${this.cityId}/promo-codes?is_active=${active}`)
      .subscribe({
        next: (r) => {
          this.rows = r.data ?? [];
          this.loading = false;
          this.applyView();
        },
        error: () => {
          this.loading = false;
          this.toast.error('Failed to load promo codes');
        },
      });
  }

  // ── Filtering + client-side pagination ──────────────────────────
  private applyView(): void {
    const q = this.search.trim().toLowerCase();
    let list = this.rows;
    if (q) list = list.filter((r) => r.code.toLowerCase().includes(q));
    this.total = list.length;
    const maxPage = Math.max(1, Math.ceil(this.total / this.pageSize));
    if (this.page > maxPage) this.page = maxPage;
    const start = (this.page - 1) * this.pageSize;
    this.pageRows = list.slice(start, start + this.pageSize);
  }

  onSearchChange(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => {
      this.page = 1;
      this.applyView();
    }, 250);
  }
  clearSearch(): void {
    this.search = '';
    this.page = 1;
    this.applyView();
  }

  statusLabel(): string {
    return this.status === 'inactive' ? 'Inactive' : 'Active';
  }
  onStatusChange(value: string): void {
    this.status = value as 'active' | 'inactive';
    this.page = 1;
    this.fetch();
  }
  clearStatus(): void {
    if (this.status === 'active') return;
    this.status = 'active';
    this.page = 1;
    this.fetch();
  }

  onPage(p: number): void {
    this.page = p;
    this.applyView();
  }
  onPageSize(s: number): void {
    this.pageSize = s;
    this.page = 1;
    this.applyView();
  }

  blankForm() {
    return {
      code: '',
      max_number: null as number | null,
      start_date: '' as string,
      end_date: '' as string,
      validity_in_days: 30 as number | null,
      bonus_type: 'cash',
      can_use_with_referral: false,
      amount: 0,
      is_active: true,
    };
  }

  openCreate(): void {
    this.editingId = null;
    this.touched = false;
    this.form = this.blankForm();
    this.open = true;
  }

  openEdit(r: PromoCodeRow): void {
    this.editingId = r.id;
    this.touched = false;
    this.form = {
      code: r.code,
      max_number: r.max_number,
      start_date: (r.start_date || '').slice(0, 10),
      end_date: (r.end_date || '').slice(0, 10),
      validity_in_days: r.validity_in_days,
      bonus_type: r.bonus_type,
      can_use_with_referral: r.can_use_with_referral,
      amount: r.amount,
      is_active: r.is_active,
    };
    this.open = true;
  }

  submit(): void {
    this.touched = true;
    if (this.cityId == null || this.saving) return;
    if (!this.form.code.trim() || !this.form.start_date || !this.form.end_date) return;
    this.saving = true;
    const body: any = { ...this.form, code: this.form.code.trim() };
    const path = this.editingId
      ? `/admin/cities/${this.cityId}/promo-codes/${this.editingId}`
      : `/admin/cities/${this.cityId}/promo-codes`;
    const req$ = this.editingId ? this.api.patch(path, body) : this.api.post(path, body);
    req$.subscribe({
      next: () => {
        this.saving = false;
        this.open = false;
        this.toast.success(this.editingId ? 'Promo code updated' : 'Promo code created');
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
    this.api.delete(`/admin/cities/${this.cityId}/promo-codes/${r.id}`).subscribe({
      next: () => {
        this.saving = false;
        this.deleteTarget = null;
        this.toast.success('Promo code deleted');
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

  // ── Give-to-users modal ─────────────────────────────────────────────
  openGive(r: PromoCodeRow): void {
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
    a.download = 'promo_code_recipients_sample.csv';
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
          // AdminCustomersController nests Laravel's paginator under `data`.
          const payload = r?.data ?? {};
          const rows: CustomerRow[] = Array.isArray(payload) ? payload : (payload.data ?? []);
          this.customerRows = rows;
          if (!Array.isArray(payload) && typeof payload === 'object') {
            this.customerPage = payload.current_page ?? this.customerPage;
            this.customerLastPage = payload.last_page ?? this.customerLastPage;
            this.customerPerPage = payload.per_page ?? this.customerPerPage;
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
      fd.append('expires_at', new Date(this.giveForm.expires_at).toISOString());
    }
    if (this.giveTab === 'customers') {
      Array.from(this.selectedUserIds).forEach((id) => fd.append('user_ids[]', String(id)));
    } else if (this.csvFile) {
      fd.append('csv', this.csvFile);
    }

    this.api
      .postMultipart<{ assigned_count: number; skipped_invalid: number; message: string }>(
        `/admin/cities/${this.cityId}/promo-codes/${this.giveTarget.id}/give`,
        fd,
      )
      .subscribe({
        next: (r) => {
          this.giving = false;
          this.toast.success(r?.message || 'Promo code issued.');
          this.closeGive();
        },
        error: (e) => {
          this.giving = false;
          this.toast.error(e?.error?.message || 'Failed to issue promo code');
        },
      });
  }
}
