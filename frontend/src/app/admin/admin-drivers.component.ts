import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { ApiService } from '../core/api.service';

type DriverRow = {
  id: number;
  approval_status: 'pending' | 'approved' | 'rejected';
  vehicle_type?: string | null;
  vehicle_reg_no?: string | null;
  is_online: boolean;
  user?: { id: number; name?: string; phone?: string | null; email?: string | null };
};

type DocsFilter = 'all' | 'uploaded' | 'not_uploaded';

@Component({
  selector: 'app-admin-drivers',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, TableModule, ButtonModule, InputTextModule, TagModule],
  template: `
    <p-card header="Driver Approvals">
      <p class="muted small">
        Click <strong>Details</strong> to view a driver's documents, set their vehicle reg no, and approve/reject documents.
      </p>

      <div class="toolbar">
        <div class="seg">
          <button
            type="button"
            class="seg__btn"
            [class.active]="docsFilter === 'all'"
            (click)="setDocsFilter('all')"
          >All</button>
          <button
            type="button"
            class="seg__btn"
            [class.active]="docsFilter === 'uploaded'"
            (click)="setDocsFilter('uploaded')"
          >Documents Uploaded</button>
          <button
            type="button"
            class="seg__btn"
            [class.active]="docsFilter === 'not_uploaded'"
            (click)="setDocsFilter('not_uploaded')"
          >Documents Not Uploaded</button>
        </div>

        <div class="search">
          <input
            pInputText
            type="search"
            placeholder="Search by phone or email…"
            [(ngModel)]="searchText"
            (ngModelChange)="onSearchChange()"
          />
        </div>
      </div>

      <p-table [value]="drivers || []" *ngIf="drivers; else loading" [paginator]="true" [rows]="20">
        <ng-template pTemplate="header">
          <tr>
            <th>ID</th>
            <th>Driver</th>
            <th>Phone</th>
            <th>Email</th>
            <th>Vehicle</th>
            <th>Approval</th>
            <th>Online</th>
            <th style="width: 110px;">Action</th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-row>
          <tr>
            <td>{{ row.id }}</td>
            <td>{{ row.user?.name || '-' }}</td>
            <td>{{ row.user?.phone || '-' }}</td>
            <td>{{ row.user?.email || '-' }}</td>
            <td>
              {{ row.vehicle_type || '-' }}
              <small *ngIf="row.vehicle_reg_no">· {{ row.vehicle_reg_no }}</small>
            </td>
            <td>
              <p-tag
                [value]="row.approval_status"
                [severity]="approvalSeverity(row.approval_status)"
              ></p-tag>
            </td>
            <td>{{ row.is_online ? 'yes' : 'no' }}</td>
            <td>
              <button
                pButton
                type="button"
                label="Details"
                class="p-button-sm"
                (click)="openDetails(row)"
              ></button>
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr><td colspan="8" class="empty">No drivers match the current filters.</td></tr>
        </ng-template>
      </p-table>

      <ng-template #loading>
        <div class="empty">Loading drivers…</div>
      </ng-template>
    </p-card>

    <div *ngIf="error" class="error">{{ error }}</div>
  `,
  styles: [
    `
      .muted { color: #64748b; font-size: 13px; margin: 0 0 12px; }
      .small { font-size: 12px; }
      .empty { padding: 28px; text-align: center; color: #64748b; }
      .error { color: #b00020; margin-top: 12px; font-weight: 700; }

      .toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
        flex-wrap: wrap;
      }
      .seg {
        display: inline-flex;
        border: 1px solid rgba(15, 23, 42, 0.16);
        border-radius: 8px;
        overflow: hidden;
      }
      .seg__btn {
        padding: 7px 14px;
        background: #fff;
        border: 0;
        cursor: pointer;
        font-weight: 700;
        font-size: 12.5px;
        color: rgba(15, 23, 42, 0.7);
        border-right: 1px solid rgba(15, 23, 42, 0.08);
      }
      .seg__btn:last-child { border-right: 0; }
      .seg__btn.active {
        background: #06b6d4;
        color: #fff;
      }
      .search input { width: 280px; }
    `,
  ],
})
export class AdminDriversComponent implements OnInit, OnDestroy {
  drivers: DriverRow[] | null = null;
  error: string | null = null;

  docsFilter: DocsFilter = 'all';
  searchText = '';

  private searchTimer: number | null = null;

  constructor(private api: ApiService, private router: Router) {}

  ngOnInit(): void {
    this.refresh();
  }

  ngOnDestroy(): void {
    if (this.searchTimer) window.clearTimeout(this.searchTimer);
  }

  refresh(): void {
    this.drivers = null;
    const params = new URLSearchParams();
    if (this.docsFilter === 'uploaded') params.set('has_documents', '1');
    else if (this.docsFilter === 'not_uploaded') params.set('has_documents', '0');
    const q = this.searchText.trim();
    if (q) params.set('q', q);
    const qs = params.toString() ? `?${params.toString()}` : '';

    this.api.get<{ data: { data: DriverRow[] } }>(`/admin/drivers${qs}`).subscribe({
      next: (res) => (this.drivers = res?.data?.data || []),
      error: (err) => (this.error = err?.error?.message || 'Failed to load drivers'),
    });
  }

  setDocsFilter(f: DocsFilter): void {
    if (this.docsFilter === f) return;
    this.docsFilter = f;
    this.refresh();
  }

  onSearchChange(): void {
    // Debounce so we don't fire a request on every keystroke.
    if (this.searchTimer) window.clearTimeout(this.searchTimer);
    this.searchTimer = window.setTimeout(() => this.refresh(), 300);
  }

  approvalSeverity(s: string): 'success' | 'warning' | 'danger' | 'info' {
    if (s === 'approved') return 'success';
    if (s === 'rejected') return 'danger';
    return 'warning';
  }

  openDetails(row: DriverRow): void {
    this.router.navigateByUrl(`/drivers/approvals/${row.id}`);
  }
}
