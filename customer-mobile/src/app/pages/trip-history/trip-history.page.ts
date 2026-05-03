import { Component } from '@angular/core';
import { ApiService } from '../../core/api.service';

@Component({
  selector: 'app-trip-history',
  templateUrl: './trip-history.page.html',
  styleUrls: ['./trip-history.page.scss'],
  standalone: false,
})
export class TripHistoryPage {
  loading = false;
  error: string | null = null;
  trips: Record<string, unknown>[] = [];

  constructor(private api: ApiService) {}

  ionViewWillEnter(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading = true;
    this.error = null;
    this.api.get<{ data: { data?: Record<string, unknown>[] } }>('/driver/trips/history').subscribe({
      next: (res) => {
        const page = res.data as { data?: Record<string, unknown>[] };
        this.trips = (page?.data as Record<string, unknown>[]) || [];
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load history';
        this.trips = [];
      },
      complete: () => {
        this.loading = false;
      },
    });
  }
}
