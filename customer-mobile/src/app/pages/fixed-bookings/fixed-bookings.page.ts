import { Component } from "@angular/core";
import { AlertController, ToastController } from "@ionic/angular";
import { Subscription, interval } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { FixedCustomerLocationService } from '../../core/fixed-customer-location.service';

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

type FixedBookingStatusFilter = 'all' | 'active' | 'completed' | 'cancelled' | 'no_show' | 'dropped';

interface FixedBooking {
  id: number;
  route_name?: string | null;
  scope?: string | null;
  service_date?: string | null;
  depart_at?: string | null;
  announced_depart_at?: string | null;
  trip_id?: number | null;
  departure_status?: string | null;
  fixed_last_reached_stop_seq?: number | null;
  fixed_last_reached_stop_at?: string | null;
  capacity?: number | null;
  seats_taken?: number | null;
  luggage_capacity?: number | null;
  luggage_taken?: number | null;
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
  latest_driver_location?: { lat: number; lng: number; recorded_at?: string | null } | null;
  seats: number;
  status: string;
  /** Boarding code shown here — the permanent on-screen channel (no SMS); the passenger reads it out to the driver. */
  boarding_code?: string | null;
  fixed_live_status?: FixedLiveStatus | null;
  payment_method?: string | null;
  payment_status?: string | null;
  refund_status?: string | null;
  payment_reference?: string | null;
  refund_reference?: string | null;
  refund_amount?: number | null;
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
  locationWarning: string | null = null;
  allBookings: FixedBooking[] = [];
  bookings: FixedBooking[] = [];
  page = 1;
  perPage = 50;
  totalBookings = 0;
  hasMore = false;
  loadingMore = false;
  statusFilter: FixedBookingStatusFilter = 'all';
  routeFilter = 'all';
  fromDate = '';
  toDate = '';
  expandedId: number | null = null;
  cancellingId: number | null = null;
  activeOnly = false;
  private locationSub?: Subscription;
  private pollSub?: Subscription;
  private readonly inactiveStatuses = new Set(['DROPPED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);

  constructor(
    private api: ApiService,
    private router: Router,
    private route: ActivatedRoute,
    private alerts: AlertController,
    private toasts: ToastController,
    private fixedLocation: FixedCustomerLocationService,
  ) {}

  ionViewWillEnter(): void {
    this.activeOnly = this.route.snapshot.queryParamMap.get('active') === '1';
    this.locationSub ??= this.fixedLocation.state$.subscribe((state) => {
      this.locationWarning = state.degraded ? state.message : null;
    });
    this.refresh();
    // Light poll while any booking is live so the boarding code (and status
    // flips like BOARDED) show up without a manual refresh.
    this.pollSub ??= interval(6000).subscribe(() => this.silentRefresh());
  }

  ionViewWillLeave(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = undefined;
  }

  ngOnDestroy(): void {
    this.locationSub?.unsubscribe();
    this.locationSub = undefined;
  }

  refresh(): void {
    this.page = 1;
    this.loading = true;
    this.error = null;
    this.api.get<{ data: FixedBooking[]; meta?: { current_page: number; total: number; has_more: boolean } }>(this.bookingsUrl(this.page)).subscribe({
      next: (res) => {
        const rows = res?.data || [];
        this.allBookings = rows;
        this.totalBookings = res?.meta?.total ?? rows.length;
        this.hasMore = !!res?.meta?.has_more;
        this.applyFilters();
        if (this.activeOnly && this.bookings.length) {
          this.expandedId = this.bookings[0].id;
        }
        this.loading = false;
        this.syncFixedLocationStream();
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load fixed rides.';
        this.allBookings = [];
        this.bookings = [];
        this.totalBookings = 0;
        this.hasMore = false;
        this.loading = false;
        this.syncFixedLocationStream();
      },
    });
  }

  /**
   * Background refresh: no spinner, merges page-1 rows into what's loaded so
   * pagination isn't disturbed. Only runs while an active booking exists.
   */
  private silentRefresh(): void {
    if (this.loading || this.loadingMore || this.cancellingId) return;
    if (!this.allBookings.some((booking) => ['BOOKED', 'CONFIRMED'].includes((booking.status || '').toUpperCase()))) return;
    this.api.get<{ data: FixedBooking[] }>(this.bookingsUrl(1)).subscribe({
      next: (res) => {
        const fresh = new Map((res?.data || []).map((row) => [row.id, row]));
        if (!fresh.size) return;
        this.allBookings = this.allBookings.map((row) => fresh.get(row.id) || row);
        this.applyFilters();
      },
      error: () => {},
    });
  }

  loadMore(): void {
    if (this.loading || this.loadingMore || !this.hasMore) return;
    const nextPage = this.page + 1;
    this.loadingMore = true;
    this.api.get<{ data: FixedBooking[]; meta?: { current_page: number; total: number; has_more: boolean } }>(this.bookingsUrl(nextPage))
      .pipe(finalize(() => this.loadingMore = false))
      .subscribe({
        next: (res) => {
          const rows = res?.data || [];
          this.page = res?.meta?.current_page ?? nextPage;
          this.allBookings = [...this.allBookings, ...rows];
          this.totalBookings = res?.meta?.total ?? this.allBookings.length;
          this.hasMore = !!res?.meta?.has_more;
          this.applyFilters();
        },
        error: (err) => {
          this.error = err?.error?.message || 'Could not load more fixed rides.';
        },
      });
  }

  back(): void {
    this.router.navigateByUrl('/customer-tabs/book');
  }

  toggle(booking: FixedBooking): void {
    if (this.activeOnly) {
      this.expandedId = booking.id;
    } else {
      const closing = this.expandedId === booking.id;
      this.expandedId = closing ? null : booking.id;
    }
  }

  openRide(event: Event, booking: FixedBooking): void {
    event.stopPropagation();
    this.router.navigateByUrl('/customer-tabs/fixed-rides/' + booking.id);
  }

  isActiveBooking(booking: FixedBooking): boolean {
    return !this.inactiveStatuses.has((booking.status || '').toUpperCase());
  }

  get routeOptions(): string[] {
    const routes = this.allBookings
      .map((booking) => booking.route_name || 'Fixed ride')
      .filter((name, index, list) => list.indexOf(name) === index);
    return routes.sort((a, b) => a.localeCompare(b));
  }

  get hasActiveFilters(): boolean {
    return this.statusFilter !== 'all' || this.routeFilter !== 'all' || !!this.fromDate || !!this.toDate;
  }

  applyFilters(): void {
    const source = this.activeOnly
      ? this.allBookings.filter((booking) => this.isActiveBooking(booking))
      : this.allBookings;

    this.bookings = this.activeOnly
      ? source
      : source.filter((booking) => {
          if (!this.matchesStatusFilter(booking)) return false;
          if (this.routeFilter !== 'all' && (booking.route_name || 'Fixed ride') !== this.routeFilter) return false;
          return this.matchesDateRange(booking);
        });

    if (this.expandedId && !this.bookings.some((booking) => booking.id === this.expandedId)) {
      this.expandedId = null;
    }
    this.syncFixedLocationStream();
  }

  clearFilters(): void {
    this.statusFilter = 'all';
    this.routeFilter = 'all';
    this.fromDate = '';
    this.toDate = '';
    this.applyFilters();
  }

  private matchesStatusFilter(booking: FixedBooking): boolean {
    const status = (booking.status || '').toUpperCase();
    if (this.statusFilter === 'all') return true;
    if (this.statusFilter === 'active') return this.isActiveBooking(booking);
    return status === this.statusFilter.toUpperCase();
  }

  private matchesDateRange(booking: FixedBooking): boolean {
    const dateValue = this.bookingDateValue(booking);
    if (!dateValue) return !this.fromDate && !this.toDate;
    if (this.fromDate && dateValue < this.fromDate) return false;
    if (this.toDate && dateValue > this.toDate) return false;
    return true;
  }

  private bookingDateValue(booking: FixedBooking): string {
    const raw = booking.announced_depart_at || booking.depart_at || booking.service_date || booking.created_at || '';
    if (!raw) return '';
    if (raw.length >= 10 && raw.charAt(4) === '-' && raw.charAt(7) === '-') return raw.slice(0, 10);
    const date = new Date(raw);
    return isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }

  headerTitle(): string {
    return this.activeOnly ? 'Active fixed' : 'Fixed';
  }

  headerSubtitle(): string {
    return this.activeOnly
      ? 'Current fixed-route booking details.'
      : 'Your fixed-route bookings, payment and live pickup status.';
  }

  emptyTitle(): string {
    return this.activeOnly ? 'No active fixed booking' : 'No fixed bookings yet';
  }

  emptyText(): string {
    return this.activeOnly ? 'Your active fixed ride will appear here.' : 'Your fixed bookings will appear here.';
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
    return 'status--' + this.bookingStatusTone(booking);
  }

  bookingStatusLabel(booking: FixedBooking): string {
    switch ((booking.status || '').toUpperCase()) {
      case 'BOOKED':
      case 'CONFIRMED':
        return 'Booking confirmed';
      case 'BOARDED':
        return 'Boarded';
      case 'DROPPED':
        return 'Dropped off';
      case 'COMPLETED':
        return 'Ride completed';
      case 'NO_SHOW':
        return 'No-show';
      case 'CANCELLED':
        return booking.fixed_live_status?.key === 'driver_missed_stop' ? 'Driver missed pickup' : 'Cancelled';
      default:
        return this.liveStatus(booking).label || booking.status || 'Status unavailable';
    }
  }

  bookingStatusDetail(booking: FixedBooking): string {
    switch ((booking.status || '').toUpperCase()) {
      case 'BOOKED':
      case 'CONFIRMED':
        return 'Your fixed ride seat is booked.';
      case 'BOARDED':
        return 'You have boarded this fixed ride and are on the vehicle.';
      case 'DROPPED':
        return '';
      case 'COMPLETED':
        return 'This fixed ride is completed.';
      case 'NO_SHOW':
        return 'The driver marked this booking no-show after reaching your pickup stop.';
      case 'CANCELLED':
        return this.liveStatus(booking).detail || 'This fixed booking is cancelled.';
      default:
        return this.liveStatus(booking).detail;
    }
  }

  isDroppedBooking(booking: FixedBooking): boolean {
    return (booking.status || '').toUpperCase() === 'DROPPED';
  }

  bookingStatusTone(booking: FixedBooking): string {
    switch ((booking.status || '').toUpperCase()) {
      case 'DROPPED':
      case 'COMPLETED':
      case 'BOARDED':
        return 'success';
      case 'NO_SHOW':
        return 'danger';
      case 'CANCELLED':
        return booking.fixed_live_status?.key === 'driver_missed_stop' ? 'warning' : 'medium';
      default:
        return this.liveStatus(booking).tone || 'primary';
    }
  }

  routeLine(booking: FixedBooking): string {
    return (booking.board || 'Pickup stop') + ' -> ' + (booking.drop || 'Drop stop');
  }

  vehicleLine(booking: FixedBooking): string {
    return [booking.vehicle_name, booking.vehicle_type_name].filter(Boolean).join(' · ');
  }

  carLine(booking: FixedBooking): string {
    return [booking.vehicle_brand, booking.vehicle_model, booking.vehicle_color].filter(Boolean).join(' · ');
  }

  seatCapacityLine(booking: FixedBooking): string {
    return booking.seats + ' booked';
  }

  luggageLine(booking: FixedBooking): string {
    const booked = booking.extra_luggage_count || 0;
    return booked ? booked + ' extra' : 'No extra luggage';
  }

  openTrip(event: Event, booking: FixedBooking): void {
    event.stopPropagation();
    if (!booking.trip_id) return;
    this.router.navigateByUrl('/customer-tabs/trip/' + booking.trip_id);
  }

  fareLine(booking: FixedBooking): string {
    if (booking.fare_amount == null) return '-';
    return `INR ${Number(booking.fare_amount).toFixed(2)}`;
  }

  paymentLine(booking: FixedBooking): string {
    const method = booking.payment_method ? this.prettyToken(booking.payment_method) : 'Payment';
    const status = booking.payment_status ? this.prettyToken(booking.payment_status) : 'Unknown';
    return `${method} · ${status}`;
  }

  departureStatusLine(booking: FixedBooking): string {
    return this.prettyToken(booking.departure_status || 'Scheduled');
  }

  rawStatusLine(booking: FixedBooking): string {
    return this.bookingStatusLabel(booking);
  }

  refundLine(booking: FixedBooking): string {
    return booking.refund_status ? this.prettyToken(booking.refund_status) : 'None';
  }

  private prettyToken(value: string): string {
    return value
      .toString()
      .toLowerCase()
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
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
            this.allBookings = this.allBookings.map((item) => item.id === updated.id ? updated : item);
            this.applyFilters();
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


  hasMapCoords(booking: FixedBooking): boolean {
    return booking.board_lat != null && booking.board_lng != null && booking.drop_lat != null && booking.drop_lng != null;
  }

  private syncFixedLocationStream(): void {
    const shouldStream = this.allBookings.some((booking) => ['BOOKED', 'CONFIRMED'].includes((booking.status || '').toUpperCase()));
    if (shouldStream) void this.fixedLocation.start();
    else void this.fixedLocation.stop();
  }

  private bookingsUrl(page: number): string {
    return `/fixed/bookings?page=${page}&per_page=${this.perPage}`;
  }

  private async showToast(message: string): Promise<void> {
    const toast = await this.toasts.create({ message, duration: 2200, position: 'bottom' });
    await toast.present();
  }
}
