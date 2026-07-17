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

/**
 * The operator's payout worklist: every driver the company currently owes
 * money to (positive wallet balance), biggest first. The money itself moves
 * by GPay/bank OUTSIDE the app — the operator pays a driver, opens them, and
 * uses "Record payout" so the ledger keeps matching reality.
 */
@Component({
  selector: 'app-drivers-payouts-tab',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  template: `
    <div class="wrap">
      <header class="head">
        <div>
          <h2 class="head__title">Payouts due</h2>
          <p class="head__sub">
            Drivers with money owed. Pay by GPay/bank as usual, then open the
            driver and use <strong>Record payout</strong> — the list clears itself.
          </p>
        </div>
        <div class="head__side">
          <div class="total" *ngIf="!loading">
            <span class="total__label">Total owed</span>
            <span class="total__value">₹ {{ totalOwed | number:'1.2-2' }}</span>
          </div>
          <tm-button variant="outline" size="sm" icon="check" [loading]="loading" (clicked)="load()">
            Refresh
          </tm-button>
        </div>
      </header>

      <div class="state" *ngIf="loading">Loading payouts…</div>
      <div class="state state--error" *ngIf="!loading && error">{{ error }}</div>

      <div class="state state--empty" *ngIf="!loading && !error && !rows.length">
        <tm-icon name="check" [size]="22" />
        <strong>Nobody is owed anything</strong>
        <span>Every driver wallet with earnings has been paid out and recorded.</span>
      </div>

      <div class="tbl" *ngIf="!loading && rows.length">
        <table>
          <thead>
            <tr>
              <th>Driver</th>
              <th>Phone</th>
              <th>Vehicle</th>
              <th class="num">Owed</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let row of rows">
              <td class="name">{{ row.name || ('Driver #' + row.driver_id) }}</td>
              <td>{{ row.phone || '—' }}</td>
              <td>{{ row.vehicle_reg_no || '—' }}</td>
              <td class="num owed">₹ {{ row.balance | number:'1.2-2' }}</td>
              <td class="act">
                <tm-button variant="ghost" size="sm" icon="chevron-right" (clicked)="open(row)">
                  Open
                </tm-button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .wrap { display: flex; flex-direction: column; gap: var(--tm-space-4); }

    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
    .head__title { margin: 0 0 4px; font-size: 18px; }
    .head__sub { margin: 0; font-size: 13px; color: var(--tm-text-muted); max-width: 60ch; }
    .head__side { display: flex; align-items: center; gap: 14px; }
    .total { text-align: right; }
    .total__label { display: block; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--tm-text-muted); }
    .total__value { font-size: 20px; font-weight: 800; color: var(--tm-green); font-variant-numeric: tabular-nums; }

    .state { padding: 28px; text-align: center; color: var(--tm-text-muted); font-size: 13.5px;
      background: var(--tm-surface); border: 1px solid var(--tm-border); border-radius: var(--tm-radius-lg); }
    .state--error { color: var(--tm-red, #B42318); }
    .state--empty { display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .state--empty strong { color: var(--tm-text); }

    .tbl { background: var(--tm-surface); border: 1px solid var(--tm-border); border-radius: var(--tm-radius-lg); overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 560px; }
    th { text-align: left; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--tm-text-muted);
      padding: 10px 14px; border-bottom: 1px solid var(--tm-border); }
    td { padding: 10px 14px; border-bottom: 1px solid var(--tm-border); }
    tr:last-child td { border-bottom: 0; }
    .name { font-weight: 700; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .owed { font-weight: 800; color: var(--tm-green); }
    .act { text-align: right; width: 1%; white-space: nowrap; }
  `],
})
export class DriversPayoutsTabComponent implements OnInit {
  rows: PayoutDueRow[] = [];
  totalOwed = 0;
  loading = false;
  error: string | null = null;

  constructor(private api: ApiService, private router: Router) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.api.get<{ data: PayoutDueRow[]; total_owed: number }>('/admin/drivers/payouts-due').subscribe({
      next: (res) => {
        this.rows = res?.data ?? [];
        this.totalOwed = res?.total_owed ?? 0;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load the payout list.';
        this.loading = false;
      },
    });
  }

  open(row: PayoutDueRow): void {
    this.router.navigate(['/drivers', row.driver_id]);
  }
}
