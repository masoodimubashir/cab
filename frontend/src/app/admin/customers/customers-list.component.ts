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
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import $ from 'jquery';
import moment from 'moment';
import 'daterangepicker';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import {
  ButtonComponent,
  ColumnComponent,
  DataTableComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
} from '../../ui';

interface CustomerRow {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  last_login_at: string | null;
  last_ride_at: string | null;
  total_rides: number;
  city: string | null;
  is_suspended: boolean;
}

@Component({
  selector: 'app-customers-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    DatePipe,
    ButtonComponent,
    ColumnComponent,
    DataTableComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
  ],
  template: `
    <div class="page">
      <!-- =================== Hero =================== -->
      <header class="page__hero">
        <div class="page__hero-left">
          <span class="page__eyebrow">
            <span class="page__eyebrow-dot" aria-hidden="true"></span> Customers
          </span>
          <p class="page__subtitle">
            Manage riders, send OTPs and import bulk users.
          </p>
        </div>
        <div class="page__hero-right">
          <tm-button variant="outline" icon="key" (clicked)="openViewOtp()">
            Send OTP
          </tm-button>
          <tm-button variant="green" icon="upload" (clicked)="openImport()">
            Import users
          </tm-button>
        </div>
      </header>

      <!-- =================== Reusable table =================== -->
      <tm-data-table
        [rows]="rows"
        [total]="total"
        [page]="page"
        [pageSize]="pageSize"
        [pageSizes]="[10, 25, 50, 100]"
        [loading]="loading"
        emptyTitle="No customers"
        emptyHint="Try a different search, or adjust the filters above."
        (pageChange)="onPageChange($event)"
        (pageSizeChange)="onPageSizeChange($event)"
      >
        <!-- Toolbar: search on the LEFT -->
        <tm-input
          slot="search"
          icon="search"
          placeholder="Phone, email or name"
          [(ngModel)]="search"
          (ngModelChange)="onSearchChange()"
        />

        <!-- Toolbar: filters on the RIGHT -->
        <ng-container slot="filters">
          <div class="seg">
            <button
              type="button"
              class="seg__btn"
              [class.is-active]="activeTab === 0"
              (click)="setTab(0)"
            >
              All
              <span class="seg__count" *ngIf="activeTab === 0">{{ total | number }}</span>
            </button>
            <button
              type="button"
              class="seg__btn"
              [class.is-active]="activeTab === 1"
              (click)="setTab(1)"
            >
              With docs
              <span class="seg__count" *ngIf="activeTab === 1">{{ total | number }}</span>
            </button>
          </div>

          <!-- Date range picker (Dan Grossman daterangepicker) — filters by last_ride_at -->
          <div class="date-range" [class.has-value]="dateFrom || dateTo">
            <span class="date-range__icon" aria-hidden="true">
              <tm-icon name="calendar" [size]="14" />
            </span>
            <input
              #rangeInput
              type="text"
              readonly
              class="date-range__input"
              [placeholder]="'Last ride · any date'"
              [value]="rangeLabel"
              aria-label="Filter by last ride date range"
            />
            <button
              *ngIf="dateFrom || dateTo"
              type="button"
              class="date-range__clear"
              (click)="clearDateRange(); $event.stopPropagation()"
              aria-label="Clear date range"
            >
              <tm-icon name="x" [size]="12" />
            </button>
          </div>
        </ng-container>

        <!-- Active filter pill — shown below the search/toolbar when applied -->
        <ng-container slot="banner">
          <span class="filter-pill" *ngIf="dateFrom || dateTo">
            <span class="filter-pill__icon">
              <tm-icon name="calendar" [size]="11" />
            </span>
            <span class="filter-pill__label">Last ride</span>
            <span class="filter-pill__value">
              {{ formatDate(dateFrom) }} → {{ formatDate(dateTo) }}
            </span>
            <button
              type="button"
              class="filter-pill__close"
              (click)="clearDateRange()"
              aria-label="Clear date range"
            >
              <tm-icon name="x" [size]="12" />
            </button>
          </span>
        </ng-container>

        <!-- ============ Columns ============ -->
        <tm-column key="id" label="User ID" width="100">
          <ng-template let-row>
            <span class="cell-id cell-id--static">#{{ row.id }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="name" label="User Name">
          <ng-template let-row>
            <div class="cell-user">
              <span class="cell-avatar">{{ initials(row.name) }}</span>
              <div class="cell-user__meta">
                <span class="cell-user__name">{{ row.name || 'Unnamed' }}</span>
                <span class="cell-user__sub" *ngIf="row.city">{{ row.city }}</span>
              </div>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="phone" label="Phone" width="160">
          <ng-template let-row>
            <span class="mono">{{ row.phone || '—' }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="email" label="Email">
          <ng-template let-row>
            <span [class.muted]="!row.email">{{ row.email || '—' }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="last_login_at" label="Last login" width="170">
          <ng-template let-row>
            <span class="mono">
              {{ row.last_login_at ? (row.last_login_at | date:'MMM d, HH:mm') : '—' }}
            </span>
          </ng-template>
        </tm-column>

        <tm-column key="last_ride_at" label="Last ride" width="130">
          <ng-template let-row>
            <span class="mono">
              {{ row.last_ride_at ? (row.last_ride_at | date:'MMM d') : '—' }}
            </span>
          </ng-template>
        </tm-column>

        <tm-column key="total_rides" label="Rides" width="100" align="right">
          <ng-template let-row>
            <span class="rides-chip" [class.is-zero]="!row.total_rides">
              {{ row.total_rides ?? 0 }}
            </span>
          </ng-template>
        </tm-column>

        <tm-column key="otp" label="" width="100" align="right">
          <ng-template let-row>
            <tm-button
              variant="outline"
              size="sm"
              icon="key"
              (clicked)="sendOtp(row)"
            >
              OTP
            </tm-button>
          </ng-template>
        </tm-column>

        <tm-column key="view" label="" width="60" align="right">
          <ng-template let-row>
            <div class="id-pop" [class.is-open]="openPopoverId === row.id">
              <button
                type="button"
                class="view-btn"
                [class.is-open]="openPopoverId === row.id"
                (click)="togglePopover(row.id, $event)"
                [attr.aria-expanded]="openPopoverId === row.id"
                aria-label="View customer details"
                title="View details"
              >
                <tm-icon name="eye" [size]="14" />
              </button>
              <div
                class="id-pop__panel"
                *ngIf="openPopoverId === row.id"
                role="dialog"
                (click)="$event.stopPropagation()"
                [style.top.px]="popoverTop"
                [style.left.px]="popoverLeft"
              >
                <header class="id-pop__head">
                  <span class="cell-avatar">{{ initials(row.name) }}</span>
                  <div class="id-pop__title">
                    <div class="id-pop__name">{{ row.name || 'Unnamed' }}</div>
                    <div class="id-pop__id mono">#{{ row.id }}</div>
                  </div>
                  <button
                    type="button"
                    class="id-pop__close"
                    (click)="closePopover()"
                    aria-label="Close"
                  >
                    <tm-icon name="x" [size]="12" />
                  </button>
                </header>
                <div class="id-pop__rows">
                  <div class="id-pop__row">
                    <span class="lbl">Phone</span>
                    <span class="mono">{{ row.phone || '—' }}</span>
                  </div>
                  <div class="id-pop__row">
                    <span class="lbl">Email</span>
                    <span [class.muted]="!row.email">{{ row.email || '—' }}</span>
                  </div>
                  <div class="id-pop__row" *ngIf="row.city">
                    <span class="lbl">City</span>
                    <span>{{ row.city }}</span>
                  </div>
                  <div class="id-pop__row">
                    <span class="lbl">Last login</span>
                    <span class="mono">
                      {{ row.last_login_at ? (row.last_login_at | date:'MMM d, HH:mm') : '—' }}
                    </span>
                  </div>
                  <div class="id-pop__row">
                    <span class="lbl">Last ride</span>
                    <span class="mono">
                      {{ row.last_ride_at ? (row.last_ride_at | date:'MMM d, y') : '—' }}
                    </span>
                  </div>
                  <div class="id-pop__row">
                    <span class="lbl">Total rides</span>
                    <span class="rides-chip" [class.is-zero]="!row.total_rides">
                      {{ row.total_rides ?? 0 }}
                    </span>
                  </div>
                </div>
                <footer class="id-pop__foot">
                  <button
                    type="button"
                    class="id-pop__link"
                    (click)="openProfile(row.id, $event)"
                  >
                    Open full profile <tm-icon name="arrow-right" [size]="12" />
                  </button>
                </footer>
              </div>
            </div>
          </ng-template>
        </tm-column>
      </tm-data-table>
    </div>

    <!-- ===== Send OTP modal ===== -->
    <tm-modal
      [open]="viewOtpOpen"
      title="Send OTP to user"
      (closed)="viewOtpOpen = false"
    >
      <div slot="body">
        <label class="lbl" for="otpPhoneInput">Phone number</label>
        <div class="phone-field">
          <div class="phone-field__cc">
            <select
              [(ngModel)]="otpCountryCode"
              class="phone-field__cc-select"
              aria-label="Country code"
            >
              <option *ngFor="let c of countryCodes" [ngValue]="c.dial">
                {{ c.flag }}  {{ c.dial }}
              </option>
            </select>
            <tm-icon name="chevron-down" [size]="12" class="phone-field__cc-caret" />
          </div>
          <input
            id="otpPhoneInput"
            type="tel"
            inputmode="numeric"
            class="phone-field__input"
            [(ngModel)]="otpPhone"
            placeholder="e.g. 9876543210"
            (keydown.enter)="submitOtp()"
          />
        </div>
        <p class="hint">
          A one-time code will be sent to the user's registered phone number.
        </p>
      </div>
      <ng-container slot="footer">
        <tm-button variant="ghost" (clicked)="viewOtpOpen = false">Cancel</tm-button>
        <tm-button variant="green" icon="send" [loading]="otpSending" (clicked)="submitOtp()">
          Send OTP
        </tm-button>
      </ng-container>
    </tm-modal>

    <!-- ===== Import users modal ===== -->
    <tm-modal
      [open]="importOpen"
      title="Import users"
      (closed)="closeImport()"
    >
      <div slot="body">
        <p class="hint">
          Upload a CSV with at least a <code>phone</code> column.
          Optional: <code>name</code>, <code>email</code>.
        </p>

        <label class="file-drop" for="csvInput">
          <span class="file-drop__icon">
            <tm-icon name="upload" [size]="18" />
          </span>
          <span class="file-drop__primary">
            {{ csvFileName || 'Choose a CSV file' }}
          </span>
          <span class="file-drop__sub" *ngIf="!csvFileName">CSV, max ~10MB</span>
          <input
            id="csvInput"
            #csvInput
            type="file"
            accept=".csv,.txt"
            (change)="onCsvSelected($event)"
          />
        </label>
      </div>
      <ng-container slot="footer">
        <tm-button variant="ghost" (clicked)="closeImport()">Cancel</tm-button>
        <tm-button variant="green" icon="upload" [loading]="importing"
                   [disabled]="!csvFile" (clicked)="submitImport()">
          Upload
        </tm-button>
      </ng-container>
    </tm-modal>
  `,
  styles: [`
    :host { display: block; }

    .page {
      display: flex;
      flex-direction: column;
      gap: var(--tm-space-5);
    }

    /* ---------- Hero ---------- */
    .page__hero {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--tm-space-4);
      flex-wrap: wrap;
    }
    .page__hero-left { min-width: 0; }
    .page__hero-left { min-width: 0; }
    .page__eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      margin-bottom: var(--tm-space-2);
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.02em;
      text-transform: none;
      color: var(--tm-text);
      line-height: 1.2;
    }
    .page__eyebrow-dot {
      width: 9px; height: 9px;
      border-radius: 50%;
      background: var(--tm-green);
      box-shadow: 0 0 0 4px var(--tm-green-soft);
    }
    .page__title { color: var(--tm-text); margin: 0 0 4px; }
    .page__subtitle {
      font-size: 14px;
      color: var(--tm-text-muted);
      font-weight: 500;
      margin: 0;
      max-width: 60ch;
    }
    .page__hero-right {
      display: flex;
      gap: var(--tm-space-2);
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    /* ---------- Segmented filter (tab toggle) ---------- */
    .seg {
      display: inline-flex;
      background: transparent;
      border: 1px solid var(--tm-line-2);
      padding: 3px;
      border-radius: var(--tm-radius-md);
      gap: 2px;
    }
    .seg__btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 14px;
      border-radius: var(--tm-radius-sm);
      background: transparent;
      font-weight: 700;
      font-size: 12px;
      color: var(--tm-text-muted);
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .seg__btn:hover { color: var(--tm-text); }
    .seg__btn.is-active {
      background: var(--tm-ink);
      color: #fff;
    }
    .seg__count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 6px;
      min-width: 18px;
      height: 18px;
      border-radius: var(--tm-radius-pill);
      background: rgba(255, 255, 255, 0.16);
      font-family: var(--tm-font-mono);
      font-size: 10px;
      font-weight: 800;
    }

    /* ---------- Date range picker (daterangepicker) ---------- */
    .date-range {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 6px 4px 10px;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      background: transparent;
      transition: border-color var(--tm-duration-fast) var(--tm-ease),
                  background var(--tm-duration-fast) var(--tm-ease);
      cursor: pointer;
    }
    .date-range:focus-within { border-color: var(--tm-ink); }
    .date-range.has-value {
      background: var(--tm-green-tint);
      border-color: var(--tm-green-deep);
    }
    .date-range__icon { color: var(--tm-text-muted); display: inline-flex; }
    .date-range.has-value .date-range__icon { color: var(--tm-green-deep); }
    .date-range__input {
      appearance: none;
      -webkit-appearance: none;
      background: transparent;
      border: 0;
      outline: 0;
      font-family: var(--tm-font-mono);
      font-size: 12px;
      font-weight: 600;
      color: var(--tm-text);
      padding: 4px 0;
      min-width: 220px;
      cursor: pointer;
    }
    .date-range__input::placeholder { color: var(--tm-text-soft); }
    .date-range__clear {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--tm-canvas-2);
      color: var(--tm-text-muted);
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .date-range__clear:hover {
      background: var(--tm-ink);
      color: #fff;
    }

    /* Brand-tone the daterangepicker dropdown — global because the
       picker mounts on document.body, not inside this component. */
    :host ::ng-deep .daterangepicker {
      font-family: var(--tm-font-body) !important;
      border-radius: var(--tm-radius-md);
      border: 1px solid var(--tm-line-2);
      box-shadow: var(--tm-shadow-pop);
    }
    :host ::ng-deep .daterangepicker .btn-primary,
    :host ::ng-deep .daterangepicker .btn-success {
      background: var(--tm-ink);
      border-color: var(--tm-ink);
      border-radius: var(--tm-radius-sm);
      font-weight: 700;
    }
    :host ::ng-deep .daterangepicker .ranges li.active,
    :host ::ng-deep .daterangepicker td.active,
    :host ::ng-deep .daterangepicker td.active:hover {
      background: var(--tm-ink);
      color: #fff;
    }
    :host ::ng-deep .daterangepicker td.in-range {
      background: var(--tm-green-tint);
      color: var(--tm-green-deep);
    }

    /* ---------- Active filter pill (below toolbar) ---------- */
    .filter-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 6px 6px 12px;
      border-radius: var(--tm-radius-pill);
      background: var(--tm-surface);
      border: 1px solid var(--tm-line-2);
      font-size: 12px;
      font-weight: 700;
      color: var(--tm-text);
    }
    .filter-pill__icon {
      display: inline-flex;
      color: var(--tm-text-muted);
    }
    .filter-pill__label {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--tm-text-muted);
    }
    .filter-pill__value {
      font-family: var(--tm-font-mono);
      font-weight: 700;
      color: var(--tm-text);
    }
    .filter-pill__close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--tm-canvas-2);
      color: var(--tm-text-muted);
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .filter-pill__close:hover {
      background: var(--tm-ink);
      color: #fff;
    }

    /* ---------- Cell renderers ---------- */
    .cell-id {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border-radius: var(--tm-radius-pill);
      background: var(--tm-green-tint);
      color: var(--tm-green-deep);
      border: 1px solid transparent;
      font-family: var(--tm-font-mono);
      font-size: 11px;
      font-weight: 800;
      text-decoration: none;
      cursor: pointer;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease),
                  border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .cell-id:hover {
      background: var(--tm-green);
      color: #fff;
    }
    /* Non-interactive variant when the chip is just a display badge. */
    .cell-id--static {
      cursor: default;
    }
    .cell-id--static:hover {
      background: var(--tm-green-tint);
      color: var(--tm-green-deep);
    }

    /* ---------- Eye-icon view button (end of row) ---------- */
    .view-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: var(--tm-radius-sm);
      background: var(--tm-canvas-2);
      color: var(--tm-text-muted);
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .view-btn:hover {
      background: var(--tm-ink);
      color: #fff;
    }
    .view-btn.is-open {
      background: var(--tm-green);
      color: #fff;
    }

    /* ---------- Detail popover ---------- */
    .id-pop {
      position: relative;
      display: inline-block;
    }
    .id-pop__panel {
      position: fixed;
      z-index: 1200;
      width: 280px;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      box-shadow: var(--tm-shadow-pop);
      padding: var(--tm-space-3);
      animation: id-pop-in 160ms var(--tm-ease) both;
    }
    @keyframes id-pop-in {
      from { opacity: 0; transform: translateY(-6px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0)    scale(1); }
    }
    .id-pop__head {
      display: flex;
      align-items: center;
      gap: 10px;
      padding-bottom: var(--tm-space-3);
      border-bottom: 1px solid var(--tm-line);
      margin-bottom: var(--tm-space-3);
    }
    .id-pop__title {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .id-pop__name {
      font-size: 14px;
      font-weight: 800;
      color: var(--tm-text);
      letter-spacing: -0.01em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .id-pop__id {
      font-size: 11px;
      font-weight: 700;
      color: var(--tm-text-muted);
    }
    .id-pop__close {
      width: 24px; height: 24px;
      border-radius: 50%;
      background: var(--tm-canvas-2);
      color: var(--tm-text-muted);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .id-pop__close:hover {
      background: var(--tm-ink);
      color: #fff;
    }
    .id-pop__rows {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .id-pop__row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-size: 12px;
      color: var(--tm-text);
    }
    .id-pop__row .lbl {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--tm-text-muted);
      margin: 0;
    }
    .id-pop__foot {
      margin-top: var(--tm-space-3);
      padding-top: var(--tm-space-3);
      border-top: 1px solid var(--tm-line);
    }
    .id-pop__link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--tm-green-deep);
      text-decoration: none;
    }
    .id-pop__link:hover { color: var(--tm-green); }

    .cell-user {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .cell-avatar {
      width: 32px; height: 32px;
      border-radius: 50%;
      display: grid; place-items: center;
      background: linear-gradient(135deg, var(--tm-ink), var(--tm-ink-3));
      color: #fff;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.02em;
      flex-shrink: 0;
    }
    .cell-user__meta {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .cell-user__name {
      font-weight: 700;
      font-size: 13px;
      color: var(--tm-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cell-user__sub {
      font-size: 11px;
      font-weight: 600;
      color: var(--tm-text-muted);
    }

    .rides-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 32px;
      padding: 3px 8px;
      border-radius: var(--tm-radius-pill);
      background: var(--tm-green-tint);
      color: var(--tm-green-deep);
      font-family: var(--tm-font-mono);
      font-size: 12px;
      font-weight: 800;
    }
    .rides-chip.is-zero {
      background: var(--tm-canvas-2);
      color: var(--tm-text-soft);
    }

    .mono { font-family: var(--tm-font-mono); font-weight: 600; font-size: 12px; }
    .muted { color: var(--tm-text-soft); }

    /* ---------- Modal form ---------- */
    .lbl {
      display: block;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--tm-text-muted);
      margin-bottom: 6px;
    }
    .form-input {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      font-family: inherit;
      font-size: 14px;
      outline: none;
      transition: border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .form-input:focus { border-color: var(--tm-ink); }

    /* ---------- Phone field with country code ---------- */
    .phone-field {
      display: flex;
      align-items: stretch;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      overflow: hidden;
      transition: border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .phone-field:focus-within { border-color: var(--tm-ink); }
    .phone-field__cc {
      position: relative;
      display: inline-flex;
      align-items: center;
      background: var(--tm-canvas);
      border-right: 1px solid var(--tm-line);
    }
    .phone-field__cc-select {
      appearance: none;
      -webkit-appearance: none;
      background: transparent;
      border: 0;
      outline: 0;
      font-family: inherit;
      font-size: 13px;
      font-weight: 700;
      color: var(--tm-text);
      padding: 10px 26px 10px 14px;
      cursor: pointer;
    }
    .phone-field__cc-caret {
      position: absolute;
      right: 10px;
      pointer-events: none;
      color: var(--tm-text-soft);
    }
    .phone-field__input {
      flex: 1;
      min-width: 0;
      padding: 10px 14px;
      border: 0;
      outline: 0;
      font-family: var(--tm-font-mono);
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.02em;
      background: transparent;
      color: var(--tm-text);
    }
    .phone-field__input::placeholder { color: var(--tm-text-soft); font-weight: 500; }
    .hint {
      margin: 12px 0 0;
      font-size: 12px;
      font-weight: 500;
      color: var(--tm-text-muted);
      line-height: 1.5;
    }
    .hint code {
      font-family: var(--tm-font-mono);
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 4px;
      background: var(--tm-canvas-2);
      color: var(--tm-text);
    }

    /* File drop zone for CSV import */
    .file-drop {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-top: 16px;
      padding: var(--tm-space-6);
      border: 2px dashed var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      background: var(--tm-canvas);
      cursor: pointer;
      transition: border-color var(--tm-duration-fast) var(--tm-ease),
                  background var(--tm-duration-fast) var(--tm-ease);
    }
    .file-drop:hover {
      border-color: var(--tm-green-deep);
      background: var(--tm-green-tint);
    }
    .file-drop input[type='file'] {
      position: absolute;
      width: 1px; height: 1px;
      opacity: 0;
      pointer-events: none;
    }
    .file-drop__icon {
      width: 44px; height: 44px;
      border-radius: 50%;
      background: var(--tm-surface);
      color: var(--tm-text-muted);
      display: grid; place-items: center;
      box-shadow: var(--tm-shadow-sm);
    }
    .file-drop__primary {
      font-size: 14px;
      font-weight: 700;
      color: var(--tm-text);
    }
    .file-drop__sub {
      font-size: 11px;
      font-weight: 600;
      color: var(--tm-text-soft);
      letter-spacing: 0.02em;
    }

    /* ---------- Toolbar surface tweaks: drop the white from the
       search input and the segmented filter so the toolbar reads
       as one unified band. ---------- */
    
    :host ::ng-deep tm-data-table .tm-dt__toolbar tm-input .field {
      background: transparent;
      border-color: var(--tm-line-2);
    }
    :host ::ng-deep tm-data-table .tm-dt__toolbar tm-input .field:focus-within {
      border-color: var(--tm-ink);
      background: var(--tm-surface);
    }

    /* ---------- Responsive ---------- */
    @media (max-width: 880px) {
      .page__hero {
        flex-direction: column;
        align-items: stretch;
      }
      .page__hero-right { justify-content: flex-start; }
      .seg__btn { padding: 7px 10px; }
    }
  `],
})
export class CustomersListComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('rangeInput', { static: false }) rangeInput!: ElementRef<HTMLInputElement>;

  rows: CustomerRow[] = [];
  total = 0;
  loading = false;
  search = '';
  activeTab = 0;

  page = 1;
  pageSize = 25;

  /** Date range filters — applied to the customer's `last_ride_at` server-side. */
  dateFrom = '';
  dateTo = '';
  readonly todayIso = new Date().toISOString().slice(0, 10);

  /** Which row's detail popover is currently open (by user id). */
  openPopoverId: number | null = null;
  popoverTop = 0;
  popoverLeft = 0;

  viewOtpOpen = false;
  otpPhone = '';
  otpCountryCode = '+91';
  otpSending = false;

  readonly countryCodes = [
    { flag: '🇮🇳', dial: '+91' },
    { flag: '🇺🇸', dial: '+1' },
    { flag: '🇬🇧', dial: '+44' },
    { flag: '🇦🇪', dial: '+971' },
    { flag: '🇸🇦', dial: '+966' },
    { flag: '🇵🇰', dial: '+92' },
    { flag: '🇦🇺', dial: '+61' },
    { flag: '🇸🇬', dial: '+65' },
  ];

  importOpen = false;
  csvFile: File | null = null;
  csvFileName = '';
  importing = false;

  private searchDebounce: any = null;

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private zone: NgZone,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.reload();
  }

  ngAfterViewInit(): void {
    this.initDateRangePicker();
  }

  ngOnDestroy(): void {
    this.destroyDateRangePicker();
  }

  get rangeLabel(): string {
    if (!this.dateFrom && !this.dateTo) return '';
    return `${this.formatDate(this.dateFrom)} → ${this.formatDate(this.dateTo)}`;
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
          this.onDateRangeChange();
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

  reload(): void {
    const tab = this.activeTab === 1 ? 'with_docs' : 'all';
    const params = new URLSearchParams({
      page: String(this.page),
      tab,
      search: this.search,
      per_page: String(this.pageSize),
    });
    if (this.dateFrom) params.set('last_ride_from', this.dateFrom);
    if (this.dateTo) params.set('last_ride_to', this.dateTo);

    this.loading = true;
    this.api
      .get<any>(`/admin/customers?${params.toString()}`)
      .subscribe({
        next: (res) => {
          const data = res?.data;
          this.rows = data?.data ?? [];
          this.total = data?.total ?? 0;
          this.loading = false;
        },
        error: (err) => {
          this.toast.error(
            err?.error?.message || 'Could not load customers',
            { title: 'Load failed' },
          );
          this.loading = false;
        },
      });
  }

  setTab(tab: number): void {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.page = 1;
    this.reload();
  }

  onSearchChange(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => {
      this.page = 1;
      this.reload();
    }, 300);
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

  onDateRangeChange(): void {
    this.page = 1;
    this.reload();
  }

  clearDateRange(): void {
    this.dateFrom = '';
    this.dateTo = '';
    this.onDateRangeChange();
  }

  formatDate(iso: string): string {
    if (!iso) return 'any';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'any';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}-${mm}-${yy}`;
  }

  togglePopover(id: number, event: MouseEvent): void {
    event.stopPropagation();
    if (this.openPopoverId === id) {
      this.openPopoverId = null;
      return;
    }
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    // Anchor the popover below the trigger, but flip up if there isn't room.
    const panelW = 280;
    const panelH = 280;
    let left = rect.left;
    if (left + panelW > window.innerWidth - 12) left = window.innerWidth - panelW - 12;
    let top = rect.bottom + 8;
    if (top + panelH > window.innerHeight - 12) top = rect.top - panelH - 8;
    this.popoverLeft = Math.max(12, left);
    this.popoverTop = Math.max(12, top);
    this.openPopoverId = id;
  }

  closePopover(): void {
    this.openPopoverId = null;
  }

  openProfile(id: number, event: MouseEvent): void {
    event.stopPropagation();
    this.openPopoverId = null;
    this.router.navigate(['/customers', id]);
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.openPopoverId !== null) this.openPopoverId = null;
  }

  @HostListener('document:keydown.escape')
  onDocumentEscape(): void {
    if (this.openPopoverId !== null) this.openPopoverId = null;
  }

  initials(name: string | null): string {
    if (!name) return '—';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '—';
    const a = parts[0][0] || '';
    const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (a + b).toUpperCase();
  }

  // ── OTP send (top button) ─────────────────────────────────────────
  openViewOtp(): void {
    this.otpPhone = '';
    this.otpCountryCode = '+91';
    this.viewOtpOpen = true;
  }

  submitOtp(): void {
    const digits = this.otpPhone.replace(/\D+/g, '');
    if (!digits || digits.length < 6) {
      this.toast.warning('Enter a valid phone number');
      return;
    }
    const full = this.otpCountryCode.replace(/\D+/g, '') + digits;
    // Resolve the customer by phone via the existing list endpoint, then
    // call the per-user send-otp route. Search matches partial substrings,
    // so we keep only the exact phone hit.
    this.otpSending = true;
    this.api
      .get<any>(`/admin/customers?search=${encodeURIComponent(full)}&per_page=5`)
      .subscribe({
        next: (res) => {
          const candidates: CustomerRow[] = res?.data?.data ?? [];
          const match = candidates.find(
            (c) => (c.phone || '').replace(/\D+/g, '').endsWith(digits),
          );
          if (!match) {
            this.otpSending = false;
            this.toast.error('No customer found with that phone number');
            return;
          }
          this.sendOtp(match, () => (this.viewOtpOpen = false));
        },
        error: (err) => {
          this.otpSending = false;
          this.toast.error(
            err?.error?.message || 'Lookup failed',
            { title: 'Could not find customer' },
          );
        },
      });
  }

  sendOtp(row: CustomerRow, onDone?: () => void): void {
    this.otpSending = true;
    this.api.post(`/admin/customers/${row.id}/send-otp`, {}).subscribe({
      next: () => {
        this.toast.success('OTP sent successfully');
        this.otpSending = false;
        onDone?.();
      },
      error: (err) => {
        this.toast.error(
          err?.error?.message || 'Could not send OTP',
          { title: 'OTP failed' },
        );
        this.otpSending = false;
      },
    });
  }

  // ── CSV import ─────────────────────────────────────────────────────
  openImport(): void {
    this.csvFile = null;
    this.csvFileName = '';
    this.importOpen = true;
  }

  closeImport(): void {
    this.importOpen = false;
    this.csvFile = null;
    this.csvFileName = '';
  }

  onCsvSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.csvFile = input.files[0];
      this.csvFileName = this.csvFile.name;
    }
  }

  submitImport(): void {
    if (!this.csvFile) return;
    const fd = new FormData();
    fd.append('file', this.csvFile);
    this.importing = true;
    this.api.postMultipart<{ message: string }>('/admin/customers/import', fd).subscribe({
      next: (res) => {
        this.toast.success(res.message || 'Users imported', { title: 'Import complete' });
        this.importing = false;
        this.closeImport();
        this.reload();
      },
      error: (err) => {
        this.toast.error(
          err?.error?.message || 'Could not import users',
          { title: 'Import failed' },
        );
        this.importing = false;
      },
    });
  }
}
