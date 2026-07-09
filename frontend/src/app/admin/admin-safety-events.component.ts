import { AfterViewInit, Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import $ from 'jquery';
import moment from 'moment';
import 'daterangepicker';
import { ApiService } from '../core/api.service';
import {
  ColumnComponent,
  DataTableComponent,
  IconComponent,
  InputComponent,
  StatusPillComponent,
  StatusTone,
} from '../ui';

type SafetyStatus = 'all' | 'CREATED' | 'SENT' | 'RESOLVED';

const SAFETY_STATUS_OPTIONS: { value: Exclude<SafetyStatus, 'all'>; label: string }[] = [
  { value: 'CREATED', label: 'Created' },
  { value: 'SENT', label: 'Sent' },
  { value: 'RESOLVED', label: 'Resolved' },
];

interface SafetyInitiator {
  id: number;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

interface SafetyEventRow {
  id: number;
  trip_id?: number | null;
  type?: string | null;
  initiator?: SafetyInitiator | null;
  status: Exclude<SafetyStatus, 'all'>;
  lat?: number | string | null;
  lng?: number | string | null;
  payload?: { note?: string | null } | null;
  resolved_at?: string | null;
  created_at?: string | null;
}

interface PaginatedSafetyEvents {
  data: SafetyEventRow[];
  current_page?: number;
  last_page?: number;
  per_page?: number;
  total?: number;
}

@Component({
  selector: 'app-admin-safety-events',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ColumnComponent,
    DataTableComponent,
    IconComponent,
    InputComponent,
    StatusPillComponent,
  ],
  template: `
    <div class="page">
      <header class="hero">
        <div class="hero__copy">
          <h1>SOS Incidents</h1>
        </div>
      </header>

      <section class="metrics" aria-label="SOS summary">
        <article class="metric metric--danger">
          <span class="metric__label">Total incidents</span>
          <strong>{{ total | number }}</strong>
          <small>matching filters</small>
        </article>
        <article class="metric">
          <span class="metric__label">Open on page</span>
          <strong>{{ openOnPage | number }}</strong>
          <small>created or sent</small>
        </article>
        <article class="metric metric--success">
          <span class="metric__label">Resolved on page</span>
          <strong>{{ resolvedOnPage | number }}</strong>
          <small>closed incidents</small>
        </article>
        <article class="metric">
          <span class="metric__label">With location</span>
          <strong>{{ locatedOnPage | number }}</strong>
          <small>lat/lng captured</small>
        </article>
      </section>

      <tm-data-table
        class="sos-table"
        [rows]="events"
        [total]="total"
        [page]="page"
        [pageSize]="pageSize"
        [pageSizes]="[10, 20, 50, 100]"
        [loading]="loading"
        emptyTitle="No SOS incidents"
        emptyHint="Try clearing filters or changing the date range."
        (pageChange)="onPageChange($event)"
        (pageSizeChange)="onPageSizeChange($event)"
      >
        <tm-input
          slot="search"
          icon="search"
          placeholder="Search ID, trip, name, phone or email"
          [(ngModel)]="search"
          (ngModelChange)="onSearchChange()"
        />

        <ng-container slot="filters">
          <div class="state-select" [class.has-value]="status !== 'all'" [class.is-open]="statusOpen">
            <button
              type="button"
              class="state-select__trigger"
              (click)="toggleStatusMenu($event)"
              [attr.aria-expanded]="statusOpen"
              aria-haspopup="listbox"
              aria-label="Status filter"
            >
              <span class="state-select__icon" aria-hidden="true"><tm-icon name="shield" [size]="14" /></span>
              <span class="state-select__value">{{ statusLabel() }}</span>
              <tm-icon name="chevron-down" [size]="12" class="state-select__caret" />
            </button>
            <ul class="state-select__menu" *ngIf="statusOpen" role="listbox" (click)="$event.stopPropagation()">
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

          <div class="date-range" [class.has-value]="dateFrom || dateTo">
            <span class="date-range__icon" aria-hidden="true"><tm-icon name="calendar" [size]="14" /></span>
            <input
              #rangeInput
              type="text"
              readonly
              class="date-range__input"
              placeholder="Created · any date"
              [value]="rangeLabel"
              aria-label="Filter by created date range"
            />
          </div>
        </ng-container>

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
          <span class="filter-pill" *ngIf="dateFrom || dateTo">
            <span class="filter-pill__icon"><tm-icon name="calendar" [size]="11" /></span>
            <span class="filter-pill__label">Created</span>
            <span class="filter-pill__value">{{ formatDateShort(dateFrom) }} → {{ formatDateShort(dateTo) }}</span>
            <button type="button" class="filter-pill__close" (click)="clearDateRange()" aria-label="Clear date range">
              <tm-icon name="x" [size]="12" />
            </button>
          </span>
          <span class="error" *ngIf="error">
            <tm-icon name="shield" [size]="16" /> {{ error }}
          </span>
        </ng-container>

        <tm-column key="id" label="Incident" width="120">
          <ng-template let-row>
            <div class="incident-id">
              <strong>#{{ row.id }}</strong>
              <span>{{ row.type || 'SOS' }}</span>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="trip_id" label="Trip" width="110">
          <ng-template let-row>
            <span class="mono">{{ row.trip_id ? ('#' + row.trip_id) : '-' }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="initiator" label="Initiator" width="240">
          <ng-template let-row>
            <div class="person">
              <strong>{{ row.initiator?.name || 'Unknown user' }}</strong>
              <span>{{ row.initiator?.phone || row.initiator?.email || ('User #' + row.initiator?.id) }}</span>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="status" label="Status" width="130">
          <ng-template let-row>
            <tm-status-pill [tone]="statusTone(row.status)">{{ statusLabel(row.status) }}</tm-status-pill>
          </ng-template>
        </tm-column>

        <tm-column key="location" label="Location" width="190">
          <ng-template let-row>
            <div class="location" *ngIf="hasLocation(row); else noLocation">
              <span>{{ row.lat }}</span>
              <span>{{ row.lng }}</span>
            </div>
            <ng-template #noLocation><span class="muted">Not captured</span></ng-template>
          </ng-template>
        </tm-column>

        <tm-column key="note" label="Note" [wrap]="true">
          <ng-template let-row>
            <span class="note">{{ row.payload?.note || '-' }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="created_at" label="Created" width="170">
          <ng-template let-row>
            <div class="date-cell">
              <strong>{{ row.created_at | date:'MMM d, y' }}</strong>
              <span>{{ row.created_at | date:'shortTime' }}</span>
            </div>
          </ng-template>
        </tm-column>
      </tm-data-table>

      <section class="mobile-list" aria-label="SOS incidents mobile list">
        <article class="incident-card" *ngFor="let row of events; trackBy: trackByEvent">
          <div class="incident-card__head">
            <div>
              <strong>#{{ row.id }}</strong>
              <span>{{ row.created_at | date:'medium' }}</span>
            </div>
            <tm-status-pill [tone]="statusTone(row.status)">{{ statusLabel(row.status) }}</tm-status-pill>
          </div>
          <div class="incident-card__grid">
            <div><span>Trip</span><strong>{{ row.trip_id ? ('#' + row.trip_id) : '-' }}</strong></div>
            <div><span>Initiator</span><strong>{{ row.initiator?.name || 'Unknown' }}</strong></div>
            <div><span>Contact</span><strong>{{ row.initiator?.phone || row.initiator?.email || '-' }}</strong></div>
            <div><span>Location</span><strong>{{ hasLocation(row) ? (row.lat + ', ' + row.lng) : '-' }}</strong></div>
          </div>
          <p *ngIf="row.payload?.note">{{ row.payload?.note }}</p>
        </article>
        <div class="mobile-empty" *ngIf="!loading && !events.length">No SOS incidents found.</div>
      </section>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .page { display: flex; flex-direction: column; gap: 18px; }
    .hero {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
      padding: 22px; border: 1px solid var(--tm-line); border-radius: 8px;
      background: linear-gradient(135deg, #fff 0%, #fff7f7 54%, #f5fbff 100%);
      box-shadow: var(--tm-shadow-sm);
    }
    .hero__copy { min-width: 0; }
    h1 { margin: 0; color: var(--tm-text); font-size: clamp(26px, 3vw, 38px); line-height: 1.05; letter-spacing: 0; }
    .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .metric { min-width: 0; border: 1px solid var(--tm-line); border-radius: 8px; background: #fff; padding: 16px; box-shadow: var(--tm-shadow-sm); }
    .metric__label { display: block; color: var(--tm-text-muted); font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
    .metric strong { display: block; margin-top: 8px; color: var(--tm-text); font-size: 30px; line-height: 1; font-family: var(--tm-font-mono); }
    .metric small { display: block; margin-top: 6px; color: var(--tm-text-soft); font-size: 12px; font-weight: 700; }
    .metric--danger strong { color: var(--tm-danger, #dc2626); }
    .metric--success strong { color: var(--tm-success, #16a34a); }
    .state-select { position: relative; display: inline-block; }
    .state-select__trigger {
      display: inline-flex; align-items: center; gap: 8px; min-height: 40px;
      padding: 9px 14px; border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-md);
      background: transparent; font-family: var(--tm-font-body); font-size: 13px; font-weight: 700;
      color: var(--tm-text); cursor: pointer; line-height: 1.2;
      transition: border-color var(--tm-duration-fast) var(--tm-ease), background var(--tm-duration-fast) var(--tm-ease);
    }
    .state-select__trigger:hover, .state-select.is-open .state-select__trigger { border-color: var(--tm-ink); }
    .state-select.has-value .state-select__trigger { background: var(--tm-green-tint); border-color: var(--tm-green-deep); }
    .state-select__icon { color: var(--tm-text-muted); display: inline-flex; }
    .state-select.has-value .state-select__icon { color: var(--tm-green-deep); }
    .state-select__value { min-width: 110px; text-align: left; }
    .state-select__caret { color: var(--tm-text-soft); transition: transform var(--tm-duration-fast) var(--tm-ease); }
    .state-select.is-open .state-select__caret { transform: rotate(180deg); }
    .state-select.has-value .state-select__caret { color: var(--tm-green-deep); }
    .state-select__menu {
      position: absolute; top: calc(100% + 6px); left: 0; right: 0; min-width: 200px;
      margin: 0; padding: 6px; list-style: none; background: var(--tm-surface);
      border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-md); box-shadow: var(--tm-shadow-pop);
      z-index: 1100; max-height: 320px; overflow-y: auto; animation: state-select-in 140ms var(--tm-ease) both;
    }
    @keyframes state-select-in {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .state-select__option {
      display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: var(--tm-radius-sm);
      font-size: 12px; font-weight: 600; color: var(--tm-text); cursor: pointer;
      transition: background var(--tm-duration-fast) var(--tm-ease);
    }
    .state-select__option:hover { background: var(--tm-canvas-2); }
    .state-select__option.is-selected { background: var(--tm-green-tint); color: var(--tm-green-deep); font-weight: 700; }
    .state-select__option-check { color: var(--tm-green-deep); flex-shrink: 0; }
    .state-select__option-label { flex: 1; }

    .date-range {
      display: inline-flex; align-items: center; gap: 8px; min-height: 40px;
      padding: 8px 8px 8px 14px; border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-md);
      background: transparent; line-height: 1; cursor: pointer;
      transition: border-color var(--tm-duration-fast) var(--tm-ease), background var(--tm-duration-fast) var(--tm-ease);
    }
    .date-range:focus-within { border-color: var(--tm-ink); }
    .date-range.has-value { background: var(--tm-green-tint); border-color: var(--tm-green-deep); }
    .date-range__icon { color: var(--tm-text-muted); display: inline-flex; }
    .date-range.has-value .date-range__icon { color: var(--tm-green-deep); }
    .date-range__input {
      appearance: none; -webkit-appearance: none; background: transparent; border: 0; outline: 0;
      font-family: var(--tm-font-mono); font-size: 12px; font-weight: 600; color: var(--tm-text);
      padding: 0; min-width: 220px; cursor: pointer; line-height: 1.2;
    }
    .date-range__input::placeholder { color: var(--tm-text-soft); }
    :host ::ng-deep .daterangepicker {
      font-family: var(--tm-font-body) !important; border-radius: var(--tm-radius-md);
      border: 1px solid var(--tm-line-2); box-shadow: var(--tm-shadow-pop);
    }
    :host ::ng-deep .daterangepicker .btn-primary,
    :host ::ng-deep .daterangepicker .btn-success {
      background: var(--tm-ink); border-color: var(--tm-ink); border-radius: var(--tm-radius-sm); font-weight: 700;
    }
    :host ::ng-deep .daterangepicker .ranges li.active,
    :host ::ng-deep .daterangepicker td.active,
    :host ::ng-deep .daterangepicker td.active:hover { background: var(--tm-ink); color: #fff; }
    :host ::ng-deep .daterangepicker td.in-range { background: var(--tm-green-tint); color: var(--tm-green-deep); }

    .filter-pill {
      display: inline-flex; align-items: center; gap: 8px; margin-right: 8px;
      padding: 6px 6px 6px 12px; border-radius: var(--tm-radius-pill);
      background: var(--tm-surface); border: 1px solid var(--tm-line-2);
      font-size: 12px; font-weight: 700; color: var(--tm-text);
    }
    .filter-pill__icon { display: inline-flex; color: var(--tm-text-muted); }
    .filter-pill__label {
      font-size: 10px; font-weight: 800; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--tm-text-muted);
    }
    .filter-pill__value { font-family: var(--tm-font-mono); font-weight: 700; color: var(--tm-text); }
    .filter-pill__close {
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px; border-radius: 50%;
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
      transition: background var(--tm-duration-fast) var(--tm-ease), color var(--tm-duration-fast) var(--tm-ease);
    }
    .filter-pill__close:hover { background: var(--tm-ink); color: #fff; }
    .error { display: inline-flex; align-items: center; gap: 8px; color: var(--tm-danger-fg); background: var(--tm-danger-bg); border: 1px solid color-mix(in srgb, var(--tm-danger) 24%, transparent); border-radius: 8px; padding: 10px 12px; font-weight: 750; }
    .incident-id, .person, .date-cell { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .incident-id strong, .person strong, .date-cell strong { color: var(--tm-text); font-weight: 850; }
    .incident-id span, .person span, .date-cell span, .muted { color: var(--tm-text-muted); font-size: 12px; }
    .mono { font-family: var(--tm-font-mono); }
    .location { display: flex; flex-direction: column; gap: 3px; font-family: var(--tm-font-mono); font-size: 12px; color: var(--tm-text); }
    .note { color: var(--tm-text-muted); }
    .mobile-list { display: none; }
    :host ::ng-deep tm-data-table .tm-dt__toolbar { align-items: center; }
    :host ::ng-deep tm-data-table .tm-dt__toolbar-right { align-items: center; gap: 8px; flex-wrap: wrap; }
    :host ::ng-deep tm-data-table .tm-dt__toolbar tm-input .field { min-width: min(380px, 100%); }

    @media (max-width: 1180px) {
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      :host ::ng-deep tm-data-table .tm-dt__toolbar { align-items: stretch; }
      :host ::ng-deep tm-data-table .tm-dt__toolbar-left,
      :host ::ng-deep tm-data-table .tm-dt__toolbar-right { width: 100%; }
      :host ::ng-deep tm-data-table .tm-dt__toolbar tm-input .field { min-width: 0; width: 100%; }
      .state-select, .date-range { flex: 1 1 220px; }
      .state-select__trigger, .date-range { width: 100%; }
    }

    @media (max-width: 760px) {
      .hero { flex-direction: column; padding: 18px; }
      .metrics { grid-template-columns: 1fr; }
      .metric { padding: 14px; }
      .state-select, .date-range { width: 100%; flex: 1 1 100%; }
      .state-select__trigger, .date-range { width: 100%; }
      .date-range__input { min-width: 0; width: 100%; }
      .sos-table { display: none; }
      .mobile-list { display: flex; flex-direction: column; gap: 10px; }
      .incident-card { border: 1px solid var(--tm-line); border-radius: 8px; background: #fff; padding: 14px; box-shadow: var(--tm-shadow-sm); }
      .incident-card__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
      .incident-card__head > div { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
      .incident-card__head strong { color: var(--tm-text); font-size: 16px; }
      .incident-card__head span { color: var(--tm-text-muted); font-size: 12px; }
      .incident-card__grid { display: grid; grid-template-columns: 1fr; gap: 9px; margin-top: 12px; }
      .incident-card__grid div { display: flex; justify-content: space-between; gap: 12px; padding-top: 9px; border-top: 1px solid var(--tm-line); }
      .incident-card__grid span { color: var(--tm-text-muted); font-size: 12px; font-weight: 750; }
      .incident-card__grid strong { color: var(--tm-text); text-align: right; overflow-wrap: anywhere; }
      .incident-card p { margin-top: 12px; padding: 10px; border-radius: 8px; background: var(--tm-canvas-2); color: var(--tm-text-muted); }
      .mobile-empty { border: 1px dashed var(--tm-line); border-radius: 8px; padding: 18px; text-align: center; color: var(--tm-text-muted); font-weight: 750; }
    }
  `],
})
export class AdminSafetyEventsComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('rangeInput', { static: false }) rangeInput!: ElementRef<HTMLInputElement>;
  events: SafetyEventRow[] = [];
  loading = false;
  error: string | null = null;

  search = '';
  status: SafetyStatus = 'all';
  statusOpen = false;
  statusOptions = SAFETY_STATUS_OPTIONS;
  dateFrom = '';
  dateTo = '';

  page = 1;
  pageSize = 20;
  total = 0;

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private api: ApiService, private zone: NgZone) {}

  ngOnInit(): void {
    this.reload();
  }

  ngAfterViewInit(): void {
    this.initDateRangePicker();
  }

  ngOnDestroy(): void {
    this.destroyDateRangePicker();
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  get hasFilters(): boolean {
    return !!this.search.trim() || this.status !== 'all' || !!this.dateFrom || !!this.dateTo;
  }

  get openOnPage(): number {
    return this.events.filter((row) => row.status === 'CREATED' || row.status === 'SENT').length;
  }

  get resolvedOnPage(): number {
    return this.events.filter((row) => row.status === 'RESOLVED').length;
  }

  get locatedOnPage(): number {
    return this.events.filter((row) => this.hasLocation(row)).length;
  }

  reload(): void {
    this.loading = true;
    this.error = null;

    const params = new URLSearchParams({
      page: String(this.page),
      per_page: String(this.pageSize),
    });

    const q = this.search.trim();
    if (q) params.set('search', q);
    if (this.status !== 'all') params.set('status', this.status);
    if (this.dateFrom) params.set('date_from', this.dateFrom);
    if (this.dateTo) params.set('date_to', this.dateTo);

    this.api.get<{ data: PaginatedSafetyEvents }>(`/admin/safety-events?${params.toString()}`).subscribe({
      next: (res) => {
        const page = res?.data;
        this.events = page?.data || [];
        this.total = page?.total ?? this.events.length;
        this.page = page?.current_page ?? this.page;
        this.pageSize = page?.per_page ?? this.pageSize;
        this.loading = false;
      },
      error: (err) => {
        this.events = [];
        this.total = 0;
        this.loading = false;
        this.error = err?.error?.message || 'Failed to load SOS incidents';
      },
    });
  }

  onSearchChange(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.applyFilters(), 300);
  }

  applyFilters(): void {
    this.page = 1;
    this.reload();
  }

  clearFilters(): void {
    if (!this.hasFilters) return;
    this.search = '';
    this.status = 'all';
    this.statusOpen = false;
    this.dateFrom = '';
    this.dateTo = '';
    this.applyFilters();
  }

  clearSearch(): void {
    if (!this.search) return;
    this.search = '';
    this.applyFilters();
  }

  clearStatus(): void {
    if (this.status === 'all') return;
    this.status = 'all';
    this.statusOpen = false;
    this.applyFilters();
  }


  toggleStatusMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.statusOpen = !this.statusOpen;
  }

  selectStatus(value: SafetyStatus): void {
    this.statusOpen = false;
    if (this.status === value) return;
    this.status = value;
    this.applyFilters();
  }

  get rangeLabel(): string {
    if (!this.dateFrom && !this.dateTo) return '';
    return `${this.formatDateShort(this.dateFrom)} → ${this.formatDateShort(this.dateTo)}`;
  }

  clearDateRange(): void {
    if (!this.dateFrom && !this.dateTo) return;
    this.dateFrom = '';
    this.dateTo = '';
    this.applyFilters();
  }

  formatDateShort(iso: string): string {
    if (!iso) return 'any';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'any';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}-${mm}-${yy}`;
  }

  onPageChange(page: number): void {
    this.page = page;
    this.reload();
  }

  onPageSizeChange(size: number): void {
    this.pageSize = size;
    this.page = 1;
    this.reload();
  }

  hasLocation(row: SafetyEventRow): boolean {
    return row.lat !== null && row.lat !== undefined && row.lat !== '' && row.lng !== null && row.lng !== undefined && row.lng !== '';
  }

  statusLabel(status: SafetyStatus = this.status): string {
    if (status === 'all') return 'All statuses';
    return this.statusOptions.find((opt) => opt.value === status)?.label ?? 'All statuses';
  }

  statusTone(status: SafetyStatus): StatusTone {
    if (status === 'RESOLVED') return 'success';
    if (status === 'SENT') return 'warning';
    if (status === 'CREATED') return 'danger';
    return 'neutral';
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.statusOpen) this.statusOpen = false;
  }

  @HostListener('document:keydown.escape')
  onDocumentEscape(): void {
    if (this.statusOpen) this.statusOpen = false;
  }

  private initDateRangePicker(): void {
    if (!this.rangeInput?.nativeElement) return;
    const $el = $(this.rangeInput.nativeElement);
    $el.daterangepicker(
      {
        autoApply: true,
        autoUpdateInput: false,
        opens: 'left',
        maxDate: moment(),
        alwaysShowCalendars: true,
        locale: { format: 'YYYY-MM-DD', cancelLabel: 'Clear', applyLabel: 'Apply' },
        ranges: {
          Today: [moment(), moment()],
          Yesterday: [moment().subtract(1, 'days'), moment().subtract(1, 'days')],
          'Last 7 days': [moment().subtract(6, 'days'), moment()],
          'Last 30 days': [moment().subtract(29, 'days'), moment()],
          'This month': [moment().startOf('month'), moment().endOf('month')],
          'Last month': [
            moment().subtract(1, 'month').startOf('month'),
            moment().subtract(1, 'month').endOf('month'),
          ],
        },
      } as any,
      (start: moment.Moment, end: moment.Moment) => {
        this.zone.run(() => {
          this.dateFrom = start.format('YYYY-MM-DD');
          this.dateTo = end.format('YYYY-MM-DD');
          this.applyFilters();
        });
      },
    );
    $el.on('cancel.daterangepicker', () => {
      this.zone.run(() => this.clearDateRange());
    });
  }

  private destroyDateRangePicker(): void {
    if (!this.rangeInput?.nativeElement) return;
    const picker = ($(this.rangeInput.nativeElement) as any).data('daterangepicker');
    if (picker) picker.remove();
  }

  trackByEvent(_: number, row: SafetyEventRow): number {
    return row.id;
  }
}
