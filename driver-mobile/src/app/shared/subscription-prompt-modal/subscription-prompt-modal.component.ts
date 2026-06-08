import { Component, Input, OnInit } from '@angular/core';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { ApiService } from '../../core/api.service';
import { SubscriptionPlan } from '../plan-card/plan-card.component';

/**
 * App-open subscription prompt, rendered as a FULL-PAGE modal that mirrors the
 * Subscriptions screen (same green→navy hero, wallet pill, and plan cards) so
 * the driver can pick a plan right here. The headline + subtitle come from
 * Operator Settings → Subscription (title / description); the plans, wallet and
 * buy flow are the same as the Subscriptions page.
 */
@Component({
  selector: 'app-subscription-prompt-modal',
  templateUrl: './subscription-prompt-modal.component.html',
  styleUrls: ['./subscription-prompt-modal.component.scss'],
  standalone: false,
})
export class SubscriptionPromptModalComponent implements OnInit {
  @Input() title: string | null = null;
  @Input() desc: string | null = null;

  loading = false;
  buyingId: number | null = null;
  error: string | null = null;
  plans: SubscriptionPlan[] = [];
  wallet = 0;

  constructor(
    private api: ApiService,
    private modalCtrl: ModalController,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  /** Operator-set headline, falling back to the page's own copy. */
  get heroTitle(): string {
    return this.title?.trim() || 'Ride plans';
  }
  get heroSubtitle(): string {
    return this.desc?.trim() || 'Subscribe once and keep more of every fare — no per-ride commission.';
  }

  load(): void {
    this.loading = true;
    this.error = null;

    // Wallet (funds the plan + auto-renewals).
    this.api
      .get<{ subscription: unknown | null; wallet_balance: number; currency: string }>('/drivers/me/subscription')
      .subscribe({
        next: (res) => { this.wallet = res.wallet_balance ?? 0; },
        error: () => { /* wallet is non-critical for browsing */ },
      });

    this.api.get<{ data: SubscriptionPlan[] }>('/drivers/me/subscriptions/plans').subscribe({
      next: (res) => { this.plans = res.data ?? []; this.loading = false; },
      error: (err) => { this.error = err?.error?.message || 'Could not load plans.'; this.loading = false; },
    });
  }

  async confirmBuy(p: SubscriptionPlan): Promise<void> {
    const paid = p.amount > 0;
    const lead = paid
      ? `${p.title} — ₹${p.amount} will be debited from your wallet.`
      : `${p.title} — no upfront payment.`;
    const rate = p.commission_percent > 0
      ? `You'll pay ${p.commission_percent}% commission on each ride while active.`
      : 'Keep 100% of your fares while active.';
    const renew = paid
      ? 'It auto-renews from your wallet when it ends — you can cancel anytime.'
      : 'It renews automatically (no upfront charge) when it ends — you can cancel anytime.';

    const alert = await this.alertCtrl.create({
      header: 'Subscribe?',
      message: `${lead} ${rate} ${renew}`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Subscribe', handler: () => this.buy(p) },
      ],
    });
    await alert.present();
  }

  buy(p: SubscriptionPlan): void {
    if (this.buyingId) return;
    this.buyingId = p.id;
    this.api.post<{ message?: string; queued?: boolean }>('/drivers/me/subscriptions', { plan_id: p.id }).subscribe({
      next: async (res) => {
        this.buyingId = null;
        await this.presentToast(res?.message || 'Subscription activated', 'success');
        await this.modalCtrl.dismiss({ subscribed: true });
      },
      error: async (err) => {
        this.buyingId = null;
        await this.presentToast(err?.error?.message || 'Could not subscribe', 'danger');
      },
    });
  }

  close(): void {
    void this.modalCtrl.dismiss();
  }

  private async presentToast(message: string, color: 'success' | 'danger'): Promise<void> {
    const toast = await this.toastCtrl.create({ message, duration: 2500, color, position: 'bottom' });
    await toast.present();
  }
}
