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
import { Router } from '@angular/router';
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
} from '../../ui';

type StateFilter = 'all' | 'active' | 'deactivated';

interface DriverRow {
  id: number;
  approval_status: 'pending' | 'approved' | 'rejected';
  vehicle_type: string | null;
  vehicle_reg_no: string | null;
  is_online: boolean;
  registered_on: string | null;
  last_login: string | null;
  last_ride_on: string | null;
  rides_7d: number;
  rides_30d: number;
  total_rides: number;
  deactivated_at: string | null;
  deactivated_reason: string | null;
  user: { id: number; name: string; phone: string | null; email: string | null } | null;
}

@Component({
  selector: 'app-drivers-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DatePipe,
    ButtonComponent,
    ColumnComponent,
    DataTableComponent,
    IconComponent,
    InputComponent,
  ],
  template: `
    <div class="page">
      <!-- =================== Hero =================== -->
      <header class="page__hero">
        <div class="page__hero-left">
          <span class="page__eyebrow">
            <span class="page__eyebrow-dot" aria-hidden="true"></span> Drivers
          </span>
          <p class="page__subtitle">
            Manage your fleet — search, filter and review active and deactivated drivers in one place.
          </p>
        </div>
        <div class="page__hero-right">
          <tm-button variant="outline" icon="download"
                     [loading]="exporting" (clicked)="exportCsv()">
            Export CSV
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
        emptyTitle="No drivers"
        emptyHint="Try a different search, or adjust the filters above."
        (pageChange)="onPageChange($event)"
        (pageSizeChange)="onPageSizeChange($event)"
      >
        <!-- Toolbar: search on the LEFT -->
        <tm-input
          slot="search"
          icon="search"
          placeholder="Driver ID, name, phone, email or vehicle no."
          [(ngModel)]="search"
          (ngModelChange)="onSearchChange()"
        />

        <!-- Toolbar: filters on the RIGHT -->
        <ng-container slot="filters">
          <!-- State select (Active / Deactivated / All) -->
          <div class="state-select" [class.has-value]="state !== 'all'">
            <span class="state-select__icon" aria-hidden="true">
              <tm-icon name="user" [size]="14" />
            </span>
            <select
              class="state-select__field"
              [(ngModel)]="state"
              (ngModelChange)="onStateChange()"
              aria-label="Activation status filter"
            >
              <option value="all">All drivers</option>
              <option value="active">Active</option>
              <option value="deactivated">Deactivated</option>
            </select>
            <tm-icon name="chevron-down" [size]="12" class="state-select__caret" />
          </div>

          <!-- Date range picker — filters by drivers.created_at -->
          <div class="date-range" [class.has-value]="dateFrom || dateTo">
            <span class="date-range__icon" aria-hidden="true">
              <tm-icon name="calendar" [size]="14" />
            </span>
            <input
              #rangeInput
              type="text"
              readonly
              class="date-range__input"
              [placeholder]="'Registered · any date'"
              [value]="rangeLabel"
              aria-label="Filter by registered date range"
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

        <!-- Active filter pills below the toolbar -->
        <ng-container slot="banner">
          <span class="filter-pill" *ngIf="state !== 'all'">
            <span class="filter-pill__icon">
              <tm-icon name="user" [size]="11" />
            </span>
            <span class="filter-pill__label">Status</span>
            <span class="filter-pill__value">
              {{ state === 'active' ? 'Active' : 'Deactivated' }}
            </span>
            <button
              type="button"
              class="filter-pill__close"
              (click)="clearState()"
              aria-label="Clear status filter"
            >
              <tm-icon name="x" [size]="12" />
            </button>
          </span>
          <span class="filter-pill" *ngIf="dateFrom || dateTo">
            <span class="filter-pill__icon">
              <tm-icon name="calendar" [size]="11" />
            </span>
            <span class="filter-pill__label">Registered</span>
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
        <tm-column key="id" label="Driver ID" width="110">
          <ng-template let-row>
            <span class="cell-id cell-id--static">#{{ row.id }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="name" label="Driver">
          <ng-template let-row>
            <div class="cell-user">
              <span class="cell-avatar">{{ initials(row.user?.name) }}</span>
              <div class="cell-user__meta">
                <span class="cell-user__name">{{ row.user?.name || 'Unnamed' }}</span>
                <span class="cell-user__sub" *ngIf="row.vehicle_type || row.vehicle_reg_no">
                  {{ row.vehicle_type || '—' }}
                  <span *ngIf="row.vehicle_reg_no" class="mono"> · {{ row.vehicle_reg_no }}</span>
                </span>
              </div>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="phone" label="Phone" width="160">
          <ng-template let-row>
            <span class="mono">{{ row.user?.phone || '—' }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="email" label="Email">
          <ng-template let-row>
            <span [class.muted]="!row.user?.email">{{ row.user?.email || '—' }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="status" label="Status" width="160">
          <ng-template let-row>
            <span class="status-stack">
              <span class="status-pill"
                    [class.is-online]="row.is_online"
                    [class.is-offline]="!row.is_online">
                <span class="status-dot"></span>
                {{ row.is_online ? 'Online' : 'Offline' }}
              </span>
              <span class="status-pill status-pill--ghost"
                    [class.is-approved]="row.approval_status === 'approved'"
                    [class.is-rejected]="row.approval_status === 'rejected'"
                    [class.is-pending]="row.approval_status === 'pending'">
                {{ row.approval_status }}
              </span>
            </span>
          </ng-template>
        </tm-column>

        <tm-column key="registered_on" label="Registered" width="140">
          <ng-template let-row>
            <span class="mono">
              {{ row.registered_on ? (row.registered_on | date:'MMM d, y') : '—' }}
            </span>
          </ng-template>
        </tm-column>

        <tm-column key="rides_7d" label="7d" width="70" align="right">
          <ng-template let-row>
            <span class="rides-chip" [class.is-zero]="!row.rides_7d">{{ row.rides_7d ?? 0 }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="total_rides" label="Total" width="80" align="right">
          <ng-template let-row>
            <span class="rides-chip" [class.is-zero]="!row.total_rides">
              {{ row.total_rides ?? 0 }}
            </span>
          </ng-template>
        </tm-column>

        <tm-column key="action" label="" width="140" align="right">
          <ng-template let-row>
            <ng-container *ngIf="!row.deactivated_at; else reactivateBtn">
              <tm-button
                variant="outline"
                size="sm"
                [loading]="busyId === row.id"
                (clicked)="deactivate(row)"
              >
                Deactivate
              </tm-button>
            </ng-container>
            <ng-template #reactivateBtn>
              <tm-button
                variant="green"
                size="sm"
                [loading]="busyId === row.id"
                (clicked)="reactivate(row)"
              >
                Reactivate
              </tm-button>
            </ng-template>
          </ng-template>
        </tm-column>

        <tm-column key="view" label="" width="60" align="right">
          <ng-template let-row>
            <div class="id-pop" [class.is-open]="openPopoverId === row.id">
              <button
                type="button"
                class="view-btn"
                [class.is-open]="openPopoverId === row.id"
                (click)="togglePopover(row, $event)"
                [attr.aria-expanded]="openPopoverId === row.id"
                aria-label="View driver details"
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
                  <span class="cell-avatar">{{ initials(row.user?.name) }}</span>
                  <div class="id-pop__title">
                    <div class="id-pop__name">{{ row.user?.name || 'Unnamed' }}</div>
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
                    <span class="mono">{{ row.user?.phone || '—' }}</span>
                  </div>
                  <div class="id-pop__row">
                    <span class="lbl">Email</span>
                    <span [class.muted]="!row.user?.email">{{ row.user?.email || '—' }}</span>
                  </div>
                  <div class="id-pop__row">
                    <span class="lbl">Vehicle</span>
                    <span class="mono">{{ row.vehicle_reg_no || '—' }}</span>
                  </div>
                  <div class="id-pop__row">
                    <span class="lbl">Vehicle type</span>
                    <span>{{ row.vehicle_type || '—' }}</span>
                  </div>
                  <div class="id-pop__row">
                    <span class="lbl">Registered</span>
                    <span class="mono">
                      {{ row.registered_on ? (row.registered_on | date:'MMM d, y') : '—' }}
                    </span>
                  </div>
                  <div class="id-pop__row">
                    <span class="lbl">Last login</span>
                    <span class="mono">
                      {{ row.last_login ? (row.last_login | date:'MMM d, HH:mm') : '—' }}
                    </span>
                  </div>
                  <div class="id-pop__row">
                    <span class="lbl">Total rides</span>
                    <span class="rides-chip" [class.is-zero]="!row.total_rides">
                      {{ row.total_rides ?? 0 }}
                    </span>
                  </div>
                  <div class="id-pop__row" *ngIf="row.deactivated_at">
                    <span class="lbl">Deactivated</span>
                    <span class="mono">{{ row.deactivated_at | date:'MMM d, y' }}</span>
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
    .page__eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      margin-bottom: var(--tm-space-2);
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: var(--tm-text);
      line-height: 1.2;
    }
    .page__eyebrow-dot {
      width: 9px; height: 9px;
      border-radius: 50%;
      background: var(--tm-green);
      box-shadow: 0 0 0 4px var(--tm-green-soft);
    }
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

    /* ---------- State select (left of date range) ---------- */
    .state-select {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 26px 4px 10px;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      background: transparent;
      transition: border-color var(--tm-duration-fast) var(--tm-ease),
                  background var(--tm-duration-fast) var(--tm-ease);
    }
    .state-select:focus-within { border-color: var(--tm-ink); }
    .state-select.has-value {
      background: var(--tm-green-tint);
      border-color: var(--tm-green-deep);
    }
    .state-select__icon { color: var(--tm-text-muted); display: inline-flex; }
    .state-select.has-value .state-select__icon { color: var(--tm-green-deep); }
    .state-select__field {
      appearance: none;
      -webkit-appearance: none;
      background: transparent;
      border: 0;
      outline: 0;
      font-family: var(--tm-font-body);
      font-size: 12px;
      font-weight: 700;
      color: var(--tm-text);
      padding: 4px 0;
      min-width: 130px;
      cursor: pointer;
    }
    .state-select__caret {
      position: absolute;
      right: 8px;
      pointer-events: none;
      color: var(--tm-text-soft);
    }
    .state-select.has-value .state-select__caret { color: var(--tm-green-deep); }

    /* ---------- Date range picker ---------- */
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

    /* Brand-tone the daterangepicker dropdown — mounts on body */
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

    /* ---------- Active filter pills (below toolbar) ---------- */
    .filter-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-right: 8px;
      padding: 6px 6px 6px 12px;
      border-radius: var(--tm-radius-pill);
      background: var(--tm-surface);
      border: 1px solid var(--tm-line-2);
      font-size: 12px;
      font-weight: 700;
      color: var(--tm-text);
    }
    .filter-pill__icon { display: inline-flex; color: var(--tm-text-muted); }
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
    }
    .cell-id--static { cursor: default; }

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
    .cell-user__meta { display: flex; flex-direction: column; min-width: 0; }
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

    .status-stack {
      display: inline-flex;
      flex-direction: column;
      gap: 4px;
      align-items: flex-start;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 10px;
      border-radius: var(--tm-radius-pill);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      line-height: 1.6;
    }
    .status-pill .status-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: currentColor;
    }
    .status-pill.is-online   { background: var(--tm-green-tint); color: var(--tm-green-deep); }
    .status-pill.is-offline  { background: var(--tm-canvas-2);   color: var(--tm-text-soft);  }
    .status-pill--ghost {
      background: transparent;
      border: 1px solid var(--tm-line-2);
      color: var(--tm-text-muted);
    }
    .status-pill--ghost.is-approved {
      border-color: var(--tm-green-deep);
      color: var(--tm-green-deep);
    }
    .status-pill--ghost.is-rejected {
      border-color: #dc2626;
      color: #dc2626;
    }
    .status-pill--ghost.is-pending {
      border-color: #f59e0b;
      color: #f59e0b;
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

    /* ---------- Eye-icon view button ---------- */
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
    .view-btn:hover { background: var(--tm-ink); color: #fff; }
    .view-btn.is-open { background: var(--tm-green); color: #fff; }

    /* ---------- Detail popover ---------- */
    .id-pop { position: relative; display: inline-block; }
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
    .id-pop__title { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .id-pop__name {
      font-size: 14px;
      font-weight: 800;
      color: var(--tm-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .id-pop__id { font-size: 11px; font-weight: 700; color: var(--tm-text-muted); }
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
    .id-pop__close:hover { background: var(--tm-ink); color: #fff; }
    .id-pop__rows { display: flex; flex-direction: column; gap: 8px; }
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
    }
    .id-pop__link:hover { color: var(--tm-green); }

    /* ---------- Toolbar surface tweaks ---------- */
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
      .page__hero { flex-direction: column; align-items: stretch; }
      .page__hero-right { justify-content: flex-start; }
      .date-range__input { min-width: 160px; }
      .state-select__field { min-width: 110px; }
    }
  `],
})
export class DriversListComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('rangeInput', { static: false }) rangeInput!: ElementRef<HTMLInputElement>;

  rows: DriverRow[] = [];
  total = 0;
  loading = false;
  exporting = false;

  search = '';
  state: StateFilter = 'all';
  page = 1;
  pageSize = 25;

  /** Date range filters — applied to drivers.created_at server-side. */
  dateFrom = '';
  dateTo = '';

  openPopoverId: number | null = null;
  popoverTop = 0;
  popoverLeft = 0;

  busyId: number | null = null;

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
    const params = new URLSearchParams({
      page: String(this.page),
      per_page: String(this.pageSize),
      state: this.state,
    });
    if (this.search.trim()) params.set('q', this.search.trim());
    if (this.dateFrom) params.set('date_from', this.dateFrom);
    if (this.dateTo) params.set('date_to', this.dateTo);

    this.loading = true;
    this.api.get<{ data: { data: DriverRow[]; total: number } }>(
      `/admin/drivers?${params.toString()}`,
    ).subscribe({
      next: (res) => {
        this.rows = res?.data?.data ?? [];
        this.total = res?.data?.total ?? 0;
        this.loading = false;
      },
      error: (err) => {
        this.toast.error(
          err?.error?.message || 'Could not load drivers',
          { title: 'Load failed' },
        );
        this.loading = false;
      },
    });
  }

  onSearchChange(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => {
      this.page = 1;
      this.reload();
    }, 300);
  }

  onStateChange(): void {
    this.page = 1;
    this.reload();
  }

  clearState(): void {
    this.state = 'all';
    this.onStateChange();
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

  togglePopover(row: DriverRow, event: MouseEvent): void {
    event.stopPropagation();
    if (this.openPopoverId === row.id) {
      this.openPopoverId = null;
      return;
    }
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const panelW = 280;
    const panelH = 320;
    let left = rect.left;
    if (left + panelW > window.innerWidth - 12) left = window.innerWidth - panelW - 12;
    let top = rect.bottom + 8;
    if (top + panelH > window.innerHeight - 12) top = rect.top - panelH - 8;
    this.popoverLeft = Math.max(12, left);
    this.popoverTop = Math.max(12, top);
    this.openPopoverId = row.id;
  }

  closePopover(): void {
    this.openPopoverId = null;
  }

  openProfile(id: number, event: MouseEvent): void {
    event.stopPropagation();
    this.openPopoverId = null;
    this.router.navigate(['/drivers/approvals', id]);
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.openPopoverId !== null) this.openPopoverId = null;
  }

  @HostListener('document:keydown.escape')
  onDocumentEscape(): void {
    if (this.openPopoverId !== null) this.openPopoverId = null;
  }

  initials(name: string | null | undefined): string {
    if (!name) return '—';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '—';
    const a = parts[0][0] || '';
    const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (a + b).toUpperCase();
  }

  deactivate(row: DriverRow): void {
    const reason = (window.prompt('Reason for deactivation (optional)') ?? '').trim();
    this.toggleActivation(row, false, reason || null);
  }

  reactivate(row: DriverRow): void {
    this.toggleActivation(row, true, null);
  }

  private toggleActivation(row: DriverRow, active: boolean, reason: string | null): void {
    this.busyId = row.id;
    this.api
      .patch<{ driver: { id: number } }>(`/admin/drivers/${row.id}/activation`, {
        active,
        reason,
      })
      .subscribe({
        next: () => {
          this.toast.success(
            active ? `Driver #${row.id} reactivated` : `Driver #${row.id} deactivated`,
          );
          this.busyId = null;
          this.reload();
        },
        error: (err) => {
          this.toast.error(err?.error?.message || 'Action failed', { title: 'Driver update' });
          this.busyId = null;
        },
      });
  }

  exportCsv(): void {
    this.exporting = true;
    const params = new URLSearchParams({ state: this.state });
    if (this.search.trim()) params.set('q', this.search.trim());
    if (this.dateFrom) params.set('date_from', this.dateFrom);
    if (this.dateTo) params.set('date_to', this.dateTo);

    this.api.getBlob(`/admin/drivers/export?${params.toString()}`).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `drivers-${this.state}-${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        this.exporting = false;
      },
      error: () => {
        this.toast.error('Export failed');
        this.exporting = false;
      },
    });
  }
}
