import { Component } from '@angular/core';
import { ApiService } from '../../core/api.service';

type StatusFilter = 'all' | 'completed' | 'cancelled' | 'missed';
type PaymentFilter = 'all' | 'paid' | 'unpaid';

interface TripPayment {
  id: number;
  method?: string | null;
  status?: 'PENDING' | 'SUCCESS' | 'FAILED' | string | null;
  amount?: number | null;
  discount_amount?: number | null;
  paid_at?: string | null;
}

interface TripRow {
  id: number;
  status: string;
  pickup_address?: string | null;
  drop_address?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  drop_lat?: number | null;
  drop_lng?: number | null;
  estimated_fare?: number | null;
  final_fare?: number | null;
  currency?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  created_at?: string | null;
  cancelled_reason?: string | null;
  no_show_by?: string | null;
  payment?: TripPayment | null;
}

@Component({
  selector: 'app-trip-history',
  templateUrl: './trip-history.page.html',
  styleUrls: ['./trip-history.page.scss'],
  standalone: false,
})
export class TripHistoryPage {
  loading = false;
  error: string | null = null;
  trips: TripRow[] = [];

  status: StatusFilter = 'all';
  payment: PaymentFilter = 'all';

  constructor(private api: ApiService) {}

  ionViewWillEnter(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading = true;
    this.error = null;
    const params = new URLSearchParams({
      status: this.status,
      payment: this.payment,
    }).toString();
    this.api.get<{ data: { data?: TripRow[] } }>(`/driver/trips/history?${params}`).subscribe({
      next: (res) => {
        const page = res.data;
        this.trips = page?.data ?? [];
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

  setStatus(s: StatusFilter): void {
    if (this.status === s) return;
    this.status = s;
    this.refresh();
  }

  setPayment(p: PaymentFilter): void {
    if (this.payment === p) return;
    this.payment = p;
    this.refresh();
  }

  statusLabel(t: TripRow): string {
    if (t.status === 'COMPLETED') return 'Completed';
    if (t.status === 'CANCELLED') {
      return t.no_show_by ? 'Missed' : 'Cancelled';
    }
    return t.status;
  }

  statusColor(t: TripRow): string {
    if (t.status === 'COMPLETED') return 'success';
    if (t.status === 'CANCELLED') return t.no_show_by ? 'warning' : 'medium';
    return 'primary';
  }

  /**
   * Payment badge on each row. For the driver, "Unpaid" on a completed trip
   * means the customer hasn't settled yet — useful when chasing cash rides.
   */
  paymentBadge(t: TripRow): { label: string; color: string } | null {
    if (t.payment?.status === 'SUCCESS') {
      return { label: 'Paid', color: 'success' };
    }
    if (t.status === 'COMPLETED') {
      return { label: 'Unpaid', color: 'danger' };
    }
    return null;
  }

  fareDisplay(t: TripRow): string | null {
    const amount = t.final_fare ?? t.estimated_fare;
    if (amount == null) return null;
    return `${amount} ${t.currency || 'INR'}`;
  }

  dateDisplay(t: TripRow): string | null {
    return t.completed_at || t.cancelled_at || t.created_at || null;
  }
}
