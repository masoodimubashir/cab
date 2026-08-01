import { Component, ElementRef, NgZone, OnInit, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import {
  ButtonComponent,
  IconComponent,
  DataTableComponent,
  ColumnComponent,
} from '../../ui';
import $ from 'jquery';
import moment from 'moment';
import 'daterangepicker';

/** One immutable money movement. The ledger is append-only — nothing is edited. */
interface LedgerRow {
  id: number;
  trip_id: number | null;
  payment_id: number | null;
  type: 'capture' | 'transfer' | 'held' | 'release' | 'retained' | 'refund' | 'reversal' | 'gateway_fee' | string;
  party: 'customer' | 'driver' | 'operator' | 'gateway' | string;
  direction: 'in' | 'out';
  amount: number;
  razorpay_ref: string | null;
  created_at: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  driver_name?: string | null;
  driver_phone?: string | null;
}

/** Per-trip proof that nothing was invented or lost. */
interface TripBalance {
  captured: number;
  driver_net: number;
  operator_net: number;
  gateway_fee: number;
  refunded: number;
  balanced: boolean;
  imbalance_paise: number;
}

/**
 * A row as the table actually renders it.
 */
interface DisplayRow extends LedgerRow {
  /** Set on a summary line; absent on real ledger rows. */
  group?: {
    key: string;
    label?: string;
    count: number;
    captured: number;
    toDriver: number;
    commission: number;
    refunded: number;
    customer_name?: string | null;
    customer_phone?: string | null;
    driver_name?: string | null;
    driver_phone?: string | null;
  };
  /** Set on a real row that sits underneath an expanded summary line. */
  child?: boolean;
}

interface LedgerResponse {
  rows: LedgerRow[];
  reconciliation: Record<string, TripBalance>;
  summary: {
    captured: number;
    to_driver: number;
    held: number;
    to_operator: number;
    gateway_fee: number;
    refunded: number;
    trips: number;
    unbalanced: number;
  };
}

@Component({
  selector: 'app-finance-ledger',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, IconComponent, DataTableComponent, ColumnComponent],
  template: `
    <div class="page">
      <header class="page__hero">
        <div>
          <h1 class="page__title">Money Ledger</h1>
          <p class="page__sub">
            Complete log of all rider payments, driver payouts, platform fees, and refunds.
          </p>
        </div>
        <div class="hero__side">
          <tm-button variant="outline" size="sm" icon="refresh" [loading]="loading" (clicked)="load()">Refresh</tm-button>
        </div>
      </header>

      <!-- Balance Status Banner -->
      <div class="verdict" [class.verdict--bad]="activeSummary.unbalanced > 0" *ngIf="!loading && !error">
        <span class="verdict__icon">
          <tm-icon [name]="activeSummary.unbalanced > 0 ? 'bell' : 'check'" [size]="18" />
        </span>
        <div class="verdict__body">
          <strong *ngIf="activeSummary.unbalanced === 0">All {{ activeSummary.trips }} trips are fully balanced.</strong>
          <strong *ngIf="activeSummary.unbalanced > 0">
            {{ activeSummary.unbalanced }} of {{ activeSummary.trips }} trips need review.
          </strong>
          <span>
            {{ activeSummary.unbalanced > 0
              ? 'Discrepancy detected between payments and payouts. Please review flagged trips.'
              : 'Payments match driver payouts, pending holds, and platform fees.' }}
          </span>
        </div>
        <tm-button
          *ngIf="activeSummary.unbalanced > 0 && !unbalancedOnly"
          variant="outline" size="sm"
          (clicked)="setUnbalanced(true)"
        >Show flagged trips</tm-button>
      </div>

      <!-- Stat Cards Summary -->
      <div class="cards" *ngIf="!loading && !error">
        <div class="card">
          <span class="card__label">Payments Received</span>
          <span class="card__value" [class.card__value--pulse]="cardsUpdating">₹ {{ activeSummary.captured | number:'1.2-2' }}</span>
          <span class="card__meta">from customers</span>
        </div>
        <div class="card card--driver">
          <span class="card__label">Driver Payouts</span>
          <span class="card__value" [class.card__value--pulse]="cardsUpdating">₹ {{ activeSummary.to_driver | number:'1.2-2' }}</span>
          <span class="card__meta">transferred to driver</span>
        </div>
        <div class="card card--held" *ngIf="activeSummary.held > 0">
          <span class="card__label">On Hold</span>
          <span class="card__value" [class.card__value--pulse]="cardsUpdating">₹ {{ activeSummary.held | number:'1.2-2' }}</span>
          <span class="card__meta">pending release</span>
        </div>
        <div class="card card--operator">
          <span class="card__label">Platform Fee</span>
          <span class="card__value" [class.card__value--pulse]="cardsUpdating">₹ {{ activeSummary.to_operator | number:'1.2-2' }}</span>
          <span class="card__meta">retained by company</span>
        </div>
        <div class="card card--fee" *ngIf="activeSummary.gateway_fee > 0">
          <span class="card__label">Gateway Fee</span>
          <span class="card__value" [class.card__value--pulse]="cardsUpdating">₹ {{ activeSummary.gateway_fee | number:'1.2-2' }}</span>
          <span class="card__meta">payment processing</span>
        </div>
        <div class="card card--refund" *ngIf="activeSummary.refunded > 0">
          <span class="card__label">Refunded</span>
          <span class="card__value" [class.card__value--pulse]="cardsUpdating">₹ {{ activeSummary.refunded | number:'1.2-2' }}</span>
          <span class="card__meta">returned to customers</span>
        </div>
      </div>

      <!-- Filters & Search Toolbar -->
      <div class="toolbar">
        <div class="tabs-group">
          <div class="tabs">
            <span class="tabs-label">Group by:</span>
            <button type="button" class="tab" [class.tab--on]="groupBy === 'trip'" (click)="setGroupBy('trip')">Trip</button>
            <button type="button" class="tab" [class.tab--on]="groupBy === 'driver'" (click)="setGroupBy('driver')">Driver</button>
            <button type="button" class="tab" [class.tab--on]="groupBy === 'customer'" (click)="setGroupBy('customer')">Customer</button>
            <button type="button" class="tab" [class.tab--on]="groupBy === 'none'" (click)="setGroupBy('none')">None</button>
          </div>

          <div class="tabs">
            <span class="tabs-label">Type:</span>
            <button type="button" class="tab" [class.tab--on]="type === 'all'" (click)="setType('all')">All</button>
            <button type="button" class="tab" *ngFor="let t of types"
              [class.tab--on]="type === t.key" (click)="setType(t.key)">{{ t.label }}</button>
          </div>

          <div class="tabs">
            <span class="tabs-label">Party:</span>
            <button type="button" class="tab" [class.tab--on]="partyFilter === 'all'" (click)="setPartyFilter('all')">All</button>
            <button type="button" class="tab" [class.tab--on]="partyFilter === 'customer'" (click)="setPartyFilter('customer')">Customer</button>
            <button type="button" class="tab" [class.tab--on]="partyFilter === 'driver'" (click)="setPartyFilter('driver')">Driver</button>
            <button type="button" class="tab" [class.tab--on]="partyFilter === 'operator'" (click)="setPartyFilter('operator')">Company</button>
          </div>
        </div>

        <div class="toolbar__right">
          <div class="date-pills">
            <button type="button" class="date-pill" [class.date-pill--on]="activePreset === 'today'" (click)="setPresetDate('today')">Today</button>
            <button type="button" class="date-pill" [class.date-pill--on]="activePreset === 'yesterday'" (click)="setPresetDate('yesterday')">Yesterday</button>
            <button type="button" class="date-pill" [class.date-pill--on]="activePreset === '7days'" (click)="setPresetDate('7days')">7 Days</button>
            <button type="button" class="date-pill" [class.date-pill--on]="activePreset === 'thisMonth'" (click)="setPresetDate('thisMonth')">This Month</button>
          </div>

          <div class="date-range" [class.has-value]="dateFrom || dateTo">
            <span class="date-range__icon" aria-hidden="true"><tm-icon name="calendar" [size]="14" /></span>
            <input
              #rangeInput
              type="text"
              readonly
              class="date-range__input"
              placeholder="Filter date"
              [value]="rangeLabel"
              aria-label="Filter by date range"
            />
            <button *ngIf="dateFrom || dateTo" type="button" class="search__clear" (click)="clearDateRange(); $event.stopPropagation()" aria-label="Clear date range">
              <tm-icon name="x" [size]="13" />
            </button>
          </div>

          <label class="check">
            <input type="checkbox" [ngModel]="unbalancedOnly" (ngModelChange)="setUnbalanced($event)" />
            <span>Unbalanced only</span>
          </label>

          <div class="search">
            <span class="search__icon"><tm-icon name="search" [size]="15" /></span>
            <input type="text" class="search__input" placeholder="Search Tx ID, Name, Phone, Ref..."
              [(ngModel)]="searchFilter" (ngModelChange)="onSearchChange()" />
            <button *ngIf="searchFilter" type="button" class="search__clear" (click)="clearSearch()" aria-label="Clear">
              <tm-icon name="x" [size]="13" />
            </button>
          </div>

          <button type="button" class="export-btn" (click)="exportCsv()" title="Export filtered ledger to CSV">
            <tm-icon name="download" [size]="14" /> Export CSV
          </button>
        </div>
      </div>

      <div class="state state--error" *ngIf="error">{{ error }}</div>

      <tm-data-table
        [rows]="pagedRows"
        [total]="display.length"
        [page]="page"
        [pageSize]="pageSize"
        [loading]="loading || searchLoading"
        [showToolbar]="false"
        emptyTitle="No transactions found"
        emptyHint="Transactions appear here as rides are booked, split, and completed."
        (pageChange)="page = $event"
        (pageSizeChange)="pageSize = $event; page = 1"
      >
        <tm-column key="created_at" label="Date & ID" width="150">
          <ng-template let-row>
            <div class="stack" [class.stack--child]="row.child">
              <span class="strong">{{ row.created_at | date:'d MMM y' }}</span>
              <span class="muted">{{ row.created_at | date:'h:mm a' }}</span>
              <span class="tx-badge" *ngIf="!row.group">Tx #{{ row.id }}</span>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="type" label="Type" width="150">
          <ng-template let-row>
            <button
              *ngIf="row.group; else plainType"
              type="button" class="grouptoggle"
              (click)="toggleGroup(row.group.key)"
              [attr.aria-expanded]="isExpanded(row.group.key)"
            >
              <tm-icon [name]="isExpanded(row.group.key) ? 'chevron-down' : 'chevron-right'" [size]="14" />
              <span>{{ row.group.count }} transactions</span>
            </button>
            <ng-template #plainType>
              <span class="mv" [ngClass]="'mv--' + row.type" [class.mv--child]="row.child">{{ typeLabel(row.type) }}</span>
            </ng-template>
          </ng-template>
        </tm-column>

        <tm-column key="party" label="Customer / Driver" width="280">
          <ng-template let-row>
            <ng-container *ngIf="!row.group">
              <div class="party-info" *ngIf="row.party === 'customer'">
                <span class="party-badge party-badge--customer">Customer</span>
                <strong class="party-name">{{ row.customer_name || 'Customer' }}</strong>
                <small class="party-phone" *ngIf="row.customer_phone">📞 {{ row.customer_phone }}</small>
              </div>

              <div class="party-info" *ngIf="row.party === 'driver'">
                <span class="party-badge party-badge--driver">Driver</span>
                <strong class="party-name">{{ row.driver_name || 'Driver' }}</strong>
                <small class="party-phone" *ngIf="row.driver_phone">📞 {{ row.driver_phone }}</small>
              </div>

              <div class="party-info" *ngIf="row.party === 'operator'">
                <span class="party-badge party-badge--operator">Company</span>
                <strong class="party-name">Platform Fee</strong>
                <div class="party-sub-details" *ngIf="row.customer_name || row.driver_name">
                  <small *ngIf="row.customer_name">Cust: <strong>{{ row.customer_name }}</strong> ({{ row.customer_phone }})</small>
                  <small *ngIf="row.driver_name">Drv: <strong>{{ row.driver_name }}</strong> ({{ row.driver_phone }})</small>
                </div>
              </div>

              <div class="party-info" *ngIf="row.party !== 'customer' && row.party !== 'driver' && row.party !== 'operator'">
                <span class="party-badge">{{ row.party }}</span>
                <div class="party-sub-details" *ngIf="row.customer_name || row.driver_name">
                  <small *ngIf="row.customer_name">Cust: <strong>{{ row.customer_name }}</strong> ({{ row.customer_phone }})</small>
                  <small *ngIf="row.driver_name">Drv: <strong>{{ row.driver_name }}</strong> ({{ row.driver_phone }})</small>
                </div>
              </div>
            </ng-container>

            <div class="groupmeta" *ngIf="row.group">
              <strong class="groupmeta__title" *ngIf="row.group.label">{{ row.group.label }}</strong>
              <span *ngIf="row.group.customer_name">Customer: <strong>{{ row.group.customer_name }}</strong> <small *ngIf="row.group.customer_phone">({{ row.group.customer_phone }})</small></span>
              <span *ngIf="row.group.driver_name">Driver: <strong>{{ row.group.driver_name }}</strong> <small *ngIf="row.group.driver_phone">({{ row.group.driver_phone }})</small></span>
              <span>Driver: ₹ {{ row.group.toDriver | number:'1.2-2' }} · Platform Fee: ₹ {{ row.group.commission | number:'1.2-2' }}</span>
              <span class="groupmeta--refund" *ngIf="row.group.refunded > 0">
                Refunded: ₹ {{ row.group.refunded | number:'1.2-2' }}
              </span>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="trip_id" label="Trip" width="100">
          <ng-template let-row>
            <button type="button" class="triplink" *ngIf="row.trip_id" (click)="focusTrip(row.trip_id)">
              #{{ row.trip_id }}
            </button>
            <span class="muted" *ngIf="!row.trip_id">—</span>
          </ng-template>
        </tm-column>

        <tm-column key="balance" label="Status" width="140">
          <ng-template let-row>
            <ng-container *ngIf="balanceFor(row.trip_id) as b; else noBal">
              <span class="bal" [class.bal--bad]="!b.balanced">
                <span class="bal__dot"></span>
                {{ b.balanced ? 'Balanced' : (b.imbalance_paise / 100 | number:'1.2-2') + ' off' }}
              </span>
            </ng-container>
            <ng-template #noBal><span class="muted">—</span></ng-template>
          </ng-template>
        </tm-column>

        <tm-column key="razorpay_ref" label="Payment Ref" width="200">
          <ng-template let-row>
            <div class="ref-stack" *ngIf="!row.group">
              <span class="ref" *ngIf="row.razorpay_ref">{{ row.razorpay_ref }}</span>
              <small class="pay-id" *ngIf="row.payment_id">Pay #{{ row.payment_id }}</small>
              <span class="muted" *ngIf="!row.razorpay_ref && !row.payment_id">—</span>
            </div>
            <span class="muted" *ngIf="row.group">{{ row.group.count }} references</span>
          </ng-template>
        </tm-column>

        <tm-column key="amount" label="Amount" width="130" align="right">
          <ng-template let-row>
            <span class="amount" *ngIf="row.group">₹ {{ row.group.captured | number:'1.2-2' }}</span>
            <span class="amount" *ngIf="!row.group" [class.amount--out]="row.direction === 'out'">
              {{ row.direction === 'out' ? '−' : '+' }} ₹ {{ row.amount | number:'1.2-2' }}
            </span>
          </ng-template>
        </tm-column>
      </tm-data-table>
    </div>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 14px; }
    .page__hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .page__title { margin: 0; font-size: 24px; line-height: 1.1; font-weight: 850; color: var(--tm-text); }
    .page__sub { margin: 6px 0 0; max-width: 680px; color: var(--tm-text-muted); font-size: 13px; line-height: 1.45; }
    .hero__side { display: flex; align-items: center; gap: 14px; }

    .page { display: flex; flex-direction: column; gap: 18px; }
    .page__hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .page__title { margin: 0; font-size: 26px; line-height: 1.1; font-weight: 850; color: var(--tm-text); letter-spacing: -0.02em; }
    .page__sub { margin: 6px 0 0; max-width: 680px; color: var(--tm-text-muted); font-size: 13.5px; line-height: 1.5; }
    .hero__side { display: flex; align-items: center; gap: 14px; }

    .verdict { display: flex; align-items: center; gap: 12px; padding: 14px 16px;
      border: 1px solid rgba(16, 185, 129, 0.25); border-radius: var(--tm-radius-lg); background: var(--tm-green-tint);
      box-shadow: 0 2px 8px rgba(16, 185, 129, 0.05); }
    .verdict__icon { display: inline-flex; color: var(--tm-green-deep); flex: none; }
    .verdict__body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
    .verdict__body strong { font-size: 14px; font-weight: 800; color: var(--tm-text); }
    .verdict__body span { font-size: 12.5px; color: var(--tm-text-muted); }
    .verdict--bad { background: var(--tm-danger-bg, #fef3f2); border-color: rgba(225, 29, 72, 0.3); }
    .verdict--bad .verdict__icon { color: var(--tm-danger, #B42318); }

    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
    .card { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; background: var(--tm-surface);
      border: 1px solid var(--tm-line); border-radius: var(--tm-radius-lg); transition: all 0.2s ease;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04); position: relative; overflow: hidden; }
    .card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: var(--tm-green-deep); }
    .card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
    @keyframes numberPulse {
      0% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.08); opacity: 0.6; }
      100% { transform: scale(1); opacity: 1; }
    }
    .card__value { font-size: 21px; font-weight: 850; color: var(--tm-text); font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
    .card__value--pulse { animation: numberPulse 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); }
    .card__meta { font-size: 11px; color: var(--tm-text-soft); font-weight: 500; }

    .card--driver::before { background: var(--tm-info-fg, #1d4ed8); }
    .card--driver .card__value { color: var(--tm-info-fg, #1d4ed8); }
    .card--operator::before { background: var(--tm-green-deep); }
    .card--operator .card__value { color: var(--tm-green-deep); }
    .card--held::before { background: var(--tm-warning-fg, #d97706); }
    .card--held .card__value { color: var(--tm-warning-fg, #d97706); }
    .card--refund::before { background: var(--tm-danger, #e11d48); }
    .card--refund .card__value { color: var(--tm-danger, #e11d48); }
    .card--fee::before { background: var(--tm-text-muted); }
    .card--fee .card__value { color: var(--tm-text-muted); }

    .toolbar { display: flex; flex-direction: column; gap: 14px; background: var(--tm-surface);
      border: 1px solid var(--tm-line); border-radius: var(--tm-radius-lg); padding: 14px 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.03); }
    .toolbar__right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: flex-end; }
    .tabs-group { display: flex; flex-direction: column; gap: 10px; }
    .tabs { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .tabs-label { font-size: 12px; font-weight: 800; color: var(--tm-text-muted); width: 70px; flex: none; }
    .tab { border: 1px solid var(--tm-line); background: var(--tm-surface); color: var(--tm-text-muted);
      border-radius: 999px; padding: 5px 14px; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
      transition: all 0.15s ease; }
    .tab:hover { border-color: var(--tm-text); color: var(--tm-text); }
    .tab--on { background: var(--tm-text); color: var(--tm-surface); border-color: var(--tm-text); font-weight: 800;
      box-shadow: 0 2px 6px rgba(0,0,0,0.12); }

    .party-info { display: flex; flex-direction: column; gap: 3px; }
    .party-name { font-size: 13.5px; font-weight: 800; color: var(--tm-text); letter-spacing: -0.01em; }
    .party-phone { font-size: 11.5px; color: var(--tm-text-muted); font-family: var(--tm-font-mono); }
    .party-badge { display: inline-flex; width: fit-content; padding: 2px 6px; border-radius: 4px;
      font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; background: var(--tm-canvas); color: var(--tm-text-muted); }
    .party-badge--customer { background: var(--tm-green-tint); color: var(--tm-green-deep); }
    .party-badge--driver { background: var(--tm-info-bg, #eff6ff); color: var(--tm-info-fg, #1d4ed8); }
    .party-badge--operator { background: var(--tm-canvas-2); color: var(--tm-text); }

    .date-pills { display: inline-flex; align-items: center; gap: 4px; background: var(--tm-canvas-subtle, #f3f4f6); padding: 3px; border-radius: var(--tm-radius-md); }
    .date-pill { border: 0; background: transparent; padding: 5px 11px; border-radius: var(--tm-radius-sm); font-size: 11.5px; font-weight: 700; color: var(--tm-text-muted); cursor: pointer; transition: all 0.15s ease; white-space: nowrap; }
    .date-pill:hover { color: var(--tm-text); }
    .date-pill--on { background: var(--tm-surface); color: var(--tm-text); font-weight: 850; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }

    .export-btn { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px; background: #059669; color: #ffffff; border: 0; border-radius: var(--tm-radius-md); font-size: 12px; font-weight: 800; cursor: pointer; transition: background 0.15s ease, transform 0.1s ease; box-shadow: 0 1px 3px rgba(5, 150, 105, 0.25); white-space: nowrap; }
    .export-btn:hover { background: #047857; transform: translateY(-1px); }
    .export-btn:active { transform: translateY(0); }

    .date-range { display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px;
      border: 1px solid var(--tm-line); border-radius: var(--tm-radius-md); background: var(--tm-surface); line-height: 1;
      transition: border-color var(--tm-duration-fast) var(--tm-ease); cursor: pointer; position: relative; }
    .date-range:focus-within { border-color: var(--tm-text); box-shadow: 0 0 0 2px rgba(0,0,0,0.05); }
    .date-range.has-value { background: var(--tm-green-tint); border-color: var(--tm-green-deep); }
    .date-range__icon { color: var(--tm-text-muted); display: inline-flex; }
    .date-range.has-value .date-range__icon { color: var(--tm-green-deep); }
    .date-range__input { appearance: none; -webkit-appearance: none; background: transparent; border: 0; outline: 0;
      font-family: var(--tm-font-mono); font-size: 12px; font-weight: 600; color: var(--tm-text); padding: 0; width: 140px;
      cursor: pointer; line-height: 1.2; }
    .date-range__input::placeholder { color: var(--tm-text-soft); }

    :host ::ng-deep .daterangepicker { font-family: var(--tm-font-body) !important; border-radius: var(--tm-radius-md);
      border: 1px solid var(--tm-line-2); box-shadow: var(--tm-shadow-pop); }
    :host ::ng-deep .daterangepicker .btn-primary, :host ::ng-deep .daterangepicker .btn-success {
      background: var(--tm-ink); border-color: var(--tm-ink); border-radius: var(--tm-radius-sm); font-weight: 700; }
    :host ::ng-deep .daterangepicker .ranges li.active, :host ::ng-deep .daterangepicker td.active,
    :host ::ng-deep .daterangepicker td.active:hover { background: var(--tm-ink); color: #fff; }
    :host ::ng-deep .daterangepicker td.in-range { background: var(--tm-green-tint); color: var(--tm-green-deep); }

    .tx-badge { display: inline-block; font-size: 10.5px; font-weight: 800; color: var(--tm-text-muted); font-family: var(--tm-font-mono); }
    .ref-stack { display: flex; flex-direction: column; gap: 2px; }
    .pay-id { font-size: 11px; font-weight: 700; color: var(--tm-text-muted); font-family: var(--tm-font-mono); }
    .party-sub-details { display: flex; flex-direction: column; gap: 2px; margin-top: 2px; }
    .party-sub-details small { font-size: 11px; color: var(--tm-text-muted); }

    .check { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 700;
      color: var(--tm-text-muted); cursor: pointer; user-select: none; }
    .search { position: relative; display: flex; align-items: center; min-width: 240px; }
    .search__icon { position: absolute; left: 10px; color: var(--tm-text-muted); display: inline-flex; pointer-events: none; }
    .search__input { width: 100%; height: 36px; padding: 0 28px 0 34px; font: inherit; font-size: 12.5px;
      color: var(--tm-text); background: var(--tm-surface); border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-md); outline: none; transition: border-color 0.15s ease; }
    .search__input:focus { border-color: var(--tm-text); box-shadow: 0 0 0 2px rgba(0,0,0,0.05); }
    .search__clear { position: absolute; right: 6px; border: 0; background: transparent; padding: 4px;
      color: var(--tm-text-muted); cursor: pointer; display: inline-flex; }

    .mv { display: inline-flex; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 800;
      letter-spacing: 0.02em; background: var(--tm-canvas); color: var(--tm-text); white-space: nowrap; }
    .mv--capture { background: var(--tm-green-tint); color: var(--tm-green-deep); }
    .mv--transfer { background: var(--tm-info-bg, #eff6ff); color: var(--tm-info-fg, #1d4ed8); }
    .mv--retained { background: var(--tm-canvas); color: var(--tm-text); }
    .mv--gateway_fee { background: var(--tm-canvas-2); color: var(--tm-text-muted); }
    .mv--held { background: var(--tm-warning-bg, #fff4e5); color: var(--tm-warning-fg, #92400e); }
    .mv--refund, .mv--reversal { background: var(--tm-danger-bg, #fef3f2); color: var(--tm-danger, #B42318); }

    .triplink { border: 0; background: transparent; padding: 0; font: inherit; font-size: 12.5px; font-weight: 800;
      color: var(--tm-info-fg, #1d4ed8); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }

    .bal { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px;
      font-size: 11.5px; font-weight: 800; background: var(--tm-green-tint); color: var(--tm-green-deep); white-space: nowrap; }
    .bal__dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
    .bal--bad { background: var(--tm-danger-bg, #fef3f2); color: var(--tm-danger, #B42318); }

    .grouptoggle { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--tm-line);
      background: var(--tm-surface); padding: 5px 12px; border-radius: var(--tm-radius-md); font: inherit;
      font-size: 12px; font-weight: 800; color: var(--tm-text); cursor: pointer; transition: background 0.15s ease; }
    .grouptoggle:hover { background: var(--tm-canvas-subtle, #f9fafb); }
    .grouptoggle tm-icon { color: var(--tm-text-muted); display: inline-flex; }

    .groupmeta { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--tm-text-muted);
      font-variant-numeric: tabular-nums; }
    .groupmeta__title { font-size: 13.5px; font-weight: 850; color: var(--tm-text); letter-spacing: -0.01em; }
    .groupmeta--refund { color: var(--tm-danger, #B42318); font-weight: 700; }
    .stack--child { padding-left: 14px; border-left: 3px solid var(--tm-line-2, #e5e7eb); }
    .mv--child { opacity: 0.9; }
  `],
})
export class FinanceLedgerComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('rangeInput') rangeInput?: ElementRef<HTMLInputElement>;

  rows: LedgerRow[] = [];
  reconciliation: Record<string, TripBalance> = {};
  summary: LedgerResponse['summary'] = {
    captured: 0, to_driver: 0, held: 0, to_operator: 0, gateway_fee: 0, refunded: 0, trips: 0, unbalanced: 0,
  };

  loading = false;
  error = '';

  type = 'all';
  partyFilter = 'all';
  searchFilter = '';
  dateFrom = moment().startOf('month').format('YYYY-MM-DD');
  dateTo = moment().format('YYYY-MM-DD');
  unbalancedOnly = false;

  groupBy: 'trip' | 'driver' | 'customer' | 'none' = 'trip';
  /** Which summary lines are opened, keyed by group key. */
  expanded: Record<string, boolean> = {};

  page = 1;
  pageSize = 25;

  readonly types = [
    { key: 'capture', label: 'Payments' },
    { key: 'transfer', label: 'Driver payouts' },
    { key: 'retained', label: 'Platform fee' },
    { key: 'gateway_fee', label: 'Gateway fee' },
    { key: 'held', label: 'On hold' },
    { key: 'refund', label: 'Refunds' },
    { key: 'reversal', label: 'Reversals' },
  ];

  constructor(private api: ApiService, private zone: NgZone) {}

  ngOnInit(): void {
    this.load();
  }

  ngAfterViewInit(): void {
    this.initDatePicker();
  }

  ngOnDestroy(): void {
    this.destroyDatePicker();
  }

  activePreset: 'today' | 'yesterday' | '7days' | 'thisMonth' | null = 'thisMonth';

  get rangeLabel(): string {
    if (this.dateFrom && this.dateTo) return `${this.dateFrom} → ${this.dateTo}`;
    return '';
  }

  clearDateRange(): void {
    this.activePreset = null;
    this.dateFrom = '';
    this.dateTo = '';
    this.page = 1;
    this.load();
  }

  setPresetDate(preset: 'today' | 'yesterday' | '7days' | 'thisMonth'): void {
    this.activePreset = preset;
    const now = new Date();
    const formatDate = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    if (preset === 'today') {
      const todayStr = formatDate(now);
      this.dateFrom = todayStr;
      this.dateTo = todayStr;
    } else if (preset === 'yesterday') {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      const yStr = formatDate(y);
      this.dateFrom = yStr;
      this.dateTo = yStr;
    } else if (preset === '7days') {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      this.dateFrom = formatDate(d);
      this.dateTo = formatDate(now);
    } else if (preset === 'thisMonth') {
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      this.dateFrom = `${year}-${month}-01`;
      this.dateTo = formatDate(now);
    }

    this.page = 1;
    this.load();
  }

  exportCsv(): void {
    const rows = this.filtered;
    if (!rows.length) return;
    const headers = ['Tx ID', 'Trip ID', 'Payment ID', 'Type', 'Party', 'Direction', 'Amount (INR)', 'Ref', 'Customer Name', 'Customer Phone', 'Driver Name', 'Driver Phone', 'Date'];
    const csvRows = [headers.join(',')];
    for (const r of rows) {
      const line = [
        r.id ?? '',
        r.trip_id ?? '',
        r.payment_id ?? '',
        `"${r.type || ''}"`,
        `"${r.party || ''}"`,
        `"${r.direction || ''}"`,
        r.amount || 0,
        `"${r.razorpay_ref || ''}"`,
        `"${(r.customer_name || '').replace(/"/g, '""')}"`,
        `"${r.customer_phone || ''}"`,
        `"${(r.driver_name || '').replace(/"/g, '""')}"`,
        `"${r.driver_phone || ''}"`,
        `"${r.created_at || ''}"`,
      ];
      csvRows.push(line.join(','));
    }
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `money-ledger-export-${new Date().toISOString().substring(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  private initDatePicker(): void {
    if (!this.rangeInput?.nativeElement) return;
    const $el = $(this.rangeInput.nativeElement);
    $el.daterangepicker(
      {
        autoApply: true,
        autoUpdateInput: false,
        opens: 'left',
        maxDate: moment(),
        alwaysShowCalendars: true,
        startDate: moment(this.dateFrom),
        endDate: moment(this.dateTo),
        locale: { format: 'YYYY-MM-DD', applyLabel: 'Apply', cancelLabel: 'Cancel' },
        ranges: {
          Today: [moment(), moment()],
          Yesterday: [moment().subtract(1, 'days'), moment().subtract(1, 'days')],
          'Last 7 days': [moment().subtract(6, 'days'), moment()],
          'Last 30 days': [moment().subtract(29, 'days'), moment()],
          'This month': [moment().startOf('month'), moment().endOf('month')],
          'Last month': [moment().subtract(1, 'month').startOf('month'), moment().subtract(1, 'month').endOf('month')],
        },
      } as any,
      (start: moment.Moment, end: moment.Moment) => {
        this.zone.run(() => {
          this.dateFrom = start.format('YYYY-MM-DD');
          this.dateTo = end.format('YYYY-MM-DD');
          this.page = 1;
          this.load();
        });
      },
    );
    $el.on('cancel.daterangepicker', () => {
      this.zone.run(() => this.clearDateRange());
    });
  }

  private destroyDatePicker(): void {
    if (!this.rangeInput?.nativeElement) return;
    const picker = ($(this.rangeInput.nativeElement) as any).data('daterangepicker');
    if (picker) picker.remove();
  }

  load(): void {
    this.loading = true;
    this.error = '';

    const params: string[] = [];
    if (this.unbalancedOnly) params.push('unbalanced=1');
    if (this.dateFrom) params.push(`from=${encodeURIComponent(this.dateFrom)}`);
    if (this.dateTo) params.push(`to=${encodeURIComponent(this.dateTo)}`);
    if (this.searchFilter.trim()) params.push(`search=${encodeURIComponent(this.searchFilter.trim())}`);
    const qs = params.length ? `?${params.join('&')}` : '';

    this.api.get<LedgerResponse>(`/admin/ledger${qs}`).subscribe({
      next: (res) => {
        this.rows = res.rows ?? [];
        this.reconciliation = res.reconciliation ?? {};
        if (res.summary) this.summary = res.summary;
        this.expanded = {};
        this.page = 1;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load the ledger.';
        this.loading = false;
      },
    });
  }

  searchLoading = false;
  cardsUpdating = false;
  private searchTimer: any = null;

  triggerCardPulse(): void {
    this.cardsUpdating = true;
    setTimeout(() => {
      this.zone.run(() => {
        this.cardsUpdating = false;
      });
    }, 350);
  }

  onSearchChange(): void {
    this.searchLoading = true;
    this.triggerCardPulse();
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.zone.run(() => {
        this.page = 1;
        this.searchLoading = false;
      });
    }, 200);
  }

  clearSearch(): void {
    this.searchFilter = '';
    this.page = 1;
    this.triggerCardPulse();
    this.load();
  }

  setType(key: string): void {
    this.type = key;
    this.page = 1;
    this.triggerCardPulse();
  }

  setPartyFilter(party: string): void {
    this.partyFilter = party;
    this.page = 1;
    this.triggerCardPulse();
  }

  setUnbalanced(on: boolean): void {
    this.unbalancedOnly = on;
    this.load();
  }

  focusTrip(tripId: number): void {
    this.searchFilter = String(tripId);
  }

  get activeSummary() {
    const list = this.filtered;

    let captured = 0;
    let to_driver = 0;
    let held = 0;
    let to_operator = 0;
    let gateway_fee = 0;
    let refunded = 0;

    for (const r of list) {
      const amt = Number(r.amount || 0);
      switch (r.type) {
        case 'capture':
          captured += amt;
          break;
        case 'transfer':
        case 'release':
          to_driver += amt;
          break;
        case 'held':
          held += amt;
          break;
        case 'retained':
          to_operator += amt;
          break;
        case 'gateway_fee':
          gateway_fee += amt;
          break;
        case 'refund':
        case 'reversal':
          refunded += amt;
          break;
      }
    }

    const tripIds = new Set(list.map((r) => r.trip_id).filter((id): id is number => id != null));
    let unbalancedCount = 0;
    for (const tid of tripIds) {
      const b = this.reconciliation[String(tid)];
      if (b && !b.balanced) {
        unbalancedCount++;
      }
    }

    return {
      captured,
      to_driver,
      held,
      to_operator,
      gateway_fee,
      refunded,
      trips: tripIds.size,
      unbalanced: unbalancedCount,
    };
  }

  get filtered(): LedgerRow[] {
    return this.rows.filter((r) => {
      if (this.type !== 'all' && r.type !== this.type) return false;
      if (this.partyFilter !== 'all' && r.party !== this.partyFilter) return false;
      if (this.dateFrom || this.dateTo) {
        const rowDate = r.created_at ? r.created_at.substring(0, 10) : '';
        if (!rowDate) return false;
        if (this.dateFrom && rowDate < this.dateFrom) return false;
        if (this.dateTo && rowDate > this.dateTo) return false;
      }
      if (this.searchFilter.trim()) {
        const q = this.searchFilter.trim().toLowerCase();
        const txStr = r.id ? `#${r.id}` : '';
        const tripStr = r.trip_id ? `#${r.trip_id}` : '';
        const payStr = r.payment_id ? `#${r.payment_id}` : '';
        const cName = (r.customer_name || '').toLowerCase();
        const cPhone = (r.customer_phone || '').toLowerCase();
        const dName = (r.driver_name || '').toLowerCase();
        const dPhone = (r.driver_phone || '').toLowerCase();
        const ref = (r.razorpay_ref || '').toLowerCase();
        const match = txStr.includes(q) || String(r.id || '').includes(q) ||
          tripStr.includes(q) || String(r.trip_id || '').includes(q) ||
          payStr.includes(q) || String(r.payment_id || '').includes(q) ||
          cName.includes(q) || cPhone.includes(q) || dName.includes(q) || dPhone.includes(q) || ref.includes(q);
        if (!match) return false;
      }
      return true;
    });
  }

  get display(): DisplayRow[] {
    const rows = this.filtered;
    if (this.groupBy === 'none') return rows;

    const groupsMap = new Map<string, {
      key: string;
      label?: string;
      customerName?: string | null;
      customerPhone?: string | null;
      driverName?: string | null;
      driverPhone?: string | null;
      rows: LedgerRow[];
    }>();

    for (const r of rows) {
      let groupKey = '';
      let label = '';

      if (this.groupBy === 'trip') {
        if (r.trip_id == null) {
          groupKey = `no-trip-${r.id}`;
          label = `Tx #${r.id}`;
        } else {
          groupKey = `trip-${r.trip_id}`;
          label = `Trip #${r.trip_id}`;
        }
      } else if (this.groupBy === 'driver') {
        const dKey = (r.driver_name || r.driver_phone || 'unassigned').trim().toLowerCase();
        groupKey = `driver-${dKey}`;
        label = r.driver_name ? `Driver: ${r.driver_name}` : (r.driver_phone ? `Driver: ${r.driver_phone}` : 'Driver: Unassigned');
      } else if (this.groupBy === 'customer') {
        const cKey = (r.customer_name || r.customer_phone || 'unassigned').trim().toLowerCase();
        groupKey = `customer-${cKey}`;
        label = r.customer_name ? `Customer: ${r.customer_name}` : (r.customer_phone ? `Customer: ${r.customer_phone}` : 'Customer: Unassigned');
      }

      if (!groupsMap.has(groupKey)) {
        groupsMap.set(groupKey, {
          key: groupKey,
          label,
          customerName: r.customer_name,
          customerPhone: r.customer_phone,
          driverName: r.driver_name,
          driverPhone: r.driver_phone,
          rows: [],
        });
      }

      const g = groupsMap.get(groupKey)!;
      g.rows.push(r);
      if (!g.customerName && r.customer_name) g.customerName = r.customer_name;
      if (!g.customerPhone && r.customer_phone) g.customerPhone = r.customer_phone;
      if (!g.driverName && r.driver_name) g.driverName = r.driver_name;
      if (!g.driverPhone && r.driver_phone) g.driverPhone = r.driver_phone;
    }

    const out: DisplayRow[] = [];
    for (const [key, g] of groupsMap.entries()) {
      if (g.rows.length === 1 && key.startsWith('no-trip-')) {
        out.push(g.rows[0]);
        continue;
      }

      const firstRow = g.rows[0];
      out.push({
        ...firstRow,
        group: {
          key: g.key,
          label: g.label,
          count: g.rows.length,
          captured: this.sumOf(g.rows, 'capture'),
          toDriver: this.sumOf(g.rows, 'transfer') + this.sumOf(g.rows, 'release'),
          commission: this.sumOf(g.rows, 'retained'),
          refunded: this.sumOf(g.rows, 'refund'),
          customer_name: g.customerName,
          customer_phone: g.customerPhone,
          driver_name: g.driverName,
          driver_phone: g.driverPhone,
        },
      });

      if (this.isExpanded(g.key)) {
        for (const r of g.rows) {
          out.push({ ...r, child: true });
        }
      }
    }

    return out;
  }

  private sumOf(rows: LedgerRow[], type: string): number {
    return rows.reduce((total, r) => (r.type === type ? total + Number(r.amount || 0) : total), 0);
  }

  get pagedRows(): DisplayRow[] {
    const start = (this.page - 1) * this.pageSize;
    return this.display.slice(start, start + this.pageSize);
  }

  setGroupBy(mode: 'trip' | 'driver' | 'customer' | 'none'): void {
    this.groupBy = mode;
    this.expanded = {};
    this.page = 1;
  }

  toggleGroup(key: string): void {
    this.expanded[key] = !this.expanded[key];
  }

  isExpanded(key: string): boolean {
    return !!this.expanded[key];
  }

  balanceFor(tripId: number | null): TripBalance | null {
    if (tripId == null) return null;
    return this.reconciliation[String(tripId)] ?? null;
  }

  typeLabel(type: string): string {
    switch (type) {
      case 'capture': return 'Payment';
      case 'transfer': return 'Driver Payout';
      case 'retained': return 'Platform Fee';
      case 'gateway_fee': return 'Gateway Fee';
      case 'held': return 'On Hold';
      case 'release': return 'Hold Released';
      case 'refund': return 'Refund';
      case 'reversal': return 'Reversal';
      default: return type;
    }
  }
}
