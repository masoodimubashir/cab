import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';

interface DriverWalletRow {
  driver_id: number;
  user_id: number;
  name: string;
  phone: string;
  vehicle_reg_no: string;
  vehicle_type: string;
  balance: number;
  minimum_wallet_limit: number;
  maximum_wallet_limit: number;
  is_in_debt: boolean;
  can_accept_rides: boolean;
}

interface WalletsResponse {
  data: DriverWalletRow[];
  total_balance: number;
  total_drivers: number;
  in_debt_count: number;
  minimum_wallet_limit: number;
  maximum_wallet_limit: number;
}

@Component({
  selector: 'app-finance-wallets',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="dc-page">
      <!-- Header -->
      <div class="dc-page-header">
        <div>
          <h1 class="dc-title">Wallet Management</h1>
          <p class="dc-subtitle">Driver platform liabilities, minimum float limits, and balance adjustments</p>
        </div>
        <button class="dc-btn dc-btn-secondary" (click)="load()">
          <span class="icon">↻</span> Refresh
        </button>
      </div>

      <!-- KPI Summary Cards -->
      <div class="dc-kpi-grid">
        <div class="dc-kpi-card">
          <span class="dc-kpi-label">Total Platform Float / Net Balance</span>
          <span class="dc-kpi-value">₹{{ totalBalance | number:'1.2-2' }}</span>
          <span class="dc-kpi-sub">Across {{ totalDrivers }} registered drivers</span>
        </div>
        <div class="dc-kpi-card">
          <span class="dc-kpi-label">Drivers In Platform Debt</span>
          <span class="dc-kpi-value text-amber">{{ inDebtCount }}</span>
          <span class="dc-kpi-sub">Negative wallet balance</span>
        </div>
        <div class="dc-kpi-card">
          <span class="dc-kpi-label">Configured Minimum Limit</span>
          <span class="dc-kpi-value text-rose">₹{{ minimumLimit }}</span>
          <span class="dc-kpi-sub">Below this, ride acceptance is blocked</span>
        </div>
      </div>

      <!-- Filter Controls -->
      <div class="dc-filter-bar">
        <input
          type="text"
          class="dc-input dc-search"
          placeholder="Search by driver name, phone, vehicle..."
          [(ngModel)]="searchQuery"
          (input)="applyFilter()"
        />
        <div class="dc-btn-group">
          <button class="dc-pill" [class.active]="filterStatus === 'all'" (click)="setFilter('all')">All ({{ rows.length }})</button>
          <button class="dc-pill" [class.active]="filterStatus === 'debt'" (click)="setFilter('debt')">In Debt ({{ inDebtCount }})</button>
          <button class="dc-pill" [class.active]="filterStatus === 'blocked'" (click)="setFilter('blocked')">Blocked ({{ blockedCount }})</button>
        </div>
      </div>

      <!-- Table Card -->
      <div class="dc-card dc-table-container">
        <div *ngIf="loading" class="dc-loading">Loading wallet data...</div>
        <div *ngIf="error" class="dc-error">{{ error }}</div>

        <table *ngIf="!loading && !error" class="dc-table">
          <thead>
            <tr>
              <th>Driver</th>
              <th>Vehicle</th>
              <th>Wallet Balance</th>
              <th>Min Limit</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let row of filteredRows">
              <td>
                <div class="dc-user-cell">
                  <strong>{{ row.name }}</strong>
                  <small>{{ row.phone }}</small>
                </div>
              </td>
              <td>
                <div>{{ row.vehicle_type }}</div>
                <small class="text-muted">{{ row.vehicle_reg_no }}</small>
              </td>
              <td>
                <span class="dc-balance" [class.text-emerald]="row.balance >= 0" [class.text-rose]="row.balance < 0">
                  ₹{{ row.balance | number:'1.2-2' }}
                </span>
              </td>
              <td>₹{{ row.minimum_wallet_limit }}</td>
              <td>
                <span *ngIf="row.can_accept_rides" class="dc-badge badge-success">Eligible</span>
                <span *ngIf="!row.can_accept_rides" class="dc-badge badge-danger">Below Min Limit</span>
              </td>
              <td>
                <button class="dc-btn dc-btn-xs dc-btn-primary" (click)="openAdjustModal(row)">
                  Adjust Wallet
                </button>
              </td>
            </tr>
            <tr *ngIf="filteredRows.length === 0">
              <td colspan="6" class="text-center py-6 text-muted">No drivers found matching current filter.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Adjust Wallet Modal -->
      <div class="dc-modal-backdrop" *ngIf="selectedDriver">
        <div class="dc-modal">
          <div class="dc-modal-header">
            <h3>Adjust Wallet — {{ selectedDriver.name }}</h3>
            <button class="dc-close-btn" (click)="closeModal()">×</button>
          </div>
          <div class="dc-modal-body">
            <p class="text-muted mb-4">
              Current balance: <strong>₹{{ selectedDriver.balance | number:'1.2-2' }}</strong> | Min Limit: <strong>₹{{ selectedDriver.minimum_wallet_limit }}</strong>
            </p>

            <div class="dc-form-group">
              <label>Adjustment Type</label>
              <select class="dc-input" [(ngModel)]="adjustForm.type">
                <option value="credit">Credit (Add float / waive fee)</option>
                <option value="debit">Debit (Deduct platform charge / fine)</option>
              </select>
            </div>

            <div class="dc-form-group">
              <label>Amount (₹)</label>
              <input type="number" class="dc-input" min="0.01" step="0.01" placeholder="e.g. 500" [(ngModel)]="adjustForm.amount" />
            </div>

            <div class="dc-form-group">
              <label>Reason / Audit Note</label>
              <input type="text" class="dc-input" placeholder="e.g. Manual top-up / Platform charge adjustment" [(ngModel)]="adjustForm.reason" />
            </div>

            <div *ngIf="adjustError" class="dc-error mt-2">{{ adjustError }}</div>
          </div>
          <div class="dc-modal-footer">
            <button class="dc-btn dc-btn-secondary" (click)="closeModal()" [disabled]="adjusting">Cancel</button>
            <button class="dc-btn dc-btn-primary" (click)="submitAdjust()" [disabled]="adjusting || !adjustForm.amount || !adjustForm.reason">
              {{ adjusting ? 'Saving...' : 'Save Adjustment' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .dc-page { padding: 24px; color: #e0e0e0; }
    .dc-page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    .dc-title { font-size: 24px; font-weight: 700; color: #fff; margin: 0; }
    .dc-subtitle { color: #888; margin-top: 4px; font-size: 14px; }
    .dc-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .dc-kpi-card { background: #18191c; border: 1px solid #282a2e; border-radius: 12px; padding: 20px; }
    .dc-kpi-label { font-size: 13px; color: #9e9e9e; display: block; margin-bottom: 6px; }
    .dc-kpi-value { font-size: 28px; font-weight: 700; color: #fff; display: block; }
    .dc-kpi-sub { font-size: 12px; color: #666; margin-top: 4px; display: block; }
    .text-amber { color: #ffb300; }
    .text-rose { color: #ff5252; }
    .text-emerald { color: #00e676; }
    .text-muted { color: #777; }
    .dc-filter-bar { display: flex; gap: 12px; margin-bottom: 16px; align-items: center; }
    .dc-search { max-width: 380px; }
    .dc-btn-group { display: flex; gap: 6px; }
    .dc-pill { background: #222428; border: 1px solid #33363d; color: #aaa; border-radius: 20px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
    .dc-pill.active { background: #00c06a; color: #000; font-weight: 600; border-color: #00c06a; }
    .dc-card { background: #18191c; border: 1px solid #282a2e; border-radius: 12px; overflow: hidden; }
    .dc-table { width: 100%; border-collapse: collapse; text-align: left; }
    .dc-table th { background: #202226; color: #999; font-size: 12px; text-transform: uppercase; padding: 14px 16px; letter-spacing: 0.5px; }
    .dc-table td { padding: 14px 16px; border-bottom: 1px solid #24262b; font-size: 14px; }
    .dc-user-cell strong { display: block; color: #fff; }
    .dc-user-cell small { color: #888; }
    .dc-balance { font-weight: 600; font-size: 15px; }
    .dc-badge { display: inline-block; padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: 600; }
    .badge-success { background: rgba(0,230,118,0.15); color: #00e676; }
    .badge-danger { background: rgba(255,82,82,0.15); color: #ff5252; }
    .dc-input { background: #222428; border: 1px solid #33363d; border-radius: 8px; color: #fff; padding: 8px 12px; width: 100%; box-sizing: border-box; }
    .dc-btn { padding: 8px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; border: none; font-size: 13px; }
    .dc-btn-primary { background: #00c06a; color: #000; }
    .dc-btn-secondary { background: #2a2c31; color: #fff; }
    .dc-btn-xs { padding: 5px 10px; font-size: 12px; }
    .dc-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 1000; }
    .dc-modal { background: #1e2024; border: 1px solid #33363d; border-radius: 14px; width: 460px; max-width: 90vw; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
    .dc-modal-header { padding: 18px 20px; border-bottom: 1px solid #2d3036; display: flex; justify-content: space-between; align-items: center; }
    .dc-modal-header h3 { margin: 0; font-size: 17px; color: #fff; }
    .dc-close-btn { background: none; border: none; font-size: 22px; color: #888; cursor: pointer; }
    .dc-modal-body { padding: 20px; }
    .dc-form-group { margin-bottom: 14px; }
    .dc-form-group label { display: block; font-size: 12px; color: #aaa; margin-bottom: 6px; }
    .dc-modal-footer { padding: 14px 20px; border-top: 1px solid #2d3036; display: flex; justify-content: flex-end; gap: 10px; background: #1a1c1f; }
    .dc-loading, .dc-error { padding: 20px; text-align: center; }
    .dc-error { color: #ff5252; }
  `]
})
export class FinanceWalletsComponent implements OnInit {
  loading = false;
  error: string | null = null;
  rows: DriverWalletRow[] = [];
  filteredRows: DriverWalletRow[] = [];

  totalBalance = 0;
  totalDrivers = 0;
  inDebtCount = 0;
  blockedCount = 0;
  minimumLimit = 0;
  maximumLimit = 0;

  searchQuery = '';
  filterStatus: 'all' | 'debt' | 'blocked' = 'all';

  selectedDriver: DriverWalletRow | null = null;
  adjustForm = { type: 'credit', amount: null as number | null, reason: '' };
  adjusting = false;
  adjustError: string | null = null;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.api.get<WalletsResponse>('/admin/finance/wallets').subscribe({
      next: (res) => {
        this.loading = false;
        this.rows = res.data || [];
        this.totalBalance = res.total_balance || 0;
        this.totalDrivers = res.total_drivers || 0;
        this.inDebtCount = res.in_debt_count || 0;
        this.minimumLimit = res.minimum_wallet_limit || 0;
        this.maximumLimit = res.maximum_wallet_limit || 0;
        this.blockedCount = this.rows.filter(r => !r.can_accept_rides).length;
        this.applyFilter();
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.message || 'Failed to load driver wallet records.';
      }
    });
  }

  setFilter(s: 'all' | 'debt' | 'blocked'): void {
    this.filterStatus = s;
    this.applyFilter();
  }

  applyFilter(): void {
    let filtered = [...this.rows];
    if (this.filterStatus === 'debt') {
      filtered = filtered.filter(r => r.is_in_debt);
    } else if (this.filterStatus === 'blocked') {
      filtered = filtered.filter(r => !r.can_accept_rides);
    }

    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase().trim();
      filtered = filtered.filter(r =>
        r.name?.toLowerCase().includes(q) ||
        r.phone?.toLowerCase().includes(q) ||
        r.vehicle_reg_no?.toLowerCase().includes(q)
      );
    }

    this.filteredRows = filtered;
  }

  openAdjustModal(driver: DriverWalletRow): void {
    this.selectedDriver = driver;
    this.adjustForm = { type: 'credit', amount: null, reason: '' };
    this.adjustError = null;
  }

  closeModal(): void {
    this.selectedDriver = null;
  }

  submitAdjust(): void {
    if (!this.selectedDriver || !this.adjustForm.amount || !this.adjustForm.reason) return;
    this.adjusting = true;
    this.adjustError = null;

    this.api.post(`/admin/drivers/${this.selectedDriver.driver_id}/wallet/adjust`, {
      type: this.adjustForm.type,
      amount: this.adjustForm.amount,
      reason: this.adjustForm.reason,
    }).subscribe({
      next: () => {
        this.adjusting = false;
        this.closeModal();
        this.load();
      },
      error: (err) => {
        this.adjusting = false;
        this.adjustError = err?.error?.message || 'Failed to adjust wallet.';
      }
    });
  }
}
