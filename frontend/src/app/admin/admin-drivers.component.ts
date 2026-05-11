import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
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

@Component({
  selector: 'app-admin-drivers',
  standalone: true,
  imports: [CommonModule, CardModule, TableModule, ButtonModule, TagModule],
  template: `
    <p-card header="Driver Approvals">
      <p class="muted small">
        Click <strong>Details</strong> to view a driver's documents, set their vehicle reg no, and approve/reject documents.
      </p>

      <p-table [value]="drivers || []" *ngIf="drivers; else loading" [paginator]="true" [rows]="20">
        <ng-template pTemplate="header">
          <tr>
            <th>ID</th>
            <th>Driver</th>
            <th>Phone</th>
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
          <tr><td colspan="7" class="empty">No drivers yet.</td></tr>
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
    `,
  ],
})
export class AdminDriversComponent implements OnInit {
  drivers: DriverRow[] | null = null;
  error: string | null = null;

  constructor(private api: ApiService, private router: Router) {}

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.api.get<{ data: { data: DriverRow[] } }>('/admin/drivers').subscribe({
      next: (res) => (this.drivers = res?.data?.data || []),
      error: (err) => (this.error = err?.error?.message || 'Failed to load drivers'),
    });
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
