import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import {
  coordsFromTrip,
  googleMapsDirectionsUrl,
  openExternalUrl,
} from '../../core/maps-navigation';

type StatusFilter = 'all' | 'completed' | 'cancelled' | 'missed';
type PaymentFilter = 'all' | 'paid' | 'unpaid';
type PaymentMethodFilter = 'all' | 'cash' | 'razorpay';
type DateRangeFilter = 'all' | '7d' | '30d' | '90d';

/** Ride types are loaded live from /pricing/ride-types — the real, admin-managed rows. */
interface RideType {
  id: number;
  name: string;
}

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
  ride_type_id?: number | null;
  // Eager-loaded by the history endpoint: { id, name }. Null for plain local rides
  // (those don't carry a ride_type_id).
  ride_type?: RideType | null;
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

/**
 * Customer ride history. All refinements live in a bottom sheet:
 *
 *   Ride type:      All · <real ride_types rows>     (trips.ride_type_id)
 *   Status:         All · Completed · Cancelled · Missed
 *   Payment status: Any · Paid · Unpaid              (payments.status SUCCESS?)
 *   Payment method: Any · Cash · Razorpay            (payments.method enum)
 *   Date:           All time · 7d · 30d · 90d         (created_at >= from)
 *
 * Filters are sent as query params to /customer/trips/history.
 */
@Component({
  selector: 'app-customer-trips',
  templateUrl: './customer-trips.page.html',
  styleUrls: ['./customer-trips.page.scss'],
  standalone: false,
})
export class CustomerTripsPage {
  loading = false;
  error: string | null = null;
  trips: TripRow[] = [];

  // Real ride types from the DB (drives the Ride type filter chips).
  rideTypes: RideType[] = [];

  // Filter state — all of it lives in the bottom sheet now.
  rideTypeId: number | 'all' = 'all';
  status: StatusFilter = 'all';
  payment: PaymentFilter = 'all';
  paymentMethod: PaymentMethodFilter = 'all';
  dateRange: DateRangeFilter = 'all';

  filtersOpen = false;

  constructor(
    private api: ApiService,
    private router: Router,
  ) {}

  ionViewWillEnter(): void {
    this.loadRideTypes();
    this.refresh();
  }

  private loadRideTypes(): void {
    this.api.get<{ data: RideType[] }>('/pricing/ride-types').subscribe({
      next: (res) => (this.rideTypes = res.data || []),
      error: () => (this.rideTypes = []),
    });
  }

  refresh(): void {
    this.loading = true;
    this.error = null;

    const params = new URLSearchParams();
    params.set('status', this.status);
    params.set('payment', this.payment);
    if (this.rideTypeId !== 'all') params.set('ride_type_id', String(this.rideTypeId));
    if (this.paymentMethod !== 'all') params.set('payment_method', this.paymentMethod);
    const from = this.dateRangeFrom();
    if (from) params.set('from', from);

    this.api.get<{ data: { data?: TripRow[] } }>(`/customer/trips/history?${params.toString()}`).subscribe({
      next: (res) => {
        const page = res.data;
        this.trips = page?.data ?? [];
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load trips';
        this.trips = [];
      },
      complete: () => { this.loading = false; },
    });
  }

  /** Maps the chosen date range to an ISO `from` date (YYYY-MM-DD), or null for "all time". */
  private dateRangeFrom(): string | null {
    const days = this.dateRange === '7d' ? 7 : this.dateRange === '30d' ? 30 : this.dateRange === '90d' ? 90 : 0;
    if (!days) return null;
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }

  // ── Filter setters (each reloads) ────────────────────────────────

