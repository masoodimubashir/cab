import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, IconComponent } from '../../ui';

interface CouponOption {
  id: number;
  title: string;
  subtitle: string | null;
  promo_type: string;
  discount_type: string;
  discount_value: number;
  discount_maximum: number | null;
}

interface ReferralSettings {
  referee_benefit_type: 'none' | 'coupon' | 'carpool_coupon';
  referee_coupon_id: number | null;
  referrer_benefit_type: 'none' | 'coupon' | 'carpool_coupon';
  referrer_coupon_id: number | null;

  referral_message: string | null;
  facebook_caption: string | null;
  facebook_description: string | null;
  referral_caption: string | null;
  referral_email_subject: string | null;
  referral_email_support: string | null;
  referral_cashback_text: string | null;
  invite_and_earn_message: string | null;
  invite_and_earn_info: string | null;
  referral_sharing_message: string | null;
  branch_android_url: string | null;
  branch_desktop_url: string | null;
  branch_ios_url: string | null;
  branch_fallback_url: string | null;
}

const BENEFIT_OPTIONS: { value: ReferralSettings['referee_benefit_type']; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'coupon', label: 'Coupon' },
  { value: 'carpool_coupon', label: 'Carpool Coupon' },
];

/** Referral program configuration for the city chosen in the topbar switcher. */
@Component({
  selector: 'app-referrals',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, IconComponent],
  template: `
    <div class="rf">
      <header class="rf__head">
        <div>
          <h1 class="rf__title">Referrals</h1>
          <p class="rf__sub">Referral rewards and the copy shown when riders share their link.</p>
        </div>
      </header>

      <!-- No city -->
      <div class="cue" *ngIf="cityId == null">
        <tm-icon name="map-marker" [size]="24" />
        <p class="cue__title">No city selected</p>
        <p class="cue__text">Pick a city from the switcher in the top bar to configure referrals.</p>
      </div>

      <ng-container *ngIf="cityId != null">
        <div class="seg">
          <button class="seg__btn" [class.is-on]="tab === 'benefits'" (click)="tab = 'benefits'">
            <tm-icon name="gift" [size]="14" /> Benefits
          </button>
          <button class="seg__btn" [class.is-on]="tab === 'copy'" (click)="tab = 'copy'">
            <tm-icon name="envelope" [size]="14" /> Sharing copy
          </button>
        </div>

        <!-- ===== BENEFITS ===== -->
        <ng-container *ngIf="tab === 'benefits'">
          <section class="sec" *ngFor="let side of ['referee','referrer']">
            <header class="sec__head">
              <span class="sec__icon"><tm-icon name="user" [size]="16" /></span>
              <div>
                <h3 class="sec__title">{{ side === 'referee' ? 'Referee' : 'Referrer' }} benefit</h3>
                <p class="sec__desc">
                  Reward given to the {{ side === 'referee' ? 'invited rider' : 'rider who refers' }}.
                </p>
              </div>
            </header>
            <div class="sec__body">
              <div class="chips">
                <button
                  *ngFor="let b of benefitOptions"
                  type="button"
                  class="chip"
                  [class.is-on]="benefitType(side) === b.value"
                  (click)="setBenefitType(side, b.value)"
                >{{ b.label }}</button>
              </div>

              <div class="picker" *ngIf="benefitType(side) !== 'none'">
                <p class="picker__lbl">Select the coupon to grant</p>
                <div class="picker__list" *ngIf="coupons.length; else noCoupons">
                  <button
                    *ngFor="let c of coupons"
                    type="button"
                    class="crow"
                    [class.is-on]="couponId(side) === c.id"
                    (click)="setCouponId(side, c.id)"
                  >
                    <span class="crow__radio" [class.on]="couponId(side) === c.id"></span>
                    <span class="crow__main">
                      <span class="crow__title">{{ c.title }}</span>
                      <span class="crow__sub">{{ c.subtitle || c.promo_type }}</span>
                    </span>
                    <span class="crow__disc">
                      {{ c.discount_value }}{{ c.discount_type === 'percentage' ? '%' : '' }} off
                    </span>
                  </button>
                </div>
                <ng-template #noCoupons>
                  <div class="picker__empty">No coupons yet — create some on the Coupons page first.</div>
                </ng-template>
              </div>
            </div>
          </section>
        </ng-container>

        <!-- ===== SHARING COPY ===== -->
        <ng-container *ngIf="tab === 'copy'">
          <section class="sec">
            <header class="sec__head">
              <span class="sec__icon"><tm-icon name="send" [size]="16" /></span>
              <div>
                <h3 class="sec__title">Referral & invite copy</h3>
                <p class="sec__desc">Text shown when a rider shares their referral link.</p>
              </div>
            </header>
            <div class="sec__body grid">
              <label class="field"><span class="field__lbl">Referral message</span>
                <textarea rows="3" [(ngModel)]="settings.referral_message"></textarea></label>
              <label class="field"><span class="field__lbl">Invite & earn message</span>
                <textarea rows="3" [(ngModel)]="settings.invite_and_earn_message"></textarea></label>
              <label class="field"><span class="field__lbl">Facebook caption</span>
                <input type="text" [(ngModel)]="settings.facebook_caption" /></label>
              <label class="field"><span class="field__lbl">Referral caption</span>
                <input type="text" [(ngModel)]="settings.referral_caption" /></label>
              <label class="field"><span class="field__lbl">Facebook description</span>
                <textarea rows="2" [(ngModel)]="settings.facebook_description"></textarea></label>
              <label class="field"><span class="field__lbl">Invite & earn info</span>
                <textarea rows="2" [(ngModel)]="settings.invite_and_earn_info"></textarea></label>
              <label class="field"><span class="field__lbl">Referral email subject</span>
                <input type="text" [(ngModel)]="settings.referral_email_subject" /></label>
              <label class="field"><span class="field__lbl">Referral cashback text</span>
                <input type="text" [(ngModel)]="settings.referral_cashback_text" /></label>
              <label class="field"><span class="field__lbl">Referral email support text</span>
                <textarea rows="2" [(ngModel)]="settings.referral_email_support"></textarea></label>
              <label class="field"><span class="field__lbl">Referral sharing message</span>
                <textarea rows="2" [(ngModel)]="settings.referral_sharing_message"></textarea></label>
            </div>
          </section>

          <section class="sec">
            <header class="sec__head">
              <span class="sec__icon"><tm-icon name="map" [size]="16" /></span>
              <div>
                <h3 class="sec__title">Branch deep links</h3>
                <p class="sec__desc">Platform-specific links used in shared invites.</p>
              </div>
            </header>
            <div class="sec__body grid">
              <label class="field"><span class="field__lbl">Android URL</span>
                <input type="text" [(ngModel)]="settings.branch_android_url" /></label>
              <label class="field"><span class="field__lbl">iOS URL</span>
                <input type="text" [(ngModel)]="settings.branch_ios_url" /></label>
              <label class="field"><span class="field__lbl">Desktop URL</span>
                <input type="text" [(ngModel)]="settings.branch_desktop_url" /></label>
              <label class="field"><span class="field__lbl">Fallback URL</span>
                <input type="text" [(ngModel)]="settings.branch_fallback_url" /></label>
            </div>
          </section>
        </ng-container>

        <!-- Save bar -->
        <div class="savebar">
          <span class="savebar__hint">Referral settings apply to the selected city only.</span>
          <tm-button variant="green" icon="check" [disabled]="saving" (clicked)="save()">
            {{ saving ? 'Saving…' : 'Save referrals' }}
          </tm-button>
        </div>
      </ng-container>
    </div>
  `,
  styles: [`
    .rf { display: flex; flex-direction: column; gap: 14px; }
    .rf__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .rf__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); }

    .cue {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 48px 24px; text-align: center;
      background: var(--tm-surface); border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg); color: var(--tm-text-muted);
    }
    .cue__title { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .cue__text { margin: 0; font-size: 13px; }

    .seg {
      display: inline-flex; gap: 4px; padding: 4px;
      background: var(--tm-canvas-2); border-radius: var(--tm-radius-md, 10px);
    }
    .seg__btn {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 8px 16px; border-radius: 8px;
      font-size: 13px; font-weight: 700; color: var(--tm-text-muted);
      background: transparent; cursor: pointer;
    }
    .seg__btn.is-on { background: var(--tm-surface); color: var(--tm-text); box-shadow: var(--tm-shadow-sm); }

    .sec {
      background: var(--tm-surface); border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px); overflow: hidden;
    }
    .sec__head {
      display: flex; align-items: center; gap: 11px;
      padding: 14px 16px; border-bottom: 1px solid var(--tm-line);
    }
    .sec__icon {
      width: 34px; height: 34px; border-radius: 9px; flex: none;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--tm-green-tint, #e0f7fa); color: var(--tm-green);
    }
    .sec__title { margin: 0; font-size: 14px; font-weight: 800; color: var(--tm-text); }
    .sec__desc { margin: 1px 0 0; font-size: 12px; color: var(--tm-text-muted); }
    .sec__body { padding: 16px; display: flex; flex-direction: column; gap: 14px; }

    .chips { display: flex; gap: 8px; flex-wrap: wrap; }
    .chip {
      padding: 8px 16px; border-radius: 999px;
      border: 1px solid var(--tm-line); background: var(--tm-canvas);
      color: var(--tm-text-muted); font-size: 13px; font-weight: 700; cursor: pointer;
    }
    .chip.is-on { background: var(--tm-green-tint, #e0f7fa); border-color: var(--tm-green); color: var(--tm-green); }

    .picker__lbl { margin: 0 0 8px; font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .picker__list { display: flex; flex-direction: column; gap: 6px; max-height: 320px; overflow-y: auto; }
    .crow {
      display: flex; align-items: center; gap: 11px;
      padding: 10px 12px; text-align: left;
      border: 1px solid var(--tm-line); border-radius: 10px;
      background: var(--tm-canvas); cursor: pointer;
    }
    .crow.is-on { border-color: var(--tm-green); background: var(--tm-green-tint, #e0f7fa); }
    .crow__radio {
      width: 16px; height: 16px; border-radius: 50%; flex: none;
      border: 2px solid var(--tm-line); background: var(--tm-surface);
    }
    .crow__radio.on { border-color: var(--tm-green); box-shadow: inset 0 0 0 3px var(--tm-green); }
    .crow__main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .crow__title { font-size: 13px; font-weight: 700; color: var(--tm-text); }
    .crow__sub { font-size: 11px; color: var(--tm-text-muted); }
    .crow__disc { font-size: 12px; font-weight: 800; color: var(--tm-green); flex: none; }
    .picker__empty {
      padding: 16px; text-align: center; font-size: 12px; color: var(--tm-text-muted);
      background: var(--tm-canvas-2); border-radius: 10px;
    }

    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .field__lbl { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .field input, .field textarea {
      width: 100%; padding: 9px 11px;
      border: 1px solid var(--tm-line); border-radius: 9px;
      background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13px; outline: none; font-family: inherit;
    }
    .field input:focus, .field textarea:focus { border-color: var(--tm-green); }
    .field textarea { resize: vertical; }

    .savebar {
      position: sticky; bottom: 0;
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 12px 16px;
      background: var(--tm-surface); border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px); box-shadow: var(--tm-shadow-pop);
    }
    .savebar__hint { font-size: 12px; color: var(--tm-text-muted); }

    @media (max-width: 700px) { .grid { grid-template-columns: 1fr; } }
  `],
})
export class ReferralsComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  tab: 'benefits' | 'copy' = 'benefits';
  coupons: CouponOption[] = [];
  settings: ReferralSettings = this.blankSettings();
  saving = false;
  benefitOptions = BENEFIT_OPTIONS;

  private sub?: Subscription;

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.sub = this.cityCtx.cityId$.subscribe((id) => {
      this.cityId = id;
      if (id != null) this.fetch();
    });
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  // ── benefit-side accessors ──
  benefitType(side: string): ReferralSettings['referee_benefit_type'] {
    return side === 'referee' ? this.settings.referee_benefit_type : this.settings.referrer_benefit_type;
  }
  setBenefitType(side: string, val: ReferralSettings['referee_benefit_type']): void {
    if (side === 'referee') this.settings.referee_benefit_type = val;
    else this.settings.referrer_benefit_type = val;
  }
  couponId(side: string): number | null {
    return side === 'referee' ? this.settings.referee_coupon_id : this.settings.referrer_coupon_id;
  }
  setCouponId(side: string, id: number): void {
    if (side === 'referee') this.settings.referee_coupon_id = id;
    else this.settings.referrer_coupon_id = id;
  }

  blankSettings(): ReferralSettings {
    return {
      referee_benefit_type: 'none',
      referee_coupon_id: null,
      referrer_benefit_type: 'none',
      referrer_coupon_id: null,
      referral_message: '',
      facebook_caption: '',
      facebook_description: '',
      referral_caption: '',
      referral_email_subject: '',
      referral_email_support: '',
      referral_cashback_text: '',
      invite_and_earn_message: '',
      invite_and_earn_info: '',
      referral_sharing_message: '',
      branch_android_url: '',
      branch_desktop_url: '',
      branch_ios_url: '',
      branch_fallback_url: '',
    };
  }

  fetch(): void {
    if (this.cityId == null) return;
    this.api.get<{ settings: ReferralSettings; coupons: CouponOption[] }>(
      `/admin/cities/${this.cityId}/referrals`,
    ).subscribe({
      next: (r) => {
        this.settings = { ...this.blankSettings(), ...r.settings };
        this.coupons = r.coupons ?? [];
      },
      error: () => this.toast.error('Failed to load referral settings'),
    });
  }

  save(): void {
    if (this.cityId == null || this.saving) return;
    this.saving = true;
    this.api.patch(`/admin/cities/${this.cityId}/referrals`, { ...this.settings }).subscribe({
      next: () => {
        this.saving = false;
        this.toast.success('Referral settings saved');
      },
      error: (e) => {
        this.saving = false;
        this.toast.error(e?.error?.message || 'Failed to save referral settings');
      },
    });
  }
}
