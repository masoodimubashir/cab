import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { RadioButtonModule } from 'primeng/radiobutton';
import { TabViewModule } from 'primeng/tabview';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';

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

@Component({
  selector: 'app-referrals',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonModule, TableModule,
    InputTextModule, InputTextareaModule, RadioButtonModule, TabViewModule,
    ToastModule,
  ],
  providers: [MessageService],
  template: `
    <p-toast />

    <h2 class="page-title">Referrals</h2>

    <p-tabView>
      <!-- ── BENEFITS ── -->
      <p-tabPanel header="Benefits">
        <!-- Referee Benefits -->
        <div class="card">
          <h3 class="card__title underline">Referee Benefits</h3>
          <div class="opts">
            <label class="opt">
              <p-radioButton name="referee" value="none" [(ngModel)]="settings.referee_benefit_type"></p-radioButton>
              <span>None</span>
            </label>
            <label class="opt">
              <p-radioButton name="referee" value="coupon" [(ngModel)]="settings.referee_benefit_type"></p-radioButton>
              <span>Coupon</span>
            </label>
            <label class="opt">
              <p-radioButton name="referee" value="carpool_coupon" [(ngModel)]="settings.referee_benefit_type"></p-radioButton>
              <span>Carpool Coupon</span>
            </label>
          </div>

          <p-table [value]="coupons" *ngIf="settings.referee_benefit_type !== 'none'"
                   styleClass="p-datatable-sm" [rowHover]="true">
            <ng-template pTemplate="header">
              <tr>
                <th style="width: 60px;">Select</th>
                <th>Coupon ID</th>
                <th>Promo Type</th>
                <th>Title</th>
                <th>Sub Title</th>
                <th>Discount Type</th>
                <th>Value</th>
                <th>Maximum Discount</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-c>
              <tr>
                <td>
                  <p-radioButton
                    name="refereeCoupon"
                    [value]="c.id"
                    [(ngModel)]="settings.referee_coupon_id"
                  ></p-radioButton>
                </td>
                <td>{{ c.id }}</td>
                <td>{{ c.promo_type }}</td>
                <td>{{ c.title }}</td>
                <td>{{ c.subtitle || '—' }}</td>
                <td>{{ c.discount_type }}</td>
                <td>{{ c.discount_value }}{{ c.discount_type === 'percentage' ? '%' : '' }}</td>
                <td>{{ c.discount_maximum ?? '—' }}</td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr><td colspan="8" class="empty">No coupons available — create some on the Coupons page first.</td></tr>
            </ng-template>
          </p-table>

          <div class="card__actions">
            <button pButton type="button" label="Update" class="p-button-sm"
                    (click)="saveBenefits()" [loading]="savingBenefits"></button>
          </div>
        </div>

        <!-- Referrer Benefits -->
        <div class="card">
          <h3 class="card__title underline">Referrer Benefits</h3>
          <div class="opts">
            <label class="opt">
              <p-radioButton name="referrer" value="none" [(ngModel)]="settings.referrer_benefit_type"></p-radioButton>
              <span>None</span>
            </label>
            <label class="opt">
              <p-radioButton name="referrer" value="coupon" [(ngModel)]="settings.referrer_benefit_type"></p-radioButton>
              <span>Coupon</span>
            </label>
            <label class="opt">
              <p-radioButton name="referrer" value="carpool_coupon" [(ngModel)]="settings.referrer_benefit_type"></p-radioButton>
              <span>Carpool Coupon</span>
            </label>
          </div>

          <p-table [value]="coupons" *ngIf="settings.referrer_benefit_type !== 'none'"
                   styleClass="p-datatable-sm" [rowHover]="true">
            <ng-template pTemplate="header">
              <tr>
                <th style="width: 60px;">Select</th>
                <th>Coupon ID</th>
                <th>Promo Type</th>
                <th>Title</th>
                <th>Sub Title</th>
                <th>Discount Type</th>
                <th>Value</th>
                <th>Maximum Discount</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-c>
              <tr>
                <td>
                  <p-radioButton
                    name="referrerCoupon"
                    [value]="c.id"
                    [(ngModel)]="settings.referrer_coupon_id"
                  ></p-radioButton>
                </td>
                <td>{{ c.id }}</td>
                <td>{{ c.promo_type }}</td>
                <td>{{ c.title }}</td>
                <td>{{ c.subtitle || '—' }}</td>
                <td>{{ c.discount_type }}</td>
                <td>{{ c.discount_value }}{{ c.discount_type === 'percentage' ? '%' : '' }}</td>
                <td>{{ c.discount_maximum ?? '—' }}</td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr><td colspan="8" class="empty">No coupons available — create some on the Coupons page first.</td></tr>
            </ng-template>
          </p-table>

          <div class="card__actions">
            <button pButton type="button" label="Update" class="p-button-sm"
                    (click)="saveBenefits()" [loading]="savingBenefits"></button>
          </div>
        </div>
      </p-tabPanel>

      <!-- ── SHARING COPY ── -->
      <p-tabPanel header="Sharing Copy">
        <div class="card">
          <h3 class="card__title">Referral & Invite Copy</h3>
          <p class="muted small">
            Text shown when a user shares their referral link via SMS, email, social or in-app.
          </p>

          <div class="grid">
            <div class="col">
              <label class="lbl">Referral Message</label>
              <textarea pInputTextarea rows="3" [(ngModel)]="settings.referral_message"></textarea>

              <label class="lbl">Facebook Caption</label>
              <input pInputText [(ngModel)]="settings.facebook_caption" />

              <label class="lbl">Facebook Description</label>
              <textarea pInputTextarea rows="2" [(ngModel)]="settings.facebook_description"></textarea>

              <label class="lbl">Referral Caption</label>
              <input pInputText [(ngModel)]="settings.referral_caption" />

              <label class="lbl">Referral Email Subject</label>
              <input pInputText [(ngModel)]="settings.referral_email_subject" />

              <label class="lbl">Referral Email Support Text</label>
              <textarea pInputTextarea rows="3" [(ngModel)]="settings.referral_email_support"></textarea>

              <label class="lbl">Referral Cashback Text</label>
              <input pInputText [(ngModel)]="settings.referral_cashback_text" />
            </div>

            <div class="col">
              <label class="lbl">Invite and Earn Message</label>
              <textarea pInputTextarea rows="2" [(ngModel)]="settings.invite_and_earn_message"></textarea>

              <label class="lbl">Invite and Earn Info</label>
              <textarea pInputTextarea rows="3" [(ngModel)]="settings.invite_and_earn_info"></textarea>

              <label class="lbl">Referral Sharing Message</label>
              <textarea pInputTextarea rows="3" [(ngModel)]="settings.referral_sharing_message"></textarea>

              <label class="lbl">Branch Android URL</label>
              <input pInputText [(ngModel)]="settings.branch_android_url" />

              <label class="lbl">Branch Desktop URL</label>
              <input pInputText [(ngModel)]="settings.branch_desktop_url" />

              <label class="lbl">Branch iOS URL</label>
              <input pInputText [(ngModel)]="settings.branch_ios_url" />

              <label class="lbl">Branch Fallback URL</label>
              <input pInputText [(ngModel)]="settings.branch_fallback_url" />
            </div>
          </div>

          <div class="card__actions">
            <button pButton type="button" label="Save Copy" class="p-button-sm"
                    (click)="saveCopy()" [loading]="savingCopy"></button>
          </div>
        </div>
      </p-tabPanel>
    </p-tabView>
  `,
  styles: [`
    .page-title { margin: 0 0 14px; font-size: 22px; font-weight: 800; color: #0f172a; }
    .muted { color: #64748b; }
    .small { font-size: 12px; }
    .empty { padding: 28px; text-align: center; color: #64748b; }

    .card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 18px;
      margin: 0 0 16px;
    }
    .card__title {
      margin: 0 0 14px;
      font-size: 16px;
      font-weight: 800;
      text-align: center;
      color: #0f172a;
    }
    .card__title.underline { text-decoration: underline; }
    .card__actions { display: flex; justify-content: flex-end; margin-top: 14px; }

    .opts { display: flex; justify-content: center; gap: 28px; margin-bottom: 14px; }
    .opt { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 600; }

    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    .col { display: flex; flex-direction: column; gap: 6px; }
    .lbl { font-size: 12px; font-weight: 700; color: #475569; margin-top: 6px; }
    .col input[pInputText], .col textarea { width: 100%; }
  `],
})
export class ReferralsComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  coupons: CouponOption[] = [];
  settings: ReferralSettings = this.blankSettings();
  savingBenefits = false;
  savingCopy = false;

  private sub?: Subscription;

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private msg: MessageService,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.sub = this.cityCtx.cityId$.subscribe((id) => {
      this.cityId = id;
      if (id != null) this.fetch();
    });
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

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
    this.api.get<{
      settings: ReferralSettings;
      coupons: CouponOption[];
    }>(`/admin/cities/${this.cityId}/referrals`).subscribe({
      next: (r) => {
        this.settings = { ...this.blankSettings(), ...r.settings };
        this.coupons = r.coupons ?? [];
      },
      error: () => this.msg.add({ severity: 'error', summary: 'Failed to load referral settings' }),
    });
  }

  saveBenefits(): void {
    if (this.cityId == null) return;
    this.savingBenefits = true;
    this.api.patch(`/admin/cities/${this.cityId}/referrals`, {
      referee_benefit_type: this.settings.referee_benefit_type,
      referee_coupon_id: this.settings.referee_coupon_id,
      referrer_benefit_type: this.settings.referrer_benefit_type,
      referrer_coupon_id: this.settings.referrer_coupon_id,
    }).subscribe({
      next: () => { this.savingBenefits = false; this.msg.add({ severity: 'success', summary: 'Benefits updated' }); },
      error: (e) => {
        this.savingBenefits = false;
        this.msg.add({ severity: 'error', summary: e?.error?.message || 'Failed to update benefits' });
      },
    });
  }

  saveCopy(): void {
    if (this.cityId == null) return;
    this.savingCopy = true;
    const body = {
      referral_message: this.settings.referral_message,
      facebook_caption: this.settings.facebook_caption,
      facebook_description: this.settings.facebook_description,
      referral_caption: this.settings.referral_caption,
      referral_email_subject: this.settings.referral_email_subject,
      referral_email_support: this.settings.referral_email_support,
      referral_cashback_text: this.settings.referral_cashback_text,
      invite_and_earn_message: this.settings.invite_and_earn_message,
      invite_and_earn_info: this.settings.invite_and_earn_info,
      referral_sharing_message: this.settings.referral_sharing_message,
      branch_android_url: this.settings.branch_android_url,
      branch_desktop_url: this.settings.branch_desktop_url,
      branch_ios_url: this.settings.branch_ios_url,
      branch_fallback_url: this.settings.branch_fallback_url,
    };
    this.api.patch(`/admin/cities/${this.cityId}/referrals`, body).subscribe({
      next: () => { this.savingCopy = false; this.msg.add({ severity: 'success', summary: 'Sharing copy saved' }); },
      error: (e) => {
        this.savingCopy = false;
        this.msg.add({ severity: 'error', summary: e?.error?.message || 'Failed to save copy' });
      },
    });
  }
}
