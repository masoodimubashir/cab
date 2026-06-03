import { Component } from '@angular/core';
import { ApiService } from '../../core/api.service';

interface ScheduledRow {
  id: number;
  status: string;
  scheduled_at?: string | null;
  pickup_address?: string | null;
  drop_address?: string | null;
  estimated_fare?: number | null;
  final_fare?: number | null;
  payment_method?: string | null;
  ride_type?: string | null;
  customer?: { id: number; name?: string | null; phone?: string | null } | null;
}

/**
 * Driver "Scheduled rides" — upcoming pre-booked trips assigned to this driver,
 * next pickup first. Read-only summary; the live ride appears in Rides once it
 * starts.
 */
@Component({
  selector: 'app-scheduled-rides',
  templateUrl: './scheduled-rides.page.html',
  styleUrls: ['./scheduled-rides.page.scss'],
  standalone: false,
})
export class ScheduledRidesPage {
  loading = false;
  error: string | null = null;
  rides: ScheduledRow[] = [];

  constructor(private api: ApiService) {}

  ionViewWillEnter(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading = true;
    this.error = null;
    this.api.get<{ data: ScheduledRow[] }>('/driver/trips/scheduled').subscribe({
      next: (res) => {
        this.rides = res?.data ?? [];
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load scheduled rides';
        this.rides = [];
      },
      complete: () => {
        this.loading = false;
      },
    });
  }

  statusLabel(r: ScheduledRow): string {
    switch (r.status) {
      case 'CONFIRMED':
        return 'Confirmed';
      case 'ASSIGNED':
      case 'EN_ROUTE_PICKUP':
      case 'ARRIVED_PICKUP':
        return 'Assigned';
      case 'EN_ROUTE_DROP':
      case 'ARRIVED_DROP':
        return 'In progress';
      default:
        return 'Pending';
    }
  }

  statusBadgeClass(r: ScheduledRow): string {
    if (['REQUESTED', 'NEGOTIATION'].includes(r.status)) return 'dc-badge--warn';
    return 'dc-badge--ok';
  }

  fareDisplay(r: ScheduledRow): string | null {
    const amount = r.final_fare ?? r.estimated_fare;
    return amount == null ? null : `₹${amount}`;
  }
}
