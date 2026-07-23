import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../core/api.service';

interface Bucket {
  date: string;       // YYYY-MM-DD
  amount: number;
  weekday: string;    // 'Mon', 'Tue', …
}

interface RideRow {
  id: number;
  date: string | null;
  fare: number;
  commission: number;
  net: number;
  commission_free: boolean;
  is_shared: boolean;
}

interface EarningsResponse {
  total_earnings: number;
  total_commission: number;
  net_earnings: number;
  wallet_balance: number;
  currency: string;
  period: 'week' | 'month';
  buckets: Bucket[];
  weekly: Bucket[];
  rides: RideRow[];
}

/**
 * Ride earnings — the detail behind the Earnings & Wallet page.
 *
 *   1. Hero — lifetime gross / commission / net.
 *   2. Bar chart — per-day earnings for a selected window (week | month).
 *   3. Ride-by-ride — every ride in the window with fare − commission = net,
 *      so the driver sees exactly how much was cut on each trip.
 *
 * Chart is a hand-rolled CSS bar grid (no chart library needed).
 */
@Component({
  selector: 'app-earnings',
  templateUrl: './earnings.page.html',
  styleUrls: ['./earnings.page.scss'],
  standalone: false,
})
export class EarningsPage implements OnInit {
  loading = false;
  error: string | null = null;

  total = 0;
  totalCommission = 0;
  net = 0;
  currency = 'INR';

  period: 'week' | 'month' = 'week';
  buckets: Bucket[] = [];
  rides: RideRow[] = [];

  constructor(private api: ApiService) {}

  ngOnInit(): void { this.load(); }
  ionViewWillEnter(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.error = null;
    this.api.get<EarningsResponse>(`/drivers/me/earnings?period=${this.period}`).subscribe({
      next: (res) => {
        this.total = res.total_earnings ?? 0;
        this.totalCommission = res.total_commission ?? 0;
        this.net = res.net_earnings ?? 0;
        this.currency = res.currency || 'INR';
        this.buckets = res.buckets ?? [];
        this.rides = res.rides ?? [];
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load earnings.';
        this.loading = false;
      },
    });
  }

  setPeriod(p: 'week' | 'month'): void {
    if (this.period === p) return;
    this.period = p;
    this.load();
  }

  get maxBucket(): number {
    return Math.max(1, ...this.buckets.map((b) => b.amount));
  }

  /** Height percentage for a bar, 0–100. Minimum visible height of 2% so
   *  zero-earning days still have a hairline visible on the chart. */
  barHeight(amount: number): number {
    const max = this.maxBucket;
    if (max <= 0) return 0;
    return Math.max(2, Math.round((amount / max) * 100));
  }

  /** Show only every other label on the month view so the X-axis doesn't crowd. */
  showLabel(index: number): boolean {
    if (this.period === 'week') return true;
    return index % 3 === 0;
  }

  // Compact date label "12 May" for the chart's X-axis.
  shortLabel(b: Bucket): string {
    try {
      const d = new Date(b.date);
      return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
    } catch { return b.weekday; }
  }

  // ── Ride-by-ride period totals (sum of the rides shown) ──
  get periodFare(): number { return this.rides.reduce((s, r) => s + (r.fare || 0), 0); }
  get periodCommission(): number { return this.rides.reduce((s, r) => s + (r.commission || 0), 0); }
  get periodNet(): number { return this.rides.reduce((s, r) => s + (r.net || 0), 0); }

  rideDate(r: RideRow): string {
    if (!r.date) return '';
    try {
      const d = new Date(r.date);
      return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}, ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch { return ''; }
  }
}
