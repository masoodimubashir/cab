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
    count: number;
    captured: number;
    toDriver: number;
    commission: number;
    refunded: number;
    customer_name?: string | null;
    driver_name?: string | null;
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

      <!-- Movement & Party Filter Toolbars -->
      <div class="toolbar">
        <div class="tabs-group">
          <div class="tabs">
            <span class="tabs-label">Movement:</span>
            <button type="button" class="tab" [class.tab--on]="type === 'all'" (click)="setType('all')">All movements</button>
            <button type="button" class="tab" *ngFor="let t of types"
              [class.tab--on]="type === t.key" (click)="setType(t.key)">{{ t.label }}</button>
          </div>

          <div class="tabs">
            <span class="tabs-label">Party (Payer/Recipient):</span>
            <button type="button" class="tab" [class.tab--on]="partyFilter === 'all'" (click)="setPartyFilter('all')">All parties</button>
            <button type="button" class="tab" [class.tab--on]="partyFilter === 'customer'" (click)="setPartyFilter('customer')">Customer (Payer)</button>
            <button type="button" class="tab" [class.tab--on]="partyFilter === 'driver'" (click)="setPartyFilter('driver')">Driver (Recipient)</button>
            <button type="button" class="tab" [class.tab--on]="partyFilter === 'operator'" (click)="setPartyFilter('operator')">Operator (Company)</button>
          </div>
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
            <input type="text" class="search__input" placeholder="Search name, phone, trip #..."
              [(ngModel)]="searchFilter" />
            <button *ngIf="searchFilter" type="button" class="search__clear" (click)="searchFilter=''" aria-label="Clear">
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
        <tm-column key="created_at" label="When" width="140">
          <ng-template let-row>
            <div class="stack" [class.stack--child]="row.child">
              <span class="strong">{{ row.created_at | date:'d MMM y' }}</span>
              <span class="muted">{{ row.created_at | date:'h:mm a' }}</span>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="type" label="Movement" width="160">
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

        <tm-column key="party" label="Party (Payer / Recipient)" width="260">
          <ng-template let-row>
            <ng-container *ngIf="!row.group">
              <div class="party-info" *ngIf="row.party === 'customer'">
                <span class="party-badge party-badge--customer">Customer (Payer)</span>
                <strong class="party-name">{{ row.customer_name || 'Rider' }}</strong>
                <small class="party-phone" *ngIf="row.customer_phone">{{ row.customer_phone }}</small>
              </div>

              <div class="party-info" *ngIf="row.party === 'driver'">
                <span class="party-badge party-badge--driver">Driver (Recipient)</span>
                <strong class="party-name">{{ row.driver_name || 'Driver' }}</strong>
                <small class="party-phone" *ngIf="row.driver_phone">{{ row.driver_phone }}</small>
              </div>

              <div class="party-info" *ngIf="row.party === 'operator'">
                <span class="party-badge party-badge--operator">Company (Operator)</span>
                <strong class="party-name">Platform Commission</strong>
              </div>

              <div class="party-info" *ngIf="row.party !== 'customer' && row.party !== 'driver' && row.party !== 'operator'">
                <span class="party-badge">{{ row.party }}</span>
              </div>
            </ng-container>

            <div class="groupmeta" *ngIf="row.group">
              <span *ngIf="row.group.customer_name">Rider: <strong>{{ row.group.customer_name }}</strong></span>
              <span *ngIf="row.group.driver_name">Driver: <strong>{{ row.group.driver_name }}</strong></span>
              <span>Driver ₹ {{ row.group.toDriver | number:'1.2-2' }} · Commission ₹ {{ row.group.commission | number:'1.2-2' }}</span>
              <span class="groupmeta--refund" *ngIf="row.group.refunded > 0">
                Refunded ₹ {{ row.group.refunded | number:'1.2-2' }}
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

        <tm-column key="balance" label="Trip balances?" width="150">
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

    .toolbar { display: flex; flex-direction: column; gap: 12px; }
    .toolbar__right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .tabs-group { display: flex; flex-direction: column; gap: 8px; }
    .tabs { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .tabs-label { font-size: 12px; font-weight: 700; color: var(--tm-text-muted); margin-right: 4px; }
    .tab { border: 1px solid var(--tm-line); background: var(--tm-surface); color: var(--tm-text-muted);
      border-radius: 999px; padding: 5px 12px; font: inherit; font-size: 12px; font-weight: 800; cursor: pointer; }
    .tab--on { background: var(--tm-text); color: var(--tm-surface); border-color: var(--tm-text); }

    .party-info { display: flex; flex-direction: column; gap: 2px; }
    .party-name { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .party-phone { font-size: 11.5px; color: var(--tm-text-muted); }
    .party-badge { display: inline-block; font-size: 10px; font-weight: 800; text-transform: uppercase;
      letter-spacing: 0.04em; color: var(--tm-text-muted); }
    .party-badge--customer { color: var(--tm-green-deep); }
    .party-badge--driver { color: var(--tm-info-fg, #1d4ed8); }
    .party-badge--operator { color: var(--tm-text); }

    .check { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 700;
      color: var(--tm-text-muted); cursor: pointer; }
    .search { position: relative; display: flex; align-items: center; min-width: 220px; }
    .search__icon { position: absolute; left: 10px; color: var(--tm-text-muted); display: inline-flex; pointer-events: none; }
    .search__input { width: 100%; height: 34px; padding: 0 28px 0 32px; font: inherit; font-size: 12.5px;
      color: var(--tm-text); background: var(--tm-surface); border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-md); outline: none; }
    .search__input:focus { border-color: var(--tm-text); }
    .search__clear { position: absolute; right: 6px; border: 0; background: transparent; padding: 4px;
      color: var(--tm-text-muted); cursor: pointer; display: inline-flex; }

    .mv { display: inline-flex; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 800;
      letter-spacing: 0.02em; background: var(--tm-canvas); color: var(--tm-text); }
    .mv--capture { background: var(--tm-green-tint); color: var(--tm-green-deep); }
    .mv--transfer { background: var(--tm-info-bg, #eff6ff); color: var(--tm-info-fg, #1d4ed8); }
    .mv--retained { background: var(--tm-canvas); color: var(--tm-text); }
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

  type = 'all';
  partyFilter = 'all';
  searchFilter = '';
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

  setPartyFilter(party: string): void {
    this.partyFilter = party;
    this.page = 1;
  }

  setUnbalanced(on: boolean): void {
    this.unbalancedOnly = on;
    this.load();
  }

  focusTrip(tripId: number): void {
    this.searchFilter = String(tripId);
  }

  get filtered(): LedgerRow[] {
    return this.rows.filter((r) => {
      if (this.type !== 'all' && r.type !== this.type) return false;
      if (this.partyFilter !== 'all' && r.party !== this.partyFilter) return false;
      if (this.searchFilter.trim()) {
        const q = this.searchFilter.trim().toLowerCase();
        const tripStr = r.trip_id ? `#${r.trip_id}` : '';
        const cName = (r.customer_name || '').toLowerCase();
        const cPhone = (r.customer_phone || '').toLowerCase();
        const dName = (r.driver_name || '').toLowerCase();
        const dPhone = (r.driver_phone || '').toLowerCase();
        const ref = (r.razorpay_ref || '').toLowerCase();
        const match = tripStr.includes(q) || String(r.trip_id || '').includes(q) ||
          cName.includes(q) || cPhone.includes(q) || dName.includes(q) || dPhone.includes(q) || ref.includes(q);
        if (!match) return false;
      }
      return true;
    });
  }

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

      let end = i;
      while (end + 1 < rows.length && rows[end + 1].trip_id === tripId) end++;

      const run = rows.slice(i, end + 1);
      i = end;

      if (run.length === 1) {
        out.push(run[0]);
        continue;
      }

      const key = `${tripId}:${run[0].id}`;
      const firstCustomer = run.find((r) => r.customer_name)?.customer_name;
      const firstDriver = run.find((r) => r.driver_name)?.driver_name;

      out.push({
        ...run[0],
        group: {
          key,
          count: run.length,
          captured: this.sumOf(run, 'capture'),
          toDriver: this.sumOf(run, 'transfer') + this.sumOf(run, 'release'),
          commission: this.sumOf(run, 'retained'),
          refunded: this.sumOf(run, 'refund'),
          customer_name: firstCustomer,
          driver_name: firstDriver,
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
