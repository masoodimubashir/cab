import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import $ from 'jquery';
import moment from 'moment';
import 'daterangepicker';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import {
  ColumnComponent,
  DataTableComponent,
  IconComponent,
  InputComponent,
} from '../../ui';

export type RideCategory =
  | 'ongoing'
  | 'scheduled'
  | 'completed'
  | 'cancelled'
  | 'missed'
  | 'pending'
  | 'all';

type StatusFilter =
  | 'all'
  | 'REQUESTED'
  | 'NEGOTIATION'
  | 'CONFIRMED'
  | 'ASSIGNED'
  | 'EN_ROUTE_PICKUP'
  | 'ARRIVED_PICKUP'
  | 'EN_ROUTE_DROP'
  | 'ARRIVED_DROP'
  | 'COMPLETED'
  | 'CANCELLED';

interface RideTypeOption { id: number; name: string; }
interface CityVehicleTypeOption { id: number; display_name: string; }

interface TripRow {
  id: number;
  status: string;
  no_show_by?: string | null;
  pickup_address?: string | null;
  drop_address?: string | null;
  estimated_fare?: number | null;
  final_fare?: number | null;
  created_at?: string | null;
  customer?: { id: number; name?: string | null; phone?: string | null } | null;
  driver?: { id: number; name?: string | null; phone?: string | null } | null;
  ride_type?: { id: number; name?: string | null } | null;
}

const STATUS_OPTIONS: { value: Exclude<StatusFilter, 'all'>; label: string }[] = [
  { value: 'REQUESTED',       label: 'Requested' },
  { value: 'NEGOTIATION',     label: 'Negotiation' },
  { value: 'CONFIRMED',       label: 'Confirmed' },
  { value: 'ASSIGNED',        label: 'Assigned' },
  { value: 'EN_ROUTE_PICKUP', label: 'En route pickup' },
  { value: 'ARRIVED_PICKUP',  label: 'At pickup' },
  { value: 'EN_ROUTE_DROP',   label: 'En route drop' },
  { value: 'ARRIVED_DROP',    label: 'At drop' },
  { value: 'COMPLETED',       label: 'Completed' },
  { value: 'CANCELLED',       label: 'Cancelled' },
];

