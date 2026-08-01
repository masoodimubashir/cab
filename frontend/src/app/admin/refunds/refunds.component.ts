import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import $ from 'jquery';
import moment from 'moment';
import 'daterangepicker';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import {
  ButtonComponent,
  DrawerComponent,
  IconComponent,
  StatusPillComponent,
} from '../../ui';

export interface RefundRow {
  key: string;
  module: 'fixed' | 'shuttle';
  id: number;
  customer_id?: number | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  driver_name?: string | null;
  trip_label: string;
  travel_date?: string | null;
  reason: string;
  payment_method: string;
  amount: number;
  state: 'due' | 'refunded' | 'rejected' | 'none';
  refund_status: string;
  refund_method?: string | null;
  refund_method_label?: string | null;
  refund_reference?: string | null;
  refund_note?: string | null;
  refunded_by_name?: string | null;
  refunded_at?: string | null;
  owed_since?: string | null;
  created_at?: string | null;
}

const METHOD_OPTIONS = [
  { value: 'gpay', label: 'GPay / UPI' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'razorpay_dashboard', label: 'Razorpay dashboard' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
];

const MODULE_OPTIONS = [
  { value: 'fixed' as const, label: 'Fixed route' },
  { value: 'shuttle' as const, label: 'Shuttle' },
];

const PAID_OPTIONS = [
  { value: 'razorpay' as const, label: 'Razorpay' },
  { value: 'wallet' as const, label: 'Wallet' },
];

/**
 * B5 — the customer-refund REGISTER. Money captured by Razorpay that must go
 * back to a customer is sent by the operator OUTSIDE the app (GPay / bank /
 * Razorpay dashboard); this screen shows who is owed what and why, and
 * records the proof when it's sent. Rows never disappear — settled refunds
 * stay as a permanent audit trail (method, reference, who marked it, when).
 * Wallet-paid bookings refund to the wallet automatically and only show up
 * here as already-settled history.
 */
@Component({
  selector: 'app-admin-refunds',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, IconComponent, DrawerComponent, StatusPillComponent],
  template: `
    <div class="page">
      <header class="page__hero">
        <div>
          <h1 class="page__title">Refunds</h1>
          <p class="page__sub" *ngIf="!autoRefunds">
            Customers owed money from cancelled fixed &amp; shuttle bookings. Send the money by
            GPay/bank as usual, then <strong>Mark refunded</strong> — the row stays here forever as proof.
          </p>
          <p class="page__sub" *ngIf="autoRefunds">
            Refunds go back to the customer's card automatically. This is the audit trail —
            and, at the top, the handful of <strong>exceptions</strong> that didn't go through.
          </p>
        </div>
        <div class="hero__side">
          <div class="total" *ngIf="!loading">
            <span class="total__label">{{ autoRefunds ? 'Needs a human' : 'Due to customers' }}</span>
            <span class="total__value" [class.total__value--zero]="filteredTotalDue === 0" [class.total__value--pulse]="cardsUpdating">₹ {{ filteredTotalDue | number:'1.2-2' }}</span>
            <span class="total__count">{{ filteredDueCount }} {{ autoRefunds ? 'exceptions' : 'pending' }}</span>
          </div>
          <tm-button variant="outline" size="sm" icon="refresh" [loading]="loading" (clicked)="load()">Refresh</tm-button>
        </div>
      </header>

      <!-- What this screen is FOR, once refunds stopped being manual work. -->
      <div class="auto-banner" [class.auto-banner--clear]="dueCount === 0" *ngIf="autoRefunds && !loading">
        <span class="auto-banner__icon"><tm-icon [name]="dueCount === 0 ? 'check' : 'bell'" [size]="17" /></span>
        <div class="auto-banner__body">
          <strong *ngIf="dueCount === 0">Nothing needs you. Every refund went back automatically.</strong>
          <strong *ngIf="dueCount > 0">{{ dueCount }} refund(s) did not complete automatically.</strong>
          <span *ngIf="dueCount === 0">
            Cancellations refund the rider's card without anyone touching this screen. Rows below are history.
          </span>
          <span *ngIf="dueCount > 0">
            Either Razorpay rejected the refund, or these predate automatic refunds. Send the money
            the usual way and record it with <strong>Mark refunded</strong>.
          </span>
        </div>
      </div>

      <!-- Status tabs -->
      <div class="tabs">
        <button type="button" class="tab" [class.tab--on]="filter === 'due'" (click)="setFilter('due')">
          Due <span class="tab__n" *ngIf="dueCount">{{ dueCount }}</span>
        </button>
        <button type="button" class="tab" [class.tab--on]="filter === 'refunded'" (click)="setFilter('refunded')">Refunded</button>
        <button type="button" class="tab" [class.tab--on]="filter === 'all'" (click)="setFilter('all')">All</button>
      </div>

      <!-- Filter toolbar -->
      <div class="toolbar">
        <div class="search">
          <span class="search__icon"><tm-icon name="search" [size]="15" /></span>
          <input
            type="text"
            class="search__input"
            placeholder="Search customer, phone or booking #"
            [(ngModel)]="search"
            (ngModelChange)="onSearchChange()"
          />
          <button *ngIf="search.trim()" type="button" class="search__clear" (click)="clearSearch()" aria-label="Clear search">
            <tm-icon name="x" [size]="13" />
          </button>
        </div>

        <div class="filters">
          <!-- Module -->
          <div class="state-select" [class.has-value]="moduleFilter !== 'all'" [class.is-open]="moduleOpen">
            <button type="button" class="state-select__trigger" (click)="toggleModuleMenu($event)"
              [attr.aria-expanded]="moduleOpen" aria-haspopup="listbox" aria-label="Booking type filter">
              <span class="state-select__icon" aria-hidden="true"><tm-icon name="car" [size]="14" /></span>
              <span class="state-select__value">{{ moduleLabel() }}</span>
              <tm-icon name="chevron-down" [size]="12" class="state-select__caret" />
            </button>
            <ul class="state-select__menu" *ngIf="moduleOpen" role="listbox" (click)="$event.stopPropagation()">
              <li class="state-select__option" [class.is-selected]="moduleFilter === 'all'" role="option"
                [attr.aria-selected]="moduleFilter === 'all'" (click)="selectModule('all')">
                <tm-icon *ngIf="moduleFilter === 'all'" name="check" [size]="12" class="state-select__option-check" />
                <span class="state-select__option-label">All bookings</span>
              </li>
              <li *ngFor="let opt of moduleOptions" class="state-select__option" [class.is-selected]="moduleFilter === opt.value"
                role="option" [attr.aria-selected]="moduleFilter === opt.value" (click)="selectModule(opt.value)">
                <tm-icon *ngIf="moduleFilter === opt.value" name="check" [size]="12" class="state-select__option-check" />
                <span class="state-select__option-label">{{ opt.label }}</span>
              </li>
            </ul>
          </div>

          <!-- Paid via -->
          <div class="state-select" [class.has-value]="paidVia !== 'all'" [class.is-open]="paidOpen">
            <button type="button" class="state-select__trigger" (click)="togglePaidMenu($event)"
              [attr.aria-expanded]="paidOpen" aria-haspopup="listbox" aria-label="Paid via filter">
              <span class="state-select__icon" aria-hidden="true"><tm-icon name="rupee" [size]="14" /></span>
              <span class="state-select__value">{{ paidLabel() }}</span>
              <tm-icon name="chevron-down" [size]="12" class="state-select__caret" />
            </button>
            <ul class="state-select__menu" *ngIf="paidOpen" role="listbox" (click)="$event.stopPropagation()">
              <li class="state-select__option" [class.is-selected]="paidVia === 'all'" role="option"
                [attr.aria-selected]="paidVia === 'all'" (click)="selectPaid('all')">
                <tm-icon *ngIf="paidVia === 'all'" name="check" [size]="12" class="state-select__option-check" />
                <span class="state-select__option-label">Any payment</span>
              </li>
              <li *ngFor="let opt of paidOptions" class="state-select__option" [class.is-selected]="paidVia === opt.value"
                role="option" [attr.aria-selected]="paidVia === opt.value" (click)="selectPaid(opt.value)">
                <tm-icon *ngIf="paidVia === opt.value" name="check" [size]="12" class="state-select__option-check" />
                <span class="state-select__option-label">{{ opt.label }}</span>
              </li>
            </ul>
          </div>

          <!-- Date shortcut pills -->
          <div class="date-pills">
            <button type="button" class="date-pill" [class.date-pill--on]="activePreset === 'today'" (click)="setPresetDate('today')">Today</button>
            <button type="button" class="date-pill" [class.date-pill--on]="activePreset === 'yesterday'" (click)="setPresetDate('yesterday')">Yesterday</button>
            <button type="button" class="date-pill" [class.date-pill--on]="activePreset === '7days'" (click)="setPresetDate('7days')">7 Days</button>
            <button type="button" class="date-pill" [class.date-pill--on]="activePreset === 'thisMonth'" (click)="setPresetDate('thisMonth')">This Month</button>
          </div>

          <!-- Date range -->
          <div class="date-range" [class.has-value]="dateFrom || dateTo">
            <span class="date-range__icon" aria-hidden="true"><tm-icon name="calendar" [size]="14" /></span>
            <input #rangeInput type="text" readonly class="date-range__input" placeholder="Any date"
              [value]="rangeLabel" aria-label="Filter by refund date range" />
            <button *ngIf="dateFrom || dateTo" type="button" class="date-range__clear"
              (click)="clearDateRange(); $event.stopPropagation()" aria-label="Clear date range">
              <tm-icon name="x" [size]="12" />
            </button>
          </div>

          <button type="button" class="export-btn" (click)="exportCsv()" title="Export refunds to CSV">
            <tm-icon name="download" [size]="14" /> Export CSV
          </button>
        </div>
      </div>

      <!-- Active filter pills -->
      <div class="pills" *ngIf="hasActiveFilters">
        <span class="filter-pill" *ngIf="search.trim()">
          <span class="filter-pill__icon"><tm-icon name="search" [size]="11" /></span>
          <span class="filter-pill__label">Search</span>
          <span class="filter-pill__value">{{ search }}</span>
          <button type="button" class="filter-pill__close" (click)="clearSearch()" aria-label="Clear search"><tm-icon name="x" [size]="12" /></button>
        </span>
        <span class="filter-pill" *ngIf="moduleFilter !== 'all'">
          <span class="filter-pill__icon"><tm-icon name="car" [size]="11" /></span>
          <span class="filter-pill__label">Type</span>
          <span class="filter-pill__value">{{ moduleLabel() }}</span>
          <button type="button" class="filter-pill__close" (click)="selectModule('all')" aria-label="Clear type filter"><tm-icon name="x" [size]="12" /></button>
        </span>
        <span class="filter-pill" *ngIf="paidVia !== 'all'">
          <span class="filter-pill__icon"><tm-icon name="rupee" [size]="11" /></span>
          <span class="filter-pill__label">Paid via</span>
          <span class="filter-pill__value">{{ paidLabel() }}</span>
          <button type="button" class="filter-pill__close" (click)="selectPaid('all')" aria-label="Clear payment filter"><tm-icon name="x" [size]="12" /></button>
        </span>
        <span class="filter-pill" *ngIf="dateFrom || dateTo">
          <span class="filter-pill__icon"><tm-icon name="calendar" [size]="11" /></span>
          <span class="filter-pill__label">Date</span>
          <span class="filter-pill__value">{{ dateFrom }} → {{ dateTo }}</span>
          <button type="button" class="filter-pill__close" (click)="clearDateRange()" aria-label="Clear date range"><tm-icon name="x" [size]="12" /></button>
        </span>
        <button type="button" class="pills__clear" (click)="clearAllFilters()">Clear all</button>
      </div>

      <div class="state" *ngIf="loading || searchLoading">Filtering the refund register…</div>
      <div class="state state--error" *ngIf="!loading && !searchLoading && error">{{ error }}</div>

      <div class="state state--empty" *ngIf="!loading && !searchLoading && !error && !visibleRows.length">
        <tm-icon name="check" [size]="22" />
        <strong>{{ emptyTitle }}</strong>
        <span>{{ emptyHint }}</span>
      </div>

      <div class="tbl" *ngIf="!loading && !searchLoading && visibleRows.length">
        <div class="tbl__count">Showing {{ visibleRows.length }} {{ visibleRows.length === 1 ? 'refund' : 'refunds' }}</div>
        <table>
          <thead>
            <tr>
              <th>Booking</th>
              <th>Customer</th>
              <th>Why the refund</th>
              <th>Paid via</th>
              <th class="num">Amount</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let row of visibleRows" [class.row--aged]="isAged(row)">
              <td>
                <div class="stack">
                  <span class="strong">
                    <span class="mod" [class.mod--shuttle]="row.module === 'shuttle'">{{ row.module === 'fixed' ? 'Fixed' : 'Shuttle' }}</span>
                    #{{ row.id }}
                  </span>
                  <span class="muted">{{ row.trip_label }}</span>
                  <span class="muted" *ngIf="row.travel_date">Travel {{ row.travel_date }}</span>
                </div>
              </td>
              <td>
                <div class="cust">
                  <span class="cust__avatar">{{ initials(row.customer_name) }}</span>
                  <div class="stack">
                    <span class="strong">{{ row.customer_name || 'Customer' }}</span>
                    <span class="muted">{{ row.customer_phone || '—' }}</span>
                    <span class="muted" *ngIf="row.driver_name">Driver: {{ row.driver_name }}</span>
                  </div>
                </div>
              </td>
              <td class="reason">{{ row.reason }}</td>
              <td>
                <span class="paychip" [ngClass]="'paychip--' + (row.payment_method === 'wallet' ? 'wallet' : 'razorpay')">
                  <span class="paychip__dot"></span>{{ row.payment_method === 'wallet' ? 'Wallet' : 'Razorpay' }}
                </span>
              </td>
              <td class="num amount">₹ {{ row.amount | number:'1.2-2' }}</td>
              <td>
                <div class="stack">
                  <ng-container *ngIf="row.state === 'due'">
                    <tm-status-pill [tone]="isAged(row) ? 'danger' : 'warning'">Due</tm-status-pill>
                    <span class="muted" [class.aged]="isAged(row)">Owed for {{ owedFor(row) }}</span>
                  </ng-container>
                  <ng-container *ngIf="row.state === 'refunded'">
                    <tm-status-pill tone="success">Refunded</tm-status-pill>
                    <span class="muted" *ngIf="row.refund_method_label">via {{ row.refund_method_label }}</span>
                    <span class="muted" *ngIf="row.refund_reference">Ref {{ row.refund_reference }}</span>
                    <span class="muted" *ngIf="row.refunded_by_name">by {{ row.refunded_by_name }} · {{ formatDate(row.refunded_at) }}</span>
                  </ng-container>
                  <ng-container *ngIf="row.state === 'rejected'">
                    <tm-status-pill tone="neutral">No refund</tm-status-pill>
                  </ng-container>
                </div>
              </td>
              <td class="act">
                <tm-button *ngIf="row.state === 'due'" variant="green" size="sm" (clicked)="openMark(row)">Mark refunded</tm-button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <tm-drawer
        [open]="!!markRow"
        title="Mark refund as sent"
        subtitle="Record money you've already sent — the customer is notified instantly."
        [width]="440"
        (closed)="closeMark()"
      >
        <div slot="body" class="form">
          <ng-container *ngIf="markRow as m">
            <!-- Who / what this refund is for -->
            <div class="who">
              <span class="who__avatar">{{ initials(m.customer_name) }}</span>
              <div class="who__meta">
                <span class="who__name">{{ m.customer_name || 'Customer' }}</span>
                <span class="who__sub">{{ m.customer_phone || '—' }}</span>
              </div>
              <span class="who__chip" [class.who__chip--shuttle]="m.module === 'shuttle'">
                {{ m.module === 'fixed' ? 'Fixed' : 'Shuttle' }} #{{ m.id }}
              </span>
            </div>
            <p class="who__reason">{{ m.reason }}</p>

            <div class="lockedAmount">
              <span class="lockedAmount__label">Amount owed (locked)</span>
              <span class="lockedAmount__value">₹ {{ m.amount | number:'1.2-2' }}</span>
            </div>

            <label class="field">
              <span>How was it sent? <em class="req">*</em></span>
              <select [(ngModel)]="markMethod">
                <option *ngFor="let opt of methodOptions" [value]="opt.value">{{ opt.label }}</option>
              </select>
            </label>

            <label class="field">
              <span>Reference — UPI txn id / bank ref / rfnd_… <em class="req">*</em></span>
              <input type="text" [(ngModel)]="markReference" placeholder="e.g. 4839201· / rfnd_NqA3…" />
            </label>

            <label class="field">
              <span>Note <em class="req">*</em></span>
              <textarea rows="3" [(ngModel)]="markNote" placeholder="Shown to the customer — e.g. 'Refunded to your GPay 98••••10'."></textarea>
              <small class="field__help"><tm-icon name="eye" [size]="12" /> The customer sees this note on their Refunds page.</small>
            </label>

            <p class="form__missing" *ngIf="!canSubmit">All three fields are required before you can record the refund.</p>
          </ng-container>
        </div>
        <div slot="footer">
          <tm-button variant="ghost" size="sm" (clicked)="closeMark()">Cancel</tm-button>
          <tm-button variant="green" size="sm" [disabled]="saving || !canSubmit" (clicked)="submitMark()">
            {{ saving ? 'Saving…' : 'Money sent — record it' }}
          </tm-button>
        </div>
      </tm-drawer>
    </div>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 14px; }
    .page__hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .page__title { margin: 0; font-size: 24px; line-height: 1.1; font-weight: 850; color: var(--tm-text); }
    .page__sub { margin: 6px 0 0; max-width: 640px; color: var(--tm-text-muted); font-size: 13px; line-height: 1.45; }

    .auto-banner { display: flex; align-items: center; gap: 12px; padding: 12px 14px;
      border: 1px solid var(--tm-warning-fg, #92400e); border-radius: var(--tm-radius-lg);
      background: var(--tm-warning-bg, #fff4e5); }
    .auto-banner--clear { border-color: var(--tm-line); background: var(--tm-green-tint); }
    .auto-banner__icon { display: inline-flex; flex: none; color: var(--tm-warning-fg, #92400e); }
    .auto-banner--clear .auto-banner__icon { color: var(--tm-green-deep); }
    .auto-banner__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .auto-banner__body strong { font-size: 13.5px; font-weight: 800; color: var(--tm-text); }
    .auto-banner__body span { font-size: 12px; color: var(--tm-text-muted); }
    .hero__side { display: flex; align-items: center; gap: 14px; }
    .total { text-align: right; display: flex; flex-direction: column; }
    .total__label { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--tm-text-muted); }
    @keyframes numberPulse {
      0% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.08); opacity: 0.6; }
      100% { transform: scale(1); opacity: 1; }
    }
    .total__value--pulse { animation: numberPulse 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); }
    .total__value { font-size: 20px; font-weight: 800; color: var(--tm-danger, #B42318); font-variant-numeric: tabular-nums; }
    .total__value--zero { color: var(--tm-green, #12805c); }
    .total__count { font-size: 11px; color: var(--tm-text-muted); }

    .tabs { display: flex; gap: 6px; }
    .tab { border: 1px solid var(--tm-line); background: var(--tm-surface); color: var(--tm-text-muted);
      border-radius: 999px; padding: 6px 14px; font: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer; }
    .tab--on { background: var(--tm-text); color: var(--tm-surface); border-color: var(--tm-text); }
    .tab__n { display: inline-block; min-width: 18px; padding: 0 5px; margin-left: 4px; border-radius: 999px;
      background: var(--tm-danger, #B42318); color: #fff; font-size: 11px; text-align: center; }

    /* ---------- Filter toolbar ---------- */
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .search { display: inline-flex; align-items: center; gap: 8px; flex: 1 1 260px; min-width: 220px; max-width: 360px;
      padding: 8px 10px 8px 12px; border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-md); background: transparent;
      transition: border-color var(--tm-duration-fast) var(--tm-ease); }
    .search:focus-within { border-color: var(--tm-ink); }
    .search__icon { color: var(--tm-text-muted); display: inline-flex; }
    .search__input { flex: 1; appearance: none; background: transparent; border: 0; outline: 0;
      font-family: var(--tm-font-body); font-size: 13px; font-weight: 600; color: var(--tm-text); padding: 0; }
    .search__input::placeholder { color: var(--tm-text-soft); }
    .search__clear { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px;
      border-radius: 50%; background: var(--tm-canvas-2); color: var(--tm-text-muted); }
    .search__clear:hover { background: var(--tm-ink); color: #fff; }
    .filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

    /* ---------- Custom state-select dropdown ---------- */
    .state-select { position: relative; display: inline-block; }
    .state-select__trigger { display: inline-flex; align-items: center; gap: 8px; padding: 9px 14px;
      border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-md); background: transparent;
      font-family: var(--tm-font-body); font-size: 13px; font-weight: 700; color: var(--tm-text); cursor: pointer; line-height: 1.2;
      transition: border-color var(--tm-duration-fast) var(--tm-ease), background var(--tm-duration-fast) var(--tm-ease); }
    .state-select__trigger:hover { border-color: var(--tm-ink); }
    .state-select.is-open .state-select__trigger { border-color: var(--tm-ink); }
    .state-select.has-value .state-select__trigger { background: var(--tm-green-tint); border-color: var(--tm-green-deep); }
    .state-select__icon { color: var(--tm-text-muted); display: inline-flex; }
    .state-select.has-value .state-select__icon { color: var(--tm-green-deep); }
    .state-select__value { min-width: 92px; text-align: left; }
    .state-select__caret { color: var(--tm-text-soft); transition: transform var(--tm-duration-fast) var(--tm-ease); }
    .state-select.is-open .state-select__caret { transform: rotate(180deg); }
    .state-select.has-value .state-select__caret { color: var(--tm-green-deep); }
    .state-select__menu { position: absolute; top: calc(100% + 6px); left: 0; right: 0; min-width: 190px; margin: 0; padding: 6px;
      list-style: none; background: var(--tm-surface); border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-md);
      box-shadow: var(--tm-shadow-pop); z-index: 1100; max-height: 320px; overflow-y: auto;
      animation: state-select-in 140ms var(--tm-ease) both; }
    @keyframes state-select-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
    .state-select__option { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: var(--tm-radius-sm);
      font-size: 12px; font-weight: 600; color: var(--tm-text); cursor: pointer;
      transition: background var(--tm-duration-fast) var(--tm-ease); }
    .state-select__option:hover { background: var(--tm-canvas-2); }
    .state-select__option.is-selected { background: var(--tm-green-tint); color: var(--tm-green-deep); font-weight: 700; }
    .state-select__option-check { color: var(--tm-green-deep); flex-shrink: 0; }
    .state-select__option-label { flex: 1; }

    .date-pills { display: inline-flex; align-items: center; gap: 4px; background: var(--tm-canvas-subtle, #f3f4f6); padding: 3px; border-radius: var(--tm-radius-md); }
    .date-pill { border: 0; background: transparent; padding: 5px 11px; border-radius: var(--tm-radius-sm); font-size: 11.5px; font-weight: 700; color: var(--tm-text-muted); cursor: pointer; transition: all 0.15s ease; white-space: nowrap; }
    .date-pill:hover { color: var(--tm-text); }
    .date-pill--on { background: var(--tm-surface); color: var(--tm-text); font-weight: 850; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }

    .export-btn { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px; background: #059669; color: #ffffff; border: 0; border-radius: var(--tm-radius-md); font-size: 12px; font-weight: 800; cursor: pointer; transition: background 0.15s ease, transform 0.1s ease; box-shadow: 0 1px 3px rgba(5, 150, 105, 0.25); white-space: nowrap; }
    .export-btn:hover { background: #047857; transform: translateY(-1px); }
    .export-btn:active { transform: translateY(0); }

    /* ---------- Date range ---------- */
    .date-range { display: inline-flex; align-items: center; gap: 8px; padding: 8px 8px 8px 14px;
      border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-md); background: transparent; line-height: 1;
      transition: border-color var(--tm-duration-fast) var(--tm-ease), background var(--tm-duration-fast) var(--tm-ease); cursor: pointer; }
    .date-range:focus-within { border-color: var(--tm-ink); }
    .date-range.has-value { background: var(--tm-green-tint); border-color: var(--tm-green-deep); }
    .date-range__icon { color: var(--tm-text-muted); display: inline-flex; }
    .date-range.has-value .date-range__icon { color: var(--tm-green-deep); }
    .date-range__input { appearance: none; -webkit-appearance: none; background: transparent; border: 0; outline: 0;
      font-family: var(--tm-font-mono); font-size: 12px; font-weight: 600; color: var(--tm-text); padding: 0; min-width: 150px;
      cursor: pointer; line-height: 1.2; }
    .date-range__input::placeholder { color: var(--tm-text-soft); }
    .date-range__clear { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px;
      border-radius: 50%; background: var(--tm-canvas-2); color: var(--tm-text-muted);
      transition: background var(--tm-duration-fast) var(--tm-ease), color var(--tm-duration-fast) var(--tm-ease); }
    .date-range__clear:hover { background: var(--tm-ink); color: #fff; }

    :host ::ng-deep .daterangepicker { font-family: var(--tm-font-body) !important; border-radius: var(--tm-radius-md);
      border: 1px solid var(--tm-line-2); box-shadow: var(--tm-shadow-pop); }
    :host ::ng-deep .daterangepicker .btn-primary, :host ::ng-deep .daterangepicker .btn-success {
      background: var(--tm-ink); border-color: var(--tm-ink); border-radius: var(--tm-radius-sm); font-weight: 700; }
    :host ::ng-deep .daterangepicker .ranges li.active, :host ::ng-deep .daterangepicker td.active,
    :host ::ng-deep .daterangepicker td.active:hover { background: var(--tm-ink); color: #fff; }
    :host ::ng-deep .daterangepicker td.in-range { background: var(--tm-green-tint); color: var(--tm-green-deep); }

    /* ---------- Filter pills ---------- */
    .pills { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
    .filter-pill { display: inline-flex; align-items: center; gap: 8px; padding: 6px 6px 6px 12px;
      border-radius: var(--tm-radius-pill); background: var(--tm-surface); border: 1px solid var(--tm-line-2);
      font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .filter-pill__icon { display: inline-flex; color: var(--tm-text-muted); }
    .filter-pill__label { font-size: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--tm-text-muted); }
    .filter-pill__value { font-family: var(--tm-font-mono); font-weight: 700; color: var(--tm-text); }
    .filter-pill__close { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px;
      border-radius: 50%; background: var(--tm-canvas-2); color: var(--tm-text-muted);
      transition: background var(--tm-duration-fast) var(--tm-ease), color var(--tm-duration-fast) var(--tm-ease); }
    .filter-pill__close:hover { background: var(--tm-ink); color: #fff; }
    .pills__clear { border: 0; background: transparent; color: var(--tm-text-muted); font: inherit; font-size: 12px;
      font-weight: 800; text-decoration: underline; cursor: pointer; padding: 4px 6px; }
    .pills__clear:hover { color: var(--tm-text); }

    .state { padding: 28px; text-align: center; color: var(--tm-text-muted); font-size: 13.5px;
      background: var(--tm-surface); border: 1px solid var(--tm-line); border-radius: var(--tm-radius-lg); }
    .state--error { color: var(--tm-danger, #B42318); }
    .state--empty { display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .state--empty strong { color: var(--tm-text); }

    .tbl { background: var(--tm-surface); border: 1px solid var(--tm-line); border-radius: var(--tm-radius-lg); overflow-x: auto; }
    .tbl__count { padding: 8px 14px; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase;
      color: var(--tm-text-muted); font-weight: 800; border-bottom: 1px solid var(--tm-line); }
    table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 880px; }
    th { text-align: left; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--tm-text-muted);
      padding: 10px 14px; border-bottom: 1px solid var(--tm-line); }
    td { padding: 10px 14px; border-bottom: 1px solid var(--tm-line); vertical-align: top; }
    tr:last-child td { border-bottom: 0; }
    .row--aged td { background: color-mix(in srgb, var(--tm-danger, #B42318) 6%, transparent); }
    .stack { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .strong { font-weight: 800; color: var(--tm-text); }
    .muted { color: var(--tm-text-muted); font-size: 11px; overflow-wrap: anywhere; }
    .muted.aged { color: var(--tm-danger, #B42318); font-weight: 800; }
    .mod { display: inline-block; padding: 1px 7px; margin-right: 4px; border-radius: 999px; font-size: 10.5px;
      background: var(--tm-info-bg, #eef4ff); color: var(--tm-info-fg, #1d4ed8); }
    .mod--shuttle { background: var(--tm-warning-bg, #fff4e5); color: var(--tm-warning-fg, #92400e); }
    .reason { max-width: 240px; color: var(--tm-text); font-size: 12.5px; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .amount { font-weight: 800; color: var(--tm-text); white-space: nowrap; }
    .act { text-align: right; width: 1%; white-space: nowrap; }

    /* Customer cell — avatar + stacked identity (transactions look) */
    .cust { display: flex; align-items: flex-start; gap: 10px; }
    .cust__avatar { flex: none; width: 34px; height: 34px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--tm-green-tint); color: var(--tm-green-deep);
      font-size: 12px; font-weight: 800; letter-spacing: 0.02em; }

    /* Payment brand chip */
    .paychip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px;
      border-radius: var(--tm-radius-pill); font-size: 11.5px; font-weight: 800; white-space: nowrap; }
    .paychip__dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
    .paychip--razorpay { background: var(--tm-info-bg); color: var(--tm-info-fg); }
    .paychip--razorpay .paychip__dot { background: var(--tm-info); }
    .paychip--wallet { background: var(--tm-green-tint); color: var(--tm-green-deep); }
    .paychip--wallet .paychip__dot { background: var(--tm-green); }

    /* Drawer — "who" summary card at the top of the form */
    .who { display: flex; align-items: center; gap: 12px; }
    .who__avatar { flex: none; width: 42px; height: 42px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--tm-green-tint); color: var(--tm-green-deep); font-size: 15px; font-weight: 800; }
    .who__meta { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .who__name { font-weight: 800; color: var(--tm-text); font-size: 14px; }
    .who__sub { font-size: 12px; color: var(--tm-text-muted); }
    .who__chip { flex: none; padding: 3px 9px; border-radius: var(--tm-radius-pill); font-size: 11px; font-weight: 800;
      background: var(--tm-info-bg); color: var(--tm-info-fg); white-space: nowrap; }
    .who__chip--shuttle { background: var(--tm-warning-bg); color: var(--tm-warning-fg); }
    .who__reason { margin: 0; font-size: 12.5px; color: var(--tm-text-muted); line-height: 1.5;
      background: var(--tm-canvas); border-radius: var(--tm-radius-md); padding: 10px 12px; }

    .form { display: flex; flex-direction: column; gap: 14px; }
    .form__hint { margin: 0; font-size: 12.5px; color: var(--tm-text-muted); line-height: 1.5; }
    .lockedAmount { display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
      padding: 10px 12px; border: 1px dashed var(--tm-line); border-radius: var(--tm-radius-md); background: var(--tm-canvas); }
    .lockedAmount__label { font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--tm-text-muted); font-weight: 800; }
    .lockedAmount__value { font-size: 18px; font-weight: 850; color: var(--tm-text); font-variant-numeric: tabular-nums; }
    .field { display: flex; flex-direction: column; gap: 6px; color: var(--tm-text-muted); font-size: 12px; font-weight: 800; }
    .field input, .field textarea, .field select { border: 1px solid var(--tm-line); border-radius: var(--tm-radius-md);
      background: var(--tm-canvas); color: var(--tm-text); padding: 9px 10px; font: inherit; font-weight: 650; }
    .req { color: var(--tm-danger, #B42318); font-style: normal; font-weight: 900; }
    .field__help { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700;
      color: var(--tm-text-soft); }
    .form__missing { margin: 0; font-size: 12px; font-weight: 700; color: var(--tm-danger, #B42318); }

    @media (max-width: 760px) { .page__hero { flex-direction: column; } .toolbar { flex-direction: column; align-items: stretch; } .search { max-width: none; } }
  `],
})
export class AdminRefundsComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('rangeInput', { static: false }) rangeInput?: ElementRef<HTMLInputElement>;

  rows: RefundRow[] = [];
  totalDue = 0;
  dueCount = 0;
  /** True once refunds are automatic — turns this page from worklist to audit trail. */
  autoRefunds = false;
  loading = false;
  error: string | null = null;
  filter: 'due' | 'refunded' | 'all' = 'due';

  // Extra filters (all client-side over the loaded register)
  search = '';
  moduleFilter: 'all' | 'fixed' | 'shuttle' = 'all';
  paidVia: 'all' | 'razorpay' | 'wallet' = 'all';
  dateFrom = moment().startOf('month').format('YYYY-MM-DD');
  dateTo = moment().format('YYYY-MM-DD');
  activePreset: 'today' | 'yesterday' | '7days' | 'thisMonth' | null = 'thisMonth';
  moduleOpen = false;
  paidOpen = false;

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

    this.triggerCardPulse();
  }

  exportCsv(): void {
    const rows = this.visibleRows;
    if (!rows.length) return;
    const headers = ['Refund ID', 'Trip/Booking', 'Customer Name', 'Customer Phone', 'Amount (INR)', 'Reason', 'Payment Method', 'State', 'Date'];
    const csvRows = [headers.join(',')];
    for (const r of rows) {
      const line = [
        r.id ?? '',
        `"${(r.trip_label || '').replace(/"/g, '""')}"`,
        `"${(r.customer_name || '').replace(/"/g, '""')}"`,
        `"${r.customer_phone || ''}"`,
        r.amount || 0,
        `"${(r.reason || '').replace(/"/g, '""')}"`,
        `"${r.payment_method || ''}"`,
        `"${r.state || ''}"`,
        `"${r.created_at || ''}"`,
      ];
      csvRows.push(line.join(','));
    }
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `refunds-export-${new Date().toISOString().substring(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  markRow: RefundRow | null = null;
  markMethod = 'gpay';
  markReference = '';
  markNote = '';
  saving = false;

  methodOptions = METHOD_OPTIONS;
  moduleOptions = MODULE_OPTIONS;
  paidOptions = PAID_OPTIONS;

  constructor(private api: ApiService, private toast: ToastService, private zone: NgZone) {}

  ngOnInit(): void {
    this.load();
  }

  ngAfterViewInit(): void {
    this.initDateRangePicker();
  }

  ngOnDestroy(): void {
    this.destroyDateRangePicker();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.api.get<{ rows: RefundRow[]; total_due: number; due_count: number; auto_refunds?: boolean }>('/admin/refunds?status=all').subscribe({
      next: (res) => {
        this.rows = res?.rows ?? [];
        this.totalDue = res?.total_due ?? 0;
        this.dueCount = res?.due_count ?? 0;
        this.autoRefunds = !!res?.auto_refunds;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load the refund register.';
        this.loading = false;
      },
    });
  }

  get visibleRows(): RefundRow[] {
    const q = this.search.trim().toLowerCase();
    const from = this.dateFrom || null;
    const to = this.dateTo || null;

    return this.rows.filter((r) => {
      // Status tab
      if (this.filter === 'due' && r.state !== 'due') return false;
      if (this.filter === 'refunded' && r.state !== 'refunded') return false;
      // Module
      if (this.moduleFilter !== 'all' && r.module !== this.moduleFilter) return false;
      // Paid via (wallet vs razorpay)
      if (this.paidVia !== 'all') {
        const isWallet = r.payment_method === 'wallet';
        if (this.paidVia === 'wallet' && !isWallet) return false;
        if (this.paidVia === 'razorpay' && isWallet) return false;
      }
      // Date range on the row's activity date
      if (from || to) {
        const d = this.rowDate(r);
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
      }
      // Search
      if (q) {
        const hay = `${r.customer_name || ''} ${r.customer_phone || ''} ${r.id} ${r.trip_label} ${r.driver_name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  /** The date a row is filtered on: when it was refunded, else when the debt arose. */
  private rowDate(r: RefundRow): string | null {
    const iso = r.state === 'refunded' ? (r.refunded_at || r.owed_since) : (r.owed_since || r.created_at);
    return iso ? iso.substring(0, 10) : null;
  }

  get hasActiveFilters(): boolean {
    return !!this.search.trim() || this.moduleFilter !== 'all' || this.paidVia !== 'all' || !!this.dateFrom || !!this.dateTo;
  }

  get rangeLabel(): string {
    if (this.dateFrom && this.dateTo) return `${this.dateFrom} → ${this.dateTo}`;
    return '';
  }

  get emptyTitle(): string {
    if (this.hasActiveFilters) return 'No refunds match these filters';
    return this.filter === 'due' ? 'Nobody is owed a refund' : 'Nothing here yet';
  }

  get emptyHint(): string {
    if (this.hasActiveFilters) return 'Try widening the date range or clearing a filter.';
    return this.filter === 'due'
      ? 'Every cancelled paid booking has been refunded and recorded.'
      : 'Rows appear here as refunds are owed and settled.';
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

  get filteredTotalDue(): number {
    return this.visibleRows
      .filter((r) => r.state === 'due')
      .reduce((sum, r) => sum + Number(r.amount || 0), 0);
  }

  get filteredDueCount(): number {
    return this.visibleRows.filter((r) => r.state === 'due').length;
  }

  setFilter(f: 'due' | 'refunded' | 'all'): void {
    this.filter = f;
    this.triggerCardPulse();
  }

  // ── Search ──────────────────────────────────────────────────────
  onSearchChange(): void {
    this.searchLoading = true;
    this.triggerCardPulse();
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.zone.run(() => {
        this.searchLoading = false;
      });
    }, 200);
  }

  clearSearch(): void {
    this.search = '';
    this.triggerCardPulse();
  }

  // ── Module ──────────────────────────────────────────────────────
  moduleLabel(): string {
    return this.moduleFilter === 'all' ? 'All bookings'
      : this.moduleOptions.find((o) => o.value === this.moduleFilter)?.label ?? 'All bookings';
  }
  toggleModuleMenu(event: MouseEvent): void { event.stopPropagation(); this.paidOpen = false; this.moduleOpen = !this.moduleOpen; }
  selectModule(value: 'all' | 'fixed' | 'shuttle'): void { this.moduleOpen = false; this.moduleFilter = value; this.triggerCardPulse(); }

  // ── Paid via ────────────────────────────────────────────────────
  paidLabel(): string {
    return this.paidVia === 'all' ? 'Any payment'
      : this.paidOptions.find((o) => o.value === this.paidVia)?.label ?? 'Any payment';
  }
  togglePaidMenu(event: MouseEvent): void { event.stopPropagation(); this.moduleOpen = false; this.paidOpen = !this.paidOpen; }
  selectPaid(value: 'all' | 'razorpay' | 'wallet'): void { this.paidOpen = false; this.paidVia = value; this.triggerCardPulse(); }

  clearAllFilters(): void {
    this.search = '';
    this.moduleFilter = 'all';
    this.paidVia = 'all';
    this.clearDateRange();
  }

  // ── Daterangepicker ─────────────────────────────────────────────
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
        startDate: moment(this.dateFrom),
        endDate: moment(this.dateTo),
        locale: { format: 'YYYY-MM-DD', cancelLabel: 'Clear', applyLabel: 'Apply' },
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

  clearDateRange(): void {
    this.dateFrom = '';
    this.dateTo = '';
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.moduleOpen = false;
    this.paidOpen = false;
  }
  @HostListener('document:keydown.escape')
  onDocumentEscape(): void {
    this.moduleOpen = false;
    this.paidOpen = false;
  }

  /** A due refund older than 24 hours needs attention — highlight it red. */
  isAged(row: RefundRow): boolean {
    if (row.state !== 'due' || !row.owed_since) return false;
    return Date.now() - new Date(row.owed_since).getTime() > 24 * 60 * 60 * 1000;
  }

  owedFor(row: RefundRow): string {
    if (!row.owed_since) return '—';
    const mins = Math.max(0, Math.floor((Date.now() - new Date(row.owed_since).getTime()) / 60000));
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 48) return `${hours} h`;
    return `${Math.floor(hours / 24)} days`;
  }

  formatDate(iso?: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  /** Up to 2 initials for the customer avatar. */
  initials(name?: string | null): string {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '👤';
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  openMark(row: RefundRow): void {
    this.markRow = row;
    this.markMethod = 'gpay';
    this.markReference = '';
    this.markNote = '';
  }

  closeMark(): void {
    if (this.saving) return;
    this.markRow = null;
  }

  /** All three fields must be filled before the refund can be recorded. */
  get canSubmit(): boolean {
    return !!this.markMethod && !!this.markReference.trim() && !!this.markNote.trim();
  }

  submitMark(): void {
    if (!this.markRow || this.saving || !this.canSubmit) return;
    this.saving = true;
    const row = this.markRow;
    this.api.post<{ row: RefundRow; message: string }>(
      `/admin/refunds/${row.module}/${row.id}/mark-refunded`,
      {
        method: this.markMethod,
        reference: this.markReference.trim() || null,
        note: this.markNote.trim() || null,
      },
    ).subscribe({
      next: (res) => {
        this.saving = false;
        this.markRow = null;
        this.toast.success(res?.message || 'Refund recorded — the customer has been notified.');
        // Replace the row in place so the register visibly flips to Refunded.
        const idx = this.rows.findIndex((r) => r.key === row.key);
        if (idx >= 0 && res?.row) this.rows[idx] = res.row;
        this.dueCount = this.rows.filter((r) => r.state === 'due').length;
        this.totalDue = this.rows.filter((r) => r.state === 'due').reduce((sum, r) => sum + (r.amount || 0), 0);
      },
      error: (err) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Could not record the refund.');
      },
    });
  }
}
