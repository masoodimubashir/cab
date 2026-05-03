import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ApiService } from '../core/api.service';

@Component({
  selector: 'app-admin-drivers',
  standalone: true,
  imports: [CommonModule, CardModule, TableModule],
  template: `
    <p-card header="Drivers">
      <p-table [value]="drivers" *ngIf="drivers; else loading">
        <ng-template pTemplate="header">
          <tr>
            <th>ID</th>
            <th>Driver</th>
            <th>Approval</th>
            <th>Vehicle Reg</th>
            <th>Online</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr>
            <td>{{ row.id }}</td>
            <td>{{ row.user?.name || '-' }}</td>
            <td>{{ row.approval_status }}</td>
            <td>{{ row.vehicle_reg_no || '-' }}</td>
            <td>{{ row.is_online }}</td>
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
  `,
})
export class AdminDriversComponent implements OnInit {
  drivers: any[] | null = null;
  error: string | null = null;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.api.get<any>('/admin/drivers').subscribe({
      next: (res) => (this.drivers = res?.data?.data || []),
      error: (err) => (this.error = err?.error?.message || 'Failed to load drivers'),
    });
  }
}

