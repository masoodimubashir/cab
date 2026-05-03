import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { ApiService } from '../core/api.service';

@Component({
  selector: 'app-admin-trips',
  standalone: true,
  imports: [CommonModule, CardModule, TableModule, ButtonModule],
  template: `
    <p-card header="Ride Monitoring">
      <p-table [value]="trips" *ngIf="trips; else loading">
        <ng-template pTemplate="header">
          <tr>
            <th>ID</th>
            <th>Status</th>
            <th>Customer</th>
            <th>Driver</th>
            <th>Ride</th>
            <th>Final Fare</th>
            <th>Latest Location</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr>
            <td>{{ row.id }}</td>
            <td>{{ row.status }}</td>
            <td>{{ row.customer?.name || '-' }}</td>
            <td>{{ row.driver?.name || '-' }}</td>
            <td>{{ row.rideType?.name || '-' }}</td>
            <td>{{ row.final_fare || '-' }}</td>
            <td>
              <button pButton type="button" label="Refresh" (click)="loadLatest(row.id)"></button>
              <div *ngIf="latestLocationByTripId[row.id] as loc" style="margin-top:6px; font-size: 12px;">
                {{ loc?.lat }}, {{ loc?.lng }}<br />
                <span style="color: rgba(0,0,0,.6);">{{ loc?.recorded_at || '-' }}</span>
              </div>
            </td>
          </tr>
        </ng-template>
      </p-table>

      <ng-template #loading>
        <div>Loading trips...</div>
      </ng-template>
    </p-card>

    <div *ngIf="error" style="color: #b00020; margin-top: 12px;">
      {{ error }}
    </div>
  `,
})
export class AdminTripsComponent implements OnInit {
  trips: any[] | null = null;
  error: string | null = null;
  latestLocationByTripId: Record<number, any> = {};

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.api.get<any>('/admin/trips').subscribe({
      next: (res) => (this.trips = res?.data?.data || []),
      error: (err) => (this.error = err?.error?.message || 'Failed to load trips'),
    });
  }

  loadLatest(tripId: number): void {
    this.api.get<any>(`/admin/trips/${tripId}/latest-location`).subscribe({
      next: (res) => {
        this.latestLocationByTripId[tripId] = res?.latest_location ?? null;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load latest location';
      },
    });
  }
}

