import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ApiService } from '../core/api.service';

@Component({
  selector: 'app-admin-safety-events',
  standalone: true,
  imports: [CommonModule, CardModule, TableModule],
  template: `
    <p-card header="Safety Events (SOS)">
      <p-table [value]="events" *ngIf="events; else loading">
        <ng-template pTemplate="header">
          <tr>
            <th>ID</th>
            <th>Trip</th>
            <th>Initiator</th>
            <th>Status</th>
            <th>Lat</th>
            <th>Lng</th>
            <th>Created</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr>
            <td>{{ row.id }}</td>
            <td>{{ row.trip_id || '-' }}</td>
            <td>{{ row.initiator?.name || '-' }}</td>
            <td>{{ row.status }}</td>
            <td>{{ row.lat ?? '-' }}</td>
            <td>{{ row.lng ?? '-' }}</td>
            <td>{{ row.created_at || '-' }}</td>
          </tr>
        </ng-template>
      </p-table>

      <ng-template #loading>
        <div>Loading safety events...</div>
      </ng-template>
    </p-card>

    <div *ngIf="error" style="color: #b00020; margin-top: 12px;">
      {{ error }}
    </div>
  `,
})
export class AdminSafetyEventsComponent implements OnInit {
  events: any[] | null = null;
  error: string | null = null;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.api.get<any>('/admin/safety-events').subscribe({
      next: (res) => (this.events = res?.data?.data || []),
      error: (err) => (this.error = err?.error?.message || 'Failed to load safety events'),
    });
  }
}

