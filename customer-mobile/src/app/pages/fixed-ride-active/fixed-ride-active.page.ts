import { Component } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { finalize } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import { FixedCustomerLocationService } from '../../core/fixed-customer-location.service';

interface FixedLiveStatus {
  key: string;
  label: string;
  detail: string;
  tone: 'primary' | 'success' | 'warning' | 'danger' | 'medium' | string;
}

interface FixedBooking {
  id: number;
  route_name?: string | null;
  trip_id?: number | null;
  departure_status?: string | null;
  fixed_last_reached_stop_seq?: number | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  vehicle_name?: string | null;
  vehicle_type_name?: string | null;
  vehicle_brand?: string | null;
  vehicle_model?: string | null;
  vehicle_color?: string | null;
  vehicle_reg_no?: string | null;
  board_lat?: number | null;
  board_lng?: number | null;
  drop_lat?: number | null;
  drop_lng?: number | null;
  seats: number;
  status: string;
  fixed_live_status?: FixedLiveStatus | null;
  payment_method?: string | null;
  payment_status?: string | null;
  refund_status?: string | null;
  payment_reference?: string | null;
  fare_amount?: number | null;
  promo_discount_amount?: number | null;
  has_extra_luggage?: boolean;
  extra_luggage_count?: number;
  luggage_surcharge_amount?: number;
  board?: string | null;
  drop?: string | null;
  created_at?: string | null;
  announced_depart_at?: string | null;
  depart_at?: string | null;
  service_date?: string | null;
}

