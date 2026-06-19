import { Component } from "@angular/core";
import { AlertController, ToastController } from "@ionic/angular";
import { finalize } from 'rxjs/operators';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';

interface FixedLiveStatus {
  key: string;
  label: string;
  detail: string;
  tone: 'primary' | 'success' | 'warning' | 'danger' | 'medium' | string;
  arrived_at?: string | null;
  no_show_after_at?: string | null;
  auto_outcome?: string | null;
  refund_status?: string | null;
}

interface FixedBooking {
  id: number;
  route_name?: string | null;
  scope?: string | null;
  service_date?: string | null;
  depart_at?: string | null;
  announced_depart_at?: string | null;
  seats: number;
  status: string;
  fixed_live_status?: FixedLiveStatus | null;
  payment_method?: string | null;
  payment_status?: string | null;
  refund_status?: string | null;
  booking_channel?: string | null;
  fare_amount?: number | null;
  has_extra_luggage?: boolean;
  extra_luggage_count?: number;
  luggage_surcharge_amount?: number;
  board?: string | null;
  drop?: string | null;
  created_at?: string | null;
}

@Component({
  selector: 'app-fixed-bookings',
  templateUrl: './fixed-bookings.page.html',
  styleUrls: ['./fixed-bookings.page.scss'],
  standalone: false,
})
export class FixedBookingsPage {
  loading = false;
  error: string | null = null;
  bookings: FixedBooking[] = [];
  expandedId: number | null = null;
  cancellingId: number | null = null;

  constructor(
    private api: ApiService,
    private router: Router,
    private alerts: AlertController,
    private toasts: ToastController,
  ) {}

  ionViewWillEnter(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading = true;
    this.error = null;
    this.api.get<{ data: FixedBooking[] }>('/fixed/bookings').subscribe({
      next: (res) => {
        this.bookings = res?.data || [];
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load fixed rides.';
        this.bookings = [];
        this.loading = false;
      },
    });
  }

  back(): void {
    this.router.navigateByUrl('/customer-tabs/book');
  }

  toggle(booking: FixedBooking): void {
    this.expandedId = this.expandedId === booking.id ? null : booking.id;
  }

  liveStatus(booking: FixedBooking): FixedLiveStatus {
    return booking.fixed_live_status || {
      key: booking.status,
      label: booking.status,
      detail: 'Fixed booking status is ' + booking.status + '.',
      tone: 'primary',
    };
  }

  statusClass(booking: FixedBooking): string {
    return 'status--' + (this.liveStatus(booking).tone || 'primary');
  }

  routeLine(booking: FixedBooking): string {
    return `${booking.board || 'Pickup stop'} -> ${booking.drop || 'Drop stop'}`;
  }

  fareLine(booking: FixedBooking): string {
    if (booking.fare_amount == null) return '-';
    return `INR ${Number(booking.fare_amount).toFixed(2)}`;
  }

  paymentLine(booking: FixedBooking): string {
    const method = booking.payment_method ? booking.payment_method.toUpperCase() : 'PAYMENT';
    const status = booking.payment_status || 'UNKNOWN';
    return `${method} · ${status}`;
  }

  dateLine(booking: FixedBooking): string {
    const raw = booking.announced_depart_at || booking.depart_at || booking.created_at || booking.service_date;
    if (!raw) return '-';
    const date = new Date(raw);
    return isNaN(date.getTime())
      ? raw
      : date.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  canCancel(booking: FixedBooking): boolean {
    return ['BOOKED', 'CONFIRMED'].includes(booking.status);
  }

  async cancelBooking(event: Event, booking: FixedBooking): Promise<void> {
    event.stopPropagation();
    if (!this.canCancel(booking) || this.cancellingId) return;

    const alert = await this.alerts.create({
      header: 'Cancel fixed ride?',
      message: 'Your seat will be released. Refund depends on the fixed ride cancellation window.',
      buttons: [
        { text: 'Keep booking', role: 'cancel' },
        { text: 'Cancel ride', role: 'confirm' },
      ],
    });
    await alert.present();
    const result = await alert.onDidDismiss();
    if (result.role !== 'confirm') return;

    this.cancellingId = booking.id;
    this.error = null;
    this.api.post<{ reservation: FixedBooking; message: string }>("/fixed/bookings/" + booking.id + "/cancel", {})
      .pipe(finalize(() => this.cancellingId = null))
      .subscribe({
        next: async (res) => {
          const updated = res?.reservation;
          if (updated) {
            this.bookings = this.bookings.map((item) => item.id === updated.id ? updated : item);
          } else {
            this.refresh();
          }
          await this.showToast(res?.message || 'Fixed booking cancelled.');
        },
        error: (err) => {
          this.error = err?.error?.message || 'Could not cancel fixed booking.';
        },
      });
  }

  private async showToast(message: string): Promise<void> {
    const toast = await this.toasts.create({ message, duration: 2200, position: 'bottom' });
    await toast.present();
  }
}
