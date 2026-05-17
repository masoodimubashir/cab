import { Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { ApiService } from '../../core/api.service';

export type DriverState = 'active' | 'deactivated';

interface DriverRow {
  id: number;
  approval_status: 'pending' | 'approved' | 'rejected';
  vehicle_type: string | null;
  vehicle_reg_no: string | null;
  is_online: boolean;
  registered_on: string | null;
  last_login: string | null;
  last_ride_on: string | null;
  rides_7d: number;
  rides_30d: number;
  total_rides: number;
  deactivated_at: string | null;
  deactivated_reason: string | null;
  user: { id: number; name: string; phone: string | null; email: string | null } | null;
}

interface VehicleTab {
  label: string;
  value: string | null;
}

@Component({
  selector: 'app-drivers-list',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, TableModule, ButtonModule, InputTextModule, TagModule],
  template: `
    <p-card [header]="title">
      <div class="toolbar">
        <input
          pInputText
          type="search"
          [(ngModel)]="q"
          placeholder="Driver ID, name, mobile, email, vehicle number"
          (keydown.enter)="applySearch()"
          class="search-input"
        />
        <button pButton type="button" label="Search" icon="pi pi-search" (click)="applySearch()"></button>
        <button
          pButton
          type="button"
          label="Clear"
          icon="pi pi-times"
          class="p-button-text"
          (click)="clearSearch()"
        ></button>
        <button
          pButton
          type="button"
          label="Export CSV"
          icon="pi pi-download"
          class="p-button-success"
          (click)="exportCsv()"
          [disabled]="exporting"
        ></button>
      </div>

      <div class="tabs">
        <button
          *ngFor="let tab of vehicleTabs"
          type="button"
          class="tab"
          [class.active]="vehicleType === tab.value"
          (click)="selectTab(tab.value)"
        >
          {{ tab.label }}
        </button>
      </div>

      <p-table [value]="drivers" [loading]="loading" responsiveLayout="scroll">
        <ng-template pTemplate="header">
          <tr>
            <th>Driver ID</th>
            <th>Name</th>
            <th>Mobile</th>
            <th>Email</th>
            <th>Status</th>
            <th>Vehicle</th>
            <th>Registered</th>
            <th>Rides 7d</th>
            <th>Rides 30d</th>
            <th>Total Rides</th>
            <th>Last Login</th>
            <th *ngIf="state === 'deactivated'">Deactivated On</th>
            <th>Action</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr>
            <td>#{{ row.id }}</td>
            <td>{{ row.user?.name || '-' }}</td>
            <td>{{ row.user?.phone || '-' }}</td>
            <td>{{ row.user?.email || '-' }}</td>
            <td>
              <p-tag
                [value]="row.is_online ? 'online' : 'offline'"
                [severity]="row.is_online ? 'success' : 'info'"
              ></p-tag>
              <p-tag
                class="ml"
                [value]="row.approval_status"
                [severity]="approvalSeverity(row.approval_status)"
              ></p-tag>
            </td>
            <td>
              {{ row.vehicle_type || '-' }}
              <div class="muted">{{ row.vehicle_reg_no || '' }}</div>
            </td>
            <td>{{ row.registered_on | date: 'short' }}</td>
            <td>{{ row.rides_7d }}</td>
            <td>{{ row.rides_30d }}</td>
            <td>{{ row.total_rides }}</td>
            <td>{{ row.last_login | date: 'short' }}</td>
            <td *ngIf="state === 'deactivated'">
              {{ row.deactivated_at | date: 'short' }}
              <div class="muted" *ngIf="row.deactivated_reason">{{ row.deactivated_reason }}</div>
            </td>
            <td>
              <button
                *ngIf="state === 'active'"
                pButton
                type="button"
                label="Deactivate"
                class="p-button-danger p-button-sm p-button-outlined"
                [disabled]="busyId === row.id"
                (click)="deactivate(row)"
              ></button>
              <button
                *ngIf="state === 'deactivated'"
                pButton
                type="button"
                label="Reactivate"
                class="p-button-success p-button-sm"
                [disabled]="busyId === row.id"
                (click)="reactivate(row)"
              ></button>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td [attr.colspan]="state === 'deactivated' ? 13 : 12" class="empty">
              No drivers found.
            </td>
          </tr>
        </ng-template>
      </p-table>

      <div *ngIf="error" class="error">{{ error }}</div>
      <div *ngIf="message" class="ok">{{ message }}</div>
    </p-card>
  `,
  styles: [
    `
      .toolbar {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-bottom: 12px;
        flex-wrap: wrap;
      }
      .search-input {
        flex: 1 1 320px;
        min-width: 240px;
      }
      .tabs {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-bottom: 14px;
      }
      .tab {
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 700;
        border-radius: 999px;
        border: 1px solid rgba(15, 23, 42, 0.16);
        background: #fff;
        color: rgba(15, 23, 42, 0.7);
        cursor: pointer;
      }
      .tab.active {
        background: #3b82f6;
        color: #fff;
        border-color: #3b82f6;
      }
      .muted {
        color: rgba(15, 23, 42, 0.55);
        font-size: 12px;
      }
      .ml {
        margin-left: 6px;
      }
      .empty {
        text-align: center;
        padding: 24px;
        color: rgba(15, 23, 42, 0.55);
      }
      .error {
        margin-top: 12px;
        color: #b00020;
        font-weight: 700;
      }
      .ok {
        margin-top: 12px;
        color: #1f8b4c;
        font-weight: 700;
      }
    `,
  ],
})
export class DriversListComponent implements OnInit, OnChanges {
  @Input({ required: true }) state!: DriverState;
  @Input() title = 'Drivers';

