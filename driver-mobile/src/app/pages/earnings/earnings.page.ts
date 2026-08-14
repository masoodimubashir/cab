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
  payment_method: string | null;
  is_cash: boolean;
  is_shared: boolean;
}

interface OperatorPayment {
  id: number;
  amount: number;
  method: string | null;
  reference: string | null;
  notes: string | null;
  created_at: string | null;
}

interface EarningsResponse {
  ride_earnings: number;
  cash_collected: number;
  online_collected: number;
  money_collected_by_operator: number;
  pending_transfers: number;
  completed_transfers: number;
  operator_payments: OperatorPayment[];
  currency: string;
  period: 'week' | 'month' | 'all';
  buckets: Bucket[];
  weekly: Bucket[];
  rides: RideRow[];
}

/**
 * Driver Earnings & Payouts Page (System 2: Driver Income & Payouts).
 *
 * Dedicated strictly to driver income:
 *   - Cash Collected
 *   - Money Waiting To Be Transferred
 *   - Pending Transfers
 *   - Completed Transfers
 *   - Operator Payments history
 *   - Ride Earnings
 *
 * Platform wallet charges live independently in the Driver Wallet tab.
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

  rideEarnings = 0;
  cashCollected = 0;
  onlineCollected = 0;
  moneyCollectedByOperator = 0;
  pendingTransfers = 0;
  completedTransfers = 0;
  operatorPayments: OperatorPayment[] = [];

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

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  ionViewWillEnter(): void {
    this.load();
  }

  setPeriod(p: 'week' | 'month' | 'all'): void {
    if (this.period === p) return;
    this.period = p;
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;

    this.api.get<EarningsResponse>(`/drivers/me/earnings?period=${this.period}`).subscribe({
      next: (res) => {
        this.loading = false;
        this.rideEarnings = res.ride_earnings ?? 0;
        this.cashCollected = res.cash_collected ?? 0;
        this.onlineCollected = res.online_collected ?? 0;
        this.moneyCollectedByOperator = res.money_collected_by_operator ?? 0;
        this.pendingTransfers = res.pending_transfers ?? 0;
        this.completedTransfers = res.completed_transfers ?? 0;
        this.operatorPayments = res.operator_payments ?? [];
        this.currency = res.currency || 'INR';
        this.buckets = res.buckets || [];
        this.rides = res.rides || [];
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.message || 'Could not load driver earnings.';
      },
    });
  }

  maxBucketAmount(): number {
    return Math.max(1, ...this.buckets.map((b) => b.amount));
  }

  barHeight(amount: number): number {
    const max = this.maxBucketAmount();
    if (max <= 0 || amount <= 0) return 4;
    return Math.max(4, Math.round((amount / max) * 100));
  }

  showLabel(idx: number): boolean {
    if (this.period === 'week') return true;
    return idx % 5 === 0;
  }

  shortLabel(b: Bucket): string {
    if (!b.date) return '';
    const parts = b.date.split('-');
    return parts.length >= 3 ? `${parts[2]}/${parts[1]}` : b.date;
  }

  fmtDate(dt: string | null): string {
    if (!dt) return '—';
    try {
      const d = new Date(dt);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return dt;
    }
  }

  methodLabel(m: string | null): string {
    if (!m) return 'Direct Transfer';
    const map: Record<string, string> = {
      gpay: 'GPay',
      bank: 'Bank Transfer',
      cash: 'Cash Handover',
      upi: 'UPI',
      razorpay: 'Razorpay',
    };
    return map[m.toLowerCase()] || m;
  }
}
