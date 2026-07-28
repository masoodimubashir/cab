import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/api.service';
import { ButtonComponent, IconComponent } from '../../../ui';

interface PayoutDueRow {
  driver_id: number;
  user_id: number;
  name: string | null;
  phone: string | null;
  vehicle_reg_no: string | null;
  balance: number;
}

type PayoutState = 'paid' | 'held' | 'failed' | 'reversed' | 'none';

interface MonitorRow {
  payment_id: number;
  trip_id: number | null;
  driver_id: number | null;
  driver_name: string | null;
  driver_phone: string | null;
  driver_amount: number;
  commission_amount: number;
  state: PayoutState;
  transfer_status: string | null;
  transfer_id: string | null;
  reversal_id: string | null;
  split_at: string | null;
}

interface MonitorSummary {
  paid_count: number;
  paid_amount: number;
  failed_count: number;
  held_count: number;
  held_amount: number;
  reversed_count: number;
}

/**
 * A driver with money waiting. The per-payment rows answer "what happened to
 * this ride"; this answers the question an operator acts on — which PEOPLE are
 * owed, and whether anyone needs chasing.
 */
interface OwedRow {
  driver_id: number;
  driver_name: string | null;
  driver_phone: string | null;
  amount: number;
  rides: number;
  account_status: string;
  blocked_by_kyc: boolean;
  oldest_at: string | null;
}

/**
 * Driver payouts — a STATUS MONITOR, not a worklist. Under the auto-split
 * engine the operator no longer sends payouts by hand; Razorpay Route pays each
 * driver's share at source. This screen watches that happen: paid / held (for an
 * unverified payout account) / failed / reversed, with the transfer reference.
 *
 * The legacy wallet "owed" list stays as a secondary card so any balances from
 * before the migration are still visible and clearable via Record payout.
 */
