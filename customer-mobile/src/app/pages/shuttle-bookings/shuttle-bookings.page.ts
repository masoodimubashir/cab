import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';

interface ShuttleBooking {
  id: number;
  shuttle_journey_id?: number | null;
  trip_id?: number | null;
  journey_status?: string | null;
  scope?: string | null;
  vehicle_name?: string | null;
  pickup?: { address?: string | null; lat?: number | null; lng?: number | null } | null;
  drop?: { address?: string | null; lat?: number | null; lng?: number | null } | null;
  fare_amount?: number | null;
  currency?: string | null;
  payment_method?: string | null;
  payment_status?: string | null;
  refund_status?: string | null;
  refund_reference?: string | null;
  refund_amount?: number | null;
  status: string;
  cancelled_reason?: string | null;
  shuttle_auto_outcome?: string | null;
  shuttle_auto_processed_at?: string | null;
  created_at?: string | null;
}

@Component({
  selector: 'app-shuttle-bookings',
  templateUrl: './shuttle-bookings.page.html',
  styleUrls: ['./shuttle-bookings.page.scss'],
  standalone: false,
})
export class ShuttleBookingsPage {
  loading = false;
  error: string | null = null;
  bookings: ShuttleBooking[] = [];
  expandedId: number | null = null;

  constructor(
    private api: ApiService,
    private router: Router,
  ) {}

  ionViewWillEnter(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading = true;
    this.error = null;
    this.api.get<{ data: ShuttleBooking[] }>('/shuttle/bookings').subscribe({
      next: (res) => {
        this.bookings = res?.data || [];
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load shuttle bookings.';
        this.bookings = [];
        this.loading = false;
      },
    });
  }

  back(): void {
    this.router.navigateByUrl('/customer-tabs/book');
  }

  toggle(booking: ShuttleBooking): void {
    this.expandedId = this.expandedId === booking.id ? null : booking.id;
  }

  openTrip(event: Event, booking: ShuttleBooking): void {
    event.stopPropagation();
    if (!booking.trip_id) return;
    this.router.navigateByUrl(`/customer-tabs/trip/${booking.trip_id}`);
  }

  title(booking: ShuttleBooking): string {
    return booking.vehicle_name || 'Shuttle ride';
  }

  routeLine(booking: ShuttleBooking): string {
    return `${booking.pickup?.address || 'Pickup'} -> ${booking.drop?.address || 'Drop'}`;
  }

  fareLine(booking: ShuttleBooking): string {
    if (booking.fare_amount == null) return '-';
    return `${booking.currency || 'INR'} ${Number(booking.fare_amount).toFixed(2)}`;
  }

  paymentLine(booking: ShuttleBooking): string {
    const method = booking.payment_method ? booking.payment_method.toUpperCase() : 'PAYMENT';
    return `${method} · ${booking.payment_status || 'UNKNOWN'}`;
  }

  refundLine(booking: ShuttleBooking): string {
    if (!booking.refund_status || booking.refund_status === 'NONE') return 'No refund';
    if (booking.refund_status === 'APPROVED') return 'Refund pending manual processing';
    if (booking.refund_status === 'REFUNDED') return 'Refunded';
    return `Refund ${booking.refund_status}`;
  }

  detailLine(booking: ShuttleBooking): string {
    if (booking.shuttle_auto_outcome === 'driver_missed_pickup') {
      return 'Driver missed pickup. Refund is pending manual Razorpay processing.';
    }
    if (booking.shuttle_auto_outcome === 'customer_no_show' || booking.status === 'NO_SHOW') {
      return 'Marked no-show. Refund is rejected for this booking.';
    }
    if (booking.status === 'CANCELLED') {
      return booking.refund_status === 'REFUNDED'
        ? 'This Shuttle booking was cancelled and refunded.'
        : 'This Shuttle booking was cancelled. Refund will be handled manually through Razorpay.';
    }
    if (booking.status === 'PAYMENT_PENDING') return 'Payment is pending for this Shuttle booking.';
    if (booking.status === 'CONFIRMED') return 'Your paid Shuttle request is confirmed and waiting for driver flow.';
    if (booking.status === 'BOARDED') return 'You have boarded this Shuttle ride.';
    if (booking.status === 'DROPPED') return 'This Shuttle ride is complete.';
    return `Shuttle booking status is ${booking.status}.`;
  }

  statusClass(booking: ShuttleBooking): string {
    if (booking.status === 'CANCELLED' || booking.status === 'NO_SHOW') return 'status--danger';
    if (booking.status === 'PAYMENT_PENDING') return 'status--warning';
    if (booking.status === 'DROPPED') return 'status--success';
    return 'status--primary';
  }

  dateLine(booking: ShuttleBooking): string {
    return this.formatDate(booking.created_at);
  }

  formatDate(value?: string | null): string {
    if (!value) return '-';
    const date = new Date(value);
    return isNaN(date.getTime())
      ? value
      : date.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
}