  setRideType(id: number | 'all'): void {
    if (this.rideTypeId === id) return;
    this.rideTypeId = id;
    this.refresh();
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

  setPaymentMethod(m: PaymentMethodFilter): void {
    if (this.paymentMethod === m) return;
    this.paymentMethod = m;
    this.refresh();
  }

  setDateRange(r: DateRangeFilter): void {
    if (this.dateRange === r) return;
    this.dateRange = r;
    this.refresh();
  }

  // ── Filter sheet ─────────────────────────────────────────────────

  openFilters(): void { this.filtersOpen = true; }
  closeFilters(): void { this.filtersOpen = false; }

  /** Active (non-default) refinements — drives the count on the Filters button. */
  get activeFilterCount(): number {
    return (this.rideTypeId !== 'all' ? 1 : 0)
      + (this.status !== 'all' ? 1 : 0)
      + (this.payment !== 'all' ? 1 : 0)
      + (this.paymentMethod !== 'all' ? 1 : 0)
      + (this.dateRange !== 'all' ? 1 : 0);
  }

  /** Reset every refinement and reload (no-op refresh if already clear). */
  clearFilters(): void {
    const changed = this.activeFilterCount > 0;
    this.rideTypeId = 'all';
    this.status = 'all';
    this.payment = 'all';
    this.paymentMethod = 'all';
    this.dateRange = 'all';
    if (changed) this.refresh();
  }

  /** Header back button — returns to the Ride/home tab (mirrors the other pages). */
  back(): void {
    this.router.navigateByUrl('/customer-tabs/book');
  }

  /**
   * Payment chip shown on each card. Completed trips with no SUCCESS payment
   * are flagged Unpaid so the customer sees what they still owe. Other trip
   * states don't get a payment chip (no payment is expected yet).
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

  // ── Display helpers ──────────────────────────────────────────────

  /** Card title — the real ride type name, falling back to "Local" for plain rides. */
  rideTypeLabel(t: TripRow): string {
    return t.ride_type?.name || 'Local';
  }

  /** Ionicon for the ride-type tile — inferred from the type name. */
  kindIcon(t: TripRow): string {
    const name = (t.ride_type?.name || '').toLowerCase();
    if (name.includes('out')) return 'airplane';
    if (name.includes('rent') || name.includes('shuttle') || name.includes('hour')) return 'time';
    return 'car-sport';
  }

  /** Human-friendly payment method (CASH → Cash, RAZORPAY → Razorpay). */
  methodLabel(method?: string | null): string | null {
    if (!method) return null;
    const m = method.toLowerCase();
    return m.charAt(0).toUpperCase() + m.slice(1);
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
   * Left accent-strip color. Money still owed wins (red) so unpaid rides stand
   * out; otherwise completed = green, cancelled/missed = grey, anything else = navy.
   */
  accentColor(t: TripRow): string {
    if (this.paymentBadge(t)?.label === 'Unpaid') return 'unpaid';
    if (t.status === 'COMPLETED') return 'completed';
    if (t.status === 'CANCELLED') return 'cancelled';
    return 'other';
  }

  fareDisplay(t: TripRow): string | null {
    const amount = t.final_fare ?? t.estimated_fare;
    if (amount == null) return null;
    return `${amount} ${t.currency || 'INR'}`;
  }

  dateDisplay(t: TripRow): string | null {
    return t.completed_at || t.cancelled_at || t.created_at || null;
  }

  // ── Actions ──────────────────────────────────────────────────────

  navigatePickupToDrop(t: TripRow): void {
    const pickup = coordsFromTrip(t as any, 'pickup_lat', 'pickup_lng');
    const drop = coordsFromTrip(t as any, 'drop_lat', 'drop_lng');
    if (!pickup || !drop) return;
    openExternalUrl(googleMapsDirectionsUrl({
      origin: pickup, destination: drop, travelmode: 'driving',
    }));
  }

  navigateToNegotiation(t: TripRow): void {
    if (!Number.isFinite(t.id) || t.id < 1) return;
    this.router.navigateByUrl(`/customer-tabs/trip/${t.id}`, { replaceUrl: true });
  }

  /**
   * Tap on the card opens the read-only details view. Negotiation trips
   * still get their own Negotiate button — they should go to trip-active,
   * not details — so the card-level tap short-circuits them.
   */
  openTripDetails(t: TripRow, event?: Event): void {
    if (event) {
      const target = event.target as HTMLElement | null;
      if (target?.closest('ion-button, ion-icon, button, a')) return;
    }
    if (!Number.isFinite(t.id) || t.id < 1) return;
    if (t.status === 'NEGOTIATION') {
      this.navigateToNegotiation(t);
      return;
    }
    this.router.navigateByUrl(`/customer-tabs/trip-details/${t.id}`);
  }
}