@Component({
  selector: 'app-rides-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule, DatePipe,
    ColumnComponent, DataTableComponent, IconComponent, InputComponent,
  ],
  template: `
    <div class="page">
      <header class="page__hero">
        <div>
          <h1 class="page__title">{{ title }}</h1>
          <p class="page__sub">Live and historical rides across this operator's cities.</p>
        </div>
      </header>

      <tm-data-table
        [rows]="trips"
        [total]="total"
        [page]="page"
        [pageSize]="pageSize"
        [pageSizes]="[10, 25, 50, 100]"
        [loading]="loading"
        emptyTitle="No rides"
        [emptyHint]="emptyMessage"
        (pageChange)="onPageChange($event)"
        (pageSizeChange)="onPageSizeChange($event)"
      >
        <!-- Toolbar: search on the LEFT -->
        <tm-input
          slot="search"
          icon="search"
          placeholder="Search by customer or driver phone"
          [(ngModel)]="phone"
          (ngModelChange)="onSearchChange()"
        />

        <!-- Toolbar: filters on the RIGHT -->
        <ng-container slot="filters">
          <!-- Status -->
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

          <!-- City vehicle type (per-city) -->
          <div class="state-select" [class.has-value]="cityVehicleTypeId != null" [class.is-open]="cvtOpen">
            <button
              type="button"
              class="state-select__trigger"
              (click)="toggleCvtMenu($event)"
              [attr.aria-expanded]="cvtOpen"
              aria-haspopup="listbox"
              aria-label="City vehicle type filter"
            >
              <span class="state-select__icon" aria-hidden="true"><tm-icon name="car" [size]="14" /></span>
              <span class="state-select__value">{{ cvtLabel() }}</span>
              <tm-icon name="chevron-down" [size]="12" class="state-select__caret" />
            </button>
            <ul class="state-select__menu" *ngIf="cvtOpen" role="listbox" (click)="$event.stopPropagation()">
              <li
                class="state-select__option"
                [class.is-selected]="cityVehicleTypeId == null"
                role="option"
                [attr.aria-selected]="cityVehicleTypeId == null"
                (click)="selectCvt(null)"
              >
                <tm-icon *ngIf="cityVehicleTypeId == null" name="check" [size]="12" class="state-select__option-check" />
                <span class="state-select__option-label">All vehicles</span>
              </li>
              <li
                *ngFor="let opt of cvtOptions"
                class="state-select__option"
                [class.is-selected]="cityVehicleTypeId === opt.id"
                role="option"
                [attr.aria-selected]="cityVehicleTypeId === opt.id"
                (click)="selectCvt(opt.id)"
              >
                <tm-icon *ngIf="cityVehicleTypeId === opt.id" name="check" [size]="12" class="state-select__option-check" />
                <span class="state-select__option-label">{{ opt.display_name }}</span>
              </li>
            </ul>
          </div>

          <!-- Ride type -->
          <div class="state-select" [class.has-value]="rideTypeId != null" [class.is-open]="rideTypeOpen">
            <button
              type="button"
              class="state-select__trigger"
              (click)="toggleRideTypeMenu($event)"
              [attr.aria-expanded]="rideTypeOpen"
              aria-haspopup="listbox"
              aria-label="Ride type filter"
            >
              <span class="state-select__icon" aria-hidden="true"><tm-icon name="car" [size]="14" /></span>
              <span class="state-select__value">{{ rideTypeLabel() }}</span>
              <tm-icon name="chevron-down" [size]="12" class="state-select__caret" />
            </button>
            <ul class="state-select__menu" *ngIf="rideTypeOpen" role="listbox" (click)="$event.stopPropagation()">
              <li
                class="state-select__option"
                [class.is-selected]="rideTypeId == null"
                role="option"
                [attr.aria-selected]="rideTypeId == null"
                (click)="selectRideType(null)"
              >
                <tm-icon *ngIf="rideTypeId == null" name="check" [size]="12" class="state-select__option-check" />
                <span class="state-select__option-label">All types</span>
              </li>
              <li
                *ngFor="let opt of rideTypeOptions"
                class="state-select__option"
                [class.is-selected]="rideTypeId === opt.id"
                role="option"
                [attr.aria-selected]="rideTypeId === opt.id"
                (click)="selectRideType(opt.id)"
              >
                <tm-icon *ngIf="rideTypeId === opt.id" name="check" [size]="12" class="state-select__option-check" />
                <span class="state-select__option-label">{{ opt.name }}</span>
              </li>
            </ul>
          </div>

          <!-- Date range -->
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
          <span class="filter-pill" *ngIf="phone.trim()">
            <span class="filter-pill__icon"><tm-icon name="search" [size]="11" /></span>
            <span class="filter-pill__label">Phone</span>
            <span class="filter-pill__value">{{ phone }}</span>
            <button type="button" class="filter-pill__close" (click)="clearPhone()" aria-label="Clear phone search">
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
          <span class="filter-pill" *ngIf="cityVehicleTypeId != null">
            <span class="filter-pill__icon"><tm-icon name="car" [size]="11" /></span>
            <span class="filter-pill__label">Vehicle</span>
            <span class="filter-pill__value">{{ cvtLabel() }}</span>
            <button type="button" class="filter-pill__close" (click)="clearCvt()" aria-label="Clear vehicle filter">
              <tm-icon name="x" [size]="12" />
            </button>
          </span>
          <span class="filter-pill" *ngIf="rideTypeId != null">
            <span class="filter-pill__icon"><tm-icon name="road" [size]="11" /></span>
            <span class="filter-pill__label">Ride type</span>
            <span class="filter-pill__value">{{ rideTypeLabel() }}</span>
            <button type="button" class="filter-pill__close" (click)="clearRideType()" aria-label="Clear ride type filter">
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
        </ng-container>

        <!-- ============ Columns ============ -->
        <tm-column key="id" label="Trip" width="110">
          <ng-template let-row>
            <span class="cell-id">#{{ row.id }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="status" label="Status" width="170">
          <ng-template let-row>
            <span class="status-pill" [attr.data-s]="statusBucket(row.status)">
              {{ statusDisplay(row.status) }}
            </span>
            <div *ngIf="row.no_show_by" class="muted">no-show: {{ row.no_show_by }}</div>
          </ng-template>
        </tm-column>

        <tm-column key="customer" label="Customer">
          <ng-template let-row>
            <div class="cell-party">
              <span class="cell-name">{{ row.customer?.name || '—' }}</span>
              <span class="cell-sub">{{ row.customer?.phone || '' }}</span>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="driver" label="Driver">
          <ng-template let-row>
            <div class="cell-party">
              <span class="cell-name">{{ row.driver?.name || '—' }}</span>
              <span class="cell-sub">{{ row.driver?.phone || '' }}</span>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="ride_type" label="Ride type" width="120">
          <ng-template let-row>
            <span *ngIf="row.ride_type?.name">{{ row.ride_type?.name }}</span>
            <span *ngIf="!row.ride_type?.name" class="muted">—</span>
          </ng-template>
        </tm-column>

        <tm-column key="pickup_address" label="Pickup" [wrap]="true">
          <ng-template let-row>
            <span *ngIf="row.pickup_address" class="cell-addr">{{ row.pickup_address }}</span>
            <span *ngIf="!row.pickup_address" class="muted">—</span>
          </ng-template>
        </tm-column>

        <tm-column key="drop_address" label="Drop" [wrap]="true">
          <ng-template let-row>
            <span *ngIf="row.drop_address" class="cell-addr">{{ row.drop_address }}</span>
            <span *ngIf="!row.drop_address" class="muted">—</span>
          </ng-template>
        </tm-column>

        <tm-column key="fare" label="Fare" width="120" align="right">
          <ng-template let-row>
            <span *ngIf="row.final_fare != null" class="cell-fare">
              ₹{{ row.final_fare | number: '1.0-2' }}
            </span>
            <span *ngIf="row.final_fare == null && row.estimated_fare != null" class="muted">
              est. ₹{{ row.estimated_fare | number: '1.0-2' }}
            </span>
            <span *ngIf="row.final_fare == null && row.estimated_fare == null" class="muted">—</span>
          </ng-template>
        </tm-column>

        <tm-column key="created_at" label="Created" width="160">
          <ng-template let-row>
            <span *ngIf="row.created_at">{{ row.created_at | date: 'dd MMM yy, HH:mm' }}</span>
            <span *ngIf="!row.created_at" class="muted">—</span>
          </ng-template>
        </tm-column>

        <tm-column key="actions" label="" width="110" align="right">
          <ng-template let-row>
            <button class="details-btn" (click)="openDetails(row)" type="button" aria-label="View details">
              Details
              <tm-icon name="chevron-right" [size]="12" />
            </button>
          </ng-template>
        </tm-column>
      </tm-data-table>

      <div *ngIf="error" class="error">{{ error }}</div>
    </div>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 16px; }
    .page__hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .page__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .page__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); }

    /* ---------- Custom state-select dropdown ---------- */
    .state-select { position: relative; display: inline-block; }
    .state-select__trigger {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 9px 14px;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      background: transparent;
      font-family: var(--tm-font-body);
      font-size: 13px; font-weight: 700;
      color: var(--tm-text);
      cursor: pointer; line-height: 1.2;
      transition: border-color var(--tm-duration-fast) var(--tm-ease),
                  background var(--tm-duration-fast) var(--tm-ease);
    }
    .state-select__trigger:hover { border-color: var(--tm-ink); }
    .state-select.is-open .state-select__trigger { border-color: var(--tm-ink); }
    .state-select.has-value .state-select__trigger {
      background: var(--tm-green-tint);
      border-color: var(--tm-green-deep);
    }
    .state-select__icon { color: var(--tm-text-muted); display: inline-flex; }
    .state-select.has-value .state-select__icon { color: var(--tm-green-deep); }
    .state-select__value { min-width: 110px; text-align: left; }
    .state-select__caret {
      color: var(--tm-text-soft);
      transition: transform var(--tm-duration-fast) var(--tm-ease);
    }
    .state-select.is-open .state-select__caret { transform: rotate(180deg); }
    .state-select.has-value .state-select__caret { color: var(--tm-green-deep); }
    .state-select__menu {
      position: absolute; top: calc(100% + 6px); left: 0; right: 0;
      min-width: 200px; margin: 0; padding: 6px;
      list-style: none;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      box-shadow: var(--tm-shadow-pop);
      z-index: 1100;
      max-height: 320px; overflow-y: auto;
      animation: state-select-in 140ms var(--tm-ease) both;
    }
    @keyframes state-select-in {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .state-select__option {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; border-radius: var(--tm-radius-sm);
      font-size: 12px; font-weight: 600; color: var(--tm-text);
      cursor: pointer;
      transition: background var(--tm-duration-fast) var(--tm-ease);
    }
    .state-select__option:hover { background: var(--tm-canvas-2); }
    .state-select__option.is-selected {
      background: var(--tm-green-tint);
      color: var(--tm-green-deep);
      font-weight: 700;
    }
    .state-select__option-check { color: var(--tm-green-deep); flex-shrink: 0; }
    .state-select__option-label { flex: 1; }

    /* ---------- Date range ---------- */
    .date-range {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 8px 8px 14px;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      background: transparent; line-height: 1;
      transition: border-color var(--tm-duration-fast) var(--tm-ease),
                  background var(--tm-duration-fast) var(--tm-ease);
      cursor: pointer;
    }
    .date-range:focus-within { border-color: var(--tm-ink); }
    .date-range.has-value { background: var(--tm-green-tint); border-color: var(--tm-green-deep); }
    .date-range__icon { color: var(--tm-text-muted); display: inline-flex; }
    .date-range.has-value .date-range__icon { color: var(--tm-green-deep); }
    .date-range__input {
      appearance: none; -webkit-appearance: none;
      background: transparent; border: 0; outline: 0;
      font-family: var(--tm-font-mono);
      font-size: 12px; font-weight: 600;
      color: var(--tm-text);
      padding: 0; min-width: 220px;
      cursor: pointer; line-height: 1.2;
    }
    .date-range__input::placeholder { color: var(--tm-text-soft); }
    .date-range__clear {
      display: inline-flex; align-items: center; justify-content: center;
      width: 18px; height: 18px; border-radius: 50%;
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .date-range__clear:hover { background: var(--tm-ink); color: #fff; }

    :host ::ng-deep .daterangepicker {
      font-family: var(--tm-font-body) !important;
      border-radius: var(--tm-radius-md);
      border: 1px solid var(--tm-line-2);
      box-shadow: var(--tm-shadow-pop);
    }
    :host ::ng-deep .daterangepicker .btn-primary,
    :host ::ng-deep .daterangepicker .btn-success {
      background: var(--tm-ink); border-color: var(--tm-ink);
      border-radius: var(--tm-radius-sm); font-weight: 700;
    }
    :host ::ng-deep .daterangepicker .ranges li.active,
    :host ::ng-deep .daterangepicker td.active,
    :host ::ng-deep .daterangepicker td.active:hover {
      background: var(--tm-ink); color: #fff;
    }
    :host ::ng-deep .daterangepicker td.in-range {
      background: var(--tm-green-tint); color: var(--tm-green-deep);
    }

    /* ---------- Filter pills ---------- */
    .filter-pill {
      display: inline-flex; align-items: center; gap: 8px;
      margin-right: 8px;
      padding: 6px 6px 6px 12px;
      border-radius: var(--tm-radius-pill);
      background: var(--tm-surface);
      border: 1px solid var(--tm-line-2);
      font-size: 12px; font-weight: 700;
      color: var(--tm-text);
    }
    .filter-pill__icon { display: inline-flex; color: var(--tm-text-muted); }
    .filter-pill__label {
      font-size: 10px; font-weight: 800;
      letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--tm-text-muted);
    }
    .filter-pill__value {
      font-family: var(--tm-font-mono);
      font-weight: 700; color: var(--tm-text);
    }
    .filter-pill__close {
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px; border-radius: 50%;
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .filter-pill__close:hover { background: var(--tm-ink); color: #fff; }

    /* ---------- Cell renderers ---------- */
    .cell-id {
      display: inline-flex; align-items: center;
      padding: 3px 10px;
      border-radius: var(--tm-radius-pill);
      background: var(--tm-green-tint); color: var(--tm-green-deep);
      font-family: var(--tm-font-mono);
      font-size: 11px; font-weight: 800;
    }

    .status-pill {
      display: inline-flex; align-items: center;
      text-transform: capitalize;
      font-size: 10px; font-weight: 800; letter-spacing: 0.3px;
      padding: 3px 10px; border-radius: var(--tm-radius-pill);
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
    }
    .status-pill[data-s="completed"] { background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .status-pill[data-s="cancelled"] { background: var(--tm-danger-bg, #fee2e2); color: var(--tm-danger-fg, #b91c1c); }
    .status-pill[data-s="ongoing"] { background: var(--tm-warning-bg); color: var(--tm-warning-fg); }
    .status-pill[data-s="pending"] { background: var(--tm-info-bg, #dbeafe); color: var(--tm-info-fg, #1e40af); }

    .cell-party { display: flex; flex-direction: column; min-width: 0; }
    .cell-name { font-size: 13px; font-weight: 700; color: var(--tm-text); }
    .cell-sub { font-size: 11px; color: var(--tm-text-muted); font-family: var(--tm-font-mono); }

    .cell-addr {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      font-size: 12px; color: var(--tm-text);
    }
    .cell-fare {
      font-family: var(--tm-font-mono);
      font-weight: 700; color: var(--tm-text);
    }
    .muted { color: var(--tm-text-muted); font-size: 12px; }

    .details-btn {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 6px 10px;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      background: transparent;
      color: var(--tm-text);
      font-family: var(--tm-font-body);
      font-size: 12px; font-weight: 700;
      cursor: pointer;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  border-color var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .details-btn:hover {
      background: var(--tm-ink);
      border-color: var(--tm-ink);
      color: #fff;
    }
    .error {
      margin-top: 12px;
      color: var(--tm-danger, #b00020);
      font-weight: 700;
    }
  `],
})
export class RidesListComponent implements OnInit, OnChanges, AfterViewInit, OnDestroy {
  @Input({ required: true }) category!: RideCategory;
  @Input() title = 'Rides';
  @Input() emptyMessage = 'No rides found.';

