import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ApiService } from '../core/api.service';

type DriverDocument = {
  id: number;
  document_type: 'DL' | 'RC' | 'INSURANCE' | 'ID';
  status: 'uploaded' | 'approved' | 'rejected';
  rejection_reason?: string | null;
};

type DriverRow = {
  id: number;
  approval_status: 'pending' | 'approved' | 'rejected';
  vehicle_type?: string | null;
  vehicle_reg_no?: string | null;
  is_online: boolean;
  user?: { id: number; name?: string; phone?: string | null; email?: string | null };
  documents?: DriverDocument[];
};

const REQUIRED_DOC_TYPES: DriverDocument['document_type'][] = ['DL', 'RC', 'INSURANCE', 'ID'];

@Component({
  selector: 'app-admin-drivers',
  standalone: true,
  imports: [CommonModule, CardModule, TableModule, ButtonModule, TagModule],
  template: `
    <p-card header="Drivers">
      <p-table
        [value]="drivers || []"
        dataKey="id"
        [expandedRowKeys]="expanded"
        *ngIf="drivers; else loading"
      >
        <ng-template pTemplate="header">
          <tr>
            <th style="width:3rem"></th>
            <th>ID</th>
            <th>Driver</th>
            <th>Phone</th>
            <th>Approval</th>
            <th>Vehicle</th>
            <th>Online</th>
            <th>Actions</th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-row let-expanded="expanded">
          <tr>
            <td>
              <button
                pButton
                type="button"
                [icon]="expanded ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"
                class="p-button-text p-button-rounded"
                (click)="toggleExpand(row)"
              ></button>
            </td>
            <td>{{ row.id }}</td>
            <td>{{ row.user?.name || '-' }}</td>
            <td>{{ row.user?.phone || '-' }}</td>
            <td>
              <p-tag
                [value]="row.approval_status"
                [severity]="approvalSeverity(row.approval_status)"
              ></p-tag>
            </td>
            <td>{{ row.vehicle_type || '-' }} <small>{{ row.vehicle_reg_no || '' }}</small></td>
            <td>{{ row.is_online ? 'yes' : 'no' }}</td>
            <td>
              <button
                pButton
                label="Approve"
                class="p-button-success p-button-sm"
                [disabled]="row.approval_status === 'approved' || !allDocsApproved(row) || busyId === row.id"
                (click)="setApproval(row, 'approved')"
                style="margin-right: 4px;"
              ></button>
              <button
                pButton
                label="Reject"
                class="p-button-danger p-button-sm p-button-outlined"
                [disabled]="row.approval_status === 'rejected' || busyId === row.id"
                (click)="setApproval(row, 'rejected')"
              ></button>
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="rowexpansion" let-row>
          <tr>
            <td colspan="8" style="background: #fafafa;">
              <div style="padding: 8px 16px;">
                <h4 style="margin: 0 0 8px;">Documents</h4>
                <p *ngIf="!row.documents?.length" style="color: #777;">
                  No documents uploaded yet.
                </p>
                <table *ngIf="row.documents?.length" style="width: 100%; border-collapse: collapse;">
                  <thead>
                    <tr style="text-align: left; border-bottom: 1px solid #ddd;">
                      <th style="padding: 6px;">Type</th>
                      <th style="padding: 6px;">Status</th>
                      <th style="padding: 6px;">Rejection reason</th>
                      <th style="padding: 6px;">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let d of row.documents" style="border-bottom: 1px solid #eee;">
                      <td style="padding: 6px;">{{ d.document_type }}</td>
                      <td style="padding: 6px;">
                        <p-tag
                          [value]="d.status"
                          [severity]="docSeverity(d.status)"
                        ></p-tag>
                      </td>
                      <td style="padding: 6px; color: #666;">{{ d.rejection_reason || '-' }}</td>
                      <td style="padding: 6px;">
                        <button
                          pButton
                          label="Approve"
                          class="p-button-success p-button-sm"
                          [disabled]="d.status === 'approved' || busyDocId === d.id"
                          (click)="setDocStatus(row, d, 'approved')"
                          style="margin-right: 4px;"
                        ></button>
                        <button
                          pButton
                          label="Reject"
                          class="p-button-danger p-button-sm p-button-outlined"
                          [disabled]="d.status === 'rejected' || busyDocId === d.id"
                          (click)="setDocStatus(row, d, 'rejected')"
                        ></button>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p *ngIf="row.documents?.length && missingDocs(row).length"
                   style="color: #b00020; margin-top: 8px;">
                  Missing: {{ missingDocs(row).join(', ') }}
                </p>
              </div>
            </td>
          </tr>
        </ng-template>
      </p-table>

      <ng-template #loading>
        <div>Loading drivers...</div>
      </ng-template>
    </p-card>

    <div *ngIf="error" style="color: #b00020; margin-top: 12px;">
      {{ error }}
    </div>
    <div *ngIf="message" style="color: #1f8b4c; margin-top: 12px;">
      {{ message }}
    </div>
  `,
})
export class AdminDriversComponent implements OnInit {
  drivers: DriverRow[] | null = null;
  expanded: Record<string | number, boolean> = {};
  busyId: number | null = null;
  busyDocId: number | null = null;
  error: string | null = null;
  message: string | null = null;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.api.get<{ data: { data: DriverRow[] } }>('/admin/drivers').subscribe({
      next: (res) => (this.drivers = res?.data?.data || []),
      error: (err) => (this.error = err?.error?.message || 'Failed to load drivers'),
    });
  }

  toggleExpand(row: DriverRow): void {
    this.expanded = { ...this.expanded, [row.id]: !this.expanded[row.id] };
  }

  approvalSeverity(s: string): 'success' | 'warning' | 'danger' | 'info' {
    if (s === 'approved') return 'success';
    if (s === 'rejected') return 'danger';
    return 'warning';
  }

  docSeverity(s: string): 'success' | 'warning' | 'danger' | 'info' {
    if (s === 'approved') return 'success';
    if (s === 'rejected') return 'danger';
    return 'info';
  }

  allDocsApproved(row: DriverRow): boolean {
    return this.missingDocs(row).length === 0;
  }

  missingDocs(row: DriverRow): string[] {
    const have = new Map<string, DriverDocument>();
    for (const d of row.documents || []) have.set(d.document_type, d);
    return REQUIRED_DOC_TYPES.filter((t) => have.get(t)?.status !== 'approved');
  }

  setApproval(row: DriverRow, status: 'approved' | 'rejected'): void {
    this.busyId = row.id;
    this.error = null;
    this.message = null;
    this.api
      .patch<{ driver: DriverRow }>(`/admin/drivers/${row.id}/approval`, {
        approval_status: status,
      })
      .subscribe({
        next: (res) => {
          row.approval_status = res.driver.approval_status;
          this.message = `Driver #${row.id} ${status}.`;
        },
        error: (err) => {
          this.error = err?.error?.message || 'Approval update failed';
        },
        complete: () => (this.busyId = null),
      });
  }

  setDocStatus(row: DriverRow, doc: DriverDocument, status: 'approved' | 'rejected'): void {
    this.busyDocId = doc.id;
    this.error = null;
    this.message = null;
    this.api
      .patch<{ document: DriverDocument }>(`/admin/drivers/documents/${doc.id}/status`, {
        status,
      })
      .subscribe({
        next: (res) => {
          doc.status = res.document.status;
          doc.rejection_reason = res.document.rejection_reason ?? null;
          this.message = `Document ${doc.document_type} ${status}.`;
        },
        error: (err) => {
          this.error = err?.error?.message || 'Document status update failed';
        },
        complete: () => (this.busyDocId = null),
      });
  }
}
