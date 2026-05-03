import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';

@Component({
  selector: 'app-performance',
  templateUrl: './performance.page.html',
  styleUrls: ['./performance.page.scss'],
  standalone: false,
})
export class PerformancePage {
  loading = false;
  error: string | null = null;
  approvalStatus: string | null = null;
  ratingAvg: string | null = null;
  ratingCount: number | null = null;
  completedTrips = 0;
  onlineStreak = '—';

  constructor(
    private api: ApiService,
    private router: Router
  ) {}

  ionViewWillEnter(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.api.get<{ driver: Record<string, unknown> | null }>('/drivers/me').subscribe({
      next: (res) => {
        const d = res.driver;
        if (d) {
          this.approvalStatus = String(d['approval_status'] ?? '');
          this.ratingAvg = d['rating_avg'] != null ? String(d['rating_avg']) : null;
          this.ratingCount = (d['rating_count'] as number) ?? null;
          if (d['last_online_at'] && d['last_offline_at']) {
            this.onlineStreak = 'See dashboard for activity';
          }
        }
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load metrics';
      },
    });
    this.api.get<{ data: { data?: unknown[]; total?: number } }>('/driver/trips/history').subscribe({
      next: (res) => {
        const p = res.data;
        this.completedTrips = p.total ?? p.data?.length ?? 0;
      },
      error: () => {
        /* optional */
      },
      complete: () => {
        this.loading = false;
      },
    });
  }

  back(): void {
    this.router.navigateByUrl('/tabs/more');
  }
}