  @ViewChild('rangeInput', { static: false }) rangeInput!: ElementRef<HTMLInputElement>;

  trips: TripRow[] = [];
  loading = false;
  error: string | null = null;

  // Filter state
  phone = '';
  status: StatusFilter = 'all';
  rideTypeId: number | null = null;
  cityVehicleTypeId: number | null = null;
  dateFrom = '';
  dateTo = '';

  // Dropdown open state
  statusOpen = false;
  rideTypeOpen = false;
  cvtOpen = false;

  statusOptions = STATUS_OPTIONS;
  rideTypeOptions: RideTypeOption[] = [];
  cvtOptions: CityVehicleTypeOption[] = [];
  private currentCityId: number | null = null;
  private citySub: Subscription | null = null;

  // Pagination
  page = 1;
  pageSize = 25;
  total = 0;

  private searchDebounce: any = null;

  constructor(
    private api: ApiService,
    private zone: NgZone,
    private cityCtx: CityContextService,
    private router: Router,
  ) {}

  openDetails(row: TripRow): void {
    if (!row?.id) return;
    this.router.navigateByUrl(`/rides/${row.id}`);
  }

  ngOnInit(): void {
    this.loadRideTypes();
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.citySub = this.cityCtx.cityId$.subscribe((id) => {
      this.currentCityId = id;
      // Reset CVT filter when city changes — the previous selection probably
      // doesn't exist in the new city.
      this.cityVehicleTypeId = null;
      this.loadCityVehicleTypes();
      this.fetch();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['category'] && !changes['category'].firstChange) {
      this.page = 1;
      this.fetch();
    }
  }

  ngAfterViewInit(): void {
    this.initDateRangePicker();
  }

  ngOnDestroy(): void {
    this.destroyDateRangePicker();
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.citySub?.unsubscribe();
  }

  // ── Status ──────────────────────────────────────────────────────
  statusLabel(): string {
    if (this.status === 'all') return 'All statuses';
    return this.statusOptions.find((o) => o.value === this.status)?.label ?? 'All statuses';
  }
  toggleStatusMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.rideTypeOpen = false;
    this.statusOpen = !this.statusOpen;
  }
  selectStatus(value: StatusFilter): void {
    this.statusOpen = false;
    if (this.status === value) return;
    this.status = value;
    this.page = 1;
    this.fetch();
  }
  clearStatus(): void {
    if (this.status === 'all') return;
    this.status = 'all';
    this.page = 1;
    this.fetch();
  }

