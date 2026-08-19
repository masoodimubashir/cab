import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';

interface CompletedTransferRow {
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

interface CompletedTransfersResponse {
  data: CompletedTransferRow[];
  total_transferred: number;
  count: number;
}

@Component({
  selector: 'app-finance-completed-transfers',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="dc-page">
      <!-- Header -->
      <div class="dc-page-header">
        <div>
          <h1 class="dc-title">Completed Driver Transfers</h1>
          <p class="dc-subtitle">Audit log of all payouts and transfers sent to drivers</p>
        </div>
        <button class="dc-btn dc-btn-secondary" (click)="load()">
          <span class="icon">↻</span> Refresh
        </button>
      </div>

      <!-- KPI Summary Cards -->
      <div class="dc-kpi-grid">
        <div class="dc-kpi-card">
          <span class="dc-kpi-label">Total Payouts Transferred</span>
          <span class="dc-kpi-value text-emerald">₹{{ totalTransferred | number:'1.2-2' }}</span>
          <span class="dc-kpi-sub">Across all completed payouts</span>
        </div>
        <div class="dc-kpi-card">
          <span class="dc-kpi-label">Total Transfer Records</span>
          <span class="dc-kpi-value">{{ totalCount }}</span>
          <span class="dc-kpi-sub">Successful payout transactions</span>
        </div>
      </div>

      <!-- Filter Controls -->
      <div class="dc-filter-bar">
        <input
          type="text"
          class="dc-input dc-search"
          placeholder="Search by driver, reference, notes..."
          [(ngModel)]="searchQuery"
          (input)="applyFilter()"
        />
      </div>

      <!-- Table Card -->
      <div class="dc-card dc-table-container">
        <div *ngIf="loading" class="dc-loading">Loading completed transfers...</div>
        <div *ngIf="error" class="dc-error">{{ error }}</div>

        <table *ngIf="!loading && !error" class="dc-table">
          <thead>
            <tr>
              <th>Date &amp; Time</th>
              <th>Driver</th>
              <th>Amount Transferred</th>
              <th>Method</th>
              <th>Reference / UTR</th>
              <th>Recorded By</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let row of filteredRows">
              <td>
                <span class="text-muted">{{ row.created_at | date:'medium' }}</span>
              </td>
              <td>
                <div class="dc-user-cell">
                  <strong>{{ row.driver_name }}</strong>
                  <small>{{ row.driver_phone }}</small>
                </div>
              </td>
              <td>
                <strong class="text-emerald">₹{{ row.amount | number:'1.2-2' }}</strong>
              </td>
              <td>
                <span class="dc-badge">{{ methodLabel(row.method) }}</span>
              </td>
              <td>
                <div>{{ row.reference || '—' }}</div>
                <small *ngIf="row.notes" class="text-muted">{{ row.notes }}</small>
              </td>
              <td>{{ row.recorded_by }}</td>
            </tr>
            <tr *ngIf="filteredRows.length === 0">
              <td colspan="6" class="text-center py-6 text-muted">No completed transfers recorded.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .dc-page { padding: 24px; color: #e0e0e0; }
    .dc-page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    .dc-title { font-size: 24px; font-weight: 700; color: #fff; margin: 0; }
    .dc-subtitle { color: #888; margin-top: 4px; font-size: 14px; }
    .dc-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .dc-kpi-card { background: #18191c; border: 1px solid #282a2e; border-radius: 12px; padding: 20px; }
    .dc-kpi-label { font-size: 13px; color: #9e9e9e; display: block; margin-bottom: 6px; }
    .dc-kpi-value { font-size: 28px; font-weight: 700; color: #fff; display: block; }
    .dc-kpi-sub { font-size: 12px; color: #666; margin-top: 4px; display: block; }
    .text-emerald { color: #00e676; }
    .text-muted { color: #777; }
    .dc-filter-bar { display: flex; gap: 12px; margin-bottom: 16px; align-items: center; }
    .dc-search { max-width: 380px; }
    .dc-card { background: #18191c; border: 1px solid #282a2e; border-radius: 12px; overflow: hidden; }
    .dc-table { width: 100%; border-collapse: collapse; text-align: left; }
    .dc-table th { background: #202226; color: #999; font-size: 12px; text-transform: uppercase; padding: 14px 16px; letter-spacing: 0.5px; }
    .dc-table td { padding: 14px 16px; border-bottom: 1px solid #24262b; font-size: 14px; }
    .dc-user-cell strong { display: block; color: #fff; }
    .dc-user-cell small { color: #888; }
    .dc-badge { display: inline-block; padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: 600; background: #282b30; color: #ccc; }
    .dc-input { background: #222428; border: 1px solid #33363d; border-radius: 8px; color: #fff; padding: 8px 12px; width: 100%; box-sizing: border-box; }
    .dc-btn { padding: 8px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; border: none; font-size: 13px; }
    .dc-btn-secondary { background: #2a2c31; color: #fff; }
    .dc-loading, .dc-error { padding: 20px; text-align: center; }
    .dc-error { color: #ff5252; }
  `]
})
export class FinanceCompletedTransfersComponent implements OnInit {
  loading = false;
  error: string | null = null;
  rows: CompletedTransferRow[] = [];
  filteredRows: CompletedTransferRow[] = [];
  totalTransferred = 0;
  totalCount = 0;

  searchQuery = '';

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.api.get<CompletedTransfersResponse>('/admin/finance/transfers/completed').subscribe({
      next: (res) => {
        this.loading = false;
        this.rows = res.data || [];
        this.totalTransferred = res.total_transferred || 0;
        this.totalCount = res.count || 0;
        this.applyFilter();
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.message || 'Failed to load completed transfers.';
      }
    });
  }

  applyFilter(): void {
    if (!this.searchQuery.trim()) {
      this.filteredRows = [...this.rows];
      return;
    }
    const q = this.searchQuery.toLowerCase().trim();
    this.filteredRows = this.rows.filter(r =>
      r.driver_name?.toLowerCase().includes(q) ||
      r.driver_phone?.toLowerCase().includes(q) ||
      r.reference?.toLowerCase().includes(q) ||
      r.notes?.toLowerCase().includes(q)
    );
  }

  methodLabel(m: string): string {
    const map: Record<string, string> = {
      gpay: 'GPay / UPI',
      bank: 'Bank Transfer',
      cash: 'Cash Handover',
      upi: 'UPI',
      other: 'Other',
    };
    return map[m?.toLowerCase()] || m;
  }
}
