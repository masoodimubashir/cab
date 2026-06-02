import { Component, OnInit } from '@angular/core';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { ApiService } from '../../core/api.service';
import { SubscriptionPlan } from '../plan-card/plan-card.component';

interface CurrentSub {
  id: number;
  title: string;
  subtitle: string | null;
  commission_percent: number;
}

/**
 * App-open subscription prompt. Shows the available plans (same card + design as
 * the Subscriptions page) in a modal the driver sees when they open the app, so
 * they can go commission-free in a couple of taps. Presented by the dashboard
 * once per app session.
 */
@Component({
  selector: 'app-subscriptions-modal',
  templateUrl: './subscriptions-modal.component.html',
  styleUrls: ['./subscriptions-modal.component.scss'],
  standalone: false,
})
export class SubscriptionsModalComponent implements OnInit {
  loading = false;
  error: string | null = null;
  plans: SubscriptionPlan[] = [];
  current: CurrentSub | null = null;
  wallet = 0;
  buyingId: number | null = null;

  constructor(
    private api: ApiService,
    private modalCtrl: ModalController,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;

    this.api.get<{ subscription: CurrentSub | null; wallet_balance: number }>('/drivers/me/subscription').subscribe({
      next: (res) => {
        this.current = res.subscription;
        this.wallet = res.wallet_balance ?? 0;
      },
      error: () => { /* non-fatal for the prompt */ },
    });

    this.api.get<{ data: SubscriptionPlan[] }>('/drivers/me/subscriptions/plans').subscribe({
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

  isCurrent(p: SubscriptionPlan): boolean {
    return !!this.current && this.current.title === p.title;
  }

  async onSubscribe(p: SubscriptionPlan): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Subscribe?',
      message: `${p.title} — ₹${p.amount} will be debited from your wallet. ${
        p.commission_percent > 0
          ? `Commission while active: ${p.commission_percent}%.`
          : 'Keep 100% of your fares while active.'
      }`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Subscribe', handler: () => this.buy(p) },
      ],
    });
    await alert.present();
  }

  private buy(p: SubscriptionPlan): void {
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

  /** Dismiss and tell the dashboard to open the full Subscriptions page. */
  seeAll(): void {
    void this.modalCtrl.dismiss({ navigate: '/subscriptions' });
  }

  close(): void {
    void this.modalCtrl.dismiss();
  }

  private async presentToast(message: string, color: 'success' | 'danger'): Promise<void> {
    const toast = await this.toastCtrl.create({ message, duration: 2500, color, position: 'bottom' });
    await toast.present();
  }
}
