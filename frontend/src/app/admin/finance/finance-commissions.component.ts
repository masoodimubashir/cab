import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';

interface CommissionRow {
  trip_id: number;
  date: string;
  driver_id: number;
  driver_name: string;
  driver_phone: string;
  vehicle_type: string;
  fare: number;
  commission_percent: number;
  commission_amount: number;
  net_driver_earnings: number;
  payment_method: string;
  is_shared: boolean;
}

interface CommissionsResponse {
  data: CommissionRow[];
  total_commission: number;
  total_fare: number;
  count: number;
  range: { from: string; to: string };
}

@Component({
  selector: 'app-finance-commissions',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="dc-page">
      <!-- Header -->
      <div class="dc-page-header">
        <div>
          <h1 class="dc-title">Ride Commissions</h1>
          <p class="dc-subtitle">Itemised platform commission deductions charged across all completed rides</p>
        </div>
        <button class="dc-btn dc-btn-secondary" (click)="load()">
          <span class="icon">↻</span> Refresh
        </button>
      </div>

      <!-- KPI Summary Cards -->
      <div class="dc-kpi-grid">
        <div class="dc-kpi-card">
          <span class="dc-kpi-label">Total Commission Deducted</span>
          <span class="dc-kpi-value text-emerald">₹{{ totalCommission | number:'1.2-2' }}</span>
          <span class="dc-kpi-sub">Across {{ count }} commissioned trips</span>
        </div>
        <div class="dc-kpi-card">
          <span class="dc-kpi-label">Total Gross Ride Volume</span>
          <span class="dc-kpi-value">₹{{ totalFare | number:'1.2-2' }}</span>
          <span class="dc-kpi-sub">Gross fares completed</span>
        </div>
        <div class="dc-kpi-card">
          <span class="dc-kpi-label">Effective Platform Take-Rate</span>
          <span class="dc-kpi-value text-amber">{{ totalFare > 0 ? ((totalCommission / totalFare) * 100 | number:'1.1-1') : 0 }}%</span>
          <span class="dc-kpi-sub">Platform commission percentage</span>
        </div>
      </div>

      <!-- Filter Controls -->
      <div class="dc-filter-bar">
        <input
          type="text"
          class="dc-input dc-search"
          placeholder="Search by trip ID, driver name, vehicle..."
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
        <div *ngIf="loading" class="dc-loading">Loading ride commissions...</div>
        <div *ngIf="error" class="dc-error">{{ error }}</div>

        <table *ngIf="!loading && !error" class="dc-table">
          <thead>
            <tr>
              <th>Date &amp; Trip</th>
              <th>Driver</th>
              <th>Vehicle</th>
              <th>Gross Fare</th>
              <th>Comm. %</th>
              <th>Commission Charged</th>
              <th>Driver Share</th>
              <th>Mode</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let row of filteredRows">
              <td>
                <strong>#{{ row.trip_id }}</strong>
                <small class="text-muted block">{{ row.date | date:'short' }}</small>
              </td>
              <td>
                <div class="dc-user-cell">
                  <strong>{{ row.driver_name }}</strong>
                  <small>{{ row.driver_phone }}</small>
                </div>
              </td>
              <td>{{ row.vehicle_type }}</td>
              <td>₹{{ row.fare | number:'1.2-2' }}</td>
              <td>{{ row.commission_percent }}%</td>
              <td>
                <strong class="text-amber">₹{{ row.commission_amount | number:'1.2-2' }}</strong>
              </td>
              <td>
                <span class="text-emerald">₹{{ row.net_driver_earnings | number:'1.2-2' }}</span>
              </td>
              <td>
                <span class="dc-badge">{{ row.is_shared ? 'Shared' : 'Solo' }} ({{ row.payment_method }})</span>
              </td>
            </tr>
            <tr *ngIf="filteredRows.length === 0">
              <td colspan="8" class="text-center py-6 text-muted">No commissioned rides found for selected period.</td>
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
    .block { display: block; }
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
    .dc-badge { display: inline-block; padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: 600; background: #282b30; color: #ccc; }
    .dc-input { background: #222428; border: 1px solid #33363d; border-radius: 8px; color: #fff; padding: 8px 12px; box-sizing: border-box; }
    .dc-btn { padding: 8px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; border: none; font-size: 13px; }
    .dc-btn-secondary { background: #2a2c31; color: #fff; }
    .dc-loading, .dc-error { padding: 20px; text-align: center; }
    .dc-error { color: #ff5252; }
  `]
})
export class FinanceCommissionsComponent implements OnInit {
  loading = false;
  error: string | null = null;
  rows: CommissionRow[] = [];
  filteredRows: CommissionRow[] = [];
  totalCommission = 0;
  totalFare = 0;
  count = 0;

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

    this.api.get<CommissionsResponse>(`/admin/finance/commissions?${params.toString()}`).subscribe({
      next: (res) => {
        this.loading = false;
        this.rows = res.data || [];
        this.totalCommission = res.total_commission || 0;
        this.totalFare = res.total_fare || 0;
        this.count = res.count || 0;
        this.applyFilter();
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.message || 'Failed to load ride commissions.';
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
      r.trip_id.toString().includes(q) ||
      r.driver_name?.toLowerCase().includes(q) ||
      r.driver_phone?.toLowerCase().includes(q) ||
      r.vehicle_type?.toLowerCase().includes(q)
    );
  }
}
