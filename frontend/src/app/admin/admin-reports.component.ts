import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { ApiService } from '../core/api.service';

@Component({
  selector: 'app-admin-reports',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, TableModule, ButtonModule, InputNumberModule],
  template: `
    <p-card header="Reports & Analytics">
      <div *ngIf="loading">Loading reports...</div>

      <div *ngIf="error" style="color: #b00020; margin-top: 12px;">
        {{ error }}
      </div>

      <div *ngIf="!loading && report">
        <div style="display:flex; gap:16px; flex-wrap:wrap; margin-bottom: 14px;">
          <div><b>Payment Success Rate:</b> {{ report.payment_success_rate_percent }}%</div>
          <div><b>Range:</b> {{ report.range_start }} to {{ report.range_end }}</div>
        </div>

        <div style="display:flex; gap:12px; align-items:center; margin-bottom: 14px;">
          <label style="font-weight:600;">Days</label>
          <p-inputNumber [(ngModel)]="days" [useGrouping]="false" [showButtons]="true" [min]="1" [max]="30" />
          <button pButton type="button" label="Refresh" (click)="load()"></button>
        </div>

        <h3 style="margin: 16px 0 8px;">Earnings by Day</h3>
        <p-table [value]="report.earnings_by_day">
          <ng-template pTemplate="header">
            <tr>
              <th>Date</th>
              <th>Earnings (INR)</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td>{{ row.date }}</td>
              <td>{{ row.earnings }}</td>
            </tr>
          </ng-template>
        </p-table>

        <h3 style="margin: 22px 0 8px;">Completed Trips by Day</h3>
        <p-table [value]="report.completed_trips_by_day">
          <ng-template pTemplate="header">
            <tr>
              <th>Date</th>
              <th>Trips</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td>{{ row.date }}</td>
              <td>{{ row.count }}</td>
            </tr>
          </ng-template>
        </p-table>

        <h3 style="margin: 22px 0 8px;">Fare Negotiations by Day</h3>
        <p-table [value]="report.negotiations_by_day">
          <ng-template pTemplate="header">
            <tr>
              <th>Date</th>
              <th>Negotiations</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td>{{ row.date }}</td>
              <td>{{ row.count }}</td>
            </tr>
          </ng-template>
        </p-table>
      </div>
    </p-card>
  `,
})
export class AdminReportsComponent implements OnInit {
  loading = false;
  error: string | null = null;
  days = 7;
  report: any | null = null;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;

    this.api.get<any>(`/admin/reports?days=${this.days}`).subscribe({
      next: (res) => (this.report = res),
      error: (err) => (this.error = err?.error?.message || 'Failed to load reports'),
      complete: () => (this.loading = false),
    });
  }
}