  drivers: DriverRow[] = [];
  loading = false;
  exporting = false;
  error: string | null = null;
  message: string | null = null;

  q = '';
  vehicleType: string | null = null;
  busyId: number | null = null;

  vehicleTabs: VehicleTab[] = [{ label: 'All Drivers', value: null }];

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.loadVehicleTypes();
    this.fetch();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['state'] && !changes['state'].firstChange) {
      this.fetch();
    }
  }

  applySearch(): void {
    this.fetch();
  }

  clearSearch(): void {
    this.q = '';
    this.vehicleType = null;
    this.fetch();
  }

  selectTab(value: string | null): void {
    this.vehicleType = value;
    this.fetch();
  }

  approvalSeverity(s: string): 'success' | 'warning' | 'danger' | 'info' {
    if (s === 'approved') return 'success';
    if (s === 'rejected') return 'danger';
    return 'warning';
  }

  deactivate(row: DriverRow): void {
    const reason = (window.prompt('Reason for deactivation (optional)') ?? '').trim();
    this.toggleActivation(row, false, reason || null);
  }

  reactivate(row: DriverRow): void {
    this.toggleActivation(row, true, null);
  }

  exportCsv(): void {
    this.exporting = true;
    this.error = null;
    const qs = this.buildQuery();
    this.api.getBlob(`/admin/drivers/export${qs}`).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `drivers-${this.state}-${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => {
        this.error = 'Export failed';
      },
      complete: () => (this.exporting = false),
    });
  }

  private toggleActivation(row: DriverRow, active: boolean, reason: string | null): void {
    this.busyId = row.id;
    this.error = null;
    this.message = null;
    this.api
      .patch<{ driver: { id: number } }>(`/admin/drivers/${row.id}/activation`, {
        active,
        reason,
      })
      .subscribe({
        next: () => {
          this.message = active ? `Driver #${row.id} reactivated.` : `Driver #${row.id} deactivated.`;
          this.drivers = this.drivers.filter((d) => d.id !== row.id);
        },
        error: (err) => {
          this.error = err?.error?.message || 'Action failed';
        },
        complete: () => (this.busyId = null),
      });
  }

  private fetch(): void {
    this.loading = true;
    this.error = null;
    const qs = this.buildQuery();
    this.api.get<{ data: { data: DriverRow[] } }>(`/admin/drivers${qs}`).subscribe({
      next: (res) => {
        this.drivers = res?.data?.data ?? [];
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load drivers';
        this.loading = false;
      },
    });
  }

  private loadVehicleTypes(): void {
    this.api.get<{ data: { name: string }[] }>('/admin/ride-types').subscribe({
      next: (res) => {
        const items = res?.data || [];
        this.vehicleTabs = [
          { label: 'All Drivers', value: null },
          ...items.map((rt) => ({ label: `${rt.name} Drivers`, value: rt.name })),
        ];
      },
      error: () => {
        // Silent — fall back to "All Drivers" only.
      },
    });
  }

  private buildQuery(): string {
    const params: string[] = [`state=${this.state}`];
    if (this.q.trim()) params.push(`q=${encodeURIComponent(this.q.trim())}`);
    if (this.vehicleType) params.push(`vehicle_type=${encodeURIComponent(this.vehicleType)}`);
    return `?${params.join('&')}`;
  }
}
