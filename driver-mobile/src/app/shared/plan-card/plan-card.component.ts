import { Component, EventEmitter, Input, Output } from '@angular/core';

/** Shared shape for a buyable subscription plan (from /drivers/me/subscriptions/plans). */
export interface SubscriptionPlan {
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

interface PlanFeature {
  icon: string;
  text: string;
}

/**
 * Premium, information-dense subscription plan card. Shared by the Subscriptions
 * page and the app-open subscription modal so both stay identical.
 *
 * Everything beyond the raw price is DERIVED from the existing plan fields
 * (no new backend data): the validity/period, what the driver keeps, the
 * effective per-ride / per-day cost, a benefits checklist, and whether the
 * driver's wallet covers the purchase.
 */
@Component({
  selector: 'app-plan-card',
  templateUrl: './plan-card.component.html',
  styleUrls: ['./plan-card.component.scss'],
  standalone: false,
})
export class PlanCardComponent {
  @Input() plan!: SubscriptionPlan;
  @Input() buying = false;
  @Input() walletBalance = 0;
  @Input() isCurrent = false;
  @Output() subscribe = new EventEmitter<SubscriptionPlan>();

  showTerms = false;

  get commissionFree(): boolean {
    return this.plan.commission_percent === 0;
  }

  /** Headline value: the % of each fare the driver keeps while subscribed. */
  get keepPercent(): number {
    const c = this.plan.commission_percent;
    return c > 0 ? Math.max(0, 100 - c) : 100;
  }

  /** Subtitle is never blank — fall back to a meter-derived description. */
  get displaySubtitle(): string {
    if (this.plan.subtitle) return this.plan.subtitle;
    switch (this.plan.meter_type) {
      case 'rides': return this.plan.rides_count ? `${this.plan.rides_count}-ride plan` : 'Ride pack';
      case 'days': return this.plan.days_count ? `${this.plan.days_count}-day plan` : 'Time plan';
      case 'daily': return 'Daily plan';
      case 'earnings': return 'Pay-as-you-earn plan';
      default: return 'Subscription plan';
    }
  }

  /** Friendly wallet line that also shows the balance left after buying. */
  get walletLine(): string {
    if (this.walletCovers) {
      return `Wallet covers it · ₹${this.fmt(this.walletBalance - this.plan.amount)} left after`;
    }
    return `Add ₹${this.fmt(this.shortfall)} to your wallet`;
  }

  private fmt(n: number): string {
    return Math.round(n).toLocaleString('en-IN');
  }

  /** "for 30 days" / "for 50 rides" / "for 1 day" / "until you earn ₹X". */
  get periodLabel(): string {
    const p = this.plan;
    switch (p.meter_type) {
      case 'rides': return p.rides_count ? `for ${p.rides_count} rides` : 'per pack';
      case 'days': return p.days_count ? `for ${p.days_count} days` : 'per pack';
      case 'daily': return 'for 1 day';
      case 'earnings': return p.earnings_threshold != null ? `until you earn ₹${p.earnings_threshold}` : '';
      default: return '';
    }
  }

  /** Effective unit cost where it makes sense (rides / days plans). */
  get effectiveCost(): string | null {
    const p = this.plan;
    if (p.meter_type === 'rides' && p.rides_count && p.rides_count > 0) {
      return `≈ ₹${Math.round(p.amount / p.rides_count)} per ride`;
    }
    if (p.meter_type === 'days' && p.days_count && p.days_count > 0) {
      return `≈ ₹${Math.round(p.amount / p.days_count)} per day`;
    }
    return null;
  }

  /** Benefits checklist derived from the plan. */
  get features(): PlanFeature[] {
    const p = this.plan;
    const list: PlanFeature[] = [];

    list.push({
      icon: 'cash-outline',
      text: this.commissionFree ? 'Keep 100% of your fares' : `Pay only ${p.commission_percent}% commission`,
    });

    let validity = '';
    if (p.meter_type === 'rides') validity = p.rides_count ? `Valid for ${p.rides_count} rides` : 'Valid for the included rides';
    else if (p.meter_type === 'days') validity = p.days_count ? `Valid for ${p.days_count} days` : 'Time-limited plan';
    else if (p.meter_type === 'daily') validity = 'Valid for 1 day';
    else if (p.meter_type === 'earnings') validity = p.earnings_threshold != null ? `Active until you earn ₹${this.fmt(p.earnings_threshold)}` : 'Pay as you earn';
    if (validity) list.push({ icon: 'time-outline', text: validity });

    list.push({
      icon: 'car-outline',
      text: p.vehicle_type_name ? `For ${p.vehicle_type_name}` : 'Works on all your vehicles',
    });

    const perk = this.planPerk(p.plan_type);
    if (perk) list.push({ icon: 'gift-outline', text: perk });
    else list.push({ icon: 'flash-outline', text: 'Activates instantly from your wallet' });

    return list;
  }

  /** Optional perk label derived from plan_type — never fabricated. */
  private planPerk(type: string | null | undefined): string | null {
    switch ((type || '').toLowerCase()) {
      case 'new_registration': return 'New-driver welcome offer';
      case 'renewal': return 'Renewal price';
      case 'targeted': return 'Special offer for you';
      default: return null;
    }
  }

  get walletCovers(): boolean {
    return this.walletBalance >= this.plan.amount;
  }
  get shortfall(): number {
    return Math.max(0, this.plan.amount - this.walletBalance);
  }

  onSubscribe(): void {
    if (this.buying || this.isCurrent) return;
    this.subscribe.emit(this.plan);
  }
}
