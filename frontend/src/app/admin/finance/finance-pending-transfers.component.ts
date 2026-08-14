import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';

interface PendingTransferRow {
  driver_id: number;
  user_id: number;
  name: string;
  phone: string;
  vehicle_reg_no: string;
  money_collected: number;
  money_transferred: number;
  pending_payout: number;
}

interface PendingTransfersResponse {
  data: PendingTransferRow[];
  total_pending: number;
  drivers_count: number;
}

@Component({
  selector: 'app-finance-pending-transfers',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="dc-page">
      <!-- Header -->
      <div class="dc-page-header">
        <div>
          <h1 class="dc-title">Pending Driver Transfers</h1>
          <p class="dc-subtitle">Online fares and deposits collected by operator awaiting transfer to drivers</p>
        </div>
        <button class="dc-btn dc-btn-secondary" (click)="load()">
          <span class="icon">↻</span> Refresh
        </button>
      </div>

      <!-- KPI Summary Cards -->
      <div class="dc-kpi-grid">
        <div class="dc-kpi-card">
          <span class="dc-kpi-label">Total Money Waiting To Be Transferred</span>
          <span class="dc-kpi-value text-emerald">₹{{ totalPending | number:'1.2-2' }}</span>
          <span class="dc-kpi-sub">Held in operator gateway for drivers</span>
        </div>
        <div class="dc-kpi-card">
          <span class="dc-kpi-label">Drivers Awaiting Payout</span>
          <span class="dc-kpi-value text-amber">{{ driversCount }}</span>
          <span class="dc-kpi-sub">With positive pending balances</span>
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
      </div>

      <!-- Table Card -->
      <div class="dc-card dc-table-container">
        <div *ngIf="loading" class="dc-loading">Loading pending transfers...</div>
        <div *ngIf="error" class="dc-error">{{ error }}</div>

        <table *ngIf="!loading && !error" class="dc-table">
          <thead>
            <tr>
              <th>Driver</th>
              <th>Vehicle</th>
              <th>Total Collected By Operator</th>
              <th>Already Transferred</th>
              <th>Pending Payout</th>
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
                <span class="text-muted">{{ row.vehicle_reg_no }}</span>
              </td>
              <td>₹{{ row.money_collected | number:'1.2-2' }}</td>
              <td>₹{{ row.money_transferred | number:'1.2-2' }}</td>
              <td>
                <strong class="text-emerald dc-pending-amount">₹{{ row.pending_payout | number:'1.2-2' }}</strong>
              </td>
              <td>
                <button class="dc-btn dc-btn-xs dc-btn-primary" (click)="openPayoutModal(row)">
                  Record Transfer
                </button>
              </td>
            </tr>
            <tr *ngIf="filteredRows.length === 0">
              <td colspan="6" class="text-center py-6 text-muted">
                {{ rows.length === 0 ? 'All caught up! No pending driver transfers.' : 'No matching drivers found.' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Record Payout Transfer Modal -->
      <div class="dc-modal-backdrop" *ngIf="selectedDriver">
        <div class="dc-modal">
          <div class="dc-modal-header">
            <h3>Record Transfer — {{ selectedDriver.name }}</h3>
            <button class="dc-close-btn" (click)="closeModal()">×</button>
          </div>
          <div class="dc-modal-body">
            <div class="dc-notice-box mb-4">
              <span>Pending payout amount: <strong>₹{{ selectedDriver.pending_payout | number:'1.2-2' }}</strong></span>
            </div>

            <div class="dc-form-group">
              <label>Transfer Method</label>
              <select class="dc-input" [(ngModel)]="payoutForm.method">
                <option value="gpay">GPay / UPI</option>
                <option value="bank">Bank Transfer (NEFT/IMPS)</option>
                <option value="cash">Cash Handover</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div class="dc-form-group">
              <label>Transfer Amount (₹)</label>
              <input
                type="number"
                class="dc-input"
                min="0.01"
                [max]="selectedDriver.pending_payout"
                step="0.01"
                placeholder="e.g. 500"
                [(ngModel)]="payoutForm.amount"
              />
            </div>

            <div class="dc-form-group">
              <label>UTR / Transaction Reference</label>
              <input type="text" class="dc-input" placeholder="e.g. UTR123456789" [(ngModel)]="payoutForm.reference" />
            </div>

            <div class="dc-form-group">
              <label>Notes</label>
              <input type="text" class="dc-input" placeholder="e.g. Weekly settlement payout" [(ngModel)]="payoutForm.note" />
            </div>

            <div *ngIf="payoutError" class="dc-error mt-2">{{ payoutError }}</div>
          </div>
          <div class="dc-modal-footer">
            <button class="dc-btn dc-btn-secondary" (click)="closeModal()" [disabled]="submitting">Cancel</button>
            <button
              class="dc-btn dc-btn-primary"
              (click)="submitPayout()"
              [disabled]="submitting || !payoutForm.amount || payoutForm.amount <= 0 || payoutForm.amount > selectedDriver.pending_payout"
            >
              {{ submitting ? 'Recording...' : 'Confirm Transfer' }}
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
    .dc-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .dc-kpi-card { background: #18191c; border: 1px solid #282a2e; border-radius: 12px; padding: 20px; }
    .dc-kpi-label { font-size: 13px; color: #9e9e9e; display: block; margin-bottom: 6px; }
    .dc-kpi-value { font-size: 28px; font-weight: 700; color: #fff; display: block; }
    .dc-kpi-sub { font-size: 12px; color: #666; margin-top: 4px; display: block; }
    .text-amber { color: #ffb300; }
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
    .dc-pending-amount { font-size: 15px; }
    .dc-input { background: #222428; border: 1px solid #33363d; border-radius: 8px; color: #fff; padding: 8px 12px; width: 100%; box-sizing: border-box; }
    .dc-btn { padding: 8px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; border: none; font-size: 13px; }
    .dc-btn-primary { background: #00c06a; color: #000; }
    .dc-btn-secondary { background: #2a2c31; color: #fff; }
    .dc-btn-xs { padding: 6px 12px; font-size: 12px; }
    .dc-notice-box { background: rgba(0, 192, 106, 0.1); border: 1px solid rgba(0, 192, 106, 0.3); border-radius: 8px; padding: 10px 14px; }
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
export class FinancePendingTransfersComponent implements OnInit {
  loading = false;
  error: string | null = null;
  rows: PendingTransferRow[] = [];
  filteredRows: PendingTransferRow[] = [];
  totalPending = 0;
  driversCount = 0;

  searchQuery = '';

  selectedDriver: PendingTransferRow | null = null;
  payoutForm = { method: 'gpay', amount: null as number | null, reference: '', note: '' };
  submitting = false;
  payoutError: string | null = null;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.api.get<PendingTransfersResponse>('/admin/finance/transfers/pending').subscribe({
      next: (res) => {
        this.loading = false;
        this.rows = res.data || [];
        this.totalPending = res.total_pending || 0;
        this.driversCount = res.drivers_count || 0;
        this.applyFilter();
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.message || 'Failed to load pending transfers.';
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

  openPayoutModal(driver: PendingTransferRow): void {
    this.selectedDriver = driver;
    this.payoutForm = {
      method: 'gpay',
      amount: driver.pending_payout,
      reference: '',
      note: 'Driver payout settlement',
    };
    this.payoutError = null;
  }

  closeModal(): void {
    this.selectedDriver = null;
  }

  submitPayout(): void {
    if (!this.selectedDriver || !this.payoutForm.amount) return;
    this.submitting = true;
    this.payoutError = null;

    this.api.post(`/admin/drivers/${this.selectedDriver.driver_id}/wallet/payout`, {
      amount: this.payoutForm.amount,
      method: this.payoutForm.method,
      reference: this.payoutForm.reference,
      note: this.payoutForm.note,
    }).subscribe({
      next: () => {
        this.submitting = false;
        this.closeModal();
        this.load();
      },
      error: (err) => {
        this.submitting = false;
        this.payoutError = err?.error?.message || 'Failed to record transfer.';
      }
    });
  }
}
