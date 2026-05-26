import { Component } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import {
  coordsFromTrip,
  googleMapsDirectionsUrl,
  openExternalUrl,
} from '../../core/maps-navigation';

interface TripPayment {
  id: number;
  method?: string | null;
  status?: 'PENDING' | 'SUCCESS' | 'FAILED' | string | null;
  amount?: number | null;
  discount_amount?: number | null;
  paid_at?: string | null;
  coupon_assignment_id?: number | null;
}

interface TripDriver {
  id: number;
  name?: string | null;
  phone?: string | null;
  avatar_path?: string | null;
}

interface AppliedPromotion {
  id: number;
  title?: string | null;
  discount_type?: 'percentage' | 'flat' | null;
  discount_value?: number | null;
}

interface TripDetail {
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
  payment_method?: string | null;
  promo_discount_amount?: number | null;
  cancellation_fee_amount?: number | null;
  waiting_charge_amount?: number | null;
  tip_amount?: number | null;
  cancelled_reason?: string | null;
  no_show_by?: string | null;
  created_at?: string | null;
  negotiation_started_at?: string | null;
  confirmed_at?: string | null;
  assigned_at?: string | null;
  en_route_pickup_at?: string | null;
  arrived_pickup_at?: string | null;
  en_route_drop_at?: string | null;
  arrived_drop_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  payment?: TripPayment | null;
  driver?: TripDriver | null;
  applied_promotion?: AppliedPromotion | null;
}

/**
 * Read-only trip summary screen. Customer arrives here from the My Trips list
 * to see the full breakdown of a past (or unpaid completed) ride.
 *
 * Payment gating:
 *   - payment.status === 'SUCCESS' → render no Pay button. The "Paid" badge
 *     and amount paid are enough.
 *   - status === 'COMPLETED' but no SUCCESS payment → render the Pay button.
 *     Clicking it navigates to /customer-tabs/trip/{id} (trip-active), which
 *     already owns the full coupon + payment-method flow. We don't duplicate
 *     that logic here.
 */
