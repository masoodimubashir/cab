import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';

export interface PlanData {
  id: number;
  title: string;
  subtitle?: string | null;
  amount: number;
  commission_percent: number;
  pricing_model?: string;
  meter_type: string;
  rides_count?: number | null;
  days_count?: number | null;
  earnings_threshold?: number | null;
  terms?: string | null;
}

@Component({
  selector: 'app-subscription-checkout-modal',
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar class="chk-toolbar">
        <ion-title class="chk-title">Review &amp; Subscribe</ion-title>
        <ion-buttons slot="end">
          <button type="button" class="chk-close-btn dc-press" (click)="dismiss()" aria-label="Close">
            <ion-icon name="close-outline"></ion-icon>
          </button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="chk-content">
      <div class="chk-body">

        <!-- Plan Hero Card -->
        <div class="chk-plan-card" [class.is-free]="commissionFree">
          <div class="chk-plan-card__top">
            <span class="chk-badge" [class.chk-badge--free]="commissionFree">
              <ion-icon [name]="commissionFree ? 'sparkles' : 'shield-checkmark'"></ion-icon>
              {{ commissionFree ? '0% Commission (Zero Fee)' : (plan.commission_percent + '% Low Commission') }}
            </span>
            <span class="chk-model-tag">{{ modelLabel }}</span>
          </div>

          <h2 class="chk-plan-title">{{ plan.title }}</h2>
          <p class="chk-plan-sub" *ngIf="plan.subtitle">{{ plan.subtitle }}</p>

          <div class="chk-price-row">
            <div class="chk-price-box">
              <span class="chk-price-val">{{ priceText }}</span>
              <span class="chk-price-period">/ {{ periodLabel }}</span>
            </div>
            <div class="chk-keep-box">
              <strong>{{ keepPercent }}%</strong>
              <small>You keep</small>
            </div>
          </div>
        </div>

        <!-- Plan Highlights & Inclusions -->
        <div class="chk-card">
          <h3 class="chk-sec-title">
            <ion-icon name="list-outline"></ion-icon> Plan Benefits &amp; Terms
          </h3>

          <div class="chk-benefit-list">
            <div class="chk-benefit-item">
              <div class="chk-benefit-icon"><ion-icon name="time-outline"></ion-icon></div>
              <div class="chk-benefit-text">
                <strong>{{ validityLabel }}</strong>
                <span>Starts immediately upon activation</span>
              </div>
            </div>

            <div class="chk-benefit-item">
              <div class="chk-benefit-icon"><ion-icon name="wallet-outline"></ion-icon></div>
              <div class="chk-benefit-text">
                <strong>{{ rateLabel }}</strong>
                <span>No hidden deductions on your rides</span>
              </div>
            </div>

            <div class="chk-benefit-item">
              <div class="chk-benefit-icon"><ion-icon name="sync-outline"></ion-icon></div>
              <div class="chk-benefit-text">
                <strong>Auto-renews from wallet</strong>
                <span>Renews only if balance stays above minimum limit. Cancel anytime.</span>
              </div>
            </div>

            <div class="chk-benefit-item">
              <div class="chk-benefit-icon"><ion-icon name="mail-outline"></ion-icon></div>
              <div class="chk-benefit-text">
                <strong>Instant Tax Invoice</strong>
                <span>Receipt sent directly to your registered email</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Payment Method Selection -->
        <div class="chk-card" *ngIf="hasUpfront">
          <h3 class="chk-sec-title">
            <ion-icon name="card-outline"></ion-icon> Select Payment Method
          </h3>

          <div class="chk-pay-options">
            <!-- Option 1: Wallet Balance -->
            <label
              class="chk-pay-opt dc-press"
              [class.is-selected]="paymentMethod === 'wallet'"
              [class.is-disabled]="!walletCovers"
              (click)="selectMethod('wallet')"
            >
              <div class="chk-pay-opt__radio">
                <span class="chk-radio-dot" *ngIf="paymentMethod === 'wallet'"></span>
              </div>
              <div class="chk-pay-opt__icon chk-pay-opt__icon--wallet">
                <ion-icon name="wallet"></ion-icon>
              </div>
              <div class="chk-pay-opt__info">
                <div class="chk-pay-opt__head">
                  <strong>Wallet Balance</strong>
                  <span class="chk-pay-opt__bal" [class.chk-pay-opt__bal--low]="!walletCovers">
                    ₹{{ walletBalance | number: '1.0-2' }}
                  </span>
                </div>
                <span class="chk-pay-opt__sub" *ngIf="walletCovers">Instant deduction from your wallet</span>
                <span class="chk-pay-opt__sub chk-pay-opt__sub--warn" *ngIf="!walletCovers">
                  Low balance. Top up or select UPI below.
                </span>
              </div>
            </label>

            <!-- Option 2: UPI / Online Payment -->
            <label
              class="chk-pay-opt dc-press"
              [class.is-selected]="paymentMethod === 'upi'"
              (click)="selectMethod('upi')"
            >
              <div class="chk-pay-opt__radio">
                <span class="chk-radio-dot" *ngIf="paymentMethod === 'upi'"></span>
              </div>
              <div class="chk-pay-opt__icon chk-pay-opt__icon--upi">
                <ion-icon name="flash"></ion-icon>
              </div>
              <div class="chk-pay-opt__info">
                <div class="chk-pay-opt__head">
                  <strong>UPI / Online (Razorpay)</strong>
                  <span class="chk-pay-opt__tag">Instant</span>
                </div>
                <span class="chk-pay-opt__sub">GPay, PhonePe, Paytm, Cards &amp; NetBanking</span>
              </div>
            </label>
          </div>
        </div>

        <!-- Price Summary Breakdown -->
        <div class="chk-card chk-summary-card">
          <div class="chk-sum-row">
            <span>Subscription Plan Fee</span>
            <span>{{ priceText }}</span>
          </div>
          <div class="chk-sum-row" *ngIf="hasUpfront">
            <span>Per-Ride Commission</span>
            <span class="chk-sum-val--green">{{ plan.commission_percent > 0 ? plan.commission_percent + '%' : '0% (Free)' }}</span>
          </div>
          <div class="chk-sum-row chk-sum-row--total">
            <strong>Total Amount</strong>
            <strong class="chk-sum-total">{{ priceText }}</strong>
          </div>
        </div>

        <!-- Action CTA Buttons -->
        <div class="chk-actions">
          <button
            type="button"
            class="chk-cta-btn dc-press"
            [disabled]="processing || (hasUpfront && paymentMethod === 'wallet' && !walletCovers)"
            (click)="confirm()"
          >
            <ion-spinner *ngIf="processing" name="crescent"></ion-spinner>
            <span *ngIf="!processing">
              {{ hasUpfront ? ('Pay ' + priceText + ' & Subscribe') : 'Activate Free Plan' }}
            </span>
          </button>

          <button type="button" class="chk-cancel-btn dc-press" [disabled]="processing" (click)="dismiss()">
            Cancel
          </button>
        </div>

      </div>
    </ion-content>
  `,
  styles: [`
    .chk-toolbar {
      --background: #0D1B2A;
      --color: #ffffff;
      padding: 6px 8px;
    }
    .chk-title {
      font-size: 1.05rem;
      font-weight: 700;
      color: #ffffff;
      text-align: left;
    }
    .chk-close-btn {
      background: rgba(255, 255, 255, 0.12);
      border: none;
      color: #ffffff;
      border-radius: 50%;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.2rem;
      margin-right: 6px;
    }
    .chk-content {
      --background: #F4F6F8;
    }
    .chk-body {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding-bottom: 28px;
    }
    .chk-plan-card {
      background: linear-gradient(135deg, #0D1B2A 0%, #172A3A 100%);
      color: #ffffff;
      border-radius: 18px;
      padding: 18px;
      box-shadow: 0 8px 24px rgba(13, 27, 42, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.08);

      &.is-free {
        background: linear-gradient(135deg, #064E3B 0%, #0D1B2A 100%);
      }
      &__top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 10px;
      }
    }
    .chk-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 0.76rem;
      font-weight: 700;
      padding: 4px 9px;
      border-radius: 999px;
      background: rgba(18, 179, 91, 0.2);
      color: #34D399;
      border: 1px solid rgba(18, 179, 91, 0.35);

      &--free {
        background: rgba(16, 185, 129, 0.25);
        color: #6EE7B7;
      }
    }
    .chk-model-tag {
      font-size: 0.74rem;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.65);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .chk-plan-title {
      font-size: 1.25rem;
      font-weight: 800;
      color: #ffffff;
      margin: 0 0 4px;
    }
    .chk-plan-sub {
      font-size: 0.84rem;
      color: rgba(255, 255, 255, 0.7);
      margin: 0 0 14px;
    }
    .chk-price-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-top: 1px solid rgba(255, 255, 255, 0.12);
      padding-top: 12px;
      margin-top: 8px;
    }
    .chk-price-box {
      display: flex;
      align-items: baseline;
      gap: 5px;
    }
    .chk-price-val {
      font-size: 1.6rem;
      font-weight: 800;
      color: #ffffff;
      font-variant-numeric: tabular-nums;
    }
    .chk-price-period {
      font-size: 0.86rem;
      color: rgba(255, 255, 255, 0.7);
      font-weight: 600;
    }
    .chk-keep-box {
      text-align: right;
      strong {
        display: block;
        font-size: 1.15rem;
        font-weight: 800;
        color: #34D399;
      }
      small {
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.6);
        text-transform: uppercase;
        font-weight: 600;
      }
    }
    .chk-card {
      background: #ffffff;
      border-radius: 16px;
      padding: 16px;
      box-shadow: 0 2px 10px rgba(13, 27, 42, 0.05);
      border: 1px solid #E5E7EB;
    }
    .chk-sec-title {
      font-size: 0.92rem;
      font-weight: 700;
      color: #111827;
      margin: 0 0 12px;
      display: flex;
      align-items: center;
      gap: 7px;
      ion-icon { color: #10B981; font-size: 1.1rem; }
    }
    .chk-benefit-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .chk-benefit-item {
      display: flex;
      align-items: flex-start;
      gap: 11px;
    }
    .chk-benefit-icon {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: rgba(16, 185, 129, 0.1);
      color: #10B981;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.95rem;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .chk-benefit-text {
      display: flex;
      flex-direction: column;
      strong {
        font-size: 0.86rem;
        font-weight: 700;
        color: #1F2937;
      }
      span {
        font-size: 0.78rem;
        color: #6B7280;
        line-height: 1.35;
        margin-top: 1px;
      }
    }
    .chk-pay-options {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .chk-pay-opt {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 14px;
      border: 2px solid #E5E7EB;
      background: #F9FAFB;
      cursor: pointer;
      transition: all 0.15s ease-in-out;

      &.is-selected {
        border-color: #10B981;
        background: rgba(16, 185, 129, 0.05);
      }
      &.is-disabled {
        opacity: 0.65;
      }
      &__radio {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: 2px solid #9CA3AF;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      &.is-selected &__radio {
        border-color: #10B981;
      }
      &__icon {
        width: 36px;
        height: 36px;
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.2rem;
        flex-shrink: 0;

        &--wallet {
          background: rgba(16, 185, 129, 0.12);
          color: #10B981;
        }
        &--upi {
          background: rgba(59, 130, 246, 0.12);
          color: #3B82F6;
        }
      }
      &__info {
        flex: 1;
        display: flex;
        flex-direction: column;
      }
      &__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        strong {
          font-size: 0.9rem;
          font-weight: 700;
          color: #111827;
        }
      }
      &__bal {
        font-size: 0.86rem;
        font-weight: 800;
        color: #10B981;
        &--low { color: #EF4444; }
      }
      &__tag {
        font-size: 0.72rem;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 6px;
        background: rgba(59, 130, 246, 0.1);
        color: #2563EB;
      }
      &__sub {
        font-size: 0.76rem;
        color: #6B7280;
        margin-top: 2px;
        &--warn { color: #DC2626; font-weight: 600; }
      }
    }
    .chk-radio-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #10B981;
    }
    .chk-summary-card {
      padding: 14px 16px;
    }
    .chk-sum-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.85rem;
      color: #6B7280;
      margin-bottom: 6px;

      &--total {
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px dashed #D1D5DB;
        color: #111827;
        font-size: 0.95rem;
      }
    }
    .chk-sum-val--green {
      color: #10B981;
      font-weight: 700;
    }
    .chk-sum-total {
      font-size: 1.25rem;
      font-weight: 800;
      color: #111827;
    }
    .chk-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 4px;
    }
    .chk-cta-btn {
      width: 100%;
      height: 50px;
      border-radius: 14px;
      background: #10B981;
      color: #ffffff;
      font-size: 1rem;
      font-weight: 800;
      border: none;
      box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;

      &:disabled {
        opacity: 0.55;
        box-shadow: none;
      }
    }
    .chk-cancel-btn {
      width: 100%;
      height: 42px;
      border-radius: 12px;
      background: transparent;
      color: #6B7280;
      font-size: 0.88rem;
      font-weight: 700;
      border: none;
      cursor: pointer;
    }
  `],
})
export class SubscriptionCheckoutModalComponent implements OnInit {
  @Input() plan!: PlanData;
  @Input() walletBalance: number = 0;

  paymentMethod: 'wallet' | 'upi' = 'wallet';
  processing = false;

  constructor(private modalCtrl: ModalController) {}

  ngOnInit(): void {
    if (this.hasUpfront && !this.walletCovers) {
      this.paymentMethod = 'upi';
    }
  }

  get hasUpfront(): boolean {
    return (this.plan?.amount || 0) > 0;
  }

  get commissionFree(): boolean {
    return (this.plan?.commission_percent || 0) <= 0;
  }

  get keepPercent(): number {
    const comm = this.plan?.commission_percent || 0;
    return Math.max(0, 100 - comm);
  }

  get priceText(): string {
    if (!this.hasUpfront) return 'Free';
    return `₹${Number(this.plan.amount).toFixed(0)}`;
  }

  get periodLabel(): string {
    if (!this.plan) return '';
    if (this.plan.meter_type === 'rides') return `${this.plan.rides_count || 1} rides`;
    if (this.plan.meter_type === 'daily') return '1 day';
    if (this.plan.meter_type === 'days') return `${this.plan.days_count || 1} days`;
    if (this.plan.meter_type === 'earnings') return `up to ₹${Number(this.plan.earnings_threshold || 0).toFixed(0)}`;
    return '1 month';
  }

  get validityLabel(): string {
    if (!this.plan) return '';
    if (this.plan.meter_type === 'rides') return `Allowance of ${this.plan.rides_count} completed rides`;
    if (this.plan.meter_type === 'daily') return `Valid for 24 hours`;
    if (this.plan.meter_type === 'days') return `Valid for ${this.plan.days_count} calendar days`;
    if (this.plan.meter_type === 'earnings') return `Valid until ₹${Number(this.plan.earnings_threshold).toFixed(0)} is earned`;
    return 'Valid for 30 days';
  }

  get rateLabel(): string {
    if (this.commissionFree) return 'Keep 100% of every ride fare';
    return `Special ${this.plan.commission_percent}% commission rate`;
  }

  get modelLabel(): string {
    if (this.plan?.pricing_model === 'commission') return 'Pay per ride';
    if (this.plan?.pricing_model === 'hybrid') return 'Hybrid pass';
    return 'Flat pass';
  }

  get walletCovers(): boolean {
    return !this.hasUpfront || this.walletBalance >= (this.plan?.amount || 0);
  }

  selectMethod(m: 'wallet' | 'upi'): void {
    if (m === 'wallet' && !this.walletCovers) return;
    this.paymentMethod = m;
  }

  dismiss(): void {
    this.modalCtrl.dismiss({ confirmed: false });
  }

  confirm(): void {
    this.modalCtrl.dismiss({
      confirmed: true,
      paymentMethod: this.hasUpfront ? this.paymentMethod : 'wallet',
    });
  }
}
