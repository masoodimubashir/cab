import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import {
  ButtonComponent,
  IconComponent,
  DataTableComponent,
  ColumnComponent,
} from '../../ui';

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
 * A row as the table actually renders it. A shared journey (one Fixed vehicle,
 * many passengers) produces a movement per passenger, which buries the thing an
 * operator is looking for. So consecutive movements on the same trip collapse
 * into a single summary line carrying the trip's totals, expandable to the real
 * rows underneath. Grouping is purely presentational — the underlying entries
 * and their amounts are untouched.
 */
interface DisplayRow extends LedgerRow {
  /** Set on a summary line; absent on real ledger rows. */
  group?: {
    key: string;
    count: number;
    captured: number;
    toDriver: number;
    commission: number;
    refunded: number;
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

/**
 * The money ledger — every rupee that moved, and the proof each trip adds up.
 *
 * This is the operator's answer to "where did the money go?". Under the
 * auto-split engine nobody moves money by hand, so the only useful questions
 * are what happened and whether it balances. Both are answered here:
 *
 *   captured = to driver + held + to operator     (nothing invented or lost)
 *
 * A trip that fails that check is the one thing on this screen that needs a
 * human, so it's filterable in one click and flagged in red.
 *
 * Strictly read-only. Nothing here can change a balance.
 */
@Component({
  selector: 'app-finance-ledger',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, IconComponent, DataTableComponent, ColumnComponent],
  template: `
    <div class="page">
      <header class="page__hero">
        <div>
          <h1 class="page__title">Money ledger</h1>
          <p class="page__sub">
            Every rupee that moved, newest first — captured from riders, split to drivers,
            retained as commission, refunded. Append-only: nothing here is ever edited.
          </p>
        </div>
        <div class="hero__side">
          <tm-button variant="outline" size="sm" icon="refresh" [loading]="loading" (clicked)="load()">Refresh</tm-button>
        </div>
      </header>

      <!-- Does it add up? The headline question, answered first. -->
      <div class="verdict" [class.verdict--bad]="summary.unbalanced > 0" *ngIf="!loading && !error">
        <span class="verdict__icon">
          <tm-icon [name]="summary.unbalanced > 0 ? 'bell' : 'check'" [size]="18" />
        </span>
        <div class="verdict__body">
          <strong *ngIf="summary.unbalanced === 0">All {{ summary.trips }} trips in view balance to the paise.</strong>
          <strong *ngIf="summary.unbalanced > 0">
            {{ summary.unbalanced }} of {{ summary.trips }} trips don't balance.
          </strong>
          <span>
            {{ summary.unbalanced > 0
              ? 'Money was recorded as more or less than was captured. Each one needs a look.'
              : 'Captured equals what went to drivers, what is held, and what the operator kept.' }}
          </span>
        </div>
        <tm-button
          *ngIf="summary.unbalanced > 0 && !unbalancedOnly"
          variant="outline" size="sm"
          (clicked)="setUnbalanced(true)"
        >Show only these</tm-button>
      </div>

      <!-- Where the money in view went -->
      <div class="cards" *ngIf="!loading && !error">
        <div class="card">
          <span class="card__label">Captured</span>
          <span class="card__value">₹ {{ summary.captured | number:'1.2-2' }}</span>
          <span class="card__meta">from riders</span>
        </div>
        <div class="card card--driver">
          <span class="card__label">To drivers</span>
          <span class="card__value">₹ {{ summary.to_driver | number:'1.2-2' }}</span>
          <span class="card__meta">transferred at source</span>
        </div>
        <div class="card card--held" *ngIf="summary.held > 0">
          <span class="card__label">Held</span>
          <span class="card__value">₹ {{ summary.held | number:'1.2-2' }}</span>
          <span class="card__meta">owed, not yet payable</span>
        </div>
        <div class="card card--operator">
          <span class="card__label">Commission</span>
          <span class="card__value">₹ {{ summary.to_operator | number:'1.2-2' }}</span>
          <span class="card__meta">retained</span>
        </div>
        <div class="card card--fee" *ngIf="summary.gateway_fee > 0">
          <span class="card__label">Gateway fee</span>
          <span class="card__value">₹ {{ summary.gateway_fee | number:'1.2-2' }}</span>
          <span class="card__meta">paid by riders, kept by Razorpay</span>
        </div>
        <div class="card card--refund" *ngIf="summary.refunded > 0">
          <span class="card__label">Refunded</span>
          <span class="card__value">₹ {{ summary.refunded | number:'1.2-2' }}</span>
          <span class="card__meta">back to riders</span>
        </div>
      </div>

      <!-- Filters -->
      <div class="toolbar">
        <div class="tabs">
          <button type="button" class="tab" [class.tab--on]="type === 'all'" (click)="setType('all')">All movements</button>
          <button type="button" class="tab" *ngFor="let t of types"
            [class.tab--on]="type === t.key" (click)="setType(t.key)">{{ t.label }}</button>
        </div>

        <div class="toolbar__right">
          <label class="check">
            <input type="checkbox" [ngModel]="unbalancedOnly" (ngModelChange)="setUnbalanced($event)" />
            <span>Only trips that don't balance</span>
          </label>

          <label class="check">
            <input type="checkbox" [ngModel]="groupByTrip" (ngModelChange)="setGrouping($event)" />
            <span>Group by trip</span>
          </label>

          <div class="search">
            <span class="search__icon"><tm-icon name="search" [size]="15" /></span>
            <input type="text" class="search__input" placeholder="Trip ID"
              [(ngModel)]="tripFilter" (keyup.enter)="load()" />
            <button *ngIf="tripFilter" type="button" class="search__clear" (click)="tripFilter=''; load()" aria-label="Clear">
              <tm-icon name="x" [size]="13" />
            </button>
          </div>
        </div>
      </div>

      <div class="state state--error" *ngIf="error">{{ error }}</div>

      <tm-data-table
        [rows]="pagedRows"
        [total]="display.length"
        [page]="page"
        [pageSize]="pageSize"
        [loading]="loading"
        [showToolbar]="false"
        emptyTitle="No movements to show"
        emptyHint="Money movements appear here as rides are paid, split and refunded."
        (pageChange)="page = $event"
        (pageSizeChange)="pageSize = $event; page = 1"
      >
        <tm-column key="created_at" label="When" width="150">
          <ng-template let-row>
            <div class="stack" [class.stack--child]="row.child">
              <span class="strong">{{ row.created_at | date:'d MMM y' }}</span>
              <span class="muted">{{ row.created_at | date:'h:mm a' }}</span>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="type" label="Movement" width="180">
          <ng-template let-row>
            <button
              *ngIf="row.group; else plainType"
              type="button" class="grouptoggle"
              (click)="toggleGroup(row.group.key)"
              [attr.aria-expanded]="isExpanded(row.group.key)"
            >
              <tm-icon [name]="isExpanded(row.group.key) ? 'chevron-down' : 'chevron-right'" [size]="14" />
              <span>{{ row.group.count }} movements</span>
            </button>
            <ng-template #plainType>
              <span class="mv" [ngClass]="'mv--' + row.type" [class.mv--child]="row.child">{{ typeLabel(row.type) }}</span>
            </ng-template>
          </ng-template>
        </tm-column>

        <tm-column key="party" label="Party" width="150">
          <ng-template let-row>
            <span class="party" *ngIf="!row.group">{{ row.party }}</span>
            <span class="groupmeta" *ngIf="row.group">
              <span>driver ₹ {{ row.group.toDriver | number:'1.2-2' }}</span>
              <span>commission ₹ {{ row.group.commission | number:'1.2-2' }}</span>
              <span class="groupmeta--refund" *ngIf="row.group.refunded > 0">
                refunded ₹ {{ row.group.refunded | number:'1.2-2' }}
              </span>
            </span>
          </ng-template>
        </tm-column>

        <tm-column key="trip_id" label="Trip" width="110">
          <ng-template let-row>
            <button type="button" class="triplink" *ngIf="row.trip_id" (click)="focusTrip(row.trip_id)">
              #{{ row.trip_id }}
            </button>
            <span class="muted" *ngIf="!row.trip_id">—</span>
          </ng-template>
        </tm-column>

        <tm-column key="balance" label="Trip balances?" width="190">
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

        <tm-column key="razorpay_ref" label="Reference" width="190">
          <ng-template let-row>
            <span class="ref" *ngIf="!row.group">{{ row.razorpay_ref || '—' }}</span>
            <span class="muted" *ngIf="row.group">{{ row.group.count }} references</span>
          </ng-template>
        </tm-column>

        <tm-column key="amount" label="Amount" width="140" align="right">
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

    .verdict { display: flex; align-items: center; gap: 12px; padding: 12px 14px;
      border: 1px solid var(--tm-line); border-radius: var(--tm-radius-lg); background: var(--tm-green-tint); }
    .verdict__icon { display: inline-flex; color: var(--tm-green-deep); flex: none; }
    .verdict__body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
    .verdict__body strong { font-size: 13.5px; font-weight: 800; color: var(--tm-text); }
    .verdict__body span { font-size: 12px; color: var(--tm-text-muted); }
    .verdict--bad { background: var(--tm-danger-bg, #fef3f2); border-color: var(--tm-danger, #B42318); }
    .verdict--bad .verdict__icon { color: var(--tm-danger, #B42318); }

    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
    .card { display: flex; flex-direction: column; gap: 3px; padding: 12px 14px; background: var(--tm-surface);
      border: 1px solid var(--tm-line); border-radius: var(--tm-radius-lg); }
    .card__label { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--tm-text-muted); font-weight: 700; }
    .card__value { font-size: 19px; font-weight: 850; color: var(--tm-text); font-variant-numeric: tabular-nums; }
    .card__meta { font-size: 11px; color: var(--tm-text-soft); }
    .card--driver .card__value { color: var(--tm-info-fg, #1d4ed8); }
    .card--operator .card__value { color: var(--tm-green-deep); }
    .card--held .card__value { color: var(--tm-warning-fg, #92400e); }
    .card--refund .card__value { color: var(--tm-danger, #B42318); }
    .card--fee .card__value { color: var(--tm-text-muted); }

    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .toolbar__right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .tabs { display: flex; gap: 6px; flex-wrap: wrap; }
    .tab { border: 1px solid var(--tm-line); background: var(--tm-surface); color: var(--tm-text-muted);
      border-radius: 999px; padding: 6px 14px; font: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer; }
    .tab--on { background: var(--tm-text); color: var(--tm-surface); border-color: var(--tm-text); }

    .check { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 700;
      color: var(--tm-text-muted); cursor: pointer; white-space: nowrap; }
    .check input { accent-color: var(--tm-ink); }

    .search { display: inline-flex; align-items: center; gap: 8px; min-width: 150px; max-width: 200px;
      padding: 8px 10px 8px 12px; border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-md); }
    .search:focus-within { border-color: var(--tm-ink); }
    .search__icon { color: var(--tm-text-muted); display: inline-flex; }
    .search__input { flex: 1; min-width: 0; appearance: none; background: transparent; border: 0; outline: 0;
      font-family: var(--tm-font-body); font-size: 13px; font-weight: 600; color: var(--tm-text); padding: 0; }
    .search__clear { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px;
      border-radius: 50%; background: var(--tm-canvas-2); color: var(--tm-text-muted); }

    .state { padding: 16px; text-align: center; color: var(--tm-text-muted); font-size: 13px;
      background: var(--tm-surface); border: 1px solid var(--tm-line); border-radius: var(--tm-radius-lg); }
    .state--error { color: var(--tm-danger, #B42318); }

    .stack { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .strong { font-weight: 800; color: var(--tm-text); }
    .muted { color: var(--tm-text-muted); font-size: 11px; }
    .ref { font-family: var(--tm-font-mono); font-size: 11.5px; color: var(--tm-text-muted); overflow-wrap: anywhere; }
    .party { font-size: 12.5px; font-weight: 700; color: var(--tm-text-muted); text-transform: capitalize; }
    .amount { font-weight: 800; color: var(--tm-green-deep); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .amount--out { color: var(--tm-text); }

    .mv { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 10.5px; font-weight: 800;
      background: var(--tm-canvas-2); color: var(--tm-text-muted); white-space: nowrap; }
    .mv--capture { background: var(--tm-green-tint); color: var(--tm-green-deep); }
    .mv--transfer { background: var(--tm-info-bg, #eef4ff); color: var(--tm-info-fg, #1d4ed8); }
    .mv--retained { background: var(--tm-canvas-2); color: var(--tm-text); }
    .mv--gateway_fee { background: var(--tm-canvas-2); color: var(--tm-text-muted); }
    .mv--held { background: var(--tm-warning-bg, #fff4e5); color: var(--tm-warning-fg, #92400e); }
    .mv--refund, .mv--reversal { background: var(--tm-danger-bg, #fef3f2); color: var(--tm-danger, #B42318); }

    .triplink { border: 0; background: transparent; padding: 0; font: inherit; font-size: 12.5px; font-weight: 800;
      color: var(--tm-info-fg, #1d4ed8); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }

    .bal { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px;
      font-size: 11.5px; font-weight: 800; background: var(--tm-green-tint); color: var(--tm-green-deep); white-space: nowrap; }
    .bal__dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
    .bal--bad { background: var(--tm-danger-bg, #fef3f2); color: var(--tm-danger, #B42318); }

    .grouptoggle { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent;
      padding: 0; font: inherit; font-size: 12.5px; font-weight: 800; color: var(--tm-text); cursor: pointer; }
    .grouptoggle tm-icon { color: var(--tm-text-muted); display: inline-flex; }
    .groupmeta { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--tm-text-muted);
      font-variant-numeric: tabular-nums; }
    .groupmeta--refund { color: var(--tm-danger, #B42318); }
    .stack--child { padding-left: 14px; border-left: 2px solid var(--tm-line); }
    .mv--child { opacity: 0.85; }
  `],
})
export class FinanceLedgerComponent implements OnInit {
  rows: LedgerRow[] = [];
  reconciliation: Record<string, TripBalance> = {};
  summary: LedgerResponse['summary'] = {
    captured: 0, to_driver: 0, held: 0, to_operator: 0, gateway_fee: 0, refunded: 0, trips: 0, unbalanced: 0,
  };

