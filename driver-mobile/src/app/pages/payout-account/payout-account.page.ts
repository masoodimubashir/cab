import { Component, OnInit } from '@angular/core';
import { ToastController } from '@ionic/angular';
import { ApiService } from '../../core/api.service';

type PayoutStatus = 'none' | 'pending' | 'verified' | 'rejected';
type PayoutMethod = 'bank' | 'upi';

interface PayoutAccount {
  status: PayoutStatus;
  method: PayoutMethod | null;
  beneficiary_name: string | null;
  bank_last4: string | null;
  ifsc: string | null;
  upi: string | null;
  pan_last4: string | null;
  verified_at: string | null;
  reject_reason: string | null;
  can_receive_payouts: boolean;
}

/**
 * The driver's payout account ("driver KYC"). Collects PAN + a settlement
 * destination (bank account or UPI) so Razorpay Route can pay the driver their
 * share automatically. Until this is verified, ride earnings are held.
 *
 * Replaces the old cash/Razorpay toggle page as the thing a driver actually
 * needs to do to get paid. Reachable any time from the More menu, and the same
 * form is shown as a skippable step at signup.
 */
@Component({
  selector: 'app-payout-account',
  templateUrl: './payout-account.page.html',
  styleUrls: ['./payout-account.page.scss'],
  standalone: false,
})
export class PayoutAccountPage implements OnInit {
  loading = true;
  saving = false;

  account: PayoutAccount | null = null;

  /** Form model. Shown when there's no verified account (or the driver edits). */
  editing = false;
  method: PayoutMethod = 'bank';
  pan = '';
  beneficiaryName = '';
  accountNumber = '';
  ifsc = '';
  upi = '';

  constructor(
    private api: ApiService,
    private toastCtrl: ToastController,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.api.get<PayoutAccount>('/me/driver/payout-account').subscribe({
      next: (res) => {
        this.account = res;
        this.loading = false;
        // First-time or rejected drivers land straight on the form.
        this.editing = res.status === 'none' || res.status === 'rejected';
        if (res.method) this.method = res.method;
        this.beneficiaryName = res.beneficiary_name ?? '';
        this.ifsc = res.ifsc ?? '';
        this.upi = res.upi ?? '';
      },
      error: () => {
        this.loading = false;
      },
    });
  }

  startEdit(): void {
    // Never prefill the sensitive raw values — the driver re-enters them.
    this.pan = '';
    this.accountNumber = '';
    this.editing = true;
  }

  get canSubmit(): boolean {
    if (!/^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/.test(this.pan.trim())) return false;
    if (this.method === 'bank') {
      return (
        this.beneficiaryName.trim().length > 1 &&
        /^[0-9]{6,20}$/.test(this.accountNumber.trim()) &&
        /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(this.ifsc.trim())
      );
    }
    return /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/.test(this.upi.trim());
  }

  async submit(): Promise<void> {
    if (!this.canSubmit || this.saving) return;
    this.saving = true;

    const body: Record<string, string> = {
      method: this.method,
      pan: this.pan.trim().toUpperCase(),
    };
    if (this.method === 'bank') {
      body['beneficiary_name'] = this.beneficiaryName.trim();
      body['account_number'] = this.accountNumber.trim();
      body['ifsc'] = this.ifsc.trim().toUpperCase();
    } else {
      body['upi'] = this.upi.trim().toLowerCase();
    }

    this.api.patch<PayoutAccount>('/me/driver/payout-account', body).subscribe({
      next: async (res) => {
        this.account = res;
        this.editing = false;
        this.saving = false;
        const t = await this.toastCtrl.create({
          message: 'Payout details submitted. Verification is usually quick.',
          duration: 2600,
          color: 'success',
        });
        await t.present();
      },
      error: async (e: any) => {
        this.saving = false;
        const t = await this.toastCtrl.create({
          message: e?.error?.message || 'Could not save your payout details.',
          duration: 2800,
          color: 'danger',
        });
        await t.present();
      },
    });
  }
}
