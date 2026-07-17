import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../core/api.service';

/** One refund row shaped by GET /customer/refunds (fixed + shuttle union). */
export interface RefundRow {
  key: string;
  module: 'fixed' | 'shuttle';
  id: number;
  trip_label: string;
  travel_date: string | null;
  reason: string;
  payment_method: string;
  amount: number;
  state: 'due' | 'refunded' | 'rejected' | 'none';
  refund_method: string | null;
  refund_method_label: string | null;
  refund_reference: string | null;
  refund_note: string | null;
  refunded_at: string | null;
  owed_since: string | null;
}

type StatusFilter = 'all' | 'due' | 'refunded' | 'rejected';
type RangeFilter = 'all' | 'today' | 'week' | 'month';

/**
 * "My refunds" — every rupee coming back to this customer from cancelled
 * fixed/shuttle bookings: how much, why, HOW it arrives and WHEN. Read-only.
 *
 * UI mirrors the driver Trip history page: navy rounded header + a bottom-sheet
 * Filter modal (WHEN / STATUS pills).
 */
@Component({
  selector: 'app-refunds',
  templateUrl: './refunds.page.html',
  styleUrls: ['./refunds.page.scss'],
  standalone: false,
})
export class RefundsPage implements OnInit {
  rows: RefundRow[] = [];
  loading = true;
  error: string | null = null;

  status: StatusFilter = 'all';
  range: RangeFilter = 'all';
  filterOpen = false;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(event?: any): void {
    this.loading = !event;
    this.error = null;
    this.api.get<{ data: RefundRow[] }>('/customer/refunds').subscribe({
      next: (res) => {
        this.rows = res?.data ?? [];
        this.loading = false;
        event?.target?.complete();
      },
      error: () => {
        this.error = 'Could not load your refunds. Pull to retry.';
        this.loading = false;
        event?.target?.complete();
      },
    });
  }

  refresh(): void {
    this.load();
  }

  // ── Filter bottom sheet ─────────────────────────────────────────
  openFilters(): void { this.filterOpen = true; }
  closeFilters(): void { this.filterOpen = false; }

  get activeFilterCount(): number {
    let n = 0;
    if (this.range !== 'all') n++;
    if (this.status !== 'all') n++;
    return n;
  }

  resetFilters(): void {
    this.range = 'all';
    this.status = 'all';
  }

  setStatus(s: StatusFilter): void { this.status = s; }
  setRange(r: RangeFilter): void { this.range = r; }

  get filteredRows(): RefundRow[] {
    const min = this.rangeStart();
    return this.rows.filter((r) => {
      if (this.status !== 'all' && r.state !== this.status) return false;
      if (this.range !== 'all') {
        const d = this.rowDate(r);
        if (!d) return false;
        if (this.range === 'today') {
          const now = new Date();
          const dd = new Date(d);
          if (dd.getFullYear() !== now.getFullYear() || dd.getMonth() !== now.getMonth() || dd.getDate() !== now.getDate()) return false;
        } else if (min && d < min) {
          return false;
        }
      }
      return true;
    });
  }

  private rowDate(r: RefundRow): number | null {
    const iso = r.state === 'refunded' ? (r.refunded_at || r.owed_since) : r.owed_since;
    const t = iso ? new Date(iso).getTime() : NaN;
    return isNaN(t) ? null : t;
  }

  private rangeStart(): number | null {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    if (this.range === 'week') return now - 7 * day;
    if (this.range === 'month') return now - 30 * day;
    return null;
  }

  get pendingTotal(): number {
    return this.rows
      .filter((r) => r.state === 'due')
      .reduce((sum, r) => sum + (r.amount || 0), 0);
  }

  get hasPending(): boolean {
    return this.rows.some((r) => r.state === 'due');
  }

  metaDate(r: RefundRow): string | null {
    return r.state === 'refunded' ? (r.refunded_at || r.owed_since) : (r.owed_since || r.travel_date);
  }

  /** Plain-English "how and when the money reaches you" line per row. */
  arrivalText(r: RefundRow): string {
    if (r.state === 'due') {
      return 'The DreamCabs team sends this to you directly by GPay/UPI or bank transfer — usually within 24 hours.';
    }
    if (r.state === 'refunded') {
      switch (r.refund_method) {
        case 'wallet':
          return 'Credited instantly to your DreamCabs wallet.';
        case 'razorpay':
        case 'razorpay_dashboard':
          return 'Sent back to the card/UPI you paid with — banks take 5–7 working days to show it.';
        case 'gpay':
          return 'Sent to you by GPay/UPI.';
        case 'bank':
          return 'Sent to you by bank transfer.';
        case 'cash':
          return 'Handed to you in cash.';
        default:
          return 'Sent to you by the DreamCabs team.';
      }
    }
    return 'This booking was not eligible for a refund (no-show, or cancelled after the cutoff).';
  }

  statusLabel(r: RefundRow): string {
    if (r.state === 'due') return 'On its way';
    if (r.state === 'refunded') return 'Refunded';
    return 'No refund';
  }

  badgeClass(r: RefundRow): string {
    if (r.state === 'due') return 'dc-badge--warn';
    if (r.state === 'refunded') return 'dc-badge--ok';
    return 'dc-badge--muted';
  }
}
