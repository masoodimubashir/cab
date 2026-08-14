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

/**
 * Where the driver's money actually is. Under the auto-split model their share
 * of every fare goes straight to their own bank account, so "earned" and
 * "received" stop being the same number — this is the difference.
 */
interface PayoutSummary {
  enabled: boolean;
  paid: number;
  pending: number;
  held: number;
  account_status: string;
  blocked_by_kyc: boolean;
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
  payout?: PayoutSummary;
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

  period: 'week' | 'month' | 'all' = 'week';
  periodLabelMap: Record<'week' | 'month' | 'all', string> = {
    week: 'this week',
    month: 'this month',
    all: 'all time',
  };
  periodRideTitleMap: Record<'week' | 'month' | 'all', string> = {
    week: 'Weekly rides',
    month: 'Monthly rides',
    all: 'All time rides',
  };
  periodChartTitleMap: Record<'week' | 'month' | 'all', string> = {
    week: 'Weekly Overview',
    month: 'Monthly Overview',
    all: 'All time Activity',
  };
  buckets: Bucket[] = [];
  rides: RideRow[] = [];
  payout: PayoutSummary | null = null;

  // Model B settlement position (replaces the old Route "paid to bank" card).
  owedToYou = 0;
  inDebt = false;
  youOwe = 0;
  lastPaidAmount: number | null = null;
  lastPaidDate: string | null = null;
  lastPaidMethod: string | null = null;

  constructor(private api: ApiService) {}

  ngOnInit(): void { this.load(); this.loadSettlement(); }
  ionViewWillEnter(): void { this.load(); this.loadSettlement(); }

  /** Model B: what the operator owes the driver right now, and the last payout. */
  loadSettlement(): void {
    this.api.get<{
      position: { owed_by_company: number; owed_by_driver: number; net: number };
      history: Array<{ amount_paid: number; method: string | null; created_at: string | null }>;
    }>('/drivers/me/settlement').subscribe({
      next: (res) => {
        this.owedToYou = res.position?.owed_by_company ?? 0;
        this.youOwe = res.position?.owed_by_driver ?? 0;
        this.inDebt = (res.position?.net ?? 0) < 0;
        const last = res.history?.length ? res.history[0] : null;
        this.lastPaidAmount = last ? last.amount_paid : null;
        this.lastPaidDate = last ? last.created_at : null;
        this.lastPaidMethod = last ? last.method : null;
      },
      error: () => { /* card simply stays hidden on older backends */ },
    });
  }

  methodLabel(m: string | null): string {
    switch (m) {
      case 'gpay': return 'GPay';
      case 'bank': return 'Bank transfer';
      case 'cash': return 'Cash';
      case 'other': return 'Other';
      default: return m || '';
    }
  }

  lastPaidLabel(): string {
    if (this.lastPaidAmount == null) return '';
    const when = this.lastPaidDate ? this.rideDate({ id: 0, date: this.lastPaidDate, fare: 0, commission: 0, net: 0, commission_free: false, is_shared: false }) : '';
    const method = this.methodLabel(this.lastPaidMethod);
    return `₹${this.lastPaidAmount} · ${when}${method ? ' · ' + method : ''}`;
  }

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
        // Absent on older backends — the payout card simply stays hidden.
        this.payout = res.payout?.enabled ? res.payout : null;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load earnings.';
        this.loading = false;
      },
    });
  }

  setPeriod(p: 'week' | 'month' | 'all'): void {
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

  // ── Payouts ──
  /** Money earned that hasn't reached the bank yet — held plus in-flight. */
  get payoutOnTheWay(): number {
    return (this.payout?.held ?? 0) + (this.payout?.pending ?? 0);
  }

  /**
   * Why money is stuck, in words the driver can act on. Null when nothing is
   * stuck — the card then just shows what's been paid.
   */
  get payoutBlockedReason(): string | null {
    if (!this.payout) return null;
    if (this.payout.blocked_by_kyc) {
      return 'Add your payout account to release this money. It is yours — it just has nowhere to go yet.';
    }
    if (this.payout.held > 0) {
      return 'A transfer to your bank did not go through. We retry automatically — nothing is lost.';
    }
    return null;
  }

  rideDate(r: RideRow): string {
    if (!r.date) return '';
    try {
      const d = new Date(r.date);
      return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}, ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch { return ''; }
  }
}
