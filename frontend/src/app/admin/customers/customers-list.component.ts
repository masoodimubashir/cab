import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TabViewModule } from 'primeng/tabview';
import { DialogModule } from 'primeng/dialog';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { ApiService } from '../../core/api.service';

interface CustomerRow {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  last_login_at: string | null;
  last_ride_at: string | null;
  total_rides: number;
  city: string | null;
  is_suspended: boolean;
}

@Component({
  selector: 'app-customers-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink, DatePipe,
    CardModule, TableModule, ButtonModule, InputTextModule,
    TabViewModule, DialogModule, ToastModule,
  ],
  providers: [MessageService],
  template: `
    <p-toast />

    <div class="page-head">
      <h2>Customers Details</h2>
    </div>

    <p-tabView [(activeIndex)]="activeTab" (onChange)="onTabChange($event)">
      <p-tabPanel header="All Customers"></p-tabPanel>
      <p-tabPanel header="Customers with Docs"></p-tabPanel>
    </p-tabView>

    <div class="action-row">
      <button pButton label="View OTP" icon="pi pi-key"
              class="p-button-info" (click)="openViewOtp()"></button>
      <button pButton label="Import Users" icon="pi pi-upload"
              class="p-button-info" (click)="openImport()"></button>
    </div>

    <div class="search-row">
      <span class="p-input-icon-left" style="width:320px;">
        <i class="pi pi-search"></i>
        <input pInputText type="text"
               [(ngModel)]="search"
               (input)="onSearchChange()"
               placeholder="User Id, Phone Number, Email" />
      </span>
    </div>

    <p-table [value]="rows"
             [paginator]="true"
             [rows]="50"
             [totalRecords]="total"
             [lazy]="true"
             (onLazyLoad)="onLazy($event)"
             [loading]="loading"
             dataKey="id"
             responsiveLayout="scroll">
      <ng-template pTemplate="header">
        <tr>
          <th>User ID</th>
          <th>User Name</th>
          <th>Phone Number</th>
          <th>Email</th>
          <th>Last Login</th>
          <th>Last Ride On</th>
          <th>Total Rides</th>
          <th>OTP</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-row>
        <tr>
          <td><a [routerLink]="['/customers', row.id]" class="link">{{ row.id }}</a></td>
          <td>{{ row.name || '—' }}</td>
          <td>{{ row.phone || '—' }}</td>
          <td>{{ row.email || '—' }}</td>
          <td>{{ row.last_login_at ? (row.last_login_at | date:'yyyy-MM-dd HH:mm:ss') : '—' }}</td>
          <td>{{ row.last_ride_at ? (row.last_ride_at | date:'yyyy-MM-dd') : '—' }}</td>
          <td>{{ row.total_rides ?? 0 }}</td>
          <td>
            <button pButton label="OTP" class="p-button-sm p-button-info"
                    (click)="sendOtp(row)"></button>
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr><td colspan="8" class="empty">No customers found.</td></tr>
      </ng-template>
    </p-table>

    <!-- View OTP dialog: prompts admin for a User ID then sends an OTP. -->
    <p-dialog header="Send OTP to User" [(visible)]="viewOtpOpen"
              [modal]="true" [style]="{ width: '420px' }" [draggable]="false">
      <div class="form">
        <label class="lbl">User ID</label>
        <input pInputText [(ngModel)]="otpUserId" placeholder="e.g. 20543094" />
      </div>
      <ng-template pTemplate="footer">
        <button pButton label="Cancel" class="p-button-secondary"
                (click)="viewOtpOpen = false"></button>
        <button pButton label="Send OTP" [loading]="otpSending"
                (click)="submitOtp()"></button>
      </ng-template>
    </p-dialog>

    <!-- Import Users CSV dialog -->
    <p-dialog header="Import Users" [(visible)]="importOpen"
              [modal]="true" [style]="{ width: '480px' }" [draggable]="false">
      <p class="muted small">
        Upload a CSV with at least a <code>phone</code> column. Optional: <code>name</code>, <code>email</code>.
      </p>
      <input #csvInput type="file" accept=".csv,.txt"
             (change)="onCsvSelected($event)" />
      <div *ngIf="csvFileName" class="muted small" style="margin-top:8px;">
        Selected: {{ csvFileName }}
      </div>
      <ng-template pTemplate="footer">
        <button pButton label="Cancel" class="p-button-secondary"
                (click)="closeImport()"></button>
        <button pButton label="Upload" icon="pi pi-upload"
                [loading]="importing" [disabled]="!csvFile"
                (click)="submitImport()"></button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .page-head { padding: 8px 0 4px; }
    h2 { margin: 0; }
    .action-row { display: flex; gap: 8px; margin: 12px 0; }
    .search-row { display: flex; justify-content: flex-end; margin-bottom: 12px; }
    .link { color: #2196f3; text-decoration: none; }
    .link:hover { text-decoration: underline; }
    .form { display: flex; flex-direction: column; gap: 6px; }
    .lbl { font-weight: 500; font-size: 0.9rem; }
    .muted { color: #666; }
    .small { font-size: 0.85rem; }
    .empty { text-align: center; padding: 24px; color: #888; }
  `],
})
export class CustomersListComponent implements OnInit {
  rows: CustomerRow[] = [];
  total = 0;
  loading = false;
  search = '';
  activeTab = 0;
  private searchDebounce: any = null;
  private lastEvent: any = null;

