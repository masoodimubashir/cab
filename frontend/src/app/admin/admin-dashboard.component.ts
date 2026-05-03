import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, CardModule, ButtonModule],
  template: `
    <div class="dashboard-page">
      <div class="dashboard-hero">
        <div>
          <div class="dashboard-title">Admin Dashboard</div>
          <div class="dashboard-subtitle">
            Operational overview at a glance
          </div>
        </div>

        <div class="dashboard-quick-actions" aria-label="Quick actions">
          <button
            pButton
            type="button"
            label="Trips"
            icon="pi pi-car"
            class="p-button-outlined"
            (click)="go('/trips')"
          ></button>
          <button
            pButton
            type="button"
            label="Drivers"
            icon="pi pi-user"
            class="p-button-outlined"
            (click)="go('/drivers')"
          ></button>
          <button
            pButton
            type="button"
            label="Users"
            icon="pi pi-users"
            class="p-button-outlined"
            (click)="go('/users')"
          ></button>
          <button
            pButton
            type="button"
            label="Reports"
            icon="pi pi-chart-line"
            class="p-button-outlined"
            (click)="go('/reports')"
          ></button>
        </div>
      </div>

      <div class="kpi-grid" *ngIf="!loading">
        <p-card class="kpi-card kpi-card--orange">
          <div class="kpi-content">
            <div class="kpi-icon"><i class="pi pi-bolt"></i></div>
            <div class="kpi-meta">
              <div class="kpi-label">Active Trips</div>
              <div class="kpi-value">{{ kpis?.active_trips ?? 0 }}</div>
            </div>
          </div>
        </p-card>

        <p-card class="kpi-card kpi-card--green">
          <div class="kpi-content">
            <div class="kpi-icon"><i class="pi pi-check-circle"></i></div>
            <div class="kpi-meta">
              <div class="kpi-label">Completed Trips</div>
              <div class="kpi-value">{{ kpis?.completed_trips ?? 0 }}</div>
            </div>
          </div>
        </p-card>

        <p-card class="kpi-card kpi-card--blue">
          <div class="kpi-content">
            <div class="kpi-icon"><i class="pi pi-users"></i></div>
            <div class="kpi-meta">
              <div class="kpi-label">Drivers (Total)</div>
              <div class="kpi-value">{{ kpis?.drivers_total ?? 0 }}</div>
            </div>
          </div>
        </p-card>

        <p-card class="kpi-card kpi-card--purple">
          <div class="kpi-content">
            <div class="kpi-icon"><i class="pi pi-shield-check"></i></div>
            <div class="kpi-meta">
              <div class="kpi-label">Drivers (Approved)</div>
              <div class="kpi-value">{{ kpis?.drivers_approved ?? 0 }}</div>
            </div>
          </div>
        </p-card>

        <p-card class="kpi-card kpi-card--amber">
          <div class="kpi-content">
            <div class="kpi-icon"><i class="pi pi-wallet"></i></div>
            <div class="kpi-meta">
              <div class="kpi-label">Earnings Total</div>
              <div class="kpi-value">
                {{ (kpis?.earnings_total ?? 0) | number:'1.2-2' }}
              </div>
              <div class="kpi-footnote">INR</div>
            </div>
          </div>
        </p-card>

        <p-card class="kpi-card kpi-card--slate">
          <div class="kpi-content">
            <div class="kpi-icon"><i class="pi pi-comment"></i></div>
            <div class="kpi-meta">
              <div class="kpi-label">Fare Negotiations</div>
              <div class="kpi-value">{{ kpis?.fare_negotiations_total ?? 0 }}</div>
            </div>
          </div>
        </p-card>
      </div>

      <div class="kpi-loading" *ngIf="loading">
        <div class="spinner" aria-hidden="true"></div>
        <div class="kpi-loading__text">Loading KPIs...</div>
      </div>

      <div *ngIf="error" class="dashboard-error">
        {{ error }}
      </div>
    </div>
  `,
  styles: [
    `
      .dashboard-page {
        background: radial-gradient(900px circle at 20% 0%, rgba(245, 158, 11, 0.16), transparent 45%),
          radial-gradient(700px circle at 90% 10%, rgba(59, 130, 246, 0.12), transparent 45%),
          linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
        padding: 6px 4px 28px;
        border-radius: 16px;
      }

      .dashboard-hero {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 18px;
        padding: 18px 16px;
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 16px;
        box-shadow: 0 12px 30px rgba(2, 6, 23, 0.06);
      }

      .dashboard-title {
        font-size: 20px;
        font-weight: 900;
        color: #0f172a;
        margin-bottom: 6px;
      }

      .dashboard-subtitle {
        font-size: 14px;
        font-weight: 600;
        color: rgba(15, 23, 42, 0.62);
      }

      .dashboard-quick-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      .kpi-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 14px;
      }

      .kpi-card {
        border-radius: 16px !important;
        border: 1px solid rgba(15, 23, 42, 0.08);
        background: rgba(255, 255, 255, 0.82) !important;
      }

      .kpi-content {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 6px 2px;
      }

      .kpi-icon {
        width: 42px;
        height: 42px;
        border-radius: 14px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(249, 115, 22, 0.14);
        color: #f97316;
        flex: 0 0 auto;
        font-size: 18px;
      }

      .kpi-meta {
        flex: 1 1 auto;
        min-width: 0;
      }

      .kpi-label {
        font-size: 13px;
        font-weight: 800;
        color: rgba(15, 23, 42, 0.68);
        margin-bottom: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .kpi-value {
        font-size: 22px;
        font-weight: 950;
        color: #0f172a;
        letter-spacing: 0.2px;
      }

      .kpi-footnote {
        margin-top: 2px;
        font-size: 12px;
        font-weight: 800;
        color: rgba(15, 23, 42, 0.55);
      }

      /* Card themes */
      .kpi-card--orange .kpi-icon { background: rgba(249, 115, 22, 0.14); color: #f97316; }
      .kpi-card--green .kpi-icon { background: rgba(16, 185, 129, 0.14); color: #10b981; }
      .kpi-card--blue .kpi-icon { background: rgba(59, 130, 246, 0.14); color: #3b82f6; }
      .kpi-card--purple .kpi-icon { background: rgba(139, 92, 246, 0.14); color: #8b5cf6; }
      .kpi-card--amber .kpi-icon { background: rgba(245, 158, 11, 0.16); color: #f59e0b; }
      .kpi-card--slate .kpi-icon { background: rgba(100, 116, 139, 0.18); color: #64748b; }

      .dashboard-error {
        color: #b00020;
        margin-top: 16px;
        background: rgba(176, 0, 32, 0.06);
        border: 1px solid rgba(176, 0, 32, 0.18);
        padding: 12px 14px;
        border-radius: 14px;
        font-weight: 700;
      }

      .kpi-loading {
        display: flex;
        gap: 12px;
        align-items: center;
        justify-content: center;
        padding: 26px 0;
        color: rgba(15, 23, 42, 0.72);
        font-weight: 800;
      }

      .spinner {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 3px solid rgba(15, 23, 42, 0.12);
        border-top-color: #f97316;
        animation: spin 0.9s linear infinite;
      }

      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      @media (max-width: 980px) {
        .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }

      @media (max-width: 640px) {
        .dashboard-hero { flex-direction: column; }
        .kpi-grid { grid-template-columns: 1fr; }
      }
    `,
  ],
})
export class AdminDashboardComponent implements OnInit {
  kpis: any;
  error: string | null = null;
  loading = false;

  constructor(private api: ApiService, private router: Router) {}

  go(path: string): void {
    this.router.navigateByUrl(path);
  }

  ngOnInit(): void {
    this.loading = true;
    this.api.get<{ kpis: any }>('/admin/dashboard').subscribe({
      next: (res) => {
        this.kpis = res.kpis;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load dashboard';
        this.loading = false;
      },
      complete: () => {
        this.loading = false;
      },
    });
  }
}

