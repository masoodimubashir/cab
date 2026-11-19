import { Component } from '@angular/core';
import { NavController, ToastController } from '@ionic/angular';
import { CarpoolApiService } from '../carpool-api.service';
import { CarpoolPaymentResult, CarpoolPlan, CarpoolPlanState, CarpoolUpiOrder } from '../carpool.models';

/**
 * Carpool Plans: time-based, no commission, UPI only, no auto-renew
 * (Carpool.md P4). Opened from Profile and the Home plan banner, or from the
 * approved status page while carpool is still closed.
 */
@Component({
  selector: 'app-carpool-plans',
  templateUrl: './carpool-plans.page.html',
  styleUrls: ['./carpool-signup.page.scss'],
  standalone: false,
})
export class CarpoolPlansPage {
  loading = true;
  error: string | null = null;
  plans: CarpoolPlan[] = [];
  state: CarpoolPlanState | null = null;
  buyingId: number | null = null;

  constructor(
    private carpool: CarpoolApiService,
    private toast: ToastController,
    private nav: NavController,
  ) {}

  ionViewWillEnter(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.carpool.planState().subscribe({
      next: (s) => (this.state = s),
      error: () => (this.state = null),
    });
    this.carpool.plans().subscribe({
      next: (p) => {
        this.plans = p;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.error = 'Could not load plans. Check your connection and pull down to try again.';
      },
    });
  }

  /** A second plan can be bought while one runs, unless one is already waiting. */
  get canBuy(): boolean {
    return !this.state?.next_plan;
  }

  daysLabel(days: number): string {
    return days === 1 ? '1 day' : `${days} days`;
  }

  fmt(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
  }

  buy(plan: CarpoolPlan): void {
    if (this.buyingId || !this.canBuy) return;
    this.buyingId = plan.id;
    this.carpool.createPlanOrder(plan.id).subscribe({
      next: (order) => this.openCheckout(order, plan),
      error: (err) => this.fail(err, 'Could not start the payment.'),
    });
  }

  private openCheckout(order: CarpoolUpiOrder, plan: CarpoolPlan): void {
    const Razorpay = (window as any).Razorpay;
    if (!Razorpay) {
      this.fail(null, 'Payment is not available right now. Please try again.');
      return;
    }
    new Razorpay({
      key: order.key_id,
      amount: order.amount_paise,
      currency: order.currency || 'INR',
      name: 'Dream Cabs',
      description: `Carpool plan: ${plan.title}`,
      order_id: order.order_id,
      method: { upi: true, card: false, netbanking: false, wallet: false, emi: false, paylater: false },
      handler: (res: CarpoolPaymentResult) => this.verify(plan, res),
      modal: { ondismiss: () => (this.buyingId = null) },
      theme: { color: '#00C06A' },
    }).open();
  }

  private verify(plan: CarpoolPlan, res: CarpoolPaymentResult): void {
    this.carpool
      .verifyPlanPayment(plan.id, {
        razorpay_order_id: res.razorpay_order_id,
        razorpay_payment_id: res.razorpay_payment_id,
        razorpay_signature: res.razorpay_signature,
      })
      .subscribe({
        next: (r) => {
          this.buyingId = null;
          void this.say(r.message, 'success');
          this.load();
        },
        error: (err) => this.fail(err, 'We could not confirm your payment. If money was taken, contact support.'),
      });
  }

  back(): void {
    this.carpool.config().subscribe((c) => void this.nav.navigateBack(c.enabled ? '/carpool/profile' : '/carpool-signup/status'));
  }

  private fail(err: any, fallback: string): void {
    this.buyingId = null;
    const msg = err?.error?.errors?.plan?.[0] || err?.error?.message;
    void this.say(msg || fallback, 'danger');
  }

  private async say(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toast.create({ message, duration: 3000, color, position: 'bottom' });
    await t.present();
  }
}
