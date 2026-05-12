import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../core/api.service';

interface Bucket {
  date: string;       // YYYY-MM-DD
  amount: number;
  weekday: string;    // 'Mon', 'Tue', …
}

interface EarningsResponse {
  total_earnings: number;
  wallet_balance: number;
  currency: string;
  period: 'week' | 'month';
  buckets: Bucket[];
  weekly: Bucket[];
}

/**
 * Earnings tab.
 *
 *   1. Stats row — Total earnings (lifetime) + Wallet balance
 *   2. Bar chart — per-day earnings for a selected window (week | month)
 *      Filter is a segmented control; switching it refetches.
 *   3. Weekly breakdown — fixed list of the last 7 days with amounts
 *
 * Chart is a hand-rolled CSS bar grid (no chart library needed). Each bar's
 * height is computed as a percentage of the window's max.
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
  wallet = 0;
  currency = 'INR';

  period: 'week' | 'month' = 'week';
  buckets: Bucket[] = [];
  weekly: Bucket[] = [];

  constructor(private api: ApiService) {}

  ngOnInit(): void { this.load(); }
  ionViewWillEnter(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.error = null;
    this.api.get<EarningsResponse>(`/drivers/me/earnings?period=${this.period}`).subscribe({
      next: (res) => {
        this.total = res.total_earnings ?? 0;
        this.wallet = res.wallet_balance ?? 0;
        this.currency = res.currency || 'INR';
        this.buckets = res.buckets ?? [];
        this.weekly = res.weekly ?? [];
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
}
