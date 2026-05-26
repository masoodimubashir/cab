import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import {
  coordsFromTrip,
  googleMapsDirectionsUrl,
  openExternalUrl,
} from '../../core/maps-navigation';

type ProductKind = 'all' | 'local' | 'rental' | 'outstation';
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
  product_kind: 'local' | 'rental' | 'outstation' | null;
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
 * Customer ride history with product-kind and status filters.
 *
 *   Product kind: All · Local · Rental · Outstation   (trips.product_kind enum)
 *   Status:       All · Completed · Cancelled · Missed
 *     - completed: status = COMPLETED
 *     - cancelled: status = CANCELLED with no_show_by = null
 *     - missed:    status = CANCELLED with no_show_by != null
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

  productKind: ProductKind = 'all';
  status: StatusFilter = 'all';
  payment: PaymentFilter = 'all';

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
    const params = new URLSearchParams({
      product_kind: this.productKind,
      status: this.status,
      payment: this.payment,
    }).toString();
    this.api.get<{ data: { data?: TripRow[] } }>(`/customer/trips/history?${params}`).subscribe({
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

  setProductKind(p: ProductKind): void {
    if (this.productKind === p) return;
    this.productKind = p;
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

  productLabel(kind: TripRow['product_kind']): string {
    if (kind === 'local') return 'Local';
    if (kind === 'rental') return 'Rental';
    if (kind === 'outstation') return 'Outstation';
    return 'Ride';
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
