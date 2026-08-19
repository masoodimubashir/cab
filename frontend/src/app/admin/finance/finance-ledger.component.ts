import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, of, Subscription } from 'rxjs';
import { catchError } from 'rxjs/operators';
import $ from 'jquery';
import moment from 'moment';
import 'daterangepicker';

import { ApiService } from '../../core/api.service';
import {
  ButtonComponent,
  IconComponent,
  DataTableComponent,
  ColumnComponent,
} from '../../ui';

/* ==========================================================================
   DATA INTERFACES
   ========================================================================== */

export interface LedgerRow {
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

export interface TripBalance {
  captured: number;
  driver_net: number;
  operator_net: number;
  gateway_fee: number;
  refunded: number;
  balanced: boolean;
  imbalance_paise: number;
}

export interface DisplayRow extends LedgerRow {
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
  child?: boolean;
}

export interface LedgerResponse {
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

export interface DriverWalletRecord {
  driver_id: number;
  user_id: number;
  name: string;
  phone: string;
  payout_method?: string | null;
  payout_beneficiary_name?: string | null;
  payout_bank_last4?: string | null;
  payout_ifsc?: string | null;
  payout_upi?: string | null;
  payout_account_status?: string | null;
  vehicle_reg_no: string;
  vehicle_type?: string;
  balance: number;
  minimum_wallet_limit: number;
  maximum_wallet_limit?: number;
  is_in_debt: boolean;
  can_accept_rides: boolean;
  pending_payout?: number;
  rides_count?: number;
  gross_earnings?: number;
  cash_collected?: number;
  online_collected?: number;
  active_subscription?: {
    plan_title: string;
    amount_paid: number;
    commission_percent: number;
    expires_at?: string;
  } | null;
}

export interface TransferRecord {
  id: number;
  driver_user_id: number;
  driver_name: string;
  driver_phone: string;
  amount: number;
  method: string;
  reference: string | null;
  notes: string | null;
  recorded_by: string;
  created_at: string;
}

export interface CommissionRecord {
  trip_id: number;
  date: string;
  driver_id: number;
  driver_name: string;
  driver_phone: string;
  vehicle_type: string;
  fare: number;
  commission_percent: number;
  commission_amount: number;
  is_fixed_commission?: boolean;
  net_driver_earnings: number;
  cash_amount?: number;
  online_amount?: number;
  payment_method: string;
  mode?: 'private' | 'fixed' | 'shuttle' | string;
  route_name?: string | null;
  is_shared: boolean;
}

export type LedgerViewMode = 'movements' | 'drivers' | 'commissions' | 'transfers';

/* ==========================================================================
   COMPONENT
   ========================================================================== */

@Component({
  selector: 'app-finance-ledger',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    IconComponent,
    DataTableComponent,
    ColumnComponent,
  ],
  template: `
    <div class="ledger-shell">
      <!-- ====================================================================
           1. EXECUTIVE HERO HEADER
           ==================================================================== -->
      <header class="ledger-hero">
        <div class="ledger-hero__main">
          <div class="ledger-hero__eyebrow">
            <span class="pulse-dot" [class.pulse-dot--warning]="activeSummary.unbalanced > 0"></span>
            <span>Finance &amp; Settlements</span>
          </div>
          <h1 class="ledger-hero__title">Financial Ledger</h1>
          <p class="ledger-hero__desc">
            Double-entry transactions, driver float balances, commissions, and payout settlements.
          </p>
        </div>

        <div class="ledger-hero__actions">
          <!-- Audit Health Pill -->
          <div
            class="audit-pill"
            [class.audit-pill--bad]="activeSummary.unbalanced > 0"
            [class.audit-pill--good]="activeSummary.unbalanced === 0"
            *ngIf="!loading && !error"
            (click)="toggleUnbalancedFilter()"
            [title]="activeSummary.unbalanced > 0 ? 'Click to filter flagged trips' : 'All transactions balanced'"
          >
            <tm-icon [name]="activeSummary.unbalanced > 0 ? 'bell' : 'check'" [size]="14" />
            <span *ngIf="activeSummary.unbalanced === 0">
              <strong>100% Balanced</strong> · {{ activeSummary.trips }} Trips Audited
            </span>
            <span *ngIf="activeSummary.unbalanced > 0">
              <strong>{{ activeSummary.unbalanced }} Flagged</strong> · Click to review
            </span>
          </div>

          <tm-button variant="green" size="sm" icon="plus" (clicked)="openPayoutModal()">
            Record Payout
          </tm-button>

          <tm-button variant="outline" size="sm" icon="download" (clicked)="exportCsv()">
            Export CSV
          </tm-button>

          <tm-button variant="outline" size="sm" icon="refresh" [loading]="loading" (clicked)="loadAll()">
            Refresh
          </tm-button>
        </div>
      </header>

      <!-- Error State Banner -->
      <div class="alert-box alert-box--error" *ngIf="error">
        <tm-icon name="bell" [size]="16" />
        <span>{{ error }}</span>
        <button type="button" class="alert-box__retry" (click)="loadAll()">Retry</button>
      </div>

      <!-- ====================================================================
           2. EXECUTIVE KPI CARDS (Clean, High-Impact Grid)
           ==================================================================== -->
      <section class="kpi-grid" *ngIf="!loading || displayRows.length > 0">
        <!-- 1. Passenger Collections -->
        <div class="kpi-card" [class.is-active]="viewMode === 'movements' && typeFilter === 'capture'" (click)="selectKpiMovements('capture')">
          <div class="kpi-card__header">
            <span class="kpi-card__label">Passenger Fares</span>
            <div class="kpi-card__icon kpi-card__icon--emerald">
              <tm-icon name="rupee" [size]="15" />
            </div>
          </div>
          <div class="kpi-card__value">
            ₹ {{ activeSummary.captured | number:'1.2-2' }}
          </div>
          <div class="kpi-card__sub">
            <span>₹ {{ totalDriverCash | number:'1.0-0' }} cash · ₹ {{ totalDriverOnline | number:'1.0-0' }} online</span>
          </div>
        </div>

        <!-- 2. Driver Settlements & Pending Payouts -->
        <div class="kpi-card" [class.is-active]="viewMode === 'drivers' && driverStatusFilter === 'pending'" (click)="selectKpiDrivers('pending')">
          <div class="kpi-card__header">
            <span class="kpi-card__label">Driver Settlements</span>
            <div class="kpi-card__icon kpi-card__icon--blue">
              <tm-icon name="arrow-right" [size]="15" />
            </div>
          </div>
          <div class="kpi-card__value">
            ₹ {{ activeSummary.to_driver | number:'1.2-2' }}
          </div>
          <div class="kpi-card__sub">
            <span *ngIf="totalPendingTransfers > 0" class="tag-pending">
              ₹ {{ totalPendingTransfers | number:'1.2-2' }} Pending ({{ pendingDriversCount }})
            </span>
            <span *ngIf="totalPendingTransfers === 0" class="tag-settled">
              All driver payouts settled
            </span>
          </div>
        </div>

        <!-- 3. Platform Revenue (Commissions) -->
        <div class="kpi-card" [class.is-active]="viewMode === 'commissions'" (click)="setViewMode('commissions')">
          <div class="kpi-card__header">
            <span class="kpi-card__label">Platform Commission</span>
            <div class="kpi-card__icon kpi-card__icon--amber">
              <tm-icon name="tag" [size]="15" />
            </div>
          </div>
          <div class="kpi-card__value">
            ₹ {{ totalPlatformCommissions | number:'1.2-2' }}
          </div>
          <div class="kpi-card__sub">
            <span class="kpi-badge">
              {{ totalDriverGross > 0 ? ((totalPlatformCommissions / totalDriverGross) * 100 | number:'1.1-1') : (activeSummary.captured > 0 ? ((totalPlatformCommissions / activeSummary.captured) * 100 | number:'1.1-1') : 0) }}% take-rate
            </span>
          </div>
        </div>

        <!-- 4. Driver Float & Wallet Health -->
        <div class="kpi-card" [class.is-active]="viewMode === 'drivers' && driverStatusFilter === 'all'" (click)="selectKpiDrivers('all')">
          <div class="kpi-card__header">
            <span class="kpi-card__label">Driver Float &amp; Wallets</span>
            <div class="kpi-card__icon kpi-card__icon--purple">
              <tm-icon name="users" [size]="15" />
            </div>
          </div>
          <div class="kpi-card__value" [class.kpi-card__value--danger]="totalWalletBalance < 0">
            ₹ {{ totalWalletBalance | number:'1.2-2' }}
          </div>
          <div class="kpi-card__sub">
            <span *ngIf="inDebtCount > 0" class="tag-debt">
              {{ inDebtCount }} in debt · {{ totalDriversCount }} registered
            </span>
            <span *ngIf="inDebtCount === 0" class="tag-clean">
              {{ totalDriversCount }} registered drivers
            </span>
          </div>
        </div>
      </section>

      <!-- Secondary Financial Metrics Pill Tray (Compact & Tidy) -->
      <div class="secondary-stats" *ngIf="!loading && (activeSummary.held > 0 || activeSummary.refunded > 0 || activeSummary.gateway_fee > 0 || totalDriverGross > 0)">
        <div class="secondary-stat" *ngIf="activeSummary.held > 0">
          <span class="secondary-stat__lbl">Held in Escrow:</span>
          <strong class="secondary-stat__val">₹ {{ activeSummary.held | number:'1.2-2' }}</strong>
        </div>
        <div class="secondary-stat" *ngIf="activeSummary.refunded > 0">
          <span class="secondary-stat__lbl">Refunds Settled:</span>
          <strong class="secondary-stat__val text-danger">₹ {{ activeSummary.refunded | number:'1.2-2' }}</strong>
        </div>
        <div class="secondary-stat" *ngIf="activeSummary.gateway_fee > 0">
          <span class="secondary-stat__lbl">Gateway Processing Fees:</span>
          <strong class="secondary-stat__val">₹ {{ activeSummary.gateway_fee | number:'1.2-2' }}</strong>
        </div>
        <div class="secondary-stat" *ngIf="totalDriverGross > 0">
          <span class="secondary-stat__lbl">Gross Driver Earnings:</span>
          <strong class="secondary-stat__val">₹ {{ totalDriverGross | number:'1.2-2' }}</strong>
        </div>
      </div>

      <!-- ====================================================================
           3. MAIN SECTION CARD & SEGMENTED TABS
           ==================================================================== -->
      <div class="section-card">
        <div class="nav-and-filters">
          <!-- Segmented View Tabs -->
          <nav class="seg-tabs" role="tablist">
            <button
              type="button"
              class="seg-tab"
              [class.is-active]="viewMode === 'movements'"
              (click)="setViewMode('movements')"
            >
              <tm-icon name="chart-line" [size]="14" />
              <span>Transactions &amp; Audit</span>
              <span class="seg-tab__count">{{ filteredRows.length }}</span>
            </button>

            <button
              type="button"
              class="seg-tab"
              [class.is-active]="viewMode === 'drivers'"
              (click)="setViewMode('drivers')"
            >
              <tm-icon name="user" [size]="14" />
              <span>Driver Float &amp; Wallets</span>
              <span class="seg-tab__count" [class.seg-tab__count--alert]="pendingDriversCount > 0">{{ filteredDrivers.length }}</span>
            </button>

            <button
              type="button"
              class="seg-tab"
              [class.is-active]="viewMode === 'commissions'"
              (click)="setViewMode('commissions')"
            >
              <tm-icon name="tag" [size]="14" />
              <span>Ride Commissions</span>
              <span class="seg-tab__count">{{ filteredCommissions.length }}</span>
            </button>

            <button
              type="button"
              class="seg-tab"
              [class.is-active]="viewMode === 'transfers'"
              (click)="setViewMode('transfers')"
            >
              <tm-icon name="check" [size]="14" />
              <span>Settlement History</span>
              <span class="seg-tab__count">{{ filteredTransfers.length }}</span>
            </button>
          </nav>

          <!-- Dynamic Filter Bar (Clean & Contextual) -->
          <div class="filter-strip">
            <!-- Left Side: Mode Specific Pills / Dropdowns -->
            <div class="filter-strip__left">
              <!-- Mode 1: Movements Specific Filters -->
              <ng-container *ngIf="viewMode === 'movements'">
                <!-- Grouping Pill Toggle -->
                <div class="mini-segmented">
                  <span class="mini-segmented__label">Group:</span>
                  <button type="button" class="mini-btn" [class.is-active]="groupBy === 'trip'" (click)="setGroupBy('trip')">Trip</button>
                  <button type="button" class="mini-btn" [class.is-active]="groupBy === 'driver'" (click)="setGroupBy('driver')">Driver</button>
                  <button type="button" class="mini-btn" [class.is-active]="groupBy === 'customer'" (click)="setGroupBy('customer')">Customer</button>
                  <button type="button" class="mini-btn" [class.is-active]="groupBy === 'none'" (click)="setGroupBy('none')">Flat</button>
                </div>

                <!-- Movement Type Selector -->
                <div class="select-wrapper">
                  <select class="clean-select" [(ngModel)]="typeFilter" (change)="page = 1">
                    <option value="all">All Movement Types</option>
                    <option *ngFor="let t of movementTypes" [value]="t.key">{{ t.label }}</option>
                  </select>
                </div>

                <!-- Unbalanced Toggle (Highlighted only if issues exist) -->
                <button
                  type="button"
                  class="pill-toggle"
                  [class.pill-toggle--active]="unbalancedOnly"
                  [class.pill-toggle--warning]="activeSummary.unbalanced > 0"
                  (click)="toggleUnbalancedFilter()"
                >
                  <span class="pill-toggle__dot" *ngIf="activeSummary.unbalanced > 0"></span>
                  <span>Flagged Only</span>
                </button>
              </ng-container>

              <!-- Mode 2: Driver Wallets Specific Filters -->
              <ng-container *ngIf="viewMode === 'drivers'">
                <div class="filter-pills">
                  <button type="button" class="filter-pill" [class.is-active]="driverStatusFilter === 'all'" (click)="driverStatusFilter = 'all'">
                    All ({{ driversList.length }})
                  </button>
                  <button type="button" class="filter-pill" [class.is-active]="driverStatusFilter === 'pending'" (click)="driverStatusFilter = 'pending'">
                    Pending Payout ({{ pendingDriversCount }})
                  </button>
                  <button type="button" class="filter-pill" [class.is-active]="driverStatusFilter === 'debt'" (click)="driverStatusFilter = 'debt'">
                    In Debt ({{ inDebtCount }})
                  </button>
                  <button type="button" class="filter-pill" [class.is-active]="driverStatusFilter === 'blocked'" (click)="driverStatusFilter = 'blocked'">
                    Blocked ({{ blockedCount }})
                  </button>
                </div>
              </ng-container>
            </div>

            <!-- Right Side: Date Presets & Search Input -->
            <div class="filter-strip__right">
              <!-- Date Presets (Hidden in Driver Wallets which is a point-in-time float view) -->
              <div class="date-presets" *ngIf="viewMode !== 'drivers'">
                <button type="button" class="date-chip" [class.is-active]="activePreset === 'today'" (click)="setPresetDate('today')">Today</button>
                <button type="button" class="date-chip" [class.is-active]="activePreset === 'yesterday'" (click)="setPresetDate('yesterday')">Yesterday</button>
                <button type="button" class="date-chip" [class.is-active]="activePreset === '7days'" (click)="setPresetDate('7days')">7D</button>
                <button type="button" class="date-chip" [class.is-active]="activePreset === 'thisMonth'" (click)="setPresetDate('thisMonth')">Month</button>
              </div>

              <!-- Custom Date Range Picker Input -->
              <div class="range-box" [class.is-filtered]="dateFrom || dateTo" *ngIf="viewMode !== 'drivers'">
                <tm-icon name="calendar" [size]="13" />
                <input
                  #rangeInput
                  type="text"
                  readonly
                  class="range-box__input"
                  placeholder="Date Range"
                  [value]="rangeLabel"
                  aria-label="Filter by date range"
                />
                <button *ngIf="dateFrom || dateTo" type="button" class="range-box__clear" (click)="clearDateRange(); $event.stopPropagation()" aria-label="Clear date">
                  <tm-icon name="x" [size]="12" />
                </button>
              </div>

              <!-- Live Search Box -->
              <div class="search-box">
                <tm-icon name="search" [size]="14" class="search-box__icon" />
                <input
                  type="text"
                  class="search-box__input"
                  [placeholder]="searchPlaceholder"
                  [(ngModel)]="searchFilter"
                  (ngModelChange)="onSearchChange()"
                />
                <button *ngIf="searchFilter" type="button" class="search-box__clear" (click)="clearSearch()" aria-label="Clear search">
                  <tm-icon name="x" [size]="12" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- ====================================================================
             VIEW 1: TRANSACTIONS & DOUBLE-ENTRY AUDIT TABLE
             ==================================================================== -->
        <div class="table-container" *ngIf="viewMode === 'movements'">
          <tm-data-table
            [rows]="pagedMovements"
            [total]="displayRows.length"
            [page]="page"
            [pageSize]="pageSize"
            [loading]="loading || searchLoading"
            [showToolbar]="false"
            emptyTitle="No transactions found"
            emptyHint="Completed rides, payments, driver transfers, and wallet adjustments will be listed here."
            (pageChange)="page = $event"
            (pageSizeChange)="pageSize = $event; page = 1"
          >
            <!-- Column 1: Date & Tx Reference -->
            <tm-column key="created_at" label="Date &amp; Time" width="160">
              <ng-template let-row>
                <div class="cell-stack" [class.cell-stack--child]="row.child">
                  <span class="cell-primary">{{ row.created_at | date:'d MMM y' }}</span>
                  <span class="cell-muted mono">{{ row.created_at | date:'h:mm a' }}</span>
                  <span class="ref-tag" *ngIf="!row.group">Tx #{{ row.id }}</span>
                </div>
              </ng-template>
            </tm-column>

            <!-- Column 2: Movement Type & Group Accordion -->
            <tm-column key="type" label="Movement Type" width="170">
              <ng-template let-row>
                <!-- Group Row Accordion Header -->
                <button
                  *ngIf="row.group; else individualType"
                  type="button"
                  class="accordion-btn"
                  (click)="toggleGroup(row.group.key)"
                  [attr.aria-expanded]="isExpanded(row.group.key)"
                >
                  <tm-icon [name]="isExpanded(row.group.key) ? 'chevron-down' : 'chevron-right'" [size]="13" />
                  <span>{{ row.group.count }} Movements</span>
                </button>

                <!-- Individual Movement Tag -->
                <ng-template #individualType>
                  <span class="type-pill" [ngClass]="'type-pill--' + row.type" [class.type-pill--child]="row.child">
                    <span class="type-pill__dot"></span>
                    {{ typeLabel(row.type) }}
                  </span>
                </ng-template>
              </ng-template>
            </tm-column>

            <!-- Column 3: Parties Involved (Customer / Driver / Platform) -->
            <tm-column key="party" label="Party / Details" width="280">
              <ng-template let-row>
                <!-- Individual Row Party Details -->
                <ng-container *ngIf="!row.group">
                  <div class="party-row" *ngIf="row.party === 'customer'">
                    <span class="role-badge role-badge--customer">Customer</span>
                    <strong class="party-title">{{ row.customer_name || 'Customer' }}</strong>
                    <span class="party-phone mono" *ngIf="row.customer_phone">{{ row.customer_phone }}</span>
                  </div>

                  <div class="party-row" *ngIf="row.party === 'driver'">
                    <span class="role-badge role-badge--driver">Driver</span>
                    <strong class="party-title">{{ row.driver_name || 'Driver' }}</strong>
                    <span class="party-phone mono" *ngIf="row.driver_phone">{{ row.driver_phone }}</span>
                  </div>

                  <div class="party-row" *ngIf="row.party === 'operator'">
                    <span class="role-badge role-badge--platform">Platform</span>
                    <strong class="party-title">Revenue &amp; Commission</strong>
                    <div class="party-subinfo" *ngIf="row.driver_name || row.customer_name">
                      <small *ngIf="row.driver_name">Drv: <strong>{{ row.driver_name }}</strong></small>
                      <small *ngIf="row.customer_name">Cust: <strong>{{ row.customer_name }}</strong></small>
                    </div>
                  </div>

                  <div class="party-row" *ngIf="row.party !== 'customer' && row.party !== 'driver' && row.party !== 'operator'">
                    <span class="role-badge">{{ row.party }}</span>
                    <div class="party-subinfo" *ngIf="row.driver_name || row.customer_name">
                      <small *ngIf="row.driver_name">Drv: <strong>{{ row.driver_name }}</strong></small>
                      <small *ngIf="row.customer_name">Cust: <strong>{{ row.customer_name }}</strong></small>
                    </div>
                  </div>
                </ng-container>

                <!-- Group Row Header Details -->
                <div class="group-info" *ngIf="row.group">
                  <strong class="group-info__title" *ngIf="row.group.label">{{ row.group.label }}</strong>
                  <div class="group-info__parties">
                    <span *ngIf="row.group.driver_name">Driver: <strong>{{ row.group.driver_name }}</strong></span>
                    <span *ngIf="row.group.customer_name">Customer: <strong>{{ row.group.customer_name }}</strong></span>
                  </div>
                  <div class="group-info__split">
                    <span>Driver: ₹ {{ row.group.toDriver | number:'1.2-2' }}</span>
                    <span>·</span>
                    <span>Fee: ₹ {{ row.group.commission | number:'1.2-2' }}</span>
                    <span *ngIf="row.group.refunded > 0" class="text-danger">· Ref: ₹ {{ row.group.refunded | number:'1.2-2' }}</span>
                  </div>
                </div>
              </ng-template>
            </tm-column>

            <!-- Column 4: Trip ID Reference -->
            <tm-column key="trip_id" label="Trip" width="100">
              <ng-template let-row>
                <button type="button" class="trip-tag" *ngIf="row.trip_id" (click)="focusTrip(row.trip_id)">
                  #{{ row.trip_id }}
                </button>
                <span class="cell-muted" *ngIf="!row.trip_id">—</span>
              </ng-template>
            </tm-column>

            <!-- Column 5: Double-Entry Balance Proof -->
            <tm-column key="balance" label="Balance Proof" width="130">
              <ng-template let-row>
                <ng-container *ngIf="balanceFor(row.trip_id) as b; else noBal">
                  <span class="proof-tag" [class.proof-tag--balanced]="b.balanced" [class.proof-tag--imbalance]="!b.balanced">
                    <span class="proof-tag__dot"></span>
                    {{ b.balanced ? 'Balanced' : (b.imbalance_paise / 100 | number:'1.2-2') + ' off' }}
                  </span>
                </ng-container>
                <ng-template #noBal><span class="cell-muted">—</span></ng-template>
              </ng-template>
            </tm-column>

            <!-- Column 6: Gateway Reference / Payment ID -->
            <tm-column key="razorpay_ref" label="Reference / Payment" width="190">
              <ng-template let-row>
                <div class="ref-stack" *ngIf="!row.group">
                  <span class="mono-code" *ngIf="row.razorpay_ref" [title]="row.razorpay_ref">{{ row.razorpay_ref }}</span>
                  <small class="cell-muted" *ngIf="row.payment_id">Pay #{{ row.payment_id }}</small>
                  <span class="cell-muted" *ngIf="!row.razorpay_ref && !row.payment_id">—</span>
                </div>
                <span class="cell-muted" *ngIf="row.group">{{ row.group.count }} entries</span>
              </ng-template>
            </tm-column>

            <!-- Column 7: Movement Amount -->
            <tm-column key="amount" label="Amount" width="140" align="right">
              <ng-template let-row>
                <span class="amount-val amount-val--group" *ngIf="row.group">
                  ₹ {{ row.group.captured | number:'1.2-2' }}
                </span>
                <span class="amount-val" *ngIf="!row.group" [class.amount-val--in]="row.direction === 'in'" [class.amount-val--out]="row.direction === 'out'">
                  {{ row.direction === 'out' ? '−' : '+' }} ₹ {{ row.amount | number:'1.2-2' }}
                </span>
              </ng-template>
            </tm-column>
          </tm-data-table>
        </div>

        <!-- ====================================================================
             VIEW 2: DRIVER FLOAT & WALLET HEALTH TABLE
             ==================================================================== -->
        <div class="table-container" *ngIf="viewMode === 'drivers'">
          <div class="custom-table-wrap">
            <table class="luxury-table">
              <thead>
                <tr>
                  <th>Driver Profile</th>
                  <th>Vehicle Details</th>
                  <th>Wallet Float Balance</th>
                  <th>Limit &amp; Permissions</th>
                  <th>Pending Payout Due</th>
                  <th>Gross Earnings</th>
                  <th>Cash vs Online</th>
                  <th style="text-align: right;">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let d of filteredDrivers" class="hoverable-row">
                  <!-- Driver Profile -->
                  <td>
                    <div class="user-block">
                      <div class="avatar-initials">{{ (d.name || 'D').charAt(0).toUpperCase() }}</div>
                      <div class="user-block__text">
                        <strong class="user-block__name">{{ d.name }}</strong>
                        <span class="user-block__phone mono">{{ d.phone }}</span>
                      </div>
                    </div>
                  </td>

                  <!-- Vehicle Details -->
                  <td>
                    <div class="cell-stack">
                      <span class="cell-primary">{{ d.vehicle_type || 'Cab' }}</span>
                      <span class="cell-muted mono">{{ d.vehicle_reg_no }}</span>
                    </div>
                  </td>

                  <!-- Wallet Balance -->
                  <td>
                    <div class="wallet-badge" [class.wallet-badge--positive]="d.balance >= 0" [class.wallet-badge--negative]="d.balance < 0">
                      <span class="wallet-badge__dot"></span>
                      ₹ {{ d.balance | number:'1.2-2' }}
                    </div>
                    <div *ngIf="d.is_in_debt" class="debt-warning-tag">In Debt</div>
                  </td>

                  <!-- Limit & Permission -->
                  <td>
                    <div class="cell-stack">
                      <span class="cell-primary">{{ d.minimum_wallet_limit === 0 ? '₹0 Limit' : 'Min ₹' + d.minimum_wallet_limit }}</span>
                      <span *ngIf="!d.can_accept_rides" class="status-chip status-chip--blocked">Rides Blocked</span>
                      <span *ngIf="d.can_accept_rides" class="status-chip status-chip--allowed">Active</span>
                      <small *ngIf="d.active_subscription" class="text-emerald-bold">
                        {{ d.active_subscription.plan_title }} ({{ d.active_subscription.commission_percent }}%)
                      </small>
                    </div>
                  </td>

                  <!-- Pending Payout -->
                  <td>
                    <strong class="payout-due-highlight" *ngIf="(d.pending_payout || 0) > 0">
                      ₹ {{ d.pending_payout | number:'1.2-2' }}
                    </strong>
                    <span class="cell-muted" *ngIf="!d.pending_payout || d.pending_payout <= 0">₹ 0.00</span>
                  </td>

                  <!-- Gross Earnings -->
                  <td>
                    <div class="cell-stack">
                      <strong class="cell-primary">₹ {{ (d.gross_earnings || 0) | number:'1.2-2' }}</strong>
                      <span class="cell-muted">{{ d.rides_count || 0 }} completed rides</span>
                    </div>
                  </td>

                  <!-- Cash vs Online -->
                  <td>
                    <div class="split-pill-group">
                      <span class="split-pill split-pill--cash">₹ {{ (d.cash_collected || 0) | number:'1.0-0' }} Cash</span>
                      <span class="split-pill split-pill--online">₹ {{ (d.online_collected || 0) | number:'1.0-0' }} Online</span>
                    </div>
                  </td>

                  <!-- Actions -->
                  <td style="text-align: right;">
                    <tm-button
                      *ngIf="(d.pending_payout || 0) > 0"
                      variant="green"
                      size="sm"
                      (clicked)="openPayoutModal(d)"
                    >
                      Pay Out
                    </tm-button>
                    <span *ngIf="!d.pending_payout || d.pending_payout <= 0" class="cell-muted">—</span>
                  </td>
                </tr>

                <tr *ngIf="filteredDrivers.length === 0">
                  <td colspan="8" class="empty-state-cell">
                    <div class="empty-state">
                      <tm-icon name="user" [size]="28" />
                      <p>No drivers matching the selected criteria.</p>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- ====================================================================
             VIEW 3: RIDE COMMISSIONS REGISTER TABLE
             ==================================================================== -->
        <div class="table-container" *ngIf="viewMode === 'commissions'">
          <div class="custom-table-wrap">
            <table class="luxury-table">
              <thead>
                <tr>
                  <th>Trip &amp; Timestamp</th>
                  <th>Driver Details</th>
                  <th>Vehicle</th>
                  <th>Gross Fare</th>
                  <th>Commission Rate</th>
                  <th>Platform Fee</th>
                  <th>Driver Take-Home</th>
                  <th>Service Mode</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let c of filteredCommissions" class="hoverable-row">
                  <!-- Trip & Timestamp -->
                  <td>
                    <div class="cell-stack">
                      <span class="trip-tag">#{{ c.trip_id }}</span>
                      <span class="cell-muted">{{ c.date | date:'d MMM, h:mm a' }}</span>
                    </div>
                  </td>

                  <!-- Driver Details -->
                  <td>
                    <div class="cell-stack">
                      <strong class="cell-primary">{{ c.driver_name }}</strong>
                      <span class="cell-muted mono">{{ c.driver_phone }}</span>
                    </div>
                  </td>

                  <!-- Vehicle -->
                  <td>
                    <span class="cell-primary">{{ c.vehicle_type || '—' }}</span>
                  </td>

                  <!-- Gross Fare -->
                  <td>
                    <strong class="cell-primary">₹ {{ c.fare | number:'1.2-2' }}</strong>
                  </td>

                  <!-- Commission Rate -->
                  <td>
                    <span class="rate-tag" [class.rate-tag--fixed]="c.is_fixed_commission || c.commission_percent <= 0">
                      {{ (c.is_fixed_commission || c.commission_percent <= 0) ? 'Fixed Rate' : (c.commission_percent + '%') }}
                    </span>
                  </td>

                  <!-- Platform Fee -->
                  <td>
                    <strong class="fee-highlight">₹ {{ c.commission_amount | number:'1.2-2' }}</strong>
                  </td>

                  <!-- Driver Take-Home -->
                  <td>
                    <strong class="driver-share-highlight">₹ {{ c.net_driver_earnings | number:'1.2-2' }}</strong>
                  </td>

                  <!-- Service Mode -->
                  <td>
                    <span class="service-pill" [ngClass]="'service-pill--' + (c.mode || (c.is_shared ? 'fixed' : 'private'))">
                      {{ formatTripMode(c) }}
                    </span>
                    <small *ngIf="c.route_name" class="route-sub">{{ c.route_name }}</small>
                  </td>
                </tr>

                <tr *ngIf="filteredCommissions.length === 0">
                  <td colspan="8" class="empty-state-cell">
                    <div class="empty-state">
                      <tm-icon name="tag" [size]="28" />
                      <p>No commissioned rides found for the selected period.</p>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- ====================================================================
             VIEW 4: COMPLETED SETTLEMENTS REGISTER TABLE
             ==================================================================== -->
        <div class="table-container" *ngIf="viewMode === 'transfers'">
          <div class="custom-table-wrap">
            <table class="luxury-table">
              <thead>
                <tr>
                  <th>Settlement Date</th>
                  <th>Driver Recipient</th>
                  <th>Amount Settled</th>
                  <th>Payment Method</th>
                  <th>UTR / Reference ID</th>
                  <th>Recorded By</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let t of filteredTransfers" class="hoverable-row">
                  <!-- Settlement Date -->
                  <td>
                    <div class="cell-stack">
                      <span class="cell-primary">{{ t.created_at | date:'d MMM y' }}</span>
                      <span class="cell-muted mono">{{ t.created_at | date:'h:mm a' }}</span>
                    </div>
                  </td>

                  <!-- Driver Recipient -->
                  <td>
                    <div class="user-block">
                      <div class="avatar-initials avatar-initials--blue">{{ (t.driver_name || 'D').charAt(0).toUpperCase() }}</div>
                      <div class="user-block__text">
                        <strong class="user-block__name">{{ t.driver_name }}</strong>
                        <span class="user-block__phone mono">{{ t.driver_phone }}</span>
                      </div>
                    </div>
                  </td>

                  <!-- Amount Settled -->
                  <td>
                    <strong class="transfer-amt-badge">₹ {{ t.amount | number:'1.2-2' }}</strong>
                  </td>

                  <!-- Payment Method -->
                  <td>
                    <span class="method-tag">{{ formatMethod(t.method) }}</span>
                  </td>

                  <!-- UTR / Reference ID -->
                  <td>
                    <div class="cell-stack">
                      <span class="mono-code">{{ t.reference || '—' }}</span>
                      <small *ngIf="t.notes" class="cell-muted">{{ t.notes }}</small>
                    </div>
                  </td>

                  <!-- Recorded By -->
                  <td>
                    <span class="recorder-chip">{{ t.recorded_by || 'Admin' }}</span>
                  </td>
                </tr>

                <tr *ngIf="filteredTransfers.length === 0">
                  <td colspan="6" class="empty-state-cell">
                    <div class="empty-state">
                      <tm-icon name="check" [size]="28" />
                      <p>No completed transfer records found.</p>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- ====================================================================
           4. RECORD DRIVER PAYOUT MODAL (Bank-Grade Executive Dialog)
           ==================================================================== -->
      <div class="modal-backdrop" *ngIf="showPayoutModal" (click)="closeModals()">
        <div class="modal-card" (click)="$event.stopPropagation()">
          <!-- Modal Header -->
          <div class="modal-card__header">
            <div class="modal-card__title-group">
              <h3>Record Driver Payout</h3>
              <p>Execute manual bank transfer or UPI payout to driver.</p>
            </div>
            <button type="button" class="modal-card__close" (click)="closeModals()" aria-label="Close modal">
              <tm-icon name="x" [size]="16" />
            </button>
          </div>

          <!-- Modal Body -->
          <div class="modal-card__body">
            <!-- Driver Picker if not preselected -->
            <div class="form-row" *ngIf="!selectedDriverForPayout">
              <label class="form-label">Select Driver for Settlement</label>
              <select class="form-input form-select" [(ngModel)]="payoutDriverId" (change)="onPayoutDriverSelected()">
                <option [ngValue]="null">-- Select a registered driver --</option>
                <option *ngFor="let d of driversList" [ngValue]="d.driver_id">
                  {{ d.name }} ({{ d.phone }}) — Pending Due: ₹{{ (d.pending_payout || 0) | number:'1.2-2' }}
                </option>
              </select>
            </div>

            <!-- Driver Account Details Card -->
            <div class="payout-driver-card" *ngIf="selectedDriverForPayout">
              <div class="payout-driver-card__top">
                <div class="user-block">
                  <div class="avatar-initials avatar-initials--green">
                    {{ (selectedDriverForPayout.name || 'D').charAt(0).toUpperCase() }}
                  </div>
                  <div class="user-block__text">
                    <strong class="user-block__name">{{ selectedDriverForPayout.name }}</strong>
                    <span class="user-block__phone mono">{{ selectedDriverForPayout.phone }} · {{ selectedDriverForPayout.vehicle_reg_no }}</span>
                  </div>
                </div>

                <div class="payout-driver-card__due">
                  <span class="payout-due-lbl">Pending Due</span>
                  <span class="payout-due-val">₹ {{ (selectedDriverForPayout.pending_payout || 0) | number:'1.2-2' }}</span>
                </div>
              </div>

              <!-- Bank Account & UPI Specs -->
              <div class="banking-specs">
                <div *ngIf="selectedDriverForPayout.payout_upi || selectedDriverForPayout.payout_bank_last4; else noSavedBank">
                  <div class="spec-line" *ngIf="selectedDriverForPayout.payout_upi">
                    <span class="spec-lbl">UPI VPA:</span>
                    <strong class="spec-val mono">{{ selectedDriverForPayout.payout_upi }}</strong>
                  </div>
                  <div class="spec-line" *ngIf="selectedDriverForPayout.payout_beneficiary_name">
                    <span class="spec-lbl">Account Holder:</span>
                    <strong class="spec-val">{{ selectedDriverForPayout.payout_beneficiary_name }}</strong>
                  </div>
                  <div class="spec-line" *ngIf="selectedDriverForPayout.payout_bank_last4">
                    <span class="spec-lbl">Bank Account:</span>
                    <strong class="spec-val mono">•••• {{ selectedDriverForPayout.payout_bank_last4 }}</strong>
                  </div>
                  <div class="spec-line" *ngIf="selectedDriverForPayout.payout_ifsc">
                    <span class="spec-lbl">IFSC Code:</span>
                    <strong class="spec-val mono">{{ selectedDriverForPayout.payout_ifsc }}</strong>
                  </div>
                </div>

                <ng-template #noSavedBank>
                  <div class="no-bank-hint">
                    No verified bank account saved. You can transfer directly via UPI / GPay to phone:
                    <strong class="mono">{{ selectedDriverForPayout.phone }}</strong>
                  </div>
                </ng-template>
              </div>
            </div>

            <!-- Transfer Method -->
            <div class="form-row">
              <label class="form-label">Transfer Channel / Method</label>
              <select class="form-input form-select" [(ngModel)]="payoutForm.method">
                <option value="gpay">UPI / GPay / PhonePe</option>
                <option value="bank">Bank Transfer (NEFT / IMPS / RTGS)</option>
                <option value="cash">Cash Handover</option>
                <option value="other">Other Settlement</option>
              </select>
            </div>

            <!-- Transfer Amount -->
            <div class="form-row">
              <div class="form-label-bar">
                <label class="form-label">Settlement Amount (₹)</label>
                <button
                  *ngIf="selectedDriverForPayout && (selectedDriverForPayout.pending_payout || 0) > 0"
                  type="button"
                  class="quick-fill-btn"
                  (click)="fillPendingAmount()"
                >
                  Fill Full Due: ₹{{ selectedDriverForPayout.pending_payout | number:'1.2-2' }}
                </button>
              </div>
              <input
                type="number"
                class="form-input mono"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                [(ngModel)]="payoutForm.amount"
              />
            </div>

            <!-- UTR Reference -->
            <div class="form-row">
              <label class="form-label">UTR / Transaction Reference (Optional)</label>
              <input
                type="text"
                class="form-input mono"
                placeholder="e.g. UTR123456789 or UPI Ref"
                [(ngModel)]="payoutForm.reference"
              />
            </div>

            <!-- Remarks -->
            <div class="form-row">
              <label class="form-label">Internal Notes / Settlement Remarks</label>
              <input
                type="text"
                class="form-input"
                placeholder="e.g. Weekly driver earnings settlement"
                [(ngModel)]="payoutForm.note"
              />
            </div>

            <!-- Modal Error Banner -->
            <div class="modal-alert-error" *ngIf="payoutError">
              <tm-icon name="bell" [size]="14" />
              <span>{{ payoutError }}</span>
            </div>
          </div>

          <!-- Modal Footer -->
          <div class="modal-card__footer">
            <tm-button variant="outline" size="sm" (clicked)="closeModals()" [disabled]="submittingPayout">
              Cancel
            </tm-button>
            <tm-button
              variant="green"
              size="sm"
              [loading]="submittingPayout"
              [disabled]="submittingPayout || !selectedDriverForPayout || !payoutForm.amount || payoutForm.amount <= 0"
              (clicked)="submitPayout()"
            >
              Confirm &amp; Record Transfer
            </tm-button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
    }

    .ledger-shell {
      display: flex;
      flex-direction: column;
      gap: var(--tm-space-5, 20px);
      max-width: var(--tm-content-max, 1400px);
      margin: 0 auto;
    }

    /* ==========================================================================
       1. HERO HEADER
       ========================================================================== */
    .ledger-hero {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--tm-space-4, 16px);
      flex-wrap: wrap;
    }

    .ledger-hero__main {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .ledger-hero__eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--tm-text-muted, #6B7785);
    }

    .pulse-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--tm-green, #22C55E);
      box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.2);
    }

    .pulse-dot--warning {
      background: var(--tm-warning, #F59E0B);
      box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.2);
    }

    .ledger-hero__title {
      margin: 0;
      font-size: 28px;
      font-weight: 850;
      letter-spacing: -0.03em;
      color: var(--tm-text, #0F1419);
      line-height: 1.15;
    }

    .ledger-hero__desc {
      margin: 0;
      font-size: 13.5px;
      color: var(--tm-text-muted, #6B7785);
      line-height: 1.45;
    }

    .ledger-hero__actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .audit-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: var(--tm-radius-pill, 999px);
      font-size: 12px;
      cursor: pointer;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
      border: 1px solid transparent;
      user-select: none;
    }

    .audit-pill:hover {
      transform: translateY(-1px);
    }

    .audit-pill--good {
      background: var(--tm-green-tint, #ECFDF3);
      color: var(--tm-green-deep, #16A34A);
      border-color: rgba(34, 197, 94, 0.25);
    }

    .audit-pill--bad {
      background: var(--tm-danger-bg, #FEE2E2);
      color: var(--tm-danger-fg, #B91C1C);
      border-color: rgba(239, 68, 68, 0.3);
      animation: alertPulse 2s infinite ease-in-out;
    }

    @keyframes alertPulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.3); }
      50% { box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.15); }
    }

    /* ==========================================================================
       2. KPI CARDS GRID
       ========================================================================== */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: var(--tm-space-4, 16px);
    }

    @media (max-width: 1024px) {
      .kpi-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    @media (max-width: 600px) {
      .kpi-grid {
        grid-template-columns: 1fr;
      }
    }

    .kpi-card {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 16px 18px;
      background: var(--tm-surface, #FFFFFF);
      border: 1px solid var(--tm-line, #ECEFF3);
      border-radius: var(--tm-radius-lg, 22px);
      box-shadow: var(--tm-shadow-sm, 0 1px 2px rgba(15,20,25,0.05));
      cursor: pointer;
      transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .kpi-card:hover {
      transform: translateY(-2px);
      border-color: var(--tm-line-2, #E2E6EC);
      box-shadow: var(--tm-shadow-card, 0 8px 24px -16px rgba(15,20,25,0.12));
    }

    .kpi-card.is-active {
      border-color: var(--tm-ink, #0F1419);
      box-shadow: 0 0 0 2px rgba(15, 20, 25, 0.08);
    }

    .kpi-card__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .kpi-card__label {
      font-size: 12px;
      font-weight: 700;
      color: var(--tm-text-muted, #6B7785);
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .kpi-card__icon {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .kpi-card__icon--emerald { background: var(--tm-green-tint, #ECFDF3); color: var(--tm-green-deep, #16A34A); }
    .kpi-card__icon--blue { background: var(--tm-info-bg, #DBEAFE); color: var(--tm-info-fg, #1E40AF); }
    .kpi-card__icon--amber { background: var(--tm-warning-bg, #FEF3C7); color: var(--tm-warning-fg, #92400E); }
    .kpi-card__icon--purple { background: #F3E8FF; color: #7E22CE; }

    .kpi-card__value {
      font-size: 24px;
      font-weight: 850;
      color: var(--tm-text, #0F1419);
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.03em;
      margin-top: 2px;
    }

    .kpi-card__value--danger {
      color: var(--tm-danger-fg, #B91C1C);
    }

    .kpi-card__sub {
      font-size: 11.5px;
      color: var(--tm-text-soft, #94A0AD);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .tag-pending {
      color: var(--tm-green-deep, #16A34A);
      font-weight: 800;
    }

    .tag-settled {
      color: var(--tm-text-muted, #6B7785);
    }

    .tag-debt {
      color: var(--tm-danger-fg, #B91C1C);
      font-weight: 800;
    }

    .tag-clean {
      color: var(--tm-text-muted, #6B7785);
    }

    .kpi-badge {
      display: inline-flex;
      padding: 1px 6px;
      background: var(--tm-canvas-2, #EAEEF4);
      color: var(--tm-text, #0F1419);
      border-radius: 4px;
      font-weight: 700;
      font-size: 11px;
    }

    /* Secondary Stats Pill Bar */
    .secondary-stats {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 16px;
      background: var(--tm-canvas-2, #EAEEF4);
      border-radius: var(--tm-radius-md, 14px);
      flex-wrap: wrap;
    }

    .secondary-stat {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
    }

    .secondary-stat__lbl {
      color: var(--tm-text-muted, #6B7785);
      font-weight: 600;
    }

    .secondary-stat__val {
      color: var(--tm-text, #0F1419);
      font-weight: 800;
      font-variant-numeric: tabular-nums;
    }

    .text-danger { color: var(--tm-danger-fg, #B91C1C); }
    .text-emerald-bold { color: var(--tm-green-deep, #16A34A); font-weight: 700; font-size: 11px; }

    /* ==========================================================================
       3. MAIN SECTION CARD & SEGMENTED TABS
       ========================================================================== */
    .section-card {
      background: var(--tm-surface, #FFFFFF);
      border: 1px solid var(--tm-line, #ECEFF3);
      border-radius: var(--tm-radius-lg, 22px);
      box-shadow: var(--tm-shadow-sm, 0 1px 2px rgba(15,20,25,0.05));
      overflow: hidden;
    }

    .nav-and-filters {
      padding: 14px 18px;
      border-bottom: 1px solid var(--tm-line, #ECEFF3);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .seg-tabs {
      display: flex;
      gap: 6px;
      padding: 3px;
      background: var(--tm-canvas, #F4F6FA);
      border-radius: var(--tm-radius-md, 14px);
      overflow-x: auto;
      scrollbar-width: none;
    }
    .seg-tabs::-webkit-scrollbar { display: none; }

    .seg-tab {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border: 0;
      background: transparent;
      color: var(--tm-text-muted, #6B7785);
      font-family: var(--tm-font-body);
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      border-radius: calc(var(--tm-radius-md, 14px) - 3px);
      white-space: nowrap;
      transition: all 0.15s ease;
    }

    .seg-tab:hover:not(.is-active) {
      color: var(--tm-text, #0F1419);
    }

    .seg-tab.is-active {
      background: var(--tm-surface, #FFFFFF);
      color: var(--tm-text, #0F1419);
      font-weight: 800;
      box-shadow: 0 1px 3px rgba(15,20,25,0.08);
    }

    .seg-tab__count {
      display: inline-flex;
      padding: 1px 6px;
      background: var(--tm-canvas-2, #EAEEF4);
      color: var(--tm-text-muted, #6B7785);
      border-radius: 999px;
      font-size: 11px;
      font-weight: 800;
    }

    .seg-tab.is-active .seg-tab__count {
      background: var(--tm-canvas, #F4F6FA);
      color: var(--tm-text, #0F1419);
    }

    .seg-tab__count--alert {
      background: var(--tm-green-tint, #ECFDF3) !important;
      color: var(--tm-green-deep, #16A34A) !important;
    }

    /* Filter Strip */
    .filter-strip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    .filter-strip__left {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .filter-strip__right {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-left: auto;
    }

    /* Mini Segmented (Group By) */
    .mini-segmented {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 2px 4px;
      background: var(--tm-canvas, #F4F6FA);
      border-radius: var(--tm-radius-sm, 10px);
    }

    .mini-segmented__label {
      font-size: 11px;
      font-weight: 700;
      color: var(--tm-text-soft, #94A0AD);
      margin: 0 4px;
    }

    .mini-btn {
      border: 0;
      background: transparent;
      padding: 4px 9px;
      font-size: 11.5px;
      font-weight: 700;
      color: var(--tm-text-muted, #6B7785);
      cursor: pointer;
      border-radius: 6px;
      transition: all 0.15s ease;
    }

    .mini-btn:hover { color: var(--tm-text, #0F1419); }
    .mini-btn.is-active {
      background: var(--tm-surface, #FFFFFF);
      color: var(--tm-text, #0F1419);
      font-weight: 800;
      box-shadow: 0 1px 2px rgba(15,20,25,0.06);
    }

    /* Clean Select */
    .select-wrapper { position: relative; }
    .clean-select {
      height: 32px;
      padding: 0 10px;
      background: var(--tm-surface, #FFFFFF);
      border: 1px solid var(--tm-line, #ECEFF3);
      border-radius: var(--tm-radius-sm, 10px);
      font-size: 12px;
      font-weight: 600;
      color: var(--tm-text, #0F1419);
      outline: none;
      cursor: pointer;
      transition: border-color 0.15s ease;
    }
    .clean-select:focus { border-color: var(--tm-ink, #0F1419); }

    /* Pill Toggle */
    .pill-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 32px;
      padding: 0 12px;
      border: 1px solid var(--tm-line, #ECEFF3);
      background: var(--tm-surface, #FFFFFF);
      border-radius: var(--tm-radius-sm, 10px);
      font-size: 12px;
      font-weight: 700;
      color: var(--tm-text-muted, #6B7785);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .pill-toggle:hover { border-color: var(--tm-text, #0F1419); color: var(--tm-text, #0F1419); }
    .pill-toggle--active {
      background: var(--tm-ink, #0F1419);
      color: var(--tm-surface, #FFFFFF) !important;
      border-color: var(--tm-ink, #0F1419);
    }
    .pill-toggle--warning .pill-toggle__dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--tm-warning, #F59E0B);
    }

    /* Driver Status Filter Pills */
    .filter-pills {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--tm-canvas, #F4F6FA);
      padding: 2px 4px;
      border-radius: var(--tm-radius-sm, 10px);
    }

    .filter-pill {
      border: 0;
      background: transparent;
      padding: 5px 11px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 700;
      color: var(--tm-text-muted, #6B7785);
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s ease;
    }
    .filter-pill:hover { color: var(--tm-text, #0F1419); }
    .filter-pill.is-active {
      background: var(--tm-surface, #FFFFFF);
      color: var(--tm-text, #0F1419);
      font-weight: 800;
      box-shadow: 0 1px 2px rgba(15,20,25,0.06);
    }

    /* Date Presets */
    .date-presets {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      background: var(--tm-canvas, #F4F6FA);
      padding: 2px 4px;
      border-radius: var(--tm-radius-sm, 10px);
    }

    .date-chip {
      border: 0;
      background: transparent;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 11.5px;
      font-weight: 700;
      color: var(--tm-text-muted, #6B7785);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .date-chip:hover { color: var(--tm-text, #0F1419); }
    .date-chip.is-active {
      background: var(--tm-surface, #FFFFFF);
      color: var(--tm-text, #0F1419);
      font-weight: 800;
      box-shadow: 0 1px 2px rgba(15,20,25,0.06);
    }

    /* Date Range Box */
    .range-box {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 32px;
      padding: 0 10px;
      border: 1px solid var(--tm-line, #ECEFF3);
      border-radius: var(--tm-radius-sm, 10px);
      background: var(--tm-surface, #FFFFFF);
      color: var(--tm-text-muted, #6B7785);
      cursor: pointer;
    }
    .range-box.is-filtered {
      border-color: var(--tm-green, #22C55E);
      background: var(--tm-green-tint, #ECFDF3);
      color: var(--tm-green-deep, #16A34A);
    }
    .range-box__input {
      appearance: none;
      background: transparent;
      border: 0;
      outline: 0;
      font-family: var(--tm-font-mono);
      font-size: 11px;
      font-weight: 600;
      color: inherit;
      width: 120px;
      cursor: pointer;
    }
    .range-box__clear {
      border: 0;
      background: transparent;
      padding: 2px;
      color: inherit;
      cursor: pointer;
      display: inline-flex;
    }

    /* Search Box */
    .search-box {
      position: relative;
      display: flex;
      align-items: center;
      min-width: 220px;
    }
    .search-box__icon {
      position: absolute;
      left: 10px;
      color: var(--tm-text-soft, #94A0AD);
      pointer-events: none;
    }
    .search-box__input {
      width: 100%;
      height: 32px;
      padding: 0 24px 0 30px;
      font: inherit;
      font-size: 12px;
      color: var(--tm-text, #0F1419);
      background: var(--tm-surface, #FFFFFF);
      border: 1px solid var(--tm-line, #ECEFF3);
      border-radius: var(--tm-radius-sm, 10px);
      outline: none;
      transition: border-color 0.15s ease;
    }
    .search-box__input:focus { border-color: var(--tm-ink, #0F1419); }
    .search-box__clear {
      position: absolute;
      right: 6px;
      border: 0;
      background: transparent;
      padding: 2px;
      color: var(--tm-text-muted, #6B7785);
      cursor: pointer;
      display: inline-flex;
    }

    /* ==========================================================================
       TABLES & CELLS
       ========================================================================== */
    .table-container { width: 100%; }
    .custom-table-wrap { overflow-x: auto; }

    .luxury-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
    }

    .luxury-table th {
      background: var(--tm-canvas, #F4F6FA);
      color: var(--tm-text-muted, #6B7785);
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 12px 18px;
      border-bottom: 1px solid var(--tm-line, #ECEFF3);
    }

    .luxury-table td {
      padding: 14px 18px;
      border-bottom: 1px solid var(--tm-line, #ECEFF3);
      vertical-align: middle;
    }

    .hoverable-row { transition: background 0.15s ease; }
    .hoverable-row:hover { background: var(--tm-canvas, #F4F6FA); }

    /* Common Cell Components */
    .mono { font-family: var(--tm-font-mono, monospace); }
    .cell-stack { display: flex; flex-direction: column; gap: 2px; }
    .cell-stack--child { padding-left: 12px; border-left: 2px solid var(--tm-line-2, #E2E6EC); }
    .cell-primary { font-weight: 700; color: var(--tm-text, #0F1419); }
    .cell-muted { font-size: 11.5px; color: var(--tm-text-muted, #6B7785); }

    .user-block { display: flex; align-items: center; gap: 10px; }
    .avatar-initials {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--tm-canvas-2, #EAEEF4);
      color: var(--tm-text, #0F1419);
      font-weight: 800;
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
    }
    .avatar-initials--green { background: var(--tm-green-tint, #ECFDF3); color: var(--tm-green-deep, #16A34A); }
    .avatar-initials--blue { background: var(--tm-info-bg, #DBEAFE); color: var(--tm-info-fg, #1E40AF); }

    .user-block__text { display: flex; flex-direction: column; gap: 1px; }
    .user-block__name { font-size: 13px; font-weight: 800; color: var(--tm-text, #0F1419); }
    .user-block__phone { font-size: 11px; color: var(--tm-text-muted, #6B7785); }

    /* Tags & Pills */
    .ref-tag {
      font-family: var(--tm-font-mono);
      font-size: 10.5px;
      font-weight: 700;
      color: var(--tm-text-soft, #94A0AD);
    }

    .trip-tag {
      display: inline-flex;
      align-items: center;
      font-family: var(--tm-font-mono);
      font-size: 12px;
      font-weight: 800;
      color: var(--tm-info-fg, #1E40AF);
      background: var(--tm-info-bg, #DBEAFE);
      padding: 2px 7px;
      border-radius: 6px;
      border: 0;
      cursor: pointer;
      transition: transform 0.1s ease;
    }
    .trip-tag:hover { transform: scale(1.03); }

    .accordion-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      background: var(--tm-surface, #FFFFFF);
      border: 1px solid var(--tm-line-2, #E2E6EC);
      border-radius: var(--tm-radius-sm, 10px);
      font-size: 12px;
      font-weight: 800;
      color: var(--tm-text, #0F1419);
      cursor: pointer;
      box-shadow: var(--tm-shadow-sm, 0 1px 2px rgba(15,20,25,0.05));
    }

    .type-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 9px;
      border-radius: var(--tm-radius-pill, 999px);
      font-size: 11px;
      font-weight: 800;
      background: var(--tm-canvas-2, #EAEEF4);
      color: var(--tm-text, #0F1419);
      white-space: nowrap;
    }
    .type-pill__dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
    .type-pill--capture { background: var(--tm-green-tint, #ECFDF3); color: var(--tm-green-deep, #16A34A); }
    .type-pill--transfer { background: var(--tm-info-bg, #DBEAFE); color: var(--tm-info-fg, #1E40AF); }
    .type-pill--retained { background: var(--tm-warning-bg, #FEF3C7); color: var(--tm-warning-fg, #92400E); }
    .type-pill--held { background: #FEF3C7; color: #92400E; }
    .type-pill--refund, .type-pill--reversal { background: var(--tm-danger-bg, #FEE2E2); color: var(--tm-danger-fg, #B91C1C); }

    .role-badge {
      display: inline-flex;
      width: fit-content;
      padding: 1px 5px;
      border-radius: 4px;
      font-size: 9.5px;
      font-weight: 800;
      text-transform: uppercase;
      background: var(--tm-canvas-2, #EAEEF4);
      color: var(--tm-text-muted, #6B7785);
    }
    .role-badge--customer { background: var(--tm-green-tint, #ECFDF3); color: var(--tm-green-deep, #16A34A); }
    .role-badge--driver { background: var(--tm-info-bg, #DBEAFE); color: var(--tm-info-fg, #1E40AF); }
    .role-badge--platform { background: var(--tm-ink, #0F1419); color: var(--tm-surface, #FFFFFF); }

    .party-row { display: flex; flex-direction: column; gap: 2px; }
    .party-title { font-size: 13px; font-weight: 800; color: var(--tm-text, #0F1419); }
    .party-phone { font-size: 11px; color: var(--tm-text-muted, #6B7785); }
    .party-subinfo { display: flex; gap: 6px; font-size: 11px; color: var(--tm-text-muted, #6B7785); }

    .group-info { display: flex; flex-direction: column; gap: 2px; font-size: 11.5px; }
    .group-info__title { font-size: 13px; font-weight: 850; color: var(--tm-text, #0F1419); }
    .group-info__parties { display: flex; gap: 8px; color: var(--tm-text-muted, #6B7785); }
    .group-info__split { display: flex; gap: 6px; color: var(--tm-text-soft, #94A0AD); font-weight: 600; }

    .proof-tag {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: var(--tm-radius-pill, 999px);
      font-size: 11px;
      font-weight: 800;
      white-space: nowrap;
    }
    .proof-tag__dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
    .proof-tag--balanced { background: var(--tm-green-tint, #ECFDF3); color: var(--tm-green-deep, #16A34A); }
    .proof-tag--imbalance { background: var(--tm-danger-bg, #FEE2E2); color: var(--tm-danger-fg, #B91C1C); }

    .mono-code {
      font-family: var(--tm-font-mono);
      font-size: 11.5px;
      font-weight: 600;
      color: var(--tm-text, #0F1419);
      max-width: 170px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .amount-val {
      font-variant-numeric: tabular-nums;
      font-weight: 800;
      font-size: 13.5px;
    }
    .amount-val--in { color: var(--tm-green-deep, #16A34A); }
    .amount-val--out { color: var(--tm-text, #0F1419); }
    .amount-val--group { color: var(--tm-text, #0F1419); font-size: 14px; }

    /* Driver Table Specific Styles */
    .wallet-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 9px;
      border-radius: var(--tm-radius-pill, 999px);
      font-size: 12.5px;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
    }
    .wallet-badge__dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
    .wallet-badge--positive { background: var(--tm-green-tint, #ECFDF3); color: var(--tm-green-deep, #16A34A); }
    .wallet-badge--negative { background: var(--tm-danger-bg, #FEE2E2); color: var(--tm-danger-fg, #B91C1C); }
    .debt-warning-tag {
      font-size: 10px;
      font-weight: 800;
      color: var(--tm-danger-fg, #B91C1C);
      margin-top: 2px;
    }

    .status-chip {
      display: inline-flex;
      width: fit-content;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 10.5px;
      font-weight: 700;
    }
    .status-chip--allowed { background: var(--tm-green-tint, #ECFDF3); color: var(--tm-green-deep, #16A34A); }
    .status-chip--blocked { background: var(--tm-danger-bg, #FEE2E2); color: var(--tm-danger-fg, #B91C1C); }

    .payout-due-highlight {
      font-variant-numeric: tabular-nums;
      font-weight: 850;
      font-size: 14px;
      color: var(--tm-green-deep, #16A34A);
    }

    .split-pill-group { display: flex; flex-direction: column; gap: 2px; font-size: 11px; }
    .split-pill { font-weight: 600; }
    .split-pill--cash { color: var(--tm-warning-fg, #92400E); }
    .split-pill--online { color: var(--tm-text-muted, #6B7785); }

    .rate-tag {
      display: inline-flex;
      padding: 2px 7px;
      border-radius: 4px;
      background: var(--tm-canvas-2, #EAEEF4);
      color: var(--tm-text, #0F1419);
      font-size: 11.5px;
      font-weight: 800;
    }
    .rate-tag--fixed { background: #FEF3C7; color: #92400E; }
    .fee-highlight { font-variant-numeric: tabular-nums; font-weight: 800; color: var(--tm-warning-fg, #92400E); }
    .driver-share-highlight { font-variant-numeric: tabular-nums; font-weight: 800; color: var(--tm-green-deep, #16A34A); }

    .service-pill {
      display: inline-flex;
      padding: 2px 7px;
      border-radius: 4px;
      background: var(--tm-canvas, #F4F6FA);
      color: var(--tm-text-muted, #6B7785);
      font-size: 11px;
      font-weight: 700;
    }
    .route-sub { display: block; font-size: 10.5px; color: var(--tm-text-soft, #94A0AD); margin-top: 1px; }

    .transfer-amt-badge {
      font-variant-numeric: tabular-nums;
      font-weight: 850;
      font-size: 14px;
      color: var(--tm-green-deep, #16A34A);
    }
    .method-tag {
      display: inline-flex;
      padding: 2px 7px;
      border-radius: 4px;
      background: var(--tm-canvas-2, #EAEEF4);
      color: var(--tm-text, #0F1419);
      font-size: 11px;
      font-weight: 700;
    }
    .recorder-chip { font-size: 12px; color: var(--tm-text-muted, #6B7785); font-weight: 600; }

    .empty-state-cell {
      text-align: center;
      padding: 48px 18px !important;
    }
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: var(--tm-text-soft, #94A0AD);
    }
    .empty-state p { margin: 0; font-size: 13px; font-weight: 600; color: var(--tm-text-muted, #6B7785); }

    .alert-box {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      border-radius: var(--tm-radius-md, 14px);
      font-size: 13px;
      font-weight: 600;
    }
    .alert-box--error {
      background: var(--tm-danger-bg, #FEE2E2);
      color: var(--tm-danger-fg, #B91C1C);
      border: 1px solid rgba(239, 68, 68, 0.2);
    }
    .alert-box__retry {
      margin-left: auto;
      border: 0;
      background: transparent;
      text-decoration: underline;
      color: inherit;
      font-weight: 800;
      cursor: pointer;
    }

    /* ==========================================================================
       4. BANK-GRADE RECORD PAYOUT MODAL
       ========================================================================== */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 20, 25, 0.5);
      backdrop-filter: blur(3px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      padding: 16px;
    }

    .modal-card {
      background: var(--tm-surface, #FFFFFF);
      border: 1px solid var(--tm-line, #ECEFF3);
      border-radius: var(--tm-radius-xl, 28px);
      width: 500px;
      max-width: 100%;
      overflow: hidden;
      box-shadow: var(--tm-shadow-pop, 0 12px 40px -16px rgba(15,20,25,0.25));
      animation: modalSlideUp 0.2s ease-out;
    }

    @keyframes modalSlideUp {
      from { transform: translateY(12px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    .modal-card__header {
      padding: 18px 22px;
      border-bottom: 1px solid var(--tm-line, #ECEFF3);
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }

    .modal-card__title-group h3 {
      margin: 0;
      font-size: 17px;
      font-weight: 850;
      color: var(--tm-text, #0F1419);
      letter-spacing: -0.02em;
    }

    .modal-card__title-group p {
      margin: 3px 0 0;
      font-size: 12px;
      color: var(--tm-text-muted, #6B7785);
    }

    .modal-card__close {
      border: 0;
      background: transparent;
      padding: 4px;
      color: var(--tm-text-muted, #6B7785);
      cursor: pointer;
      display: inline-flex;
      border-radius: 6px;
      transition: background 0.15s ease;
    }
    .modal-card__close:hover { background: var(--tm-canvas-2, #EAEEF4); color: var(--tm-text, #0F1419); }

    .modal-card__body {
      padding: 20px 22px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      max-height: 75vh;
      overflow-y: auto;
    }

    .payout-driver-card {
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: var(--tm-canvas, #F4F6FA);
      border: 1px solid var(--tm-line-2, #E2E6EC);
      border-radius: var(--tm-radius-md, 14px);
      padding: 14px;
    }

    .payout-driver-card__top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--tm-line-2, #E2E6EC);
      padding-bottom: 10px;
    }

    .payout-driver-card__due {
      text-align: right;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .payout-due-lbl { font-size: 10.5px; font-weight: 800; text-transform: uppercase; color: var(--tm-green-deep, #16A34A); }
    .payout-due-val { font-size: 18px; font-weight: 850; color: var(--tm-green-deep, #16A34A); font-variant-numeric: tabular-nums; }

    .banking-specs {
      background: var(--tm-surface, #FFFFFF);
      border: 1px solid var(--tm-line, #ECEFF3);
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 12px;
    }

    .spec-line {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .spec-line:last-child { margin-bottom: 0; }
    .spec-lbl { color: var(--tm-text-muted, #6B7785); font-weight: 600; }
    .spec-val { color: var(--tm-text, #0F1419); }

    .no-bank-hint {
      color: var(--tm-text-muted, #6B7785);
      line-height: 1.4;
    }

    .form-row {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .form-label-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .form-label {
      font-size: 11.5px;
      font-weight: 750;
      color: var(--tm-text, #0F1419);
    }

    .quick-fill-btn {
      border: 0;
      background: transparent;
      font-size: 11px;
      font-weight: 800;
      color: var(--tm-green-deep, #16A34A);
      cursor: pointer;
      text-decoration: underline;
    }

    .form-input {
      width: 100%;
      height: 36px;
      padding: 0 12px;
      background: var(--tm-surface, #FFFFFF);
      border: 1px solid var(--tm-line, #ECEFF3);
      border-radius: var(--tm-radius-sm, 10px);
      font: inherit;
      font-size: 13px;
      color: var(--tm-text, #0F1419);
      outline: none;
      transition: border-color 0.15s ease;
      box-sizing: border-box;
    }

    .form-input:focus { border-color: var(--tm-ink, #0F1419); }
    .form-select { cursor: pointer; }

    .modal-alert-error {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      background: var(--tm-danger-bg, #FEE2E2);
      color: var(--tm-danger-fg, #B91C1C);
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
    }

    .modal-card__footer {
      padding: 14px 22px;
      border-top: 1px solid var(--tm-line, #ECEFF3);
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      background: var(--tm-canvas, #F4F6FA);
    }
  `],
})
export class FinanceLedgerComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('rangeInput') rangeInput?: ElementRef<HTMLInputElement>;

  private readonly api = inject(ApiService);
  private readonly zone = inject(NgZone);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  // Active View Mode inside the unified Money Ledger
  viewMode: LedgerViewMode = 'movements';

  // Master Data Stores
  movements: LedgerRow[] = [];
  reconciliation: Record<string, TripBalance> = {};
  ledgerSummary: LedgerResponse['summary'] = {
    captured: 0, to_driver: 0, held: 0, to_operator: 0, gateway_fee: 0, refunded: 0, trips: 0, unbalanced: 0,
  };

  driversList: DriverWalletRecord[] = [];
  commissionsList: CommissionRecord[] = [];
  transfersList: TransferRecord[] = [];

  // Summary Metrics
  totalWalletBalance = 0;
  totalDriversCount = 0;
  inDebtCount = 0;
  blockedCount = 0;
  totalPendingTransfers = 0;
  pendingDriversCount = 0;
  totalDriverGross = 0;
  totalDriverCash = 0;
  totalDriverOnline = 0;
  totalPlatformCommissions = 0;

  // General State
  loading = false;
  searchLoading = false;
  cardsUpdating = false;
  error = '';

  // Filter States
  searchFilter = '';
  typeFilter = 'all';
  partyFilter = 'all';
  driverStatusFilter: 'all' | 'pending' | 'debt' | 'blocked' = 'all';
  groupBy: 'trip' | 'driver' | 'customer' | 'none' = 'trip';
  unbalancedOnly = false;
  expanded: Record<string, boolean> = {};

  dateFrom = '';
  dateTo = '';
  activePreset: 'today' | 'yesterday' | '7days' | 'thisMonth' | null = null;

  // Pagination for movements
  page = 1;
  pageSize = 25;

  // Modals State
  showPayoutModal = false;
  selectedDriverForPayout: DriverWalletRecord | null = null;
  payoutDriverId: number | null = null;
  payoutForm = { method: 'gpay', amount: null as number | null, reference: '', note: '' };
  submittingPayout = false;
  payoutError: string | null = null;

  private subs: Subscription[] = [];
  private searchTimer: any = null;

  readonly movementTypes = [
    { key: 'capture', label: 'Passenger Payments' },
    { key: 'transfer', label: 'Driver Payouts' },
    { key: 'topup', label: 'Wallet Recharges' },
    { key: 'subscription', label: 'Subscriptions' },
    { key: 'retained', label: 'Commissions' },
    { key: 'gateway_fee', label: 'Gateway Fees' },
    { key: 'held', label: 'On Hold' },
    { key: 'refund', label: 'Refunds' },
    { key: 'reversal', label: 'Reversals' },
  ];

  ngOnInit(): void {
    this.subs.push(
      this.route.queryParamMap.subscribe((qp) => {
        const view = qp.get('view') || qp.get('tab');
        if (view === 'drivers' || view === 'wallets' || view === 'driver-earnings' || view === 'pending-transfers') {
          this.viewMode = 'drivers';
          if (view === 'pending-transfers') this.driverStatusFilter = 'pending';
          if (view === 'wallets') this.driverStatusFilter = 'debt';
        } else if (view === 'commissions') {
          this.viewMode = 'commissions';
        } else if (view === 'transfers' || view === 'completed-transfers') {
          this.viewMode = 'transfers';
        } else {
          this.viewMode = 'movements';
        }
      })
    );

    this.loadAll();
  }

  ngAfterViewInit(): void {
    this.initDatePicker();
  }

  ngOnDestroy(): void {
    this.destroyDatePicker();
    this.subs.forEach((s) => s.unsubscribe());
  }

  get rangeLabel(): string {
    if (this.dateFrom && this.dateTo && this.dateFrom !== 'Invalid date' && this.dateTo !== 'Invalid date') {
      return `${this.dateFrom} → ${this.dateTo}`;
    }
    return '';
  }

  get searchPlaceholder(): string {
    switch (this.viewMode) {
      case 'drivers': return 'Search driver, phone, vehicle...';
      case 'commissions': return 'Search trip ID, driver, vehicle...';
      case 'transfers': return 'Search driver, UTR, reference...';
      default: return 'Search Tx ID, Trip ID, Phone, Ref...';
    }
  }

  setViewMode(mode: LedgerViewMode): void {
    this.viewMode = mode;
    this.searchFilter = '';
    this.page = 1;
  }

  selectKpiMovements(type: string): void {
    this.viewMode = 'movements';
    this.typeFilter = type;
    this.page = 1;
  }

  selectKpiDrivers(status: 'all' | 'pending' | 'debt' | 'blocked'): void {
    this.viewMode = 'drivers';
    this.driverStatusFilter = status;
    this.page = 1;
  }

  loadAll(): void {
    this.loading = true;
    this.error = '';

    const params: string[] = [];
    if (this.unbalancedOnly) params.push('unbalanced=1');
    if (this.dateFrom && this.dateFrom !== 'Invalid date') params.push(`from=${encodeURIComponent(this.dateFrom)}`);
    if (this.dateTo && this.dateTo !== 'Invalid date') params.push(`to=${encodeURIComponent(this.dateTo)}`);
    if (this.searchFilter.trim()) params.push(`search=${encodeURIComponent(this.searchFilter.trim())}`);
    const qs = params.length ? `?${params.join('&')}` : '';

    const commParams = new URLSearchParams();
    if (this.dateFrom && this.dateFrom !== 'Invalid date') commParams.set('from', this.dateFrom);
    if (this.dateTo && this.dateTo !== 'Invalid date') commParams.set('to', this.dateTo);
    const commQs = commParams.toString() ? `?${commParams.toString()}` : '';

    forkJoin({
      ledger: this.api.get<LedgerResponse>(`/admin/ledger${qs}`).pipe(catchError(() => of(null))),
      wallets: this.api.get<any>('/admin/finance/wallets').pipe(catchError(() => of(null))),
      pending: this.api.get<any>('/admin/finance/transfers/pending').pipe(catchError(() => of(null))),
      completed: this.api.get<any>('/admin/finance/transfers/completed').pipe(catchError(() => of(null))),
      commissions: this.api.get<any>(`/admin/finance/commissions${commQs}`).pipe(catchError(() => of(null))),
      earnings: this.api.get<any>(`/admin/finance/driver-earnings${commQs}`).pipe(catchError(() => of(null))),
    }).subscribe({
      next: (res) => {
        this.loading = false;

        // 1. Process Ledger
        if (res.ledger) {
          this.movements = res.ledger.rows ?? [];
          this.reconciliation = res.ledger.reconciliation ?? {};
          if (res.ledger.summary) this.ledgerSummary = res.ledger.summary;
        }

        // 2. Process Wallets + Merge Pending + Earnings
        const walletRows: DriverWalletRecord[] = res.wallets?.data || [];
        const pendingRows = res.pending?.data || [];
        const earningsRows = res.earnings?.data || [];

        this.totalWalletBalance = res.wallets?.total_balance || 0;
        this.totalDriversCount = res.wallets?.total_drivers || walletRows.length;
        this.inDebtCount = res.wallets?.in_debt_count || walletRows.filter(r => r.is_in_debt).length;
        this.blockedCount = walletRows.filter(r => !r.can_accept_rides).length;
        this.totalPendingTransfers = res.pending?.total_pending || 0;
        this.pendingDriversCount = res.pending?.drivers_count || pendingRows.length;
        this.totalDriverGross = res.earnings?.total_gross || 0;
        this.totalDriverCash = res.earnings?.total_cash || 0;
        this.totalDriverOnline = res.earnings?.total_online || 0;

        // Merge by driver_id
        const driverMap = new Map<number, DriverWalletRecord>();
        for (const w of walletRows) {
          driverMap.set(w.driver_id, { ...w, pending_payout: 0, rides_count: 0, gross_earnings: 0, cash_collected: 0, online_collected: 0 });
        }
        for (const p of pendingRows) {
          if (driverMap.has(p.driver_id)) {
            const d = driverMap.get(p.driver_id)!;
            d.pending_payout = p.pending_payout;
          } else {
            driverMap.set(p.driver_id, {
              driver_id: p.driver_id,
              user_id: p.user_id,
              name: p.name,
              phone: p.phone,
              vehicle_reg_no: p.vehicle_reg_no,
              balance: 0,
              minimum_wallet_limit: 0,
              is_in_debt: false,
              can_accept_rides: true,
              pending_payout: p.pending_payout,
            });
          }
        }
        for (const e of earningsRows) {
          if (driverMap.has(e.driver_id)) {
            const d = driverMap.get(e.driver_id)!;
            d.rides_count = e.rides_count;
            d.gross_earnings = e.gross_earnings;
            d.cash_collected = e.cash_collected;
            d.online_collected = e.online_collected;
          }
        }
        this.driversList = Array.from(driverMap.values());

        // 3. Process Commissions & Completed Transfers
        this.commissionsList = res.commissions?.data || [];
        this.totalPlatformCommissions = res.commissions?.total_commission ?? this.commissionsList.reduce((sum, c) => sum + (c.commission_amount || 0), 0);
        this.transfersList = res.completed?.data || [];
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.message || 'Failed to load financial records.';
      }
    });
  }

  // --- Filtered Data Getters ---

  get filteredRows(): LedgerRow[] {
    return this.movements.filter((r) => {
      if (this.typeFilter !== 'all' && r.type !== this.typeFilter) return false;
      if (this.partyFilter !== 'all' && r.party !== this.partyFilter) return false;
      if (this.dateFrom && this.dateFrom !== 'Invalid date') {
        const rowDate = r.created_at ? r.created_at.substring(0, 10) : '';
        if (!rowDate || rowDate < this.dateFrom) return false;
      }
      if (this.dateTo && this.dateTo !== 'Invalid date') {
        const rowDate = r.created_at ? r.created_at.substring(0, 10) : '';
        if (!rowDate || rowDate > this.dateTo) return false;
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

  get filteredDrivers(): DriverWalletRecord[] {
    let list = [...this.driversList];
    if (this.driverStatusFilter === 'pending') {
      list = list.filter(d => (d.pending_payout || 0) > 0);
    } else if (this.driverStatusFilter === 'debt') {
      list = list.filter(d => d.is_in_debt || d.balance < 0);
    } else if (this.driverStatusFilter === 'blocked') {
      list = list.filter(d => !d.can_accept_rides);
    }

    if (this.searchFilter.trim()) {
      const q = this.searchFilter.toLowerCase().trim();
      list = list.filter(d =>
        d.name?.toLowerCase().includes(q) ||
        d.phone?.toLowerCase().includes(q) ||
        d.vehicle_reg_no?.toLowerCase().includes(q)
      );
    }
    return list;
  }

  get filteredCommissions(): CommissionRecord[] {
    let list = [...this.commissionsList];
    if (this.searchFilter.trim()) {
      const q = this.searchFilter.toLowerCase().trim();
      list = list.filter(c =>
        c.trip_id.toString().includes(q) ||
        c.driver_name?.toLowerCase().includes(q) ||
        c.driver_phone?.toLowerCase().includes(q) ||
        c.vehicle_type?.toLowerCase().includes(q)
      );
    }
    return list;
  }

  get filteredTransfers(): TransferRecord[] {
    let list = [...this.transfersList];
    if (this.searchFilter.trim()) {
      const q = this.searchFilter.toLowerCase().trim();
      list = list.filter(t =>
        t.driver_name?.toLowerCase().includes(q) ||
        t.driver_phone?.toLowerCase().includes(q) ||
        t.reference?.toLowerCase().includes(q) ||
        t.notes?.toLowerCase().includes(q)
      );
    }
    return list;
  }

  get displayRows(): DisplayRow[] {
    const rows = this.filteredRows;
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

  get pagedMovements(): DisplayRow[] {
    const start = (this.page - 1) * this.pageSize;
    return this.displayRows.slice(start, start + this.pageSize);
  }

  get activeSummary() {
    const list = this.filteredRows;

    let captured = 0;
    let to_driver = 0;
    let held = 0;
    let to_operator = 0;
    let gateway_fee = 0;
    let refunded = 0;

    for (const r of list) {
      const amt = Number(r.amount || 0);
      switch (r.type) {
        case 'capture': captured += amt; break;
        case 'transfer':
        case 'release': to_driver += amt; break;
        case 'held': held += amt; break;
        case 'retained': to_operator += amt; break;
        case 'gateway_fee': gateway_fee += amt; break;
        case 'refund':
        case 'reversal': refunded += amt; break;
      }
    }

    const tripIds = new Set(list.map((r) => r.trip_id).filter((id): id is number => id != null));
    let unbalancedCount = 0;
    for (const tid of tripIds) {
      const b = this.reconciliation[String(tid)];
      if (b && !b.balanced) unbalancedCount++;
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

  // --- Filtering & Date Picking Logic ---

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
      case 'capture': return 'Passenger Payment';
      case 'transfer': return 'Driver Share';
      case 'topup': return 'Wallet Recharge';
      case 'subscription': return 'Subscription';
      case 'cash_retained': return 'Cash Retained';
      case 'retained': return 'Platform Fee';
      case 'gateway_fee': return 'Gateway Fee';
      case 'held': return 'Held In Escrow';
      case 'release': return 'Hold Released';
      case 'refund': return 'Refund';
      case 'reversal': return 'Reversal';
      default: return type;
    }
  }

  formatMethod(m: string): string {
    const map: Record<string, string> = {
      gpay: 'GPay / UPI',
      bank: 'Bank Transfer',
      cash: 'Cash Handover',
      upi: 'UPI',
      other: 'Other Settlement',
    };
    return map[m?.toLowerCase()] || m;
  }

  formatTripMode(c: CommissionRecord): string {
    const mode = c.mode || (c.is_shared ? 'fixed' : 'private');
    const modeLabel = mode === 'fixed' ? 'Fixed Route' : (mode === 'shuttle' ? 'Shuttle' : 'Private Cab');
    const method = c.payment_method || 'Cash';
    return `${modeLabel} · ${method}`;
  }

  toggleUnbalancedFilter(): void {
    this.unbalancedOnly = !this.unbalancedOnly;
    this.loadAll();
  }

  focusTrip(tripId: number): void {
    this.searchFilter = String(tripId);
  }

  onSearchChange(): void {
    this.searchLoading = true;
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
    this.loadAll();
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
    this.loadAll();
  }

  clearDateRange(): void {
    this.activePreset = null;
    this.dateFrom = '';
    this.dateTo = '';
    if (this.rangeInput?.nativeElement) {
      $(this.rangeInput.nativeElement).val('');
    }
    this.page = 1;
    this.loadAll();
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
        startDate: (this.dateFrom && this.dateFrom !== 'Invalid date') ? moment(this.dateFrom) : moment().startOf('month'),
        endDate: (this.dateTo && this.dateTo !== 'Invalid date') ? moment(this.dateTo) : moment(),
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
          this.activePreset = null;
          this.page = 1;
          this.loadAll();
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

  exportCsv(): void {
    if (this.viewMode === 'drivers') {
      const rows = this.filteredDrivers;
      const headers = ['Driver Name', 'Phone', 'Vehicle Reg', 'Wallet Balance', 'Min Limit', 'Pending Payout', 'Rides Count', 'Gross Earnings', 'Cash Collected', 'Online Collected'];
      const csv = [headers.join(',')];
      for (const r of rows) {
        csv.push([
          `"${(r.name || '').replace(/"/g, '""')}"`,
          `"${r.phone || ''}"`,
          `"${r.vehicle_reg_no || ''}"`,
          r.balance || 0,
          r.minimum_wallet_limit || 0,
          r.pending_payout || 0,
          r.rides_count || 0,
          r.gross_earnings || 0,
          r.cash_collected || 0,
          r.online_collected || 0,
        ].join(','));
      }
      this.downloadCsv(csv.join('\n'), 'driver-wallets-earnings');
    } else if (this.viewMode === 'commissions') {
      const rows = this.filteredCommissions;
      const headers = ['Trip ID', 'Date', 'Driver Name', 'Driver Phone', 'Vehicle', 'Gross Fare', 'Commission %', 'Commission Amount', 'Driver Share', 'Mode'];
      const csv = [headers.join(',')];
      for (const r of rows) {
        csv.push([
          r.trip_id,
          `"${r.date || ''}"`,
          `"${(r.driver_name || '').replace(/"/g, '""')}"`,
          `"${r.driver_phone || ''}"`,
          `"${r.vehicle_type || ''}"`,
          r.fare || 0,
          r.commission_percent || 0,
          r.commission_amount || 0,
          r.net_driver_earnings || 0,
          `"${r.payment_method || ''}"`,
        ].join(','));
      }
      this.downloadCsv(csv.join('\n'), 'ride-commissions');
    } else if (this.viewMode === 'transfers') {
      const rows = this.filteredTransfers;
      const headers = ['Date', 'Driver Name', 'Driver Phone', 'Amount (INR)', 'Method', 'Reference / UTR', 'Notes', 'Recorded By'];
      const csv = [headers.join(',')];
      for (const r of rows) {
        csv.push([
          `"${r.created_at || ''}"`,
          `"${(r.driver_name || '').replace(/"/g, '""')}"`,
          `"${r.driver_phone || ''}"`,
          r.amount || 0,
          `"${r.method || ''}"`,
          `"${(r.reference || '').replace(/"/g, '""')}"`,
          `"${(r.notes || '').replace(/"/g, '""')}"`,
          `"${(r.recorded_by || '').replace(/"/g, '""')}"`,
        ].join(','));
      }
      this.downloadCsv(csv.join('\n'), 'completed-driver-transfers');
    } else {
      const rows = this.filteredRows;
      const headers = ['Tx ID', 'Trip ID', 'Payment ID', 'Type', 'Party', 'Direction', 'Amount (INR)', 'Ref', 'Customer Name', 'Customer Phone', 'Driver Name', 'Driver Phone', 'Date'];
      const csv = [headers.join(',')];
      for (const r of rows) {
        csv.push([
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
        ].join(','));
      }
      this.downloadCsv(csv.join('\n'), 'money-ledger-movements');
    }
  }

  private downloadCsv(content: string, filename: string): void {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}-${new Date().toISOString().substring(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // --- Modal Operations ---

  openPayoutModal(driver?: DriverWalletRecord): void {
    this.selectedDriverForPayout = driver || null;
    this.payoutDriverId = driver ? driver.driver_id : null;
    this.payoutForm = {
      method: 'gpay',
      amount: driver && driver.pending_payout && driver.pending_payout > 0 ? driver.pending_payout : null,
      reference: '',
      note: 'Driver payout settlement',
    };
    this.payoutError = null;
    this.showPayoutModal = true;
  }

  onPayoutDriverSelected(): void {
    if (this.payoutDriverId) {
      this.selectedDriverForPayout = this.driversList.find(d => d.driver_id === this.payoutDriverId) || null;
      if (this.selectedDriverForPayout && this.selectedDriverForPayout.pending_payout && this.selectedDriverForPayout.pending_payout > 0) {
        this.payoutForm.amount = this.selectedDriverForPayout.pending_payout;
      }
    } else {
      this.selectedDriverForPayout = null;
    }
  }

  fillPendingAmount(): void {
    if (this.selectedDriverForPayout && this.selectedDriverForPayout.pending_payout && this.selectedDriverForPayout.pending_payout > 0) {
      this.payoutForm.amount = this.selectedDriverForPayout.pending_payout;
    }
  }

  submitPayout(): void {
    if (!this.selectedDriverForPayout || !this.payoutForm.amount) return;
    this.submittingPayout = true;
    this.payoutError = null;

    this.api.post(`/admin/drivers/${this.selectedDriverForPayout.driver_id}/wallet/payout`, {
      amount: this.payoutForm.amount,
      method: this.payoutForm.method,
      reference: this.payoutForm.reference,
      note: this.payoutForm.note,
    }).subscribe({
      next: () => {
        this.submittingPayout = false;
        this.closeModals();
        this.loadAll();
      },
      error: (err) => {
        this.submittingPayout = false;
        this.payoutError = err?.error?.message || 'Failed to record transfer.';
      }
    });
  }

  closeModals(): void {
    this.showPayoutModal = false;
    this.selectedDriverForPayout = null;
  }
}