  loading = false;
  error = '';

  type: string = 'all';
  tripFilter = '';
  unbalancedOnly = false;

  /** Collapse each trip's movements into one line — on by default. */
  groupByTrip = true;
  /** Which summary lines are opened, keyed by group key. */
  expanded: Record<string, boolean> = {};

  page = 1;
  pageSize = 25;

  readonly types = [
    { key: 'capture', label: 'Captured' },
    { key: 'transfer', label: 'To driver' },
    { key: 'retained', label: 'Commission' },
    { key: 'gateway_fee', label: 'Gateway fee' },
    { key: 'held', label: 'Held' },
    { key: 'refund', label: 'Refunds' },
    { key: 'reversal', label: 'Reversals' },
  ];

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = '';

    const params: string[] = [];
    const trip = this.tripFilter.trim();
    if (trip) params.push(`trip_id=${encodeURIComponent(trip)}`);
    if (this.unbalancedOnly) params.push('unbalanced=1');
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

  setType(key: string): void {
    this.type = key;
    this.page = 1;
  }

  setUnbalanced(on: boolean): void {
    this.unbalancedOnly = on;
    this.load();
  }

  /** Jump the whole view to one trip — the usual next step after spotting a row. */
  focusTrip(tripId: number): void {
    this.tripFilter = String(tripId);
    this.load();
  }