@Component({
  selector: 'app-trip-details',
  templateUrl: './trip-details.page.html',
  styleUrls: ['./trip-details.page.scss'],
  standalone: false,
})
export class TripDetailsPage {
  tripId!: number;
  loading = true;
  error: string | null = null;
  trip: TripDetail | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
  ) {}

  ionViewWillEnter(): void {
    this.tripId = Number(this.route.snapshot.paramMap.get('tripId'));
    if (!Number.isFinite(this.tripId) || this.tripId < 1) {
      this.error = 'Invalid trip.';
      this.loading = false;
      return;
    }
    this.refresh();
  }

  refresh(): void {
    this.loading = true;
    this.error = null;
    this.api.get<{ trip: TripDetail }>(`/customer/trips/${this.tripId}`).subscribe({
      next: (res) => { this.trip = res?.trip ?? null; },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load trip';
        this.trip = null;
      },
      complete: () => { this.loading = false; },
    });
  }

  // ── Derived helpers ─────────────────────────────────────────────

  /** True when the trip is completed but no successful payment exists. */
  get needsPayment(): boolean {
    if (!this.trip) return false;
    if (this.trip.status !== 'COMPLETED') return false;
    return this.trip.payment?.status !== 'SUCCESS';
  }

  get isPaid(): boolean {
    return this.trip?.payment?.status === 'SUCCESS';
  }

  statusLabel(): string {
    const t = this.trip;
    if (!t) return '';
    if (t.status === 'COMPLETED') return 'Completed';
    if (t.status === 'CANCELLED') return t.no_show_by ? 'Missed' : 'Cancelled';
    return t.status;
  }

  statusColor(): string {
    const t = this.trip;
    if (!t) return 'primary';
    if (t.status === 'COMPLETED') return 'success';
    if (t.status === 'CANCELLED') return t.no_show_by ? 'warning' : 'medium';
    return 'primary';
  }

  paymentBadge(): { label: string; color: string } | null {
    if (!this.trip) return null;
    if (this.isPaid) return { label: 'Paid', color: 'success' };
    if (this.trip.status === 'COMPLETED') return { label: 'Unpaid', color: 'danger' };
    return null;
  }

  currency(): string {
    return this.trip?.currency || 'INR';
  }

  /**
   * Build the fare breakdown from whatever fields are persisted. Lines that
   * resolve to 0 / null are skipped.
   */
  breakdownRows(): { label: string; value: string; negative?: boolean; emphasis?: boolean }[] {
    const t = this.trip;
    if (!t) return [];
    const rows: { label: string; value: string; negative?: boolean; emphasis?: boolean }[] = [];

    if (t.estimated_fare != null) {
      rows.push({ label: 'Estimated fare', value: `₹${t.estimated_fare}` });
    }
    if (t.final_fare != null) {
      rows.push({ label: 'Final fare', value: `₹${t.final_fare}` });
    }
    if (t.applied_promotion?.title && t.promo_discount_amount) {
      rows.push({
        label: `Promotion (${t.applied_promotion.title})`,
        value: `-₹${t.promo_discount_amount}`,
        negative: true,
      });
    }
    if (t.payment?.discount_amount && t.payment.discount_amount > 0) {
      rows.push({
        label: 'Coupon discount',
        value: `-₹${t.payment.discount_amount}`,
        negative: true,
      });
    }
    if (t.waiting_charge_amount && t.waiting_charge_amount > 0) {
      rows.push({ label: 'Waiting charge', value: `₹${t.waiting_charge_amount}` });
    }
    if (t.tip_amount && t.tip_amount > 0) {
      rows.push({ label: 'Tip', value: `₹${t.tip_amount}` });
    }
    if (t.cancellation_fee_amount && t.cancellation_fee_amount > 0) {
      rows.push({ label: 'Cancellation fee', value: `₹${t.cancellation_fee_amount}` });
    }
    if (t.payment?.amount != null) {
      rows.push({
        label: this.isPaid ? 'Paid' : 'Payable',
        value: `₹${t.payment.amount}`,
        emphasis: true,
      });
    }
    return rows;
  }

  /**
   * Timeline of stamped trip transitions — only steps that actually happened
   * are returned, ordered chronologically.
   */
  timeline(): { label: string; at: string }[] {
    const t = this.trip;
    if (!t) return [];
    const candidates: { label: string; at?: string | null }[] = [
      { label: 'Booked',          at: t.created_at },
      { label: 'In negotiation',  at: t.negotiation_started_at },
      { label: 'Confirmed',       at: t.confirmed_at },
      { label: 'Driver assigned', at: t.assigned_at },
      { label: 'En route',        at: t.en_route_pickup_at },
      { label: 'At pickup',       at: t.arrived_pickup_at },
      { label: 'Ride started',    at: t.en_route_drop_at },
      { label: 'At drop',         at: t.arrived_drop_at },
      { label: 'Completed',       at: t.completed_at },
      { label: 'Cancelled',       at: t.cancelled_at },
    ];
    return candidates
      .filter((c): c is { label: string; at: string } => !!c.at)
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }

  // ── Actions ─────────────────────────────────────────────────────

  payNow(): void {
    if (!this.trip) return;
    this.router.navigateByUrl(`/customer-tabs/trip/${this.trip.id}`);
  }

  openMaps(): void {
    if (!this.trip) return;
    const pickup = coordsFromTrip(this.trip as any, 'pickup_lat', 'pickup_lng');
    const drop = coordsFromTrip(this.trip as any, 'drop_lat', 'drop_lng');
    if (!pickup || !drop) return;
    openExternalUrl(
      googleMapsDirectionsUrl({ origin: pickup, destination: drop, travelmode: 'driving' }),
    );
  }
}