  // ── City vehicle type ───────────────────────────────────────────
  cvtLabel(): string {
    if (this.cityVehicleTypeId == null) return 'All vehicles';
    return this.cvtOptions.find((o) => o.id === this.cityVehicleTypeId)?.display_name ?? 'All vehicles';
  }
  toggleCvtMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.statusOpen = false;
    this.rideTypeOpen = false;
    this.cvtOpen = !this.cvtOpen;
  }
  selectCvt(id: number | null): void {
    this.cvtOpen = false;
    if (this.cityVehicleTypeId === id) return;
    this.cityVehicleTypeId = id;
    this.page = 1;
    this.fetch();
  }
  clearCvt(): void {
    if (this.cityVehicleTypeId == null) return;
    this.cityVehicleTypeId = null;
    this.page = 1;
    this.fetch();
  }

  // ── Ride type ───────────────────────────────────────────────────
  rideTypeLabel(): string {
    if (this.rideTypeId == null) return 'All ride types';
    return this.rideTypeOptions.find((o) => o.id === this.rideTypeId)?.name ?? 'All ride types';
  }
  toggleRideTypeMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.statusOpen = false;
    this.cvtOpen = false;
    this.rideTypeOpen = !this.rideTypeOpen;
  }
  selectRideType(id: number | null): void {
    this.rideTypeOpen = false;
    if (this.rideTypeId === id) return;
    this.rideTypeId = id;
    this.page = 1;
    this.fetch();
  }
  clearRideType(): void {
    if (this.rideTypeId == null) return;
    this.rideTypeId = null;
    this.page = 1;
    this.fetch();
  }

  // ── Search ──────────────────────────────────────────────────────
  onSearchChange(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => {
      this.page = 1;
      this.fetch();
    }, 300);
  }
  clearPhone(): void {
    if (!this.phone) return;
    this.phone = '';
    this.page = 1;
    this.fetch();
  }

  // ── Date range ──────────────────────────────────────────────────
  get rangeLabel(): string {
    if (!this.dateFrom && !this.dateTo) return '';
    return `${this.formatDateShort(this.dateFrom)} → ${this.formatDateShort(this.dateTo)}`;
  }
  clearDateRange(): void {
    this.dateFrom = '';
    this.dateTo = '';
    this.page = 1;
    this.fetch();
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

  // ── Pagination ──────────────────────────────────────────────────
  onPageChange(page: number): void {
    this.page = page;
    this.fetch();
  }
  onPageSizeChange(size: number): void {
    this.pageSize = size;
    this.page = 1;
    this.fetch();
  }

  // ── Status display helpers ──────────────────────────────────────
  statusDisplay(s: string): string {
    return s.replace(/_/g, ' ').toLowerCase();
  }
  statusBucket(s: string): string {
    if (s === 'COMPLETED') return 'completed';
    if (s === 'CANCELLED') return 'cancelled';
    if (s === 'NEGOTIATION' || s === 'REQUESTED' || s === 'CONFIRMED') return 'pending';
    return 'ongoing';
  }

  // ── HostListener / Esc closes popovers ──────────────────────────
  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.statusOpen) this.statusOpen = false;
    if (this.rideTypeOpen) this.rideTypeOpen = false;
    if (this.cvtOpen) this.cvtOpen = false;
  }
  @HostListener('document:keydown.escape')
  onDocumentEscape(): void {
    if (this.statusOpen) this.statusOpen = false;
    if (this.rideTypeOpen) this.rideTypeOpen = false;
    if (this.cvtOpen) this.cvtOpen = false;
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
          this.page = 1;
          this.fetch();
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

  // ── API ─────────────────────────────────────────────────────────
  private loadRideTypes(): void {
    this.api.get<{ data: RideTypeOption[] }>('/admin/ride-types').subscribe({
      next: (res) => { this.rideTypeOptions = res?.data || []; },
      error: () => { this.rideTypeOptions = []; },
    });
  }

  private loadCityVehicleTypes(): void {
    if (this.currentCityId == null) {
      this.cvtOptions = [];
      return;
    }
    this.api.get<{ data: CityVehicleTypeOption[] }>(
      `/admin/cities/${this.currentCityId}/vehicle-types`,
    ).subscribe({
      next: (res) => { this.cvtOptions = res?.data || []; },
      error: () => { this.cvtOptions = []; },
    });
  }

  private fetch(): void {
    this.loading = true;
    this.error = null;
    const qs = this.buildQuery();
    this.api.get<any>(`/admin/trips${qs}`).subscribe({
      next: (res) => {
        const page = res?.data || {};
        this.trips = (page.data as TripRow[]) ?? [];
        this.total = page.total ?? this.trips.length;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load rides';
        this.loading = false;
      },
    });
  }

  private buildQuery(): string {
    const params = new URLSearchParams();
    params.set('category', this.category);
    params.set('page', String(this.page));
    params.set('per_page', String(this.pageSize));
    if (this.dateFrom) params.set('date_from', this.dateFrom);
    if (this.dateTo) params.set('date_to', this.dateTo);
    if (this.rideTypeId != null) params.set('ride_type_id', String(this.rideTypeId));
    if (this.cityVehicleTypeId != null) params.set('city_vehicle_type_id', String(this.cityVehicleTypeId));
    if (this.phone.trim()) params.set('phone', this.phone.trim());
    if (this.status !== 'all') params.set('status', this.status);
    return `?${params.toString()}`;
  }
}
