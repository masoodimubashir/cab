import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { ApiService } from '../../core/api.service';

interface LeaderboardRow {
  driver_id: number;
  name: string | null;
  phone: string | null;
  rides: number;
  rank: number;
}

@Component({
  selector: 'app-drivers-leaderboard',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, TableModule, DropdownModule, InputTextModule],
  template: `
    <p-card header="Driver Leaderboard">
      <div class="toolbar">
        <p-dropdown
          [options]="periodOptions"
          [(ngModel)]="period"
          optionLabel="label"
          optionValue="value"
          (onChange)="fetch()"
        ></p-dropdown>
        <input
          pInputText
          type="search"
          [(ngModel)]="search"
          placeholder="Search driver name or phone"
          class="search"
        />
      </div>

      <p-table [value]="filteredRows" [loading]="loading" responsiveLayout="scroll">
        <ng-template pTemplate="header">
          <tr>
            <th>Rank</th>
            <th>Driver ID</th>
            <th>Driver Name</th>
            <th>Phone Number</th>
            <th>Rides</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr>
            <td><strong>#{{ row.rank }}</strong></td>
            <td>{{ row.driver_id }}</td>
            <td>{{ row.name || '-' }}</td>
            <td>{{ row.phone || '-' }}</td>
            <td>{{ row.rides }}</td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="5" class="empty">No data available in table</td>
          </tr>
        </ng-template>
      </p-table>

      <div *ngIf="error" class="error">{{ error }}</div>
    </p-card>
  `,
  styles: [
    `
      .toolbar {
        display: flex;
        gap: 12px;
        align-items: center;
        margin-bottom: 14px;
        flex-wrap: wrap;
      }
      .search {
        flex: 1 1 280px;
        min-width: 220px;
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
    `,
  ],
})
export class DriversLeaderboardComponent implements OnInit {
  rows: LeaderboardRow[] = [];
  loading = false;
  error: string | null = null;
  search = '';
  period: 'day' | 'week' | 'month' = 'day';

  periodOptions = [
    { label: 'Day', value: 'day' },
    { label: 'Week', value: 'week' },
    { label: 'Month', value: 'month' },
  ];

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.fetch();
  }

  get filteredRows(): LeaderboardRow[] {
    const term = this.search.trim().toLowerCase();
    if (!term) return this.rows;
    return this.rows.filter(
      (r) =>
        (r.name || '').toLowerCase().includes(term) ||
        (r.phone || '').toLowerCase().includes(term),
    );
  }

  fetch(): void {
    this.loading = true;
    this.error = null;
    this.api
      .get<{ data: LeaderboardRow[] }>(`/admin/drivers/leaderboard?period=${this.period}`)
      .subscribe({
        next: (res) => {
          this.rows = res?.data ?? [];
          this.loading = false;
        },
        error: (err) => {
          this.error = err?.error?.message || 'Failed to load leaderboard';
          this.loading = false;
        },
      });
  }
}
