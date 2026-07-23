import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { WalletActivityModalComponent } from './wallet-activity.modal';

declare const Razorpay: any;

interface EarningsSummary {
  total_earnings: number;
  total_commission: number;
  net_earnings: number;
  topup_total: number;
  wallet_balance: number;
  currency: string;
  caps: { min: number; max: number };
  subscription_active: boolean;
}

interface TopupOrder {
  topup_id: number;
  razorpay: { key_id: string; order_id: string; amount_paise: number; currency: string };
}

/**
 * Earnings & Wallet — one screen that reconciles the two so the numbers never
 * look inconsistent. It shows, top-down:
 *   • Wallet balance (the real money you hold) + top-up.
 *   • A plain-language summary: gross earnings, commission taken, net, top-ups.
 *   • Links out to the ride-by-ride breakdown and the full wallet ledger — the
 *     detail lives there, so this page stays clean.
 *
 * All the numbers come from /drivers/me/earnings, which uses the SAME wallet
 * balance formula as the ledger, so the two can't disagree.
 */
@Component({
  selector: 'app-wallet',
  templateUrl: './wallet.page.html',
  styleUrls: ['./wallet.page.scss'],
  standalone: false,
})
export class WalletPage implements OnInit {
  loading = false;
  error: string | null = null;
  toppingUp = false;

  currency = 'INR';
  balance = 0;
  totalEarnings = 0;
  totalCommission = 0;
  netEarnings = 0;
  topupTotal = 0;
  caps: { min: number; max: number } = { min: 0, max: 0 };
  subscriptionActive = false;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private router: Router,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
    private modalCtrl: ModalController,
  ) {}

  ngOnInit(): void { this.load(); }
  ionViewWillEnter(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.error = null;
    this.api.get<EarningsSummary>('/drivers/me/earnings').subscribe({
      next: (res) => {
        this.balance = res.wallet_balance ?? 0;
        this.totalEarnings = res.total_earnings ?? 0;
        this.totalCommission = res.total_commission ?? 0;
        this.netEarnings = res.net_earnings ?? 0;
        this.topupTotal = res.topup_total ?? 0;
        this.caps = res.caps ?? { min: 0, max: 0 };
        this.subscriptionActive = !!res.subscription_active;
        this.currency = res.currency || 'INR';
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load your wallet.';
        this.loading = false;
      },
    });
  }

  openRideBreakdown(): void {
    void this.router.navigateByUrl('/tabs/earnings');
  }

  async openActivity(): Promise<void> {
    const modal = await this.modalCtrl.create({ component: WalletActivityModalComponent });
    await modal.present();
  }

  async explainLimits(): Promise<void> {
    const max = this.caps.max > 0 ? `₹${this.caps.max}` : 'no upper limit';
    const min = `₹${this.caps.min}`;
    const sub = this.subscriptionActive
      ? '\n\nYou have an active subscription, so eligible rides are commission-free.'
      : '';
    const alert = await this.alertCtrl.create({
      header: 'How your wallet works',
      message:
        `Ride commission is taken from this wallet, and subscriptions (if you buy one) are paid from it too.\n\n` +
        `• Maximum balance: ${max}\n` +
        `• Minimum balance: ${min}` +
        sub,
      buttons: ['Got it'],
    });
    await alert.present();
  }

  async promptTopUp(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Top up wallet',
      message: 'Enter the amount to add to your wallet.',
      inputs: [
        { name: 'amount', type: 'number', placeholder: 'Amount (₹)', min: 1 },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Continue',
          handler: (val) => {
            const amount = Math.round(Number(val?.amount) * 100) / 100;
            if (!amount || amount < 1) {
              void this.presentToast('Enter a valid amount.', 'danger');
              return false;
            }
            void this.startTopUp(amount);
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  private async startTopUp(amount: number): Promise<void> {
    if (typeof Razorpay === 'undefined') {
      await this.presentToast('Payment library not loaded. Check your connection.', 'danger');
      return;
    }
    if (this.toppingUp) return;
    this.toppingUp = true;

    let order: TopupOrder;
    try {
      order = (await this.api
        .post<TopupOrder>('/drivers/me/wallet/topup/razorpay', { amount })
        .toPromise()) as TopupOrder;
    } catch (e: any) {
      this.toppingUp = false;
      await this.presentToast(e?.error?.message || 'Could not start top-up.', 'danger');
      return;
    }

    const user = this.auth.getUser();
    const rzp = new Razorpay({
      key: order.razorpay.key_id,
      order_id: order.razorpay.order_id,
      amount: order.razorpay.amount_paise,
      currency: order.razorpay.currency,
      name: 'DreamCabs',
      description: 'Wallet top-up',
      prefill: {
        name: user?.name || '',
        email: user?.email || '',
        contact: user?.phone || '',
      },
      theme: { color: '#3880ff' },
      handler: (resp: {
        razorpay_payment_id: string;
        razorpay_order_id: string;
        razorpay_signature: string;
      }) => {
        this.verifyTopUp(resp);
      },
      modal: {
        ondismiss: async () => {
          this.toppingUp = false;
          await this.presentToast('Top-up cancelled.', 'warning');
        },
      },
    });

    rzp.on('payment.failed', async (resp: any) => {
      this.toppingUp = false;
      await this.presentToast(resp?.error?.description || 'Payment failed.', 'danger');
    });

    rzp.open();
  }

  private async verifyTopUp(resp: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }): Promise<void> {
    try {
      await this.api.post('/drivers/me/wallet/topup/razorpay/verify', resp).toPromise();
      this.toppingUp = false;
      await this.presentToast('Wallet topped up.', 'success');
      this.load();
    } catch (e: any) {
      this.toppingUp = false;
      await this.presentToast(e?.error?.message || 'Top-up verification failed.', 'danger');
    }
  }

  private async presentToast(message: string, color: 'success' | 'danger' | 'warning'): Promise<void> {
    const toast = await this.toastCtrl.create({ message, duration: 2500, color, position: 'bottom' });
    await toast.present();
  }
}
