import { Component } from '@angular/core';
import { ApiService } from '../../core/api.service';

@Component({
  selector: 'app-earnings',
  templateUrl: './earnings.page.html',
  styleUrls: ['./earnings.page.scss'],
  standalone: false,
})
export class EarningsPage {
  loading = false;
  error: string | null = null;
  completedCount = 0;
  ratingAvg: string | null = null;
  ratingCount: number | null = null;

  constructor(private api: ApiService) {}

  ionViewWillEnter(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.api.get<{ driver: { rating_avg?: number; rating_count?: number } | null }>('/drivers/me').subscribe({
      next: (me) => {
        const d = me.driver;
        if (d) {
          this.ratingAvg = d.rating_avg != null ? String(d.rating_avg) : null;
          this.ratingCount = d.rating_count ?? null;
        }
      },
      error: () => {
        /* non-fatal */
      },
    });
    this.api.get<{ data: { data?: unknown[]; total?: number } }>('/driver/trips/history').subscribe({
      next: (res) => {
        const inner = res.data;
        this.completedCount = inner?.total ?? inner?.data?.length ?? 0;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load trip stats';
        this.completedCount = 0;
      },
      complete: () => {
        this.loading = false;
      },
    });
  }
}