@Component({
  selector: 'app-drivers-payouts-tab',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  template: `
    <div class="wrap">
      <header class="head">
        <div>
          <h2 class="head__title">Payout monitor</h2>
          <p class="head__sub">
            Driver shares are paid automatically at source by Razorpay Route.
            This is a live status board — nothing here needs manual action unless
            a transfer <strong>failed</strong> or a driver's share is <strong>held</strong>
            waiting on their payout account.
          </p>
        </div>
        <div class="head__side">
          <tm-button variant="outline" size="sm" icon="check" [loading]="loading" (clicked)="load()">
            Refresh
          </tm-button>
        </div>
      </header>

      <div class="cards" *ngIf="!loading && !error">
        <div class="card card--paid">
          <span class="card__label">Auto-paid</span>
          <span class="card__value">₹ {{ summary.paid_amount | number:'1.2-2' }}</span>
          <span class="card__meta">{{ summary.paid_count }} transfers</span>
        </div>
        <div class="card card--held">
          <span class="card__label">Held</span>
          <span class="card__value">₹ {{ summary.held_amount | number:'1.2-2' }}</span>
          <span class="card__meta">{{ summary.held_count }} unverified</span>
        </div>
        <div class="card" [class.card--alert]="summary.failed_count > 0">
          <span class="card__label">Failed</span>
          <span class="card__value">{{ summary.failed_count }}</span>
          <span class="card__meta">need attention</span>
        </div>
        <div class="card">
          <span class="card__label">Reversed</span>
          <span class="card__value">{{ summary.reversed_count }}</span>
          <span class="card__meta">cancelled rides</span>
        </div>
      </div>

      <!-- Who is actually waiting on money. Ahead of the per-ride rows because
           it's the only part of this screen anyone can act on. -->
      <div class="owed-block" *ngIf="!loading && owed.length">
        <div class="owed__head">
          <div>
            <h3 class="owed__title">Drivers waiting to be paid</h3>
            <p class="owed__sub">
              Earned but not yet sent. Anyone marked <strong>needs payout account</strong> is waiting on
              us to chase them for bank details — the rest are retried automatically every few minutes.
            </p>
          </div>
          <div class="total">
            <span class="total__label">Total waiting</span>
            <span class="total__value total__value--held">₹ {{ summary.held_amount | number:'1.2-2' }}</span>
          </div>
        </div>
        <div class="tbl">
          <table>
            <thead>
              <tr>
                <th>Driver</th>
                <th class="num">Waiting</th>
                <th class="num">Rides</th>
                <th>Why</th>
                <th class="num">Waiting since</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of owed">
                <td class="name">
                  {{ row.driver_name || ('Driver #' + row.driver_id) }}
                  <span class="phone" *ngIf="row.driver_phone">{{ row.driver_phone }}</span>
                </td>
                <td class="num owed">₹ {{ row.amount | number:'1.2-2' }}</td>
                <td class="num">{{ row.rides }}</td>
                <td>
                  <span class="badge" [class.badge--failed]="row.blocked_by_kyc" [class.badge--held]="!row.blocked_by_kyc">
                    {{ row.blocked_by_kyc ? 'Needs payout account' : 'Retrying transfer' }}
                  </span>
                </td>
                <td class="num when">{{ row.oldest_at ? (row.oldest_at | date:'d MMM, HH:mm') : '—' }}</td>
                <td class="act">
                  <tm-button variant="ghost" size="sm" icon="chevron-right" (clicked)="openDriver(row.driver_id)">Open</tm-button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="filters" *ngIf="!loading && !error">
        <button *ngFor="let f of filters" class="chip" [class.chip--on]="active === f.key"
          (click)="setFilter(f.key)">{{ f.label }}</button>
      </div>

      <div class="state" *ngIf="loading">Loading payouts…</div>
      <div class="state state--error" *ngIf="!loading && error">{{ error }}</div>

      <div class="state state--empty" *ngIf="!loading && !error && !rows.length">
        <tm-icon name="check" [size]="22" />
        <strong>No payouts to show</strong>
        <span>Once rides are paid online, each driver's split will appear here.</span>
      </div>

      <div class="tbl" *ngIf="!loading && rows.length">
        <table>
          <thead>
            <tr>
              <th>Driver</th>
              <th class="num">Driver share</th>
              <th class="num">Commission</th>
              <th>Status</th>
              <th>Reference</th>
              <th class="num">When</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let row of rows">
              <td class="name">
                {{ row.driver_name || ('Driver #' + row.driver_id) }}
                <span class="phone" *ngIf="row.driver_phone">{{ row.driver_phone }}</span>
              </td>
              <td class="num owed">₹ {{ row.driver_amount | number:'1.2-2' }}</td>
              <td class="num">₹ {{ row.commission_amount | number:'1.2-2' }}</td>
              <td><span class="badge badge--{{ row.state }}">{{ stateLabel(row.state) }}</span></td>
              <td class="ref">{{ row.transfer_id || row.reversal_id || '—' }}</td>
              <td class="num when">{{ row.split_at ? (row.split_at | date:'d MMM, HH:mm') : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Legacy wallet balances (pre-migration). Hidden once none remain. -->
      <div class="legacy" *ngIf="!loading && dueRows.length">
        <div class="legacy__head">
          <h3>Wallet balances owed <span class="legacy__tag">legacy</span></h3>
          <div class="total">
            <span class="total__label">Total owed</span>
            <span class="total__value">₹ {{ totalOwed | number:'1.2-2' }}</span>
          </div>
        </div>
        <p class="legacy__sub">
          Balances from before auto-payouts. Pay by GPay/bank and use
          <strong>Record payout</strong> on the driver to clear them.
        </p>
        <div class="tbl">
          <table>
            <thead>
              <tr><th>Driver</th><th>Phone</th><th>Vehicle</th><th class="num">Owed</th><th></th></tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of dueRows">
                <td class="name">{{ row.name || ('Driver #' + row.driver_id) }}</td>
                <td>{{ row.phone || '—' }}</td>
                <td>{{ row.vehicle_reg_no || '—' }}</td>
                <td class="num owed">₹ {{ row.balance | number:'1.2-2' }}</td>
                <td class="act">
                  <tm-button variant="ghost" size="sm" icon="chevron-right" (clicked)="open(row)">Open</tm-button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .wrap { display: flex; flex-direction: column; gap: var(--tm-space-4); }

    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
    .head__title { margin: 0 0 4px; font-size: 18px; }
    .head__sub { margin: 0; font-size: 13px; color: var(--tm-text-muted); max-width: 70ch; }

    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
    .card { background: var(--tm-surface); border: 1px solid var(--tm-border); border-radius: var(--tm-radius-lg);
      padding: 14px 16px; display: flex; flex-direction: column; gap: 2px; }
    .card__label { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--tm-text-muted); }
    .card__value { font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .card__meta { font-size: 11.5px; color: var(--tm-text-muted); }
    .card--paid .card__value { color: var(--tm-green); }
    .card--held .card__value { color: var(--tm-amber, #B54708); }
    .card--alert { border-color: var(--tm-red, #B42318); }
    .card--alert .card__value { color: var(--tm-red, #B42318); }

    .filters { display: flex; gap: 8px; flex-wrap: wrap; }
    .chip { border: 1px solid var(--tm-border); background: var(--tm-surface); color: var(--tm-text-muted);
      border-radius: 999px; padding: 5px 13px; font-size: 12.5px; cursor: pointer; }
    .chip--on { background: var(--tm-text); color: var(--tm-surface); border-color: var(--tm-text); }

    .state { padding: 28px; text-align: center; color: var(--tm-text-muted); font-size: 13.5px;
      background: var(--tm-surface); border: 1px solid var(--tm-border); border-radius: var(--tm-radius-lg); }
    .state--error { color: var(--tm-red, #B42318); }
    .state--empty { display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .state--empty strong { color: var(--tm-text); }

    .tbl { background: var(--tm-surface); border: 1px solid var(--tm-border); border-radius: var(--tm-radius-lg); overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 640px; }
    th { text-align: left; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--tm-text-muted);
      padding: 10px 14px; border-bottom: 1px solid var(--tm-border); }
    td { padding: 10px 14px; border-bottom: 1px solid var(--tm-border); }
    tr:last-child td { border-bottom: 0; }
    .name { font-weight: 700; }
    .phone { display: block; font-weight: 400; font-size: 11.5px; color: var(--tm-text-muted); }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .owed { font-weight: 800; color: var(--tm-green); }
    .ref { font-family: var(--tm-mono, monospace); font-size: 11.5px; color: var(--tm-text-muted); }
    .when { color: var(--tm-text-muted); white-space: nowrap; }
    .act { text-align: right; width: 1%; white-space: nowrap; }

    .badge { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 700; }
    .badge--paid { background: rgba(18,142,86,0.12); color: var(--tm-green); }
    .badge--held { background: rgba(181,71,8,0.12); color: var(--tm-amber, #B54708); }
    .badge--failed { background: rgba(180,35,24,0.12); color: var(--tm-red, #B42318); }
    .badge--reversed { background: var(--tm-border); color: var(--tm-text-muted); }
    .badge--none { background: var(--tm-border); color: var(--tm-text-muted); }

    .owed-block { display: flex; flex-direction: column; gap: 10px; }
    .owed__head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
    .owed__title { margin: 0 0 4px; font-size: 15px; }
    .owed__sub { margin: 0; font-size: 12.5px; color: var(--tm-text-muted); max-width: 72ch; }
    .total__value--held { color: var(--tm-amber, #B54708); }

    .legacy { margin-top: 8px; display: flex; flex-direction: column; gap: 8px; }
    .legacy__head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
    .legacy__head h3 { margin: 0; font-size: 15px; }
    .legacy__tag { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--tm-text-muted);
      border: 1px solid var(--tm-border); border-radius: 6px; padding: 1px 6px; margin-left: 6px; }
    .legacy__sub { margin: 0; font-size: 12.5px; color: var(--tm-text-muted); }
    .total { text-align: right; }
    .total__label { display: block; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--tm-text-muted); }
    .total__value { font-size: 18px; font-weight: 800; color: var(--tm-green); font-variant-numeric: tabular-nums; }
  `],
})
export class DriversPayoutsTabComponent implements OnInit {
  rows: MonitorRow[] = [];
  summary: MonitorSummary = { paid_count: 0, paid_amount: 0, failed_count: 0, held_count: 0, held_amount: 0, reversed_count: 0 };
  active: 'all' | 'paid' | 'held' | 'failed' | 'reversed' = 'all';
  filters: { key: 'all' | 'paid' | 'held' | 'failed' | 'reversed'; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'paid', label: 'Auto-paid' },
    { key: 'held', label: 'Held' },
    { key: 'failed', label: 'Failed' },
    { key: 'reversed', label: 'Reversed' },
  ];

  /** Drivers with money waiting, worst first. */
  owed: OwedRow[] = [];

  dueRows: PayoutDueRow[] = [];
  totalOwed = 0;

  loading = false;
  error: string | null = null;

  constructor(private api: ApiService, private router: Router) {}

  ngOnInit(): void {
    this.load();
  }

  setFilter(key: 'all' | 'paid' | 'held' | 'failed' | 'reversed'): void {
    this.active = key;
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;

    const status = this.active === 'all' ? '' : `?status=${this.active}`;
    this.api.get<{ summary: MonitorSummary; rows: MonitorRow[]; owed?: OwedRow[] }>(`/admin/payouts/monitor${status}`).subscribe({
      next: (res) => {
        this.rows = res?.rows ?? [];
        this.summary = res?.summary ?? this.summary;
        this.owed = res?.owed ?? [];
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load the payout monitor.';
        this.loading = false;
      },
    });

    // Legacy wallet balances, best-effort — never blocks the monitor.
    this.api.get<{ data: PayoutDueRow[]; total_owed: number }>('/admin/drivers/payouts-due').subscribe({
      next: (res) => {
        this.dueRows = res?.data ?? [];
        this.totalOwed = res?.total_owed ?? 0;
      },
      error: () => {
        this.dueRows = [];
        this.totalOwed = 0;
      },
    });
  }

  stateLabel(state: PayoutState): string {
    switch (state) {
      case 'paid': return 'Auto-paid';
      case 'held': return 'Held';
      case 'failed': return 'Failed';
      case 'reversed': return 'Reversed';
      default: return '—';
    }
  }

  open(row: PayoutDueRow): void {
    this.router.navigate(['/drivers', row.driver_id]);
  }

  openDriver(driverId: number): void {
    this.router.navigate(['/drivers', driverId]);
  }
}
