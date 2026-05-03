import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ApiService } from '../core/api.service';

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [CommonModule, CardModule, TableModule],
  template: `
    <p-card header="User Management">
      <p-table [value]="users" *ngIf="users; else loading">
        <ng-template pTemplate="header">
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Role</th>
            <th>Last Login</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr>
            <td>{{ row.id }}</td>
            <td>{{ row.name || '-' }}</td>
            <td>{{ row.email || '-' }}</td>
            <td>{{ row.phone || '-' }}</td>
            <td>{{ row.role || '-' }}</td>
            <td>{{ row.last_login_at || '-' }}</td>
          </tr>
        </ng-template>
      </p-table>

      <ng-template #loading>
        <div>Loading users...</div>
      </ng-template>
    </p-card>

    <div *ngIf="error" style="color: #b00020; margin-top: 12px;">
      {{ error }}
    </div>
  `,
})
export class AdminUsersComponent implements OnInit {
  users: any[] | null = null;
  error: string | null = null;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.api.get<any>('/admin/users').subscribe({
      next: (res) => (this.users = res?.data?.data || []),
      error: (err) => (this.error = err?.error?.message || 'Failed to load users'),
    });
  }
}

