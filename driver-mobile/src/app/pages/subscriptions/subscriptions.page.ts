import { Component, OnInit } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
import { ApiService } from '../../core/api.service';

interface Plan {
  id: number;
  title: string;
  subtitle: string | null;
  amount: number;
  commission_percent: number;
  meter_type: 'rides' | 'days' | 'daily' | 'earnings';
  rides_count: number | null;
  days_count: number | null;
  earnings_threshold: number | null;
  plan_type: string;
  vehicle_type_name: string | null;
  terms: string | null;
}

interface ActiveSubscription {
  id: number;
  title: string;
  subtitle: string | null;
  status: string;
  meter_type: Plan['meter_type'];
  commission_percent: number;
  amount_paid: number;
  rides_allowed: number | null;
  rides_used: number;
  rides_remaining: number | null;
  earnings_cap: number | null;
  earnings_accrued: number;
  earnings_remaining: number | null;
  vehicle_type_name: string | null;
  starts_at: string | null;
  expires_at: string | null;
}

/**
 * Subscriptions — the driver buys a plan to keep (usually) 100% of their fares
 * for a while instead of paying commission per ride. Shows their current active
 * plan with remaining allowance, plus the plans they can buy.
 */
@Component({
  selector: 'app-subscriptions',
  templateUrl: './subscriptions.page.html',
  styleUrls: ['./subscriptions.page.scss'],
  standalone: false,
})
export class SubscriptionsPage implements OnInit {
  loading = false;
  buyingId: number | null = null;
  error: string | null = null;

  current: ActiveSubscription | null = null;
  plans: Plan[] = [];
  wallet = 0;
  currency = 'INR';

  constructor(
    private api: ApiService,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
  ) {}

  ngOnInit(): void { this.load(); }
  ionViewWillEnter(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.error = null;

    this.api.get<{ subscription: ActiveSubscription | null; wallet_balance: number; currency: string }>(
      '/drivers/me/subscription',
    ).subscribe({
      next: (res) => {
        this.current = res.subscription;
        this.wallet = res.wallet_balance ?? 0;
        this.currency = res.currency || 'INR';
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load your subscription.';
      },
    });

    this.api.get<{ data: Plan[] }>('/drivers/me/subscriptions/plans').subscribe({
      next: (res) => {
        this.plans = res.data ?? [];
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load plans.';
        this.loading = false;
      },
    });
  }

  meterSummary(p: Plan): string {
    switch (p.meter_type) {
      case 'rides': return `${p.rides_count} rides`;
      case 'days': return `Valid ${p.days_count} days`;
      case 'daily': return 'Valid for 1 day';
      case 'earnings': return `Until you earn ₹${p.earnings_threshold}`;
      default: return '';
    }
  }

  /** Headline progress for the active plan card. */
  remainingSummary(s: ActiveSubscription): string {
    if (s.rides_remaining != null) return `${s.rides_remaining} of ${s.rides_allowed} rides left`;
    if (s.earnings_remaining != null) return `₹${s.earnings_remaining} of ₹${s.earnings_cap} left`;
    if (s.expires_at) return `Active until ${this.fmtDate(s.expires_at)}`;
    return 'Active';
  }

  private fmtDate(iso: string): string {
    try {
      const d = new Date(iso);
      return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
    } catch { return iso; }
  }

  async confirmBuy(p: Plan): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Subscribe?',
      message: `${p.title} — ₹${p.amount} will be debited from your wallet. ${
        p.commission_percent > 0 ? `Commission while active: ${p.commission_percent}%.` : 'Keep 100% of your fares while active.'
      }`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Subscribe', handler: () => this.buy(p) },
      ],
    });
    await alert.present();
  }

  buy(p: Plan): void {
    if (this.buyingId) return;
    this.buyingId = p.id;
    this.api.post<{ message?: string }>('/drivers/me/subscriptions', { plan_id: p.id }).subscribe({
      next: async (res) => {
        this.buyingId = null;
        await this.presentToast(res?.message || 'Subscription activated', 'success');
        this.load();
      },
      error: async (err) => {
        this.buyingId = null;
        await this.presentToast(err?.error?.message || 'Could not subscribe', 'danger');
      },
    });
  }

  private async presentToast(message: string, color: 'success' | 'danger'): Promise<void> {
    const toast = await this.toastCtrl.create({ message, duration: 2500, color, position: 'bottom' });
    await toast.present();
  }
}
