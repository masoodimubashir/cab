import { Component, OnInit } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

declare const Razorpay: any;

interface Position {
  earnings: number;
  commission: number;
  deposits: number;
  paid_out: number;
  balance: number;
  net: number;
  owed_by_company: number;
  owed_by_driver: number;
}

interface Reconciliation {
  earnings: number;
  commission: number;
  deposits: number;
  paid_out: number;
  balance: number;
  settlements_recorded: number;
  settlements_count: number;
  drift: number;
  balanced: boolean;
}

interface SettlementRow {
  id: number;
  owed_by_company: number;
  owed_by_driver: number;
  net: number;
  amount_paid: number;
  method: string | null;
  reference: string | null;
  created_at: string | null;
}

interface SettlementResponse {
  position: Position;
  reconciliation: Reconciliation;
  history: SettlementRow[];
  currency: string;
}

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

interface EarningsSummary {
  caps: { min: number; max: number };
  subscription_active: boolean;
}

interface TopupOrder {
  topup_id: number;
  razorpay: { key_id: string; order_id: string; amount_paise: number; currency: string };
}

type Segment = 'owed' | 'settlements' | 'ledger' | 'check';
type LedgerFilter = 'all' | 'credit' | 'debit';

/**
 * Wallet — the driver's Model B settlement hub. Four segments answer four
 * questions:
 *   • Owed        — how much the operator owes me right now (or I owe), + top-up.
 *   • Settlements — every payout I've been paid, newest first.
 *   • Ledger      — every wallet movement (earnings, commission, deposits, payouts).
 *   • Check       — proof the numbers reconcile (no drift between the wallet and
 *                   the settlement records).
 *
 * Reads /drivers/me/settlement (position + reconciliation + history) and
 * /drivers/me/wallet (the transaction ledger). Earnings performance/charts live
 * on the separate Earnings screen — this one is about the money itself.
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

  segment: Segment = 'owed';
  ledgerFilter: LedgerFilter = 'all';

  currency = 'INR';
  position: Position | null = null;
  reconciliation: Reconciliation | null = null;
  settlements: SettlementRow[] = [];
  transactions: Txn[] = [];
  caps: { min: number; max: number } = { min: 0, max: 0 };
  subscriptionActive = false;

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
    forkJoin({
      settlement: this.api.get<SettlementResponse>('/drivers/me/settlement'),
      wallet: this.api.get<WalletResponse>('/drivers/me/wallet'),
      earnings: this.api.get<EarningsSummary>('/drivers/me/earnings'),
    }).subscribe({
      next: ({ settlement, wallet, earnings }) => {
        this.position = settlement.position;
        this.reconciliation = settlement.reconciliation;
        this.settlements = settlement.history ?? [];
        this.transactions = wallet.transactions ?? [];
        this.caps = earnings.caps ?? { min: 0, max: 0 };
        this.subscriptionActive = !!earnings.subscription_active;
        this.currency = settlement.currency || 'INR';
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load your wallet.';
        this.loading = false;
      },
    });
  }

  setSegment(value: unknown): void {
    this.segment = (value as Segment) || 'owed';
  }

  // ── Owed ──
  get owed(): number { return this.position?.owed_by_company ?? 0; }
  get owes(): number { return this.position?.owed_by_driver ?? 0; }
  get inDebt(): boolean { return (this.position?.net ?? 0) < 0; }

  get lastSettlement(): SettlementRow | null {
    return this.settlements.length ? this.settlements[0] : null;
  }

  // ── Ledger ──
  get ledger(): Txn[] {
    if (this.ledgerFilter === 'all') return this.transactions;
    if (this.ledgerFilter === 'debit') return this.transactions.filter((t) => t.type === 'debit');
    return this.transactions.filter((t) => t.type !== 'debit');
  }

  isCredit(t: Txn): boolean { return t.type !== 'debit'; }

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

  methodLabel(m: string | null): string {
    switch (m) {
      case 'gpay': return 'GPay';
      case 'bank': return 'Bank transfer';
      case 'cash': return 'Cash';
      case 'other': return 'Other';
      default: return m || '—';
    }
  }

  fmtDate(iso: string | null): string {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}, ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch { return ''; }
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
        `Your online ride earnings are credited here and your cash-ride commission is debited here. ` +
        `The operator pays out what you're owed.\n\n` +
        `• Maximum balance: ${max}\n` +
        `• Debt allowed before you're blocked from going online: ${min}` +
        sub,
      buttons: ['Got it'],
    });
    await alert.present();
  }

  // ── Top-up (unchanged) ──
  async promptTopUp(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Top up wallet',
      message: 'Add your own money to clear commission owed and keep driving.',
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