  get filtered(): LedgerRow[] {
    if (this.type === 'all') return this.rows;
    return this.rows.filter((r) => r.type === this.type);
  }

  /**
   * The filtered rows with same-trip runs collapsed into summary lines. A run of
   * one is left as a plain row — wrapping a single movement in a "1 movement"
   * header would be noise. Rows with no trip (nothing to group by) always stay
   * flat.
   */
  get display(): DisplayRow[] {
    const rows = this.filtered;
    if (!this.groupByTrip) return rows;

    const out: DisplayRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const tripId = rows[i].trip_id;
      if (tripId == null) {
        out.push(rows[i]);
        continue;
      }

      // Rows arrive newest-first and a journey's movements land together, so a
      // run is the journey. Scan to the end of it.
      let end = i;
      while (end + 1 < rows.length && rows[end + 1].trip_id === tripId) end++;

      const run = rows.slice(i, end + 1);
      i = end;

      if (run.length === 1) {
        out.push(run[0]);
        continue;
      }

      const key = `${tripId}:${run[0].id}`;
      out.push({
        ...run[0],
        group: {
          key,
          count: run.length,
          captured: this.sumOf(run, 'capture'),
          toDriver: this.sumOf(run, 'transfer') + this.sumOf(run, 'release'),
          commission: this.sumOf(run, 'retained'),
          refunded: this.sumOf(run, 'refund'),
        },
      });

      if (this.isExpanded(key)) {
        for (const row of run) out.push({ ...row, child: true });
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

  setGrouping(on: boolean): void {
    this.groupByTrip = on;
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
      case 'capture': return 'Captured';
      case 'transfer': return 'To driver';
      case 'retained': return 'Commission';
      case 'gateway_fee': return 'Gateway fee';
      case 'held': return 'Held';
      case 'release': return 'Released';
      case 'refund': return 'Refunded';
      case 'reversal': return 'Reversed';
      default: return type;
    }
  }
}
