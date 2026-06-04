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
  auto_renew: boolean;
  cancelled_at: string | null;
  next_plan: { id: number; title: string; amount: number; commission_percent: number } | null;
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

  /** Which tab is showing. */
  tab: 'current' | 'all' = 'current';
  /** Once the driver taps a tab we stop auto-choosing one for them. */
  private userPickedTab = false;

  constructor(
    private api: ApiService,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
  ) {}

  ngOnInit(): void { this.load(); }
  ionViewWillEnter(): void { this.load(); }

  /** Switch tabs (and remember the driver made a manual choice). */
  setTab(v: unknown): void {
    this.userPickedTab = true;
    this.tab = v === 'all' ? 'all' : 'current';
  }

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
        // First load: land on the most useful tab — Current if they have a
        // plan, otherwise All plans so they can pick one.
        if (!this.userPickedTab) this.tab = this.current ? 'current' : 'all';
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

  /** True while the driver already has an active plan (new buys queue). */
  get hasActive(): boolean {
    return !!this.current;
  }

  /** Auto-renew status line for the active plan card. */
  renewSummary(s: ActiveSubscription): string {
    if (s.cancelled_at || !s.auto_renew) {
      return s.expires_at ? `Won't renew — active until ${this.fmtDate(s.expires_at)}` : "Won't renew";
    }
    return s.expires_at ? `Auto-renews on ${this.fmtDate(s.expires_at)}` : 'Auto-renews when it ends';
  }

  async confirmBuy(p: Plan): Promise<void> {
    // Buying while a plan is active queues the new one — it starts (and is
    // charged) only when the current plan ends.
    if (this.current) {
      const when = this.current.expires_at ? ` on ${this.fmtDate(this.current.expires_at)}` : '';
      const alert = await this.alertCtrl.create({
        header: 'Queue this plan?',
        message: `You already have an active plan. “${p.title}” will start after your current plan ends${when}, and ₹${p.amount} will be charged from your wallet then.`,
        buttons: [
          { text: 'Cancel', role: 'cancel' },
          { text: 'Queue plan', handler: () => this.buy(p) },
        ],
      });
      await alert.present();
      return;
    }

    const alert = await this.alertCtrl.create({
      header: 'Subscribe?',
      message: `${p.title} — ₹${p.amount} will be debited from your wallet. ${
        p.commission_percent > 0 ? `Commission while active: ${p.commission_percent}%.` : 'Keep 100% of your fares while active.'
      } It will auto-renew from your wallet when it ends — you can cancel anytime.`,
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
    this.api.post<{ message?: string; queued?: boolean }>('/drivers/me/subscriptions', { plan_id: p.id }).subscribe({
      next: async (res) => {
        this.buyingId = null;
        await this.presentToast(res?.message || (res?.queued ? 'Plan queued' : 'Subscription activated'), 'success');
        this.load();
      },
      error: async (err) => {
        this.buyingId = null;
        await this.presentToast(err?.error?.message || 'Could not subscribe', 'danger');
      },
    });
  }

  /** Confirm + turn off auto-renew (plan stays active until it expires). */
  async confirmCancel(): Promise<void> {
    const s = this.current;
    if (!s) return;
    const until = s.expires_at ? ` until ${this.fmtDate(s.expires_at)}` : ' until it expires';
    let message = `Auto-renew will be turned off. Your “${s.title}” stays active${until} and won't renew after that.`;
    if (s.next_plan) {
      message += ` Any plan you've queued (${s.next_plan.title}) will also be cancelled.`;
    }
    const alert = await this.alertCtrl.create({
      header: 'Cancel subscription?',
      message,
      buttons: [
        { text: 'Keep plan', role: 'cancel' },
        { text: 'Cancel plan', role: 'destructive', handler: () => this.cancel() },
      ],
    });
    await alert.present();
  }

  cancel(): void {
    this.api.post<{ message?: string }>('/drivers/me/subscriptions/cancel', {}).subscribe({
      next: async (res) => {
        await this.presentToast(res?.message || 'Auto-renew turned off', 'success');
        this.load();
      },
      error: async (err) => {
        await this.presentToast(err?.error?.message || 'Could not cancel', 'danger');
      },
    });
  }

  private async presentToast(message: string, color: 'success' | 'danger'): Promise<void> {
    const toast = await this.toastCtrl.create({ message, duration: 2500, color, position: 'bottom' });
    await toast.present();
  }
}
