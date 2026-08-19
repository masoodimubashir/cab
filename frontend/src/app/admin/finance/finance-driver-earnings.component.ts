import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';

interface DriverEarningsRow {
  user_id: number;
  driver_id: number;
  name: string;
  phone: string;
  vehicle_reg_no: string;
  rides_count: number;
  gross_earnings: number;
  cash_collected: number;
  online_collected: number;
}

interface DriverEarningsResponse {
  data: DriverEarningsRow[];
  total_gross: number;
  total_cash: number;
  total_online: number;
  drivers_count: number;
  range: { from: string; to: string };
}

@Component({
  selector: 'app-finance-driver-earnings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="dc-page">
      <!-- Header -->
      <div class="dc-page-header">
        <div>
          <h1 class="dc-title">Driver Earnings Report</h1>
          <p class="dc-subtitle">Driver income breakdown across hand-to-hand cash and operator-collected online bookings</p>
        </div>
        <button class="dc-btn dc-btn-secondary" (click)="load()">
          <span class="icon">↻</span> Refresh
        </button>
      </div>

      <!-- KPI Summary Cards -->
      <div class="dc-kpi-grid">
        <div class="dc-kpi-card">
          <span class="dc-kpi-label">Total Driver Gross Earnings</span>
          <span class="dc-kpi-value text-emerald">₹{{ totalGross | number:'1.2-2' }}</span>
          <span class="dc-kpi-sub">Across {{ driversCount }} active drivers</span>
        </div>
        <div class="dc-kpi-card">
          <span class="dc-kpi-label">Cash Collected by Drivers</span>
          <span class="dc-kpi-value text-amber">₹{{ totalCash | number:'1.2-2' }}</span>
          <span class="dc-kpi-sub">Direct cash collected in-hand</span>
        </div>
        <div class="dc-kpi-card">
          <span class="dc-kpi-label">Online Collected by Platform</span>
          <span class="dc-kpi-value">₹{{ totalOnline | number:'1.2-2' }}</span>
          <span class="dc-kpi-sub">Subject to operator transfers</span>
        </div>
      </div>

      <!-- Filter Controls -->
      <div class="dc-filter-bar">
        <input
          type="text"
          class="dc-input dc-search"
          placeholder="Search by driver name, phone, vehicle reg..."
          [(ngModel)]="searchQuery"
          (input)="applyFilter()"
        />
        <div class="dc-date-inputs">
          <input type="date" class="dc-input dc-date" [(ngModel)]="fromDate" (change)="load()" />
          <span class="dc-to-text">to</span>
          <input type="date" class="dc-input dc-date" [(ngModel)]="toDate" (change)="load()" />
        </div>
      </div>

      <!-- Table Card -->
      <div class="dc-card dc-table-container">
        <div *ngIf="loading" class="dc-loading">Loading driver earnings...</div>
        <div *ngIf="error" class="dc-error">{{ error }}</div>

        <table *ngIf="!loading && !error" class="dc-table">
          <thead>
            <tr>
              <th>Driver</th>
              <th>Vehicle</th>
              <th>Completed Rides</th>
              <th>Cash Collected</th>
              <th>Online Collected</th>
              <th>Gross Earnings</th>
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
              <td>{{ row.vehicle_reg_no }}</td>
              <td>{{ row.rides_count }}</td>
              <td>
                <span class="text-amber">₹{{ row.cash_collected | number:'1.2-2' }}</span>
              </td>
              <td>
                <span>₹{{ row.online_collected | number:'1.2-2' }}</span>
              </td>
              <td>
                <strong class="text-emerald dc-amount">₹{{ row.gross_earnings | number:'1.2-2' }}</strong>
              </td>
            </tr>
            <tr *ngIf="filteredRows.length === 0">
              <td colspan="6" class="text-center py-6 text-muted">No driver earnings recorded for this period.</td>
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
    .text-amber { color: #ffb300; }
    .text-emerald { color: #00e676; }
    .text-muted { color: #777; }
    .dc-amount { font-size: 15px; }
    .dc-filter-bar { display: flex; gap: 12px; margin-bottom: 16px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
    .dc-search { max-width: 340px; }
    .dc-date-inputs { display: flex; gap: 8px; align-items: center; }
    .dc-date { width: 140px; }
    .dc-to-text { color: #888; font-size: 13px; }
    .dc-card { background: #18191c; border: 1px solid #282a2e; border-radius: 12px; overflow: hidden; }
    .dc-table { width: 100%; border-collapse: collapse; text-align: left; }
    .dc-table th { background: #202226; color: #999; font-size: 12px; text-transform: uppercase; padding: 14px 16px; letter-spacing: 0.5px; }
    .dc-table td { padding: 14px 16px; border-bottom: 1px solid #24262b; font-size: 14px; }
    .dc-user-cell strong { display: block; color: #fff; }
    .dc-user-cell small { color: #888; }
    .dc-input { background: #222428; border: 1px solid #33363d; border-radius: 8px; color: #fff; padding: 8px 12px; box-sizing: border-box; }
    .dc-btn { padding: 8px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; border: none; font-size: 13px; }
    .dc-btn-secondary { background: #2a2c31; color: #fff; }
    .dc-loading, .dc-error { padding: 20px; text-align: center; }
    .dc-error { color: #ff5252; }
  `]
})
export class FinanceDriverEarningsComponent implements OnInit {
  loading = false;
  error: string | null = null;
  rows: DriverEarningsRow[] = [];
  filteredRows: DriverEarningsRow[] = [];
  totalGross = 0;
  totalCash = 0;
  totalOnline = 0;
  driversCount = 0;

  searchQuery = '';
  fromDate = '';
  toDate = '';

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    this.fromDate = firstDay.toISOString().split('T')[0];
    this.toDate = now.toISOString().split('T')[0];
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    const params = new URLSearchParams();
    if (this.fromDate) params.set('from', this.fromDate);
    if (this.toDate) params.set('to', this.toDate);

    this.api.get<DriverEarningsResponse>(`/admin/finance/driver-earnings?${params.toString()}`).subscribe({
      next: (res) => {
        this.loading = false;
        this.rows = res.data || [];
        this.totalGross = res.total_gross || 0;
        this.totalCash = res.total_cash || 0;
        this.totalOnline = res.total_online || 0;
        this.driversCount = res.drivers_count || 0;
        this.applyFilter();
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.message || 'Failed to load driver earnings.';
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
      r.name?.toLowerCase().includes(q) ||
      r.phone?.toLowerCase().includes(q) ||
      r.vehicle_reg_no?.toLowerCase().includes(q)
    );
  }
}
