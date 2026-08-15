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

/** One immutable money movement row from the double-entry ledger. */
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

/** Per-trip proof that nothing was invented or lost. */
export interface TripBalance {
  captured: number;
  driver_net: number;
  operator_net: number;
  gateway_fee: number;
  refunded: number;
  balanced: boolean;
  imbalance_paise: number;
}

/** Display row for grouped rendering. */
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

/** Driver wallet summary record. */
export interface DriverWalletRecord {
  driver_id: number;
  user_id: number;
  name: string;
  phone: string;
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
}

/** Driver transfer payout record. */
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

/** Ride commission record. */
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
    <div class="page">
      <!-- Top Hero Header with Quick Financial Actions -->
      <header class="page__hero">
        <div>
          <h1 class="page__title">Money Ledger</h1>
          <p class="page__sub">
            All-in-one financial headquarters — transactions audit, driver wallet balances, pending &amp; completed transfers, ride commissions, and driver earnings.
          </p>
        </div>
        <div class="hero__side">
          <tm-button variant="green" size="sm" icon="arrow-right" (clicked)="openPayoutModal()">
            Record Payout
          </tm-button>
          <tm-button variant="outline" size="sm" icon="refresh" [loading]="loading" (clicked)="loadAll()">
            Refresh
          </tm-button>
        </div>
      </header>

      <!-- Reconciliation Status Banner -->
      <div class="verdict" [class.verdict--bad]="activeSummary.unbalanced > 0" *ngIf="!loading && !error">
        <span class="verdict__icon">
          <tm-icon [name]="activeSummary.unbalanced > 0 ? 'bell' : 'check'" [size]="18" />
        </span>
        <div class="verdict__body">
          <strong *ngIf="activeSummary.unbalanced === 0">
            All {{ activeSummary.trips }} trips in this period are fully balanced.
          </strong>
          <strong *ngIf="activeSummary.unbalanced > 0">
            {{ activeSummary.unbalanced }} of {{ activeSummary.trips }} trips need review.
          </strong>
          <span>
            {{ activeSummary.unbalanced > 0
              ? 'Discrepancy detected between payments, driver share, and platform fees. Review flagged trips.'
              : 'Total customer payments match driver payouts, pending holds, and platform fees.' }}
          </span>
        </div>
        <tm-button
          *ngIf="activeSummary.unbalanced > 0 && !unbalancedOnly"
          variant="outline" size="sm"
          (clicked)="setUnbalanced(true)"
        >Show Flagged Trips</tm-button>
      </div>

      <!-- Master Financial KPI Stat Cards Grid -->
      <div class="cards" *ngIf="!loading && !error">
        <div class="card" (click)="setViewMode('movements')">
          <span class="card__label">Payments Received</span>
          <span class="card__value" [class.card__value--pulse]="cardsUpdating">
            ₹ {{ activeSummary.captured | number:'1.2-2' }}
          </span>
          <span class="card__meta">from passenger fares</span>
        </div>

        <div class="card card--driver" (click)="setViewMode('movements')">
          <span class="card__label">Driver Payouts Settled</span>
          <span class="card__value" [class.card__value--pulse]="cardsUpdating">
            ₹ {{ activeSummary.to_driver | number:'1.2-2' }}
          </span>
          <span class="card__meta">transferred to drivers</span>
        </div>

        <div class="card card--pending" (click)="setViewMode('drivers')">
          <span class="card__label">Pending Transfers Due</span>
          <span class="card__value card__value--emerald">
            ₹ {{ totalPendingTransfers | number:'1.2-2' }}
          </span>
          <span class="card__meta">{{ pendingDriversCount }} driver(s) awaiting payout</span>
        </div>

        <div class="card card--operator" (click)="setViewMode('commissions')">
          <span class="card__label">Platform Commissions</span>
          <span class="card__value" [class.card__value--pulse]="cardsUpdating">
            ₹ {{ totalPlatformCommissions | number:'1.2-2' }}
          </span>
          <span class="card__meta">
            {{ totalDriverGross > 0 ? ((totalPlatformCommissions / totalDriverGross) * 100 | number:'1.1-1') : (activeSummary.captured > 0 ? ((totalPlatformCommissions / activeSummary.captured) * 100 | number:'1.1-1') : 0) }}% take-rate
          </span>
        </div>

        <div class="card card--earnings" (click)="setViewMode('drivers')">
          <span class="card__label">Driver Gross Earnings</span>
          <span class="card__value">
            ₹ {{ totalDriverGross | number:'1.2-2' }}
          </span>
          <span class="card__meta">₹ {{ totalDriverCash | number:'1.2-2' }} cash / ₹ {{ totalDriverOnline | number:'1.2-2' }} online</span>
        </div>

        <div class="card card--wallet" (click)="setViewMode('drivers')">
          <span class="card__label">Driver Float &amp; Wallets</span>
          <span class="card__value" [class.card__value--rose]="totalWalletBalance < 0">
            ₹ {{ totalWalletBalance | number:'1.2-2' }}
          </span>
          <span class="card__meta">
            {{ inDebtCount > 0 ? inDebtCount + ' in debt / ' : '' }}{{ totalDriversCount }} registered
          </span>
        </div>

        <div class="card card--held" *ngIf="activeSummary.held > 0">
          <span class="card__label">On Hold</span>
          <span class="card__value">₹ {{ activeSummary.held | number:'1.2-2' }}</span>
          <span class="card__meta">pending release</span>
        </div>

        <div class="card card--refund" *ngIf="activeSummary.refunded > 0 || activeSummary.gateway_fee > 0">
          <span class="card__label">Refunds &amp; Gateway Fees</span>
          <span class="card__value">
            ₹ {{ (activeSummary.refunded + activeSummary.gateway_fee) | number:'1.2-2' }}
          </span>
          <span class="card__meta">₹ {{ activeSummary.refunded | number:'1.2-2' }} ref / ₹ {{ activeSummary.gateway_fee | number:'1.2-2' }} fee</span>
        </div>
      </div>

      <!-- View Mode Selector & Unified Filter Toolbar -->
      <div class="toolbar">
        <div class="view-modes">
          <button
            type="button"
            class="view-mode-btn"
            [class.is-active]="viewMode === 'movements'"
            (click)="setViewMode('movements')"
          >
            <tm-icon name="chart-line" [size]="15" />
            <span>All Movements &amp; Balancing ({{ filteredRows.length }})</span>
          </button>
          <button
            type="button"
            class="view-mode-btn"
            [class.is-active]="viewMode === 'drivers'"
            (click)="setViewMode('drivers')"
          >
            <tm-icon name="user" [size]="15" />
            <span>Driver Financials &amp; Wallets ({{ filteredDrivers.length }})</span>
          </button>
          <button
            type="button"
            class="view-mode-btn"
            [class.is-active]="viewMode === 'commissions'"
            (click)="setViewMode('commissions')"
          >
            <tm-icon name="tag" [size]="15" />
            <span>Ride Commissions ({{ filteredCommissions.length }})</span>
          </button>
          <button
            type="button"
            class="view-mode-btn"
            [class.is-active]="viewMode === 'transfers'"
            (click)="setViewMode('transfers')"
          >
            <tm-icon name="check" [size]="15" />
            <span>Completed Transfers ({{ filteredTransfers.length }})</span>
          </button>
        </div>

        <!-- Mode-Specific Filters Row -->
        <div class="filters-row">
          <!-- Movements Mode Filters -->
          <ng-container *ngIf="viewMode === 'movements'">
            <div class="tabs-group">
              <div class="tabs">
                <span class="tabs-label">Group:</span>
                <button type="button" class="tab" [class.tab--on]="groupBy === 'trip'" (click)="setGroupBy('trip')">Trip</button>
                <button type="button" class="tab" [class.tab--on]="groupBy === 'driver'" (click)="setGroupBy('driver')">Driver</button>
                <button type="button" class="tab" [class.tab--on]="groupBy === 'customer'" (click)="setGroupBy('customer')">Customer</button>
                <button type="button" class="tab" [class.tab--on]="groupBy === 'none'" (click)="setGroupBy('none')">None</button>
              </div>

              <div class="tabs">
                <span class="tabs-label">Type:</span>
                <button type="button" class="tab" [class.tab--on]="typeFilter === 'all'" (click)="setTypeFilter('all')">All</button>
                <button type="button" class="tab" *ngFor="let t of movementTypes"
                  [class.tab--on]="typeFilter === t.key" (click)="setTypeFilter(t.key)">{{ t.label }}</button>
              </div>
            </div>
          </ng-container>

          <!-- Driver Mode Filters -->
          <ng-container *ngIf="viewMode === 'drivers'">
            <div class="pills">
              <button type="button" class="pill" [class.pill--on]="driverStatusFilter === 'all'" (click)="driverStatusFilter = 'all'">
                All Drivers ({{ driversList.length }})
              </button>
              <button type="button" class="pill" [class.pill--on]="driverStatusFilter === 'pending'" (click)="driverStatusFilter = 'pending'">
                Pending Payout ({{ pendingDriversCount }})
              </button>
              <button type="button" class="pill" [class.pill--on]="driverStatusFilter === 'debt'" (click)="driverStatusFilter = 'debt'">
                In Debt ({{ inDebtCount }})
              </button>
              <button type="button" class="pill" [class.pill--on]="driverStatusFilter === 'blocked'" (click)="driverStatusFilter = 'blocked'">
                Blocked ({{ blockedCount }})
              </button>
            </div>
          </ng-container>

          <!-- Common Date & Search Controls -->
          <div class="toolbar__right">
            <div class="date-pills" [style.display]="viewMode === 'drivers' ? 'none' : 'inline-flex'">
              <button type="button" class="date-pill" [class.date-pill--on]="activePreset === 'today'" (click)="setPresetDate('today')">Today</button>
              <button type="button" class="date-pill" [class.date-pill--on]="activePreset === 'yesterday'" (click)="setPresetDate('yesterday')">Yesterday</button>
              <button type="button" class="date-pill" [class.date-pill--on]="activePreset === '7days'" (click)="setPresetDate('7days')">7 Days</button>
              <button type="button" class="date-pill" [class.date-pill--on]="activePreset === 'thisMonth'" (click)="setPresetDate('thisMonth')">This Month</button>
            </div>

            <div class="date-range" [class.has-value]="dateFrom || dateTo" [style.display]="viewMode === 'drivers' ? 'none' : 'inline-flex'">
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

            <label class="check" *ngIf="viewMode === 'movements'">
              <input type="checkbox" [ngModel]="unbalancedOnly" (ngModelChange)="setUnbalanced($event)" />
              <span>Unbalanced only</span>
            </label>

            <div class="search">
              <span class="search__icon"><tm-icon name="search" [size]="15" /></span>
              <input
                type="text"
                class="search__input"
                [placeholder]="searchPlaceholder"
                [(ngModel)]="searchFilter"
                (ngModelChange)="onSearchChange()"
              />
              <button *ngIf="searchFilter" type="button" class="search__clear" (click)="clearSearch()" aria-label="Clear">
                <tm-icon name="x" [size]="13" />
              </button>
            </div>

            <button type="button" class="export-btn" (click)="exportCsv()" title="Export to CSV">
              <tm-icon name="download" [size]="14" /> Export CSV
            </button>
          </div>
        </div>
      </div>

      <!-- State: Error Box -->
      <div class="state state--error" *ngIf="error">{{ error }}</div>

      <!-- ====================================================================
           VIEW 1: ALL MOVEMENTS & TRANSACTIONS TABLE
           ==================================================================== -->
      <div *ngIf="viewMode === 'movements'">
        <tm-data-table
          [rows]="pagedMovements"
          [total]="displayRows.length"
          [page]="page"
          [pageSize]="pageSize"
          [loading]="loading || searchLoading"
          [showToolbar]="false"
          emptyTitle="No transactions found"
          emptyHint="Transactions appear here as rides are completed, balances split, and payouts recorded."
          (pageChange)="page = $event"
          (pageSizeChange)="pageSize = $event; page = 1"
        >
          <tm-column key="created_at" label="Date &amp; ID" width="150">
            <ng-template let-row>
              <div class="stack" [class.stack--child]="row.child">
                <span class="strong">{{ row.created_at | date:'d MMM y' }}</span>
                <span class="muted">{{ row.created_at | date:'h:mm a' }}</span>
                <span class="tx-badge" *ngIf="!row.group">Tx #{{ row.id }}</span>
              </div>
            </ng-template>
          </tm-column>

          <tm-column key="type" label="Type / Movement" width="160">
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
                <span class="mv" [ngClass]="'mv--' + row.type" [class.mv--child]="row.child">
                  {{ typeLabel(row.type) }}
                </span>
              </ng-template>
            </ng-template>
          </tm-column>

          <tm-column key="party" label="Customer / Driver / Platform" width="280">
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
                  <span class="party-badge party-badge--operator">Company Platform</span>
                  <strong class="party-name">Commission / Fee</strong>
                  <div class="party-sub-details" *ngIf="row.customer_name || row.driver_name">
                    <small *ngIf="row.customer_name">Cust: <strong>{{ row.customer_name }}</strong></small>
                    <small *ngIf="row.driver_name">Drv: <strong>{{ row.driver_name }}</strong></small>
                  </div>
                </div>

                <div class="party-info" *ngIf="row.party !== 'customer' && row.party !== 'driver' && row.party !== 'operator'">
                  <span class="party-badge">{{ row.party }}</span>
                  <div class="party-sub-details" *ngIf="row.customer_name || row.driver_name">
                    <small *ngIf="row.customer_name">Cust: <strong>{{ row.customer_name }}</strong></small>
                    <small *ngIf="row.driver_name">Drv: <strong>{{ row.driver_name }}</strong></small>
                  </div>
                </div>
              </ng-container>

              <div class="groupmeta" *ngIf="row.group">
                <strong class="groupmeta__title" *ngIf="row.group.label">{{ row.group.label }}</strong>
                <span *ngIf="row.group.customer_name">Customer: <strong>{{ row.group.customer_name }}</strong></span>
                <span *ngIf="row.group.driver_name">Driver: <strong>{{ row.group.driver_name }}</strong></span>
                <span>Driver Payout: ₹ {{ row.group.toDriver | number:'1.2-2' }} · Commission: ₹ {{ row.group.commission | number:'1.2-2' }}</span>
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

          <tm-column key="balance" label="Balance Proof" width="130">
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

          <tm-column key="razorpay_ref" label="Reference / Payment" width="200">
            <ng-template let-row>
              <div class="ref-stack" *ngIf="!row.group">
                <span class="ref" *ngIf="row.razorpay_ref">{{ row.razorpay_ref }}</span>
                <small class="pay-id" *ngIf="row.payment_id">Payment #{{ row.payment_id }}</small>
                <span class="muted" *ngIf="!row.razorpay_ref && !row.payment_id">—</span>
              </div>
              <span class="muted" *ngIf="row.group">{{ row.group.count }} movements</span>
            </ng-template>
          </tm-column>

          <tm-column key="amount" label="Amount" width="140" align="right">
            <ng-template let-row>
              <span class="amount amount--group" *ngIf="row.group">
                ₹ {{ row.group.captured | number:'1.2-2' }}
              </span>
              <span class="amount" *ngIf="!row.group" [class.amount--out]="row.direction === 'out'">
                {{ row.direction === 'out' ? '−' : '+' }} ₹ {{ row.amount | number:'1.2-2' }}
              </span>
            </ng-template>
          </tm-column>
        </tm-data-table>
      </div>

      <!-- ====================================================================
           VIEW 2: DRIVER FINANCIALS & WALLETS TABLE
           ==================================================================== -->
      <div class="table-card" *ngIf="viewMode === 'drivers'">
        <div class="table-wrap">
          <table class="tm-table">
            <thead>
              <tr>
                <th>Driver</th>
                <th>Vehicle</th>
                <th>Wallet Balance</th>
                <th>Min Limit</th>
                <th>Pending Payout</th>
                <th>Gross Earnings</th>
                <th>Cash vs Online</th>
                <th style="text-align: right;">Financial Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let d of filteredDrivers">
                <td>
                  <div class="user-cell">
                    <strong>{{ d.name }}</strong>
                    <small>📞 {{ d.phone }}</small>
                  </div>
                </td>
                <td>
                  <div class="veh-cell">
                    <span>{{ d.vehicle_type || '—' }}</span>
                    <small class="muted">{{ d.vehicle_reg_no }}</small>
                  </div>
                </td>
                <td>
                  <span class="balance-badge" [class.balance-badge--pos]="d.balance >= 0" [class.balance-badge--neg]="d.balance < 0">
                    ₹ {{ d.balance | number:'1.2-2' }}
                  </span>
                  <span *ngIf="d.is_in_debt" class="status-pill status-pill--bad mt-1">In Debt</span>
                </td>
                <td>
                  <span class="limit-text">₹ {{ d.minimum_wallet_limit }}</span>
                  <div *ngIf="!d.can_accept_rides" class="text-danger-sm">Rides blocked</div>
                </td>
                <td>
                  <strong class="pending-badge" *ngIf="(d.pending_payout || 0) > 0">
                    ₹ {{ d.pending_payout | number:'1.2-2' }}
                  </strong>
                  <span class="muted" *ngIf="!d.pending_payout || d.pending_payout <= 0">₹ 0.00</span>
                </td>
                <td>
                  <strong class="earnings-val">₹ {{ (d.gross_earnings || 0) | number:'1.2-2' }}</strong>
                  <small class="block text-muted">{{ d.rides_count || 0 }} rides</small>
                </td>
                <td>
                  <div class="split-cell">
                    <span class="cash-text">₹ {{ (d.cash_collected || 0) | number:'1.2-2' }} cash</span>
                    <span class="online-text">₹ {{ (d.online_collected || 0) | number:'1.2-2' }} online</span>
                  </div>
                </td>
                <td style="text-align: right;">
                  <div class="action-buttons">
                    <tm-button
                      *ngIf="(d.pending_payout || 0) > 0"
                      variant="green"
                      size="sm"
                      (clicked)="openPayoutModal(d)"
                    >Pay Out</tm-button>
                    <span *ngIf="!d.pending_payout || d.pending_payout <= 0" class="muted">—</span>
                  </div>
                </td>
              </tr>
              <tr *ngIf="filteredDrivers.length === 0">
                <td colspan="8" class="empty-cell">No drivers match the current filter.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ====================================================================
           VIEW 3: RIDE COMMISSIONS TABLE
           ==================================================================== -->
      <div class="table-card" *ngIf="viewMode === 'commissions'">
        <div class="table-wrap">
          <table class="tm-table">
            <thead>
              <tr>
                <th>Date &amp; Trip</th>
                <th>Driver</th>
                <th>Vehicle</th>
                <th>Gross Fare</th>
                <th>Commission %</th>
                <th>Platform Fee Retained</th>
                <th>Driver Net Share</th>
                <th>Mode</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let c of filteredCommissions">
                <td>
                  <div class="trip-cell">
                    <strong class="trip-id">#{{ c.trip_id }}</strong>
                    <small class="trip-date">{{ c.date | date:'short' }}</small>
                  </div>
                </td>
                <td>
                  <div class="user-cell">
                    <strong>{{ c.driver_name }}</strong>
                    <small>📞 {{ c.driver_phone }}</small>
                  </div>
                </td>
                <td>
                  <span>{{ c.vehicle_type || '—' }}</span>
                </td>
                <td>
                  <span class="amount-cell">₹ {{ c.fare | number:'1.2-2' }}</span>
                </td>
                <td>
                  <span class="rate-badge" [class.rate-badge--fixed]="c.is_fixed_commission || c.commission_percent <= 0">
                    {{ (c.is_fixed_commission || c.commission_percent <= 0) ? 'Fixed' : (c.commission_percent + '%') }}
                  </span>
                </td>
                <td>
                  <strong class="comm-amount">₹ {{ c.commission_amount | number:'1.2-2' }}</strong>
                </td>
                <td>
                  <span class="driver-share">₹ {{ c.net_driver_earnings | number:'1.2-2' }}</span>
                </td>
                <td>
                  <span class="mode-badge" [ngClass]="'mode-badge--' + (c.mode || (c.is_shared ? 'fixed' : 'private'))">
                    {{ formatTripMode(c) }}
                  </span>
                  <small *ngIf="c.route_name" class="block text-muted">{{ c.route_name }}</small>
                </td>
              </tr>
              <tr *ngIf="filteredCommissions.length === 0">
                <td colspan="8" class="empty-cell">No commissioned rides found for selected period.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ====================================================================
           VIEW 4: COMPLETED TRANSFERS REGISTER TABLE
           ==================================================================== -->
      <div class="table-card" *ngIf="viewMode === 'transfers'">
        <div class="table-wrap">
          <table class="tm-table">
            <thead>
              <tr>
                <th>Date &amp; Time</th>
                <th>Driver</th>
                <th>Amount Settled</th>
                <th>Method</th>
                <th>Reference / UTR</th>
                <th>Recorded By</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let t of filteredTransfers">
                <td>
                  <div class="date-cell">
                    <span class="date-main">{{ t.created_at | date:'d MMM y' }}</span>
                    <small class="date-sub">{{ t.created_at | date:'h:mm a' }}</small>
                  </div>
                </td>
                <td>
                  <div class="user-cell">
                    <strong>{{ t.driver_name }}</strong>
                    <small>📞 {{ t.driver_phone }}</small>
                  </div>
                </td>
                <td>
                  <strong class="amount-val">₹ {{ t.amount | number:'1.2-2' }}</strong>
                </td>
                <td>
                  <span class="method-badge">{{ formatMethod(t.method) }}</span>
                </td>
                <td>
                  <div class="ref-cell">
                    <span class="ref-code">{{ t.reference || '—' }}</span>
                    <small *ngIf="t.notes" class="ref-notes">{{ t.notes }}</small>
                  </div>
                </td>
                <td>
                  <span class="recorder-name">{{ t.recorded_by || 'Admin' }}</span>
                </td>
              </tr>
              <tr *ngIf="filteredTransfers.length === 0">
                <td colspan="6" class="empty-cell">No completed transfers recorded.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ====================================================================
           RECORD DRIVER PAYOUT TRANSFER MODAL
           ==================================================================== -->
      <div class="modal-backdrop" *ngIf="showPayoutModal" (click)="closeModals()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal__header">
            <h3>Record Driver Payout Transfer</h3>
            <button type="button" class="modal__close" (click)="closeModals()" aria-label="Close">
              <tm-icon name="x" [size]="16" />
            </button>
          </div>
          <div class="modal__body">
            <div class="form-group" *ngIf="!selectedDriverForPayout">
              <label>Select Driver to Payout</label>
              <select class="form-control" [(ngModel)]="payoutDriverId" (change)="onPayoutDriverSelected()">
                <option [ngValue]="null">-- Select a driver --</option>
                <option *ngFor="let d of driversList" [ngValue]="d.driver_id">
                  {{ d.name }} ({{ d.phone }}) — Pending: ₹{{ (d.pending_payout || 0) | number:'1.2-2' }}
                </option>
              </select>
            </div>

            <div class="payout-notice-box" *ngIf="selectedDriverForPayout">
              <div>
                <span class="lbl">Driver:</span>
                <strong>{{ selectedDriverForPayout.name }}</strong>
              </div>
              <div>
                <span class="lbl">Pending payout balance:</span>
                <strong class="text-emerald">₹ {{ (selectedDriverForPayout.pending_payout || 0) | number:'1.2-2' }}</strong>
              </div>
            </div>

            <div class="form-group">
              <label>Transfer Method</label>
              <select class="form-control" [(ngModel)]="payoutForm.method">
                <option value="gpay">GPay / UPI</option>
                <option value="bank">Bank Transfer (NEFT / IMPS)</option>
                <option value="cash">Cash Handover</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div class="form-group">
              <label>Transfer Amount (₹)</label>
              <input
                type="number"
                class="form-control"
                min="0.01"
                step="0.01"
                placeholder="e.g. 500"
                [(ngModel)]="payoutForm.amount"
              />
            </div>

            <div class="form-group">
              <label>UTR / Transaction Reference</label>
              <input type="text" class="form-control" placeholder="e.g. UTR123456789" [(ngModel)]="payoutForm.reference" />
            </div>

            <div class="form-group">
              <label>Notes / Remarks</label>
              <input type="text" class="form-control" placeholder="e.g. Weekly settlement payout" [(ngModel)]="payoutForm.note" />
            </div>

            <div *ngIf="payoutError" class="modal-error">{{ payoutError }}</div>
          </div>
          <div class="modal__footer">
            <tm-button variant="outline" size="sm" (clicked)="closeModals()" [disabled]="submittingPayout">Cancel</tm-button>
            <tm-button
              variant="green"
              size="sm"
              [loading]="submittingPayout"
              [disabled]="submittingPayout || !selectedDriverForPayout || !payoutForm.amount || payoutForm.amount <= 0"
              (clicked)="submitPayout()"
            >Confirm Transfer</tm-button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .page { display: flex; flex-direction: column; gap: 16px; }

    /* Page Hero Header */
    .page__hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .page__title { margin: 0; font-size: 26px; line-height: 1.1; font-weight: 850; color: var(--tm-text); letter-spacing: -0.02em; }
    .page__sub { margin: 6px 0 0; max-width: 780px; color: var(--tm-text-muted); font-size: 13.5px; line-height: 1.5; }
    .hero__side { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

    /* Reconciliation Banner */
    .verdict { display: flex; align-items: center; gap: 12px; padding: 14px 16px;
      border: 1px solid rgba(16, 185, 129, 0.25); border-radius: var(--tm-radius-lg); background: var(--tm-green-tint);
      box-shadow: 0 2px 8px rgba(16, 185, 129, 0.05); }
    .verdict__icon { display: inline-flex; color: var(--tm-green-deep); flex: none; }
    .verdict__body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
    .verdict__body strong { font-size: 14px; font-weight: 800; color: var(--tm-text); }
    .verdict__body span { font-size: 12.5px; color: var(--tm-text-muted); }
    .verdict--bad { background: var(--tm-danger-bg, #fef3f2); border-color: rgba(225, 29, 72, 0.3); }
    .verdict--bad .verdict__icon { color: var(--tm-danger, #B42318); }

    /* KPI Cards Grid */
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
    .card { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; background: var(--tm-surface);
      border: 1px solid var(--tm-line); border-radius: var(--tm-radius-lg); transition: all 0.2s ease;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04); position: relative; overflow: hidden; cursor: pointer; }
    .card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: var(--tm-green-deep); }
    .card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.08); border-color: var(--tm-text); }
    .card__label { font-size: 11.5px; color: var(--tm-text-muted); font-weight: 700; }
    .card__value { font-size: 20px; font-weight: 850; color: var(--tm-text); font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
    .card__meta { font-size: 11px; color: var(--tm-text-soft); font-weight: 500; }
    .card--driver::before { background: var(--tm-info-fg, #1d4ed8); }
    .card--pending::before { background: var(--tm-green-deep); }
    .card--operator::before { background: var(--tm-green-deep); }
    .card--earnings::before { background: var(--tm-info-fg, #1d4ed8); }
    .card--wallet::before { background: var(--tm-warning-fg, #d97706); }
    .card--held::before { background: var(--tm-warning-fg, #d97706); }
    .card--refund::before { background: var(--tm-danger, #e11d48); }
    .card__value--emerald { color: var(--tm-green-deep); }
    .card__value--rose { color: var(--tm-danger, #e11d48); }

    /* Toolbar & View Modes */
    .toolbar { display: flex; flex-direction: column; gap: 12px; background: var(--tm-surface);
      border: 1px solid var(--tm-line); border-radius: var(--tm-radius-lg); padding: 12px 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.03); }
    .view-modes { display: flex; gap: 6px; padding: 3px; background: var(--tm-canvas-2, #ebecee);
      border-radius: var(--tm-radius-md); overflow-x: auto; max-width: 100%; scrollbar-width: none; }
    .view-modes::-webkit-scrollbar { display: none; }
    .view-mode-btn { display: inline-flex; align-items: center; gap: 7px; padding: 7px 14px; border: 0;
      background: transparent; color: var(--tm-text-muted); font-family: var(--tm-font-body);
      font-size: 12.5px; font-weight: 700; cursor: pointer; border-radius: calc(var(--tm-radius-md) - 3px);
      white-space: nowrap; transition: all 0.15s ease; }
    .view-mode-btn:hover:not(.is-active) { color: var(--tm-text); }
    .view-mode-btn.is-active { background: var(--tm-surface); color: var(--tm-text); font-weight: 800; box-shadow: 0 1px 3px rgba(15,20,25,0.08); }

    .filters-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .toolbar__right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; margin-left: auto; }

    .tabs-group { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .tabs { display: flex; align-items: center; gap: 4px; }
    .tabs-label { font-size: 11.5px; font-weight: 800; color: var(--tm-text-muted); margin-right: 2px; }
    .tab { border: 1px solid var(--tm-line); background: var(--tm-surface); color: var(--tm-text-muted);
      border-radius: 999px; padding: 4px 12px; font: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer;
      transition: all 0.15s ease; }
    .tab:hover { border-color: var(--tm-text); color: var(--tm-text); }
    .tab--on { background: var(--tm-text); color: var(--tm-surface); border-color: var(--tm-text); font-weight: 800; }

    .pills { display: inline-flex; align-items: center; gap: 4px; background: var(--tm-canvas-subtle, #f3f4f6); padding: 3px; border-radius: var(--tm-radius-md); }
    .pill { border: 0; background: transparent; padding: 5px 12px; border-radius: var(--tm-radius-sm); font-size: 12px; font-weight: 700; color: var(--tm-text-muted); cursor: pointer; transition: all 0.15s ease; white-space: nowrap; }
    .pill:hover { color: var(--tm-text); }
    .pill--on { background: var(--tm-surface); color: var(--tm-text); font-weight: 850; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }

    .date-pills { display: inline-flex; align-items: center; gap: 3px; background: var(--tm-canvas-subtle, #f3f4f6); padding: 3px; border-radius: var(--tm-radius-md); }
    .date-pill { border: 0; background: transparent; padding: 4px 10px; border-radius: var(--tm-radius-sm); font-size: 11.5px; font-weight: 700; color: var(--tm-text-muted); cursor: pointer; transition: all 0.15s ease; white-space: nowrap; }
    .date-pill:hover { color: var(--tm-text); }
    .date-pill--on { background: var(--tm-surface); color: var(--tm-text); font-weight: 850; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }

    .search { position: relative; display: flex; align-items: center; min-width: 220px; }
    .search__icon { position: absolute; left: 10px; color: var(--tm-text-muted); display: inline-flex; pointer-events: none; }
    .search__input { width: 100%; height: 34px; padding: 0 26px 0 32px; font: inherit; font-size: 12px;
      color: var(--tm-text); background: var(--tm-surface); border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-md); outline: none; transition: border-color 0.15s ease; }
    .search__input:focus { border-color: var(--tm-text); }
    .search__clear { position: absolute; right: 6px; border: 0; background: transparent; padding: 4px; color: var(--tm-text-muted); cursor: pointer; display: inline-flex; }

    .date-range { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px;
      border: 1px solid var(--tm-line); border-radius: var(--tm-radius-md); background: var(--tm-surface); line-height: 1; cursor: pointer; position: relative; }
    .date-range.has-value { background: var(--tm-green-tint); border-color: var(--tm-green-deep); }
    .date-range__icon { color: var(--tm-text-muted); display: inline-flex; }
    .date-range.has-value .date-range__icon { color: var(--tm-green-deep); }
    .date-range__input { appearance: none; background: transparent; border: 0; outline: 0; font-family: var(--tm-font-mono); font-size: 11.5px; font-weight: 600; color: var(--tm-text); padding: 0; width: 130px; cursor: pointer; }

    .export-btn { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; background: #059669; color: #ffffff; border: 0; border-radius: var(--tm-radius-md); font-size: 12px; font-weight: 800; cursor: pointer; transition: background 0.15s ease; white-space: nowrap; }
    .export-btn:hover { background: #047857; }
    .check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; color: var(--tm-text-muted); cursor: pointer; user-select: none; }

    /* Table Card & General Tables */
    .table-card { background: var(--tm-surface); border: 1px solid var(--tm-line); border-radius: var(--tm-radius-lg); overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.03); }
    .table-wrap { overflow-x: auto; }
    .tm-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }
    .tm-table th { background: var(--tm-canvas-subtle, #f9fafb); color: var(--tm-text-muted); font-size: 11px; font-weight: 800; text-transform: uppercase; padding: 12px 16px; letter-spacing: 0.05em; border-bottom: 1px solid var(--tm-line); }
    .tm-table td { padding: 13px 16px; border-bottom: 1px solid var(--tm-line-subtle, #f0f0f0); vertical-align: middle; }
    .tm-table tbody tr:hover { background: var(--tm-canvas-subtle, #fcfcfc); }

    .user-cell { display: flex; flex-direction: column; gap: 2px; }
    .user-cell strong { color: var(--tm-text); font-size: 13px; }
    .user-cell small { color: var(--tm-text-muted); font-family: var(--tm-font-mono); font-size: 11px; }

    .veh-cell { display: flex; flex-direction: column; gap: 2px; }
    .balance-badge { display: inline-flex; padding: 2px 7px; border-radius: var(--tm-radius-sm); font-size: 12px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .balance-badge--pos { background: var(--tm-green-tint); color: var(--tm-green-deep); }
    .balance-badge--neg { background: var(--tm-danger-bg, #fef3f2); color: var(--tm-danger, #B42318); }

    .limit-text { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--tm-text); }
    .pending-badge { font-variant-numeric: tabular-nums; font-weight: 800; color: var(--tm-green-deep); }
    .earnings-val { font-variant-numeric: tabular-nums; font-weight: 800; color: var(--tm-text); }
    .split-cell { display: flex; flex-direction: column; gap: 2px; font-size: 11px; }
    .cash-text { color: var(--tm-warning-fg, #d97706); font-weight: 600; }
    .online-text { color: var(--tm-text-muted); }
    .action-buttons { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }

    .trip-cell { display: flex; flex-direction: column; gap: 2px; }
    .trip-id { font-family: var(--tm-font-mono); font-weight: 800; color: var(--tm-info-fg, #1d4ed8); }
    .trip-date { font-size: 11px; color: var(--tm-text-muted); }
    .amount-cell { font-variant-numeric: tabular-nums; font-weight: 600; }
    .rate-badge { display: inline-flex; padding: 2px 6px; border-radius: var(--tm-radius-sm); font-size: 11px; font-weight: 800; background: var(--tm-canvas-2); color: var(--tm-text); }
    .comm-amount { font-variant-numeric: tabular-nums; font-weight: 800; color: var(--tm-warning-fg, #d97706); }
    .driver-share { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--tm-green-deep); }
    .mode-badge { display: inline-flex; padding: 2px 7px; border-radius: var(--tm-radius-sm); font-size: 10.5px; font-weight: 700; background: var(--tm-canvas); color: var(--tm-text-muted); }

    .date-cell { display: flex; flex-direction: column; gap: 2px; }
    .date-main { font-weight: 700; color: var(--tm-text); }
    .date-sub { font-size: 11px; color: var(--tm-text-muted); }
    .amount-val { font-variant-numeric: tabular-nums; font-weight: 800; color: var(--tm-green-deep); }
    .method-badge { display: inline-flex; padding: 2px 7px; border-radius: var(--tm-radius-sm); font-size: 11px; font-weight: 700; background: var(--tm-canvas); color: var(--tm-text); }
    .ref-cell { display: flex; flex-direction: column; gap: 2px; }
    .ref-code { font-family: var(--tm-font-mono); font-size: 11.5px; font-weight: 600; color: var(--tm-text); }
    .ref-notes { font-size: 11px; color: var(--tm-text-muted); }

    .status-pill { display: inline-flex; padding: 1px 6px; border-radius: 999px; font-size: 10px; font-weight: 800; }
    .status-pill--bad { background: var(--tm-danger-bg, #fef3f2); color: var(--tm-danger, #B42318); }
    .text-danger-sm { font-size: 10px; color: var(--tm-danger, #B42318); font-weight: 700; margin-top: 2px; }

    .empty-cell { text-align: center; padding: 36px !important; color: var(--tm-text-muted); font-size: 13px; }
    .state--error { color: var(--tm-danger, #e11d48); padding: 12px; background: var(--tm-danger-bg, #fef3f2); border-radius: var(--tm-radius-md); }

    /* Movements DataTable Specific Styles */
    .stack { display: flex; flex-direction: column; gap: 2px; }
    .stack--child { padding-left: 14px; border-left: 3px solid var(--tm-line-2, #e5e7eb); }
    .tx-badge { display: inline-block; font-size: 10.5px; font-weight: 800; color: var(--tm-text-muted); font-family: var(--tm-font-mono); }
    .mv { display: inline-flex; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 800; background: var(--tm-canvas); color: var(--tm-text); white-space: nowrap; }
    .mv--capture { background: var(--tm-green-tint); color: var(--tm-green-deep); }
    .mv--transfer { background: var(--tm-info-bg, #eff6ff); color: var(--tm-info-fg, #1d4ed8); }
    .mv--cash_retained { background: var(--tm-canvas-2, #f3f4f6); color: var(--tm-text, #1f2937); border: 1px solid rgba(0,0,0,0.06); }
    .mv--retained { background: var(--tm-canvas); color: var(--tm-text); }
    .mv--gateway_fee { background: var(--tm-canvas-2); color: var(--tm-text-muted); }
    .mv--held { background: var(--tm-warning-bg, #fff4e5); color: var(--tm-warning-fg, #92400e); }
    .mv--refund, .mv--reversal { background: var(--tm-danger-bg, #fef3f2); color: var(--tm-danger, #B42318); }
    .mv--child { opacity: 0.9; }

    .party-info { display: flex; flex-direction: column; gap: 2px; }
    .party-name { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .party-phone { font-size: 11px; color: var(--tm-text-muted); font-family: var(--tm-font-mono); }
    .party-badge { display: inline-flex; width: fit-content; padding: 1px 5px; border-radius: 4px; font-size: 9.5px; font-weight: 800; text-transform: uppercase; background: var(--tm-canvas); color: var(--tm-text-muted); }
    .party-badge--customer { background: var(--tm-green-tint); color: var(--tm-green-deep); }
    .party-badge--driver { background: var(--tm-info-bg, #eff6ff); color: var(--tm-info-fg, #1d4ed8); }
    .party-badge--operator { background: var(--tm-canvas-2); color: var(--tm-text); }
    .party-sub-details { display: flex; flex-direction: column; gap: 1px; margin-top: 2px; }
    .party-sub-details small { font-size: 10.5px; color: var(--tm-text-muted); }

    .groupmeta { display: flex; flex-direction: column; gap: 2px; font-size: 11.5px; color: var(--tm-text-muted); font-variant-numeric: tabular-nums; }
    .groupmeta__title { font-size: 13px; font-weight: 850; color: var(--tm-text); }
    .groupmeta--refund { color: var(--tm-danger, #B42318); font-weight: 700; }

    .triplink { border: 0; background: transparent; padding: 0; font: inherit; font-size: 12px; font-weight: 800; color: var(--tm-info-fg, #1d4ed8); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
    .bal { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 800; background: var(--tm-green-tint); color: var(--tm-green-deep); white-space: nowrap; }
    .bal__dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex: none; }
    .bal--bad { background: var(--tm-danger-bg, #fef3f2); color: var(--tm-danger, #B42318); }

    .grouptoggle { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--tm-line); background: var(--tm-surface); padding: 4px 10px; border-radius: var(--tm-radius-md); font: inherit; font-size: 11.5px; font-weight: 800; color: var(--tm-text); cursor: pointer; }
    .amount { font-variant-numeric: tabular-nums; font-weight: 800; font-size: 13px; color: var(--tm-green-deep); }
    .amount--out { color: var(--tm-text); }
    .amount--group { color: var(--tm-text); }

    /* Modals */
    .modal-backdrop { position: fixed; inset: 0; background: rgba(15, 20, 25, 0.45); backdrop-filter: blur(2px); display: flex; align-items: center; justify-content: center; z-index: 10000; }
    .modal { background: var(--tm-surface); border: 1px solid var(--tm-line); border-radius: var(--tm-radius-xl); width: 480px; max-width: 92vw; overflow: hidden; box-shadow: var(--tm-shadow-pop, 0 10px 40px rgba(0,0,0,0.15)); }
    .modal__header { padding: 16px 20px; border-bottom: 1px solid var(--tm-line); display: flex; justify-content: space-between; align-items: center; }
    .modal__header h3 { margin: 0; font-size: 16px; font-weight: 800; color: var(--tm-text); }
    .modal__close { border: 0; background: transparent; padding: 4px; color: var(--tm-text-muted); cursor: pointer; display: inline-flex; }
    .modal__close:hover { color: var(--tm-text); }
    .modal__body { padding: 18px 20px; display: flex; flex-direction: column; gap: 13px; }
    .driver-summary-box, .payout-notice-box { background: var(--tm-canvas-subtle, #f9fafb); padding: 10px 14px; border-radius: var(--tm-radius-md); border: 1px solid var(--tm-line); font-size: 12.5px; }
    .payout-notice-box { background: var(--tm-green-tint); border-color: rgba(16,185,129,0.3); display: flex; justify-content: space-between; align-items: center; }
    .lbl { color: var(--tm-text-muted); margin-right: 5px; }
    .text-emerald { color: var(--tm-green-deep); font-weight: 800; }
    .text-rose { color: var(--tm-danger, #B42318); font-weight: 800; }
    .ml-3 { margin-left: 12px; }
    .mt-1 { margin-top: 4px; }
    .block { display: block; }
    .form-group { display: flex; flex-direction: column; gap: 4px; }
    .form-group label { font-size: 11.5px; font-weight: 700; color: var(--tm-text-muted); }
    .form-control { border: 1px solid var(--tm-line); background: var(--tm-surface); color: var(--tm-text); border-radius: var(--tm-radius-md); padding: 7px 11px; font: inherit; font-size: 12.5px; outline: none; transition: border-color 0.15s ease; }
    .form-control:focus { border-color: var(--tm-text); }
    .modal-error { color: var(--tm-danger, #B42318); font-size: 11.5px; font-weight: 600; padding: 7px 10px; background: var(--tm-danger-bg, #fef3f2); border-radius: var(--tm-radius-sm); }
    .modal__footer { padding: 12px 20px; border-top: 1px solid var(--tm-line); display: flex; justify-content: flex-end; gap: 8px; background: var(--tm-canvas-subtle, #fafafa); }
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
    { key: 'capture', label: 'Payments' },
    { key: 'transfer', label: 'Payouts' },
    { key: 'topup', label: 'Wallet Recharges' },
    { key: 'retained', label: 'Commissions' },
    { key: 'gateway_fee', label: 'Gateway Fee' },
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
      case 'drivers': return 'Search driver name, phone, vehicle reg...';
      case 'commissions': return 'Search trip ID, driver, vehicle...';
      case 'transfers': return 'Search driver, reference/UTR, notes...';
      default: return 'Search Tx ID, Trip ID, Name, Phone, Ref...';
    }
  }

  setViewMode(mode: LedgerViewMode): void {
    this.viewMode = mode;
    this.searchFilter = '';
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
      case 'capture': return 'Payment';
      case 'transfer': return 'Driver Payout';
      case 'topup': return 'Wallet Recharge';
      case 'cash_retained': return 'Cash In Hand';
      case 'retained': return 'Platform Fee';
      case 'gateway_fee': return 'Gateway Fee';
      case 'held': return 'On Hold';
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
      other: 'Other',
    };
    return map[m?.toLowerCase()] || m;
  }

  formatTripMode(c: CommissionRecord): string {
    const mode = c.mode || (c.is_shared ? 'fixed' : 'private');
    const modeLabel = mode === 'fixed' ? 'Fixed' : (mode === 'shuttle' ? 'Shuttle' : 'Private');
    const method = c.payment_method || 'Cash';
    return `${modeLabel} · ${method}`;
  }

  setTypeFilter(key: string): void {
    this.typeFilter = key;
    this.page = 1;
  }

  setUnbalanced(on: boolean): void {
    this.unbalancedOnly = on;
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