@Component({
  selector: 'app-fixed-ride-active',
  templateUrl: './fixed-ride-active.page.html',
  styleUrls: ['./fixed-ride-active.page.scss'],
  standalone: false,
})
export class FixedRideActivePage {
  loading = false;
  cancelling = false;
  error: string | null = null;
  booking: FixedBooking | null = null;
  private readonly inactiveStatuses = new Set(['DROPPED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);

  constructor(
    private api: ApiService,
    private route: ActivatedRoute,
    private router: Router,
    private alerts: AlertController,
    private toasts: ToastController,
    private fixedLocation: FixedCustomerLocationService,
  ) {}

  ionViewWillEnter(): void {
    this.load();
  }

  ionViewWillLeave(): void {
    if (!this.booking || !this.isActiveBooking(this.booking)) void this.fixedLocation.stop();
  }

  load(): void {
    const bookingId = Number(this.route.snapshot.paramMap.get('bookingId') || 0);
    if (!bookingId) {
      this.error = 'Fixed booking not found.';
      return;
    }

    this.loading = true;
    this.error = null;
    this.api.get<{ booking: FixedBooking }>('/fixed/bookings/' + bookingId).subscribe({
      next: (res) => {
        this.booking = res?.booking || null;
        this.loading = false;
        if (!this.booking) this.error = 'Fixed booking not found.';
        this.syncFixedLocationStream();
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.message || 'Could not load fixed ride.';
        this.syncFixedLocationStream();
      },
    });
  }

  back(): void {
    this.router.navigateByUrl('/customer-tabs/fixed-rides');
  }

  openMap(): void {
    if (!this.booking || !this.hasMapCoords(this.booking)) return;
    this.router.navigateByUrl('/customer-tabs/fixed-rides/' + this.booking.id + '/map');
  }

  async cancelRide(): Promise<void> {
    if (!this.booking || !this.canCancel(this.booking) || this.cancelling) return;
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

    this.cancelling = true;
    this.api.post<{ reservation: FixedBooking; message: string }>('/fixed/bookings/' + this.booking.id + '/cancel', {})
      .pipe(finalize(() => this.cancelling = false))
      .subscribe({
        next: async (res) => {
          this.booking = res?.reservation || this.booking;
          this.syncFixedLocationStream();
          await this.showToast(res?.message || 'Fixed booking cancelled.');
        },
        error: (err) => this.error = err?.error?.message || 'Could not cancel fixed booking.',
      });
  }

  isActiveBooking(booking: FixedBooking): boolean {
    return !this.inactiveStatuses.has((booking.status || '').toUpperCase());
  }

  canCancel(booking: FixedBooking): boolean {
    return ['BOOKED', 'CONFIRMED'].includes((booking.status || '').toUpperCase());
  }

  hasMapCoords(booking: FixedBooking): boolean {
    return booking.board_lat != null && booking.board_lng != null && booking.drop_lat != null && booking.drop_lng != null;
  }

  bookingStatusLabel(booking: FixedBooking): string {
    switch ((booking.status || '').toUpperCase()) {
      case 'BOOKED':
      case 'CONFIRMED': return 'Booking confirmed';
      case 'BOARDED': return 'Boarded';
      case 'DROPPED': return 'Dropped off';
      case 'COMPLETED': return 'Ride completed';
      case 'NO_SHOW': return 'No-show';
      case 'CANCELLED': return booking.fixed_live_status?.key === 'driver_missed_stop' ? 'Driver missed pickup' : 'Cancelled';
      default: return booking.fixed_live_status?.label || booking.status || 'Status unavailable';
    }
  }

  statusClass(booking: FixedBooking): string {
    switch ((booking.status || '').toUpperCase()) {
      case 'BOARDED':
      case 'DROPPED':
      case 'COMPLETED': return 'status--success';
      case 'NO_SHOW': return 'status--danger';
      case 'CANCELLED': return 'status--medium';
      default: return 'status--primary';
    }
  }

  statusDetail(booking: FixedBooking): string {
    if (booking.fixed_live_status?.detail) return booking.fixed_live_status.detail;
    switch ((booking.status || '').toUpperCase()) {
      case 'BOOKED':
      case 'CONFIRMED': return 'Your fixed ride seat is booked.';
      case 'BOARDED': return 'You have boarded this fixed ride and are on the vehicle.';
      case 'DROPPED': return 'You have been dropped off.';
      case 'COMPLETED': return 'This fixed ride is completed.';
      case 'NO_SHOW': return 'The driver marked this booking no-show.';
      case 'CANCELLED': return 'This fixed booking is cancelled.';
      default: return 'Fixed ride status is ' + booking.status + '.';
    }
  }

  vehicleLine(booking: FixedBooking): string {
    return [booking.vehicle_name, booking.vehicle_type_name].filter(Boolean).join(' · ') || 'Vehicle assigned soon';
  }

  carLine(booking: FixedBooking): string {
    return [booking.vehicle_brand, booking.vehicle_model, booking.vehicle_color].filter(Boolean).join(' · ');
  }

  luggageLine(booking: FixedBooking): string {
    const booked = booking.extra_luggage_count || 0;
    return booked ? booked + ' extra' : 'No extra luggage';
  }

  fareLine(booking: FixedBooking): string {
    if (booking.fare_amount == null) return '-';
    return 'INR ' + Number(booking.fare_amount).toFixed(2);
  }

  discountLine(booking: FixedBooking): string {
    const discount = Number(booking.promo_discount_amount || 0);
    return discount > 0 ? '-INR ' + discount.toFixed(2) : 'No coupon';
  }

  paymentLine(booking: FixedBooking): string {
    const method = booking.payment_method ? this.prettyToken(booking.payment_method) : 'Payment';
    const status = booking.payment_status ? this.prettyToken(booking.payment_status) : 'Unknown';
    return method + ' · ' + status;
  }

  dateLine(booking: FixedBooking): string {
    const raw = booking.announced_depart_at || booking.depart_at || booking.created_at || booking.service_date;
    if (!raw) return '-';
    const date = new Date(raw);
    return isNaN(date.getTime()) ? raw : date.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  private syncFixedLocationStream(): void {
    if (this.booking && ['BOOKED', 'CONFIRMED'].includes((this.booking.status || '').toUpperCase())) void this.fixedLocation.start();
    else void this.fixedLocation.stop();
  }

  private prettyToken(value: string): string {
    return value.toString().toLowerCase().split('_').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  }

  private async showToast(message: string): Promise<void> {
    const toast = await this.toasts.create({ message, duration: 2200, position: 'bottom' });
    await toast.present();
  }
}
