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
}
