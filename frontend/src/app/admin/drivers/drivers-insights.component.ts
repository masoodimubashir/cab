import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import {
  ChartComponent,
  ColumnComponent,
  DataTableComponent,
  IconComponent,
  InputComponent,
} from '../../ui';

export type InsightsView = 'table' | 'graph';

export type InsightMode = 'leaderboard' | 'performance';
type LeaderboardPeriod = 'day' | 'week' | 'month';

interface LeaderboardRow {
  driver_id: number;
  name: string | null;
  phone: string | null;
  rides: number;
  rank: number;
}

interface PerformanceRow {
  driver_id: number;
  name: string | null;
  phone: string | null;
  successful: number;
  cancelled: number;
  missed: number;
  total: number;
}

type UnifiedRow = LeaderboardRow | PerformanceRow;

/**
 * Embeddable insights view. Rendered inside the drivers-list drawer.
 * The parent owns the tab switcher and passes the active mode via `[mode]`.
 */
@Component({
  selector: 'app-drivers-insights',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ChartComponent,
    ColumnComponent,
    DataTableComponent,
    IconComponent,
    InputComponent,
  ],
  template: `
    <div class="insights">
      <!-- Filters strip for graph view (table view exposes its own toolbar) -->
      <div class="insights__graph-filters" *ngIf="view === 'graph'">
        <ng-container *ngIf="mode === 'leaderboard'">
          <div
            class="state-select"
            [class.has-value]="period !== 'day'"
            [class.is-open]="periodOpen"
          >
            <button
              type="button"
              class="state-select__trigger"
              (click)="togglePeriodMenu($event)"
              aria-haspopup="listbox"
              [attr.aria-expanded]="periodOpen"
            >
              <span class="state-select__icon"><tm-icon name="calendar" [size]="14" /></span>
              <span class="state-select__value">{{ periodLabel() }}</span>
              <tm-icon name="chevron-down" [size]="12" class="state-select__caret" />
            </button>
            <ul class="state-select__menu" *ngIf="periodOpen" role="listbox" (click)="$event.stopPropagation()">
              <li
                *ngFor="let opt of periodOptions"
                class="state-select__option"
                [class.is-selected]="period === opt.value"
                (click)="selectPeriod(opt.value)"
              >
                <tm-icon *ngIf="period === opt.value" name="check" [size]="12" class="state-select__option-check" />
                <span class="state-select__option-label">{{ opt.label }}</span>
              </li>
            </ul>
          </div>
        </ng-container>
        <ng-container *ngIf="mode === 'performance'">
          <label class="date-field">
            <span class="date-field__lbl">From</span>
            <input type="date" class="date-field__input"
                   [(ngModel)]="dateFrom" [max]="dateTo || todayIso"
                   (change)="onDateRangeChange()" />
          </label>
          <label class="date-field">
            <span class="date-field__lbl">To</span>
            <input type="date" class="date-field__input"
                   [(ngModel)]="dateTo" [min]="dateFrom" [max]="todayIso"
                   (change)="onDateRangeChange()" />
          </label>
        </ng-container>
      </div>

      <!-- =================== Graph view =================== -->
      <ng-container *ngIf="view === 'graph'">
        <ng-container *ngIf="rows.length; else emptyGraph">
          <article class="graph-card" *ngIf="mode === 'leaderboard'">
            <header class="graph-card__head">
              <h3 class="graph-card__title">Rides leaderboard — {{ periodLabel() }}</h3>
              <span class="graph-card__hint">Top {{ topNLeaderboard }} of {{ rows.length }}</span>
            </header>
            <tm-chart type="bar" [config]="leaderboardChart" [height]="Math.max(260, topNLeaderboard * 32)" />
          </article>

          <article class="graph-card" *ngIf="mode === 'performance'">
            <header class="graph-card__head">
              <h3 class="graph-card__title">Performance breakdown</h3>
              <span class="graph-card__hint">Top {{ topNPerformance }} by total requests</span>
            </header>
            <tm-chart type="bar" [config]="performanceChart" [height]="Math.max(260, topNPerformance * 32)" />
            <ul class="graph-card__legend">
              <li><span class="dot dot--ok"></span> Successful</li>
              <li><span class="dot dot--warn"></span> Cancelled</li>
              <li><span class="dot dot--bad"></span> Missed</li>
            </ul>
          </article>
        </ng-container>
        <ng-template #emptyGraph>
          <div class="graph-card graph-card--empty">
            <tm-icon name="chart-bar" [size]="22" />
            <p>No data to chart.</p>
          </div>
        </ng-template>
      </ng-container>

      <!-- =================== Table view =================== -->
      <tm-data-table
        *ngIf="view === 'table'"
        [rows]="pagedRows"
        [total]="filteredRows.length"
        [page]="page"
        [pageSize]="pageSize"
        [pageSizes]="[10, 25, 50, 100]"
        [loading]="loading"
        [emptyTitle]="mode === 'leaderboard' ? 'No rides yet' : 'No drivers in this date range'"
        [emptyHint]="mode === 'leaderboard'
          ? 'No completed rides for the chosen period.'
          : 'Adjust the date range, or pick a wider window.'"
        (pageChange)="onPageChange($event)"
        (pageSizeChange)="onPageSizeChange($event)"
        (rowClick)="onDriverClick($event.driver_id)"
      >
        <tm-input
          slot="search"
          icon="search"
          [placeholder]="mode === 'leaderboard'
            ? 'Search driver, phone or rank'
            : 'Search driver, phone or ID'"
          [(ngModel)]="search"
          (ngModelChange)="onSearchChange()"
        />

        <ng-container slot="filters">
          <!-- LEADERBOARD: period -->
          <ng-container *ngIf="mode === 'leaderboard'">
            <div
              class="state-select"
              [class.has-value]="period !== 'day'"
              [class.is-open]="periodOpen"
            >
              <button
                type="button"
                class="state-select__trigger"
                (click)="togglePeriodMenu($event)"
                aria-haspopup="listbox"
                [attr.aria-expanded]="periodOpen"
                aria-label="Leaderboard period"
              >
                <span class="state-select__icon" aria-hidden="true">
                  <tm-icon name="calendar" [size]="14" />
                </span>
                <span class="state-select__value">{{ periodLabel() }}</span>
                <tm-icon name="chevron-down" [size]="12" class="state-select__caret" />
              </button>
              <ul
                class="state-select__menu"
                *ngIf="periodOpen"
                role="listbox"
                (click)="$event.stopPropagation()"
              >
                <li
                  *ngFor="let opt of periodOptions"
                  class="state-select__option"
                  [class.is-selected]="period === opt.value"
                  role="option"
                  [attr.aria-selected]="period === opt.value"
                  (click)="selectPeriod(opt.value)"
                >
                  <tm-icon
                    *ngIf="period === opt.value"
                    name="check"
                    [size]="12"
                    class="state-select__option-check"
                  />
                  <span class="state-select__option-label">{{ opt.label }}</span>
                </li>
              </ul>
            </div>
          </ng-container>

          <!-- PERFORMANCE: date range -->
          <ng-container *ngIf="mode === 'performance'">
            <label class="date-field">
              <span class="date-field__lbl">From</span>
              <input
                type="date"
                class="date-field__input"
                [(ngModel)]="dateFrom"
                [max]="dateTo || todayIso"
                (change)="onDateRangeChange()"
              />
            </label>
            <label class="date-field">
              <span class="date-field__lbl">To</span>
              <input
                type="date"
                class="date-field__input"
                [(ngModel)]="dateTo"
                [min]="dateFrom"
                [max]="todayIso"
                (change)="onDateRangeChange()"
              />
            </label>
            <button
              *ngIf="dateFrom || dateTo"
              type="button"
              class="date-field__clear"
              (click)="clearDateRange()"
              aria-label="Clear date range"
            >
              <tm-icon name="x" [size]="12" />
            </button>
          </ng-container>
        </ng-container>

        <ng-container slot="banner">
          <span class="filter-pill" *ngIf="mode === 'leaderboard'">
            <span class="filter-pill__icon"><tm-icon name="calendar" [size]="11" /></span>
            <span class="filter-pill__label">Period</span>
            <span class="filter-pill__value">{{ periodLabel() }}</span>
          </span>
          <span class="filter-pill" *ngIf="mode === 'performance' && (dateFrom || dateTo)">
            <span class="filter-pill__icon"><tm-icon name="calendar" [size]="11" /></span>
            <span class="filter-pill__label">Range</span>
            <span class="filter-pill__value">{{ dateFrom || '…' }} → {{ dateTo || '…' }}</span>
            <button type="button" class="filter-pill__close" (click)="clearDateRange()" aria-label="Clear date range">
              <tm-icon name="x" [size]="12" />
            </button>
          </span>
        </ng-container>

        <!-- LEADERBOARD columns -->
        <ng-container *ngIf="mode === 'leaderboard'">
          <tm-column key="rank" label="Rank" width="90">
            <ng-template let-row>
              <span class="rank-badge" [class.is-top]="row.rank <= 3">
                <span *ngIf="row.rank === 1" class="rank-badge__crown" aria-hidden="true">★</span>
                #{{ row.rank }}
              </span>
            </ng-template>
          </tm-column>
          <tm-column key="driver" label="Driver">
            <ng-template let-row>
              <div class="cell-user">
                <span
                  class="cell-avatar"
                  [class.cell-avatar--photo]="row.avatar_url || row.avatar_path"
                  [style.backgroundImage]="(row.avatar_url || row.avatar_path) ? 'url(' + (row.avatar_url || row.avatar_path) + ')' : null"
                >
                  <ng-container *ngIf="!(row.avatar_url || row.avatar_path)">{{ initials(row.name) }}</ng-container>
                </span>
                <div class="cell-user__meta">
                  <span class="cell-user__name">{{ row.name || 'Unnamed' }}</span>
                  <span class="cell-user__sub mono">#{{ row.driver_id }}</span>
                </div>
              </div>
            </ng-template>
          </tm-column>
          <tm-column key="phone" label="Phone" width="170">
            <ng-template let-row>
              <span class="mono">{{ row.phone || '—' }}</span>
            </ng-template>
          </tm-column>
          <tm-column key="rides" label="Rides" width="130" align="right">
            <ng-template let-row>
              <span class="rides-chip" [class.is-zero]="!row.rides">{{ row.rides ?? 0 }}</span>
            </ng-template>
          </tm-column>
          <tm-column key="view" label="" width="60" align="right">
            <ng-template let-row>
              <button
                type="button"
                class="row-eye"
                aria-label="View driver"
                (click)="$event.stopPropagation(); onDriverClick(row.driver_id)"
              >
                <tm-icon name="eye" [size]="14" />
              </button>
            </ng-template>
          </tm-column>
        </ng-container>

        <!-- PERFORMANCE columns -->
        <ng-container *ngIf="mode === 'performance'">
          <tm-column key="id" label="ID" width="100">
            <ng-template let-row>
              <span class="cell-id">#{{ row.driver_id }}</span>
            </ng-template>
          </tm-column>
          <tm-column key="driver" label="Driver">
            <ng-template let-row>
              <div class="cell-user">
                <span
                  class="cell-avatar"
                  [class.cell-avatar--photo]="row.avatar_url || row.avatar_path"
                  [style.backgroundImage]="(row.avatar_url || row.avatar_path) ? 'url(' + (row.avatar_url || row.avatar_path) + ')' : null"
                >
                  <ng-container *ngIf="!(row.avatar_url || row.avatar_path)">{{ initials(row.name) }}</ng-container>
                </span>
                <div class="cell-user__meta">
                  <span class="cell-user__name">{{ row.name || 'Unnamed' }}</span>
                  <span class="cell-user__sub mono">{{ row.phone || '—' }}</span>
                </div>
              </div>
            </ng-template>
          </tm-column>
          <tm-column key="successful" label="OK" width="90" align="right">
            <ng-template let-row>
              <span class="stat-pill stat-pill--ok" title="Successfully completed rides">
                {{ row.successful ?? 0 }}
              </span>
            </ng-template>
          </tm-column>
          <tm-column key="cancelled" label="Cancelled" width="110" align="right">
            <ng-template let-row>
              <span class="stat-pill stat-pill--warn"
                    title="Cancelled by customer or by driver after accepting">
                {{ row.cancelled ?? 0 }}
              </span>
            </ng-template>
          </tm-column>
          <tm-column key="missed" label="Missed" width="100" align="right">
            <ng-template let-row>
              <span class="stat-pill stat-pill--bad"
                    title="Rejected by driver or timed out">
                {{ row.missed ?? 0 }}
              </span>
            </ng-template>
          </tm-column>
          <tm-column key="total" label="Total" width="90" align="right">
            <ng-template let-row>
              <strong class="cell-total">{{ row.total ?? 0 }}</strong>
            </ng-template>
          </tm-column>
          <tm-column key="view" label="" width="60" align="right">
            <ng-template let-row>
              <button
                type="button"
                class="row-eye"
                aria-label="View driver"
                (click)="$event.stopPropagation(); onDriverClick(row.driver_id)"
              >
                <tm-icon name="eye" [size]="14" />
              </button>
            </ng-template>
          </tm-column>
        </ng-container>
      </tm-data-table>

      <p class="footnote" *ngIf="mode === 'performance' && view === 'table'">
        Only drivers with at least one request in the range appear here.
        <strong>Cancelled</strong> covers customer- and driver-initiated cancellations after accepting;
        <strong>Missed</strong> covers driver rejections and request timeouts.
      </p>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .insights { display: flex; flex-direction: column; gap: var(--tm-space-3); }

    /* ---------- Custom period dropdown ---------- */
    .state-select { position: relative; display: inline-block; }
    .state-select__trigger {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 9px 14px;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      background: transparent;
      font-family: var(--tm-font-body);
      font-size: 13px;
      font-weight: 700;
      color: var(--tm-text);
      cursor: pointer;
      line-height: 1.2;
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
    .state-select__value { min-width: 90px; text-align: left; }
    .state-select__caret {
      color: var(--tm-text-soft);
      transition: transform var(--tm-duration-fast) var(--tm-ease);
    }
    .state-select.is-open .state-select__caret { transform: rotate(180deg); }
    .state-select.has-value .state-select__caret { color: var(--tm-green-deep); }
    .state-select__menu {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      min-width: 160px;
      margin: 0;
      padding: 6px;
      list-style: none;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      box-shadow: var(--tm-shadow-pop);
      z-index: 1200;
    }
    .state-select__option {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: var(--tm-radius-sm);
      font-size: 12px;
      font-weight: 600;
      color: var(--tm-text);
      cursor: pointer;
    }
    .state-select__option:hover { background: var(--tm-canvas-2); }
    .state-select__option.is-selected {
      background: var(--tm-green-tint);
      color: var(--tm-green-deep);
      font-weight: 700;
    }
    .state-select__option-check { color: var(--tm-green-deep); flex-shrink: 0; }
    .state-select__option-label { flex: 1; }

    /* ---------- Date range inputs ---------- */
    .date-field {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      background: transparent;
      transition: border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .date-field:focus-within { border-color: var(--tm-ink); }
    .date-field__lbl {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--tm-text-muted);
    }
    .date-field__input {
      border: 0;
      outline: 0;
      background: transparent;
      font-family: var(--tm-font-mono);
      font-size: 12px;
      font-weight: 600;
      color: var(--tm-text);
      padding: 4px 0;
      min-width: 120px;
      cursor: pointer;
    }
    .date-field__clear {
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
    .date-field__clear:hover { background: var(--tm-ink); color: #fff; }

    /* ---------- Filter pills ---------- */
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
    .filter-pill__value { font-family: var(--tm-font-mono); font-weight: 700; }
    .filter-pill__close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--tm-canvas-2);
      color: var(--tm-text-muted);
    }
    .filter-pill__close:hover { background: var(--tm-ink); color: #fff; }

    /* ---------- Cell renderers ---------- */
    .rank-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: var(--tm-radius-pill);
      background: var(--tm-canvas-2);
      color: var(--tm-text-muted);
      font-family: var(--tm-font-mono);
      font-size: 12px;
      font-weight: 800;
    }
    .rank-badge.is-top { background: var(--tm-green-tint); color: var(--tm-green-deep); }
    .rank-badge__crown { font-size: 11px; line-height: 1; }

    .cell-id {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border-radius: var(--tm-radius-pill);
      background: var(--tm-green-tint);
      color: var(--tm-green-deep);
      font-family: var(--tm-font-mono);
      font-size: 11px;
      font-weight: 800;
    }

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
      flex-shrink: 0;
    }
    .cell-avatar--photo {
      background-color: var(--tm-canvas-2);
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
    }
    /* Eye action button — mirrors drivers-list row-action styling. */
    .row-eye {
      width: 28px; height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      border: 0;
      background: transparent;
      color: var(--tm-text-soft);
      cursor: pointer;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .row-eye:hover { background: var(--tm-canvas-2); color: var(--tm-text); }
    .cell-user__meta { display: flex; flex-direction: column; min-width: 0; }
    .cell-user__name {
      font-weight: 700;
      font-size: 13px;
      color: var(--tm-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cell-user__sub { font-size: 11px; color: var(--tm-text-muted); }

    .rides-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 32px;
      padding: 3px 10px;
      border-radius: var(--tm-radius-pill);
      background: var(--tm-green-tint);
      color: var(--tm-green-deep);
      font-family: var(--tm-font-mono);
      font-size: 12px;
      font-weight: 800;
    }
    .rides-chip.is-zero { background: var(--tm-canvas-2); color: var(--tm-text-soft); }

    .stat-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 40px;
      padding: 3px 10px;
      border-radius: var(--tm-radius-pill);
      font-family: var(--tm-font-mono);
      font-size: 12px;
      font-weight: 800;
      border: 1px solid transparent;
    }
    .stat-pill--ok   { background: var(--tm-green-tint); color: var(--tm-green-deep); border-color: var(--tm-green-soft); }
    .stat-pill--warn { background: #fffbeb;              color: #b45309;              border-color: #fde68a; }
    .stat-pill--bad  { background: #fef2f2;              color: #dc2626;              border-color: #fecaca; }

    .cell-total {
      font-family: var(--tm-font-mono);
      font-size: 13px;
      font-weight: 800;
      color: var(--tm-text);
    }

    .mono { font-family: var(--tm-font-mono); font-weight: 600; font-size: 12px; }

    .footnote {
      font-size: 12px;
      color: var(--tm-text-muted);
      line-height: 1.5;
      margin: 0;
      padding: 10px 12px;
      background: var(--tm-canvas);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-sm);
    }
    .footnote strong { color: var(--tm-text); font-weight: 700; }

    /* ---------- Graph view inside insights ---------- */
    .insights__graph-filters {
      display: flex;
      gap: var(--tm-space-2);
      flex-wrap: wrap;
      align-items: center;
    }
    .graph-card {
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-md);
      padding: var(--tm-space-4);
      display: flex;
      flex-direction: column;
      gap: var(--tm-space-3);
    }
    .graph-card__head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
    }
    .graph-card__title {
      margin: 0;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--tm-text);
    }
    .graph-card__hint {
      font-size: 11px;
      font-weight: 600;
      color: var(--tm-text-muted);
    }
    .graph-card--empty {
      align-items: center;
      justify-content: center;
      color: var(--tm-text-muted);
      min-height: 200px;
      text-align: center;
    }
    .graph-card--empty p { margin: 0; font-size: 13px; }
    .graph-card__legend {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      font-size: 12px;
      color: var(--tm-text-muted);
      font-weight: 600;
    }
    .graph-card__legend li { display: inline-flex; align-items: center; gap: 6px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .dot--ok   { background: #16A34A; }
    .dot--warn { background: #F59E0B; }
    .dot--bad  { background: #DC2626; }

    /* Match toolbar input height with the rest */
    :host ::ng-deep tm-data-table .tm-dt__toolbar tm-input .field {
      background: transparent;
      border-color: var(--tm-line-2);
      padding: 9px 14px;
      gap: 8px;
    }
    :host ::ng-deep tm-data-table .tm-dt__toolbar tm-input .field:focus-within {
      border-color: var(--tm-ink);
      background: var(--tm-surface);
    }
    :host ::ng-deep tm-data-table .tm-dt__toolbar tm-input input {
      font-size: 13px;
      line-height: 1.2;
    }
  `],
})
export class DriversInsightsComponent implements OnInit, OnChanges, OnDestroy {
  @Input() mode: InsightMode = 'leaderboard';
  /** 'table' renders the data table; 'graph' renders a chart for the same data. */
  @Input() view: InsightsView = 'table';
  /**
   * The parent toggles this when the drawer opens/closes; we use it to
   * skip pointless network calls while hidden and to refetch on (re)open.
   */
  @Input() active = true;

