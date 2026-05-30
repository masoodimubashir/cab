import { Component, OnInit } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

declare const Razorpay: any;

interface Txn {
  id: number;
  type: string;
  amount: number;
  reason: string | null;
  created_at: string | null;
}

interface WalletResponse {
  balance: number;
  currency: string;
  transactions: Txn[];
}

interface TopupOrder {
  topup_id: number;
  razorpay: { key_id: string; order_id: string; amount_paise: number; currency: string };
}

/**
 * My Wallet — shows the driver's balance and recent activity, and lets them
 * top up via Razorpay. Top-up is a 2-step flow: ask the backend for an order,
 * open Razorpay Checkout, then verify the signature so the backend credits the
 * wallet.
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

  balance = 0;
  currency = 'INR';
  transactions: Txn[] = [];

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
  ) {}

  ngOnInit(): void { this.load(); }
  ionViewWillEnter(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.error = null;
    this.api.get<WalletResponse>('/drivers/me/wallet').subscribe({
      next: (res) => {
        this.balance = res.balance ?? 0;
        this.currency = res.currency || 'INR';
        this.transactions = res.transactions ?? [];
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load your wallet.';
        this.loading = false;
      },
    });
  }

  isCredit(t: Txn): boolean {
    return t.type !== 'debit';
  }

  txnLabel(t: Txn): string {
    if (t.reason) return t.reason;
    switch (t.type) {
      case 'credit': return 'Credit';
      case 'debit': return 'Debit';
      case 'cashback': return 'Cashback';
      case 'driver_added_cash': return 'Cash added';
      default: return t.type;
    }
  }

  txnDate(t: Txn): string {
    if (!t.created_at) return '';
    try {
      const d = new Date(t.created_at);
      return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}, ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch { return ''; }
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