  viewOtpOpen = false;
  otpUserId = '';
  otpSending = false;

  importOpen = false;
  csvFile: File | null = null;
  csvFileName = '';
  importing = false;

  constructor(private api: ApiService, private toast: MessageService) {}

  ngOnInit(): void {
    // Initial load handled via onLazy() fired by p-table.
  }

  onLazy(event: any): void {
    this.lastEvent = event;
    const page = Math.floor((event.first ?? 0) / (event.rows ?? 50)) + 1;
    const tab = this.activeTab === 1 ? 'with_docs' : 'all';
    this.loading = true;
    this.api
      .get<any>(`/admin/customers?page=${page}&tab=${tab}&search=${encodeURIComponent(this.search)}`)
      .subscribe({
        next: (res) => {
          const page = res?.data;
          this.rows = page?.data ?? [];
          this.total = page?.total ?? 0;
          this.loading = false;
        },
        error: (err) => {
          this.toast.add({
            severity: 'error', summary: 'Load failed',
            detail: err?.error?.message || 'Could not load customers',
          });
          this.loading = false;
        },
      });
  }

  onTabChange(_: any): void {
    if (this.lastEvent) {
      this.lastEvent.first = 0;
      this.onLazy(this.lastEvent);
    }
  }

  onSearchChange(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => {
      if (this.lastEvent) {
        this.lastEvent.first = 0;
        this.onLazy(this.lastEvent);
      }
    }, 300);
  }

  // ── OTP send (top button) ─────────────────────────────────────────
  openViewOtp(): void {
    this.otpUserId = '';
    this.viewOtpOpen = true;
  }
  submitOtp(): void {
    const id = parseInt(this.otpUserId, 10);
    if (!id) {
      this.toast.add({ severity: 'warn', summary: 'Enter a valid User ID' });
      return;
    }
    this.sendOtp({ id } as any, () => (this.viewOtpOpen = false));
  }
  sendOtp(row: CustomerRow, onDone?: () => void): void {
    this.otpSending = true;
    this.api.post(`/admin/customers/${row.id}/send-otp`, {}).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'OTP sent' });
        this.otpSending = false;
        onDone?.();
      },
      error: (err) => {
        this.toast.add({
          severity: 'error', summary: 'OTP failed',
          detail: err?.error?.message || 'Could not send OTP',
        });
        this.otpSending = false;
      },
    });
  }

  // ── CSV import ─────────────────────────────────────────────────────
  openImport(): void {
    this.csvFile = null;
    this.csvFileName = '';
    this.importOpen = true;
  }
  closeImport(): void {
    this.importOpen = false;
    this.csvFile = null;
    this.csvFileName = '';
  }
  onCsvSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.csvFile = input.files[0];
      this.csvFileName = this.csvFile.name;
    }
  }
  submitImport(): void {
    if (!this.csvFile) return;
    const fd = new FormData();
    fd.append('file', this.csvFile);
    this.importing = true;
    this.api.postMultipart<{ message: string }>('/admin/customers/import', fd).subscribe({
      next: (res) => {
        this.toast.add({ severity: 'success', summary: 'Import complete', detail: res.message });
        this.importing = false;
        this.closeImport();
        if (this.lastEvent) this.onLazy(this.lastEvent);
      },
      error: (err) => {
        this.toast.add({
          severity: 'error', summary: 'Import failed',
          detail: err?.error?.message || 'Could not import users',
        });
        this.importing = false;
      },
    });
  }
}