  /**
   * Fires when the user clicks a driver row (or the eye action) in the
   * leaderboard / performance tables. The parent decides what to do — typically
   * close this drawer and open the driver detail drawer.
   */
  @Output() driverClick = new EventEmitter<number>();

  /** Exposed so the template can call Math.max for dynamic chart heights. */
  readonly Math = Math;
  readonly topNLeaderboard = 15;
  readonly topNPerformance = 10;

  // Leaderboard state
  period: LeaderboardPeriod = 'day';
  periodOpen = false;
  readonly periodOptions: { value: LeaderboardPeriod; label: string }[] = [
    { value: 'day', label: 'Today' },
    { value: 'week', label: 'This week' },
    { value: 'month', label: 'This month' },
  ];

  // Performance state
  dateFrom = '';
  dateTo = '';
  todayIso = new Date().toISOString().slice(0, 10);

  // Shared state
  search = '';
  rows: UnifiedRow[] = [];
  loading = false;
  page = 1;
  pageSize = 25;

  private searchDebounce: ReturnType<typeof setTimeout> | null = null;
  private hasFetched: Record<InsightMode, boolean> = { leaderboard: false, performance: false };

  constructor(private api: ApiService, private toast: ToastService) {
    const now = new Date();
    const past = new Date();
    past.setDate(now.getDate() - 30);
    this.dateFrom = past.toISOString().slice(0, 10);
    this.dateTo = this.todayIso;
  }

  ngOnInit(): void {
    if (this.active) this.fetch();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['mode'] && !changes['mode'].firstChange) {
      // Switching tabs while the drawer is open — wipe search + reset paging.
      this.page = 1;
      this.search = '';
      this.fetch();
    }
    if (changes['active'] && this.active && !changes['active'].firstChange) {
      // Drawer reopened — refresh whichever tab is active.
      this.fetch();
    }
  }

  ngOnDestroy(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
  }

  // -------------------- Period --------------------
  periodLabel(): string {
    return this.periodOptions.find((o) => o.value === this.period)?.label ?? 'Today';
  }
  togglePeriodMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.periodOpen = !this.periodOpen;
  }
  selectPeriod(value: LeaderboardPeriod): void {
    this.periodOpen = false;
    if (this.period === value) return;
    this.period = value;
    this.page = 1;
    this.fetch();
  }

  // -------------------- Date range --------------------
  onDateRangeChange(): void {
    if (this.dateFrom && this.dateTo && this.dateFrom > this.dateTo) {
      this.dateTo = this.dateFrom;
    }
    this.page = 1;
    this.fetch();
  }
  clearDateRange(): void {
    this.dateFrom = '';
    this.dateTo = '';
    this.page = 1;
    this.fetch();
  }

  // -------------------- Search --------------------
  onSearchChange(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => { this.page = 1; }, 200);
  }
  get filteredRows(): UnifiedRow[] {
    const term = this.search.trim().toLowerCase();
    if (!term) return this.rows;
    return this.rows.filter((r) => {
      const idMatch = String(r.driver_id).includes(term);
      const nameMatch = (r.name || '').toLowerCase().includes(term);
      const phoneMatch = (r.phone || '').toLowerCase().includes(term);
      const rankMatch =
        this.mode === 'leaderboard' &&
        String((r as LeaderboardRow).rank ?? '').includes(term);
      return idMatch || nameMatch || phoneMatch || rankMatch;
    });
  }
  get pagedRows(): UnifiedRow[] {
    const start = (this.page - 1) * this.pageSize;
    return this.filteredRows.slice(start, start + this.pageSize);
  }

  // -------------------- Pagination --------------------
  onPageChange(p: number): void { this.page = p; }
  onPageSizeChange(s: number): void { this.pageSize = s; this.page = 1; }

  /**
   * Emits the row's driver_id so the parent (drivers-list) can close this
   * insights drawer and route to the driver detail drawer. Guards against
   * undefined ids in case the leaderboard/performance payload is partial.
   */
  onDriverClick(driverId: number | null | undefined): void {
    if (driverId == null) return;
    this.driverClick.emit(driverId);
  }

  // -------------------- Fetch --------------------
  private fetch(): void {
    this.loading = true;
    const url = this.mode === 'leaderboard'
      ? `/admin/drivers/leaderboard?period=${this.period}`
      : this.performanceUrl();

    this.api.get<{ data: UnifiedRow[] }>(url).subscribe({
      next: (res) => {
        this.rows = res?.data ?? [];
        this.loading = false;
        this.hasFetched[this.mode] = true;
      },
      error: (err) => {
        this.rows = [];
        this.loading = false;
        this.toast.error(
          err?.error?.message ||
            (this.mode === 'leaderboard' ? 'Failed to load leaderboard' : 'Failed to load performance'),
          { title: 'Load failed' },
        );
      },
    });
  }

  private performanceUrl(): string {
    const parts: string[] = [];
    if (this.dateFrom) parts.push(`from=${this.dateFrom}`);
    if (this.dateTo) parts.push(`to=${this.dateTo}`);
    return `/admin/drivers/performance${parts.length ? `?${parts.join('&')}` : ''}`;
  }

  // -------------------- Helpers --------------------
  initials(name: string | null | undefined): string {
    if (!name) return '—';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '—';
    const a = parts[0][0] || '';
    const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (a + b).toUpperCase();
  }

  // -------------------- Chart configs --------------------
  /** Horizontal bar chart of the top-N leaderboard entries. */
  get leaderboardChart() {
    const top = (this.rows as LeaderboardRow[]).slice(0, this.topNLeaderboard);
    return {
      data: {
        labels: top.map((r) => r.name?.slice(0, 24) || `#${r.driver_id}`),
        datasets: [{
          label: 'Rides',
          data: top.map((r) => r.rides ?? 0),
          backgroundColor: top.map((r) => r.rank <= 3 ? '#16A34A' : '#22C55E'),
          borderRadius: 6,
          borderSkipped: false,
        }],
      },
      options: {
        indexAxis: 'y' as const,
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#ECEFF3' } },
          y: { grid: { display: false } },
        },
      },
    };
  }

  /** Grouped horizontal bar chart of successful / cancelled / missed per driver. */
  get performanceChart() {
    const top = [...(this.rows as PerformanceRow[])]
      .sort((a, b) => (b.total ?? 0) - (a.total ?? 0))
      .slice(0, this.topNPerformance);
    const labels = top.map((r) => r.name?.slice(0, 24) || `#${r.driver_id}`);
    return {
      data: {
        labels,
        datasets: [
          {
            label: 'Successful',
            data: top.map((r) => r.successful ?? 0),
            backgroundColor: '#16A34A',
            borderRadius: 4,
            borderSkipped: false,
          },
          {
            label: 'Cancelled',
            data: top.map((r) => r.cancelled ?? 0),
            backgroundColor: '#F59E0B',
            borderRadius: 4,
            borderSkipped: false,
          },
          {
            label: 'Missed',
            data: top.map((r) => r.missed ?? 0),
            backgroundColor: '#DC2626',
            borderRadius: 4,
            borderSkipped: false,
          },
        ],
      },
      options: {
        indexAxis: 'y' as const,
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#ECEFF3' } },
          y: { stacked: true, grid: { display: false } },
        },
      },
    };
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.periodOpen) this.periodOpen = false;
  }

  @HostListener('document:keydown.escape')
  onDocumentEscape(): void {
    if (this.periodOpen) this.periodOpen = false;
  }
}
