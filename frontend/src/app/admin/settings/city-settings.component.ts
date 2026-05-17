import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { CalendarModule } from 'primeng/calendar';
import { CheckboxModule } from 'primeng/checkbox';
import { MultiSelectModule } from 'primeng/multiselect';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';

interface CitySettings {
  id: number;
  city_id: number;

  chat_enabled: boolean;
  show_region_specific_fare: boolean;
  show_vehicle_make_model: boolean;
  driver_qr_booking_enabled: boolean;
  driver_qr_booking_force_assign: boolean;
  city_level_otp: boolean;

  mandatory_fare_capping_threshold: number;
  night_start_time: string | null;
  night_end_time: string | null;
  advertise_credits: number;

  theme_color: string | null;
  logo_path: string | null;
  logo_url: string | null;
  splash_screen_path: string | null;
  splash_screen_url: string | null;
  home_bg_path: string | null;
  home_bg_url: string | null;

  onboarding_info: string | null;
  customer_rate_card_info: string | null;
  customer_login_otp_message: string | null;
  customer_login_otp_message_ios: string | null;

  allowed_driver_payment_modes: string[];

  emergency_no: string | null;
  emergency_police_no: string | null;
  driver_support_no: string | null;
  customer_support_no: string | null;
  support_email: string | null;
  operator_name: string | null;
  operational_info: string | null;
}

const PAYMENT_MODE_OPTIONS = [
  { label: 'Cash', value: 'CASH' },
  { label: 'Razorpay', value: 'RAZORPAY' },
  { label: 'UPI', value: 'UPI' },
  { label: 'Wallet', value: 'WALLET' },
  { label: 'Card', value: 'CARD' },
];

@Component({
  selector: 'app-city-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    InputTextareaModule,
    InputNumberModule,
    CalendarModule,
    CheckboxModule,
    MultiSelectModule,
    ToastModule,
  ],
  providers: [MessageService],
  template: `
    <p-toast />
    <p class="muted">Per-city operational, branding and contact configuration.</p>

    <div *ngIf="!cityId" class="empty">
      Pick a city from the left rail to manage its settings.
    </div>

    <div *ngIf="cityId && loading" class="empty">Loading…</div>

    <ng-container *ngIf="cityId && !loading && form">
      <p-card header="Toggles" styleClass="card">
        <div class="grid grid-3">
          <div class="cell"><p-checkbox [(ngModel)]="form.chat_enabled" [binary]="true" inputId="chat" />
            <label for="chat">Chat enabled</label></div>
          <div class="cell"><p-checkbox [(ngModel)]="form.show_region_specific_fare" [binary]="true" inputId="rsf" />
            <label for="rsf">Show region-specific fare</label></div>
          <div class="cell"><p-checkbox [(ngModel)]="form.show_vehicle_make_model" [binary]="true" inputId="svm" />
            <label for="svm">Show vehicle make/model</label></div>
          <div class="cell"><p-checkbox [(ngModel)]="form.driver_qr_booking_enabled" [binary]="true" inputId="qr" />
            <label for="qr">Driver QR-code booking</label></div>
          <div class="cell"><p-checkbox [(ngModel)]="form.driver_qr_booking_force_assign" [binary]="true" inputId="qrf" />
            <label for="qrf">QR force-assign</label></div>
          <div class="cell"><p-checkbox [(ngModel)]="form.city_level_otp" [binary]="true" inputId="otp" />
            <label for="otp">City-level OTP</label></div>
        </div>
      </p-card>

      <p-card header="Time & Limits" styleClass="card">
        <div class="grid grid-3">
          <div>
            <label class="lbl">Mandatory fare capping threshold</label>
            <p-inputNumber [(ngModel)]="form.mandatory_fare_capping_threshold" [min]="0" [max]="10000"></p-inputNumber>
          </div>
          <div>
            <label class="lbl">Night start time</label>
            <input pInputText [(ngModel)]="form.night_start_time" placeholder="HH:MM:SS" />
          </div>
          <div>
            <label class="lbl">Night end time</label>
            <input pInputText [(ngModel)]="form.night_end_time" placeholder="HH:MM:SS" />
          </div>
          <div>
            <label class="lbl">Advertise credits</label>
            <p-inputNumber [(ngModel)]="form.advertise_credits" [min]="0"></p-inputNumber>
          </div>
        </div>
      </p-card>

      <p-card header="Branding" styleClass="card">
        <div class="grid grid-2">
          <div>
            <label class="lbl">Theme color</label>
            <input pInputText [(ngModel)]="form.theme_color" placeholder="#06b6d4" maxlength="16" />
          </div>
          <div></div>

          <div>
            <label class="lbl">Logo</label>
            <input type="file" accept="image/*" (change)="pickFile($event, 'logo')" />
            <div *ngIf="form.logo_url" class="thumb"><img [src]="form.logo_url" alt="" /></div>
          </div>
          <div>
            <label class="lbl">Splash screen</label>
            <input type="file" accept="image/*" (change)="pickFile($event, 'splash_screen')" />
            <div *ngIf="form.splash_screen_url" class="thumb"><img [src]="form.splash_screen_url" alt="" /></div>
          </div>
          <div>
            <label class="lbl">Home background</label>
            <input type="file" accept="image/*" (change)="pickFile($event, 'home_bg')" />
            <div *ngIf="form.home_bg_url" class="thumb"><img [src]="form.home_bg_url" alt="" /></div>
          </div>
        </div>

        <label class="lbl">Onboarding info (HTML)</label>
        <textarea pInputTextarea rows="4" [(ngModel)]="form.onboarding_info"></textarea>

        <label class="lbl">Customer rate-card info (HTML)</label>
        <textarea pInputTextarea rows="4" [(ngModel)]="form.customer_rate_card_info"></textarea>
      </p-card>

      <p-card header="Customer Messaging" styleClass="card">
        <label class="lbl">Customer login OTP message (Android)</label>
        <textarea pInputTextarea rows="2" [(ngModel)]="form.customer_login_otp_message"></textarea>

        <label class="lbl">Customer login OTP message (iOS)</label>
        <textarea pInputTextarea rows="2" [(ngModel)]="form.customer_login_otp_message_ios"></textarea>
      </p-card>

      <p-card header="Payment" styleClass="card">
        <label class="lbl">Allowed driver payment modes</label>
        <p-multiSelect
          [options]="paymentModeOptions"
          [(ngModel)]="form.allowed_driver_payment_modes"
          optionLabel="label"
          optionValue="value"
          placeholder="Select modes"
          appendTo="body"
        ></p-multiSelect>
      </p-card>

      <p-card header="Contacts" styleClass="card">
        <div class="grid grid-2">
          <div><label class="lbl">Emergency no.</label>
            <input pInputText [(ngModel)]="form.emergency_no" /></div>
          <div><label class="lbl">Police no.</label>
            <input pInputText [(ngModel)]="form.emergency_police_no" /></div>
          <div><label class="lbl">Driver support no.</label>
            <input pInputText [(ngModel)]="form.driver_support_no" /></div>
          <div><label class="lbl">Customer support no.</label>
            <input pInputText [(ngModel)]="form.customer_support_no" /></div>
          <div><label class="lbl">Support email</label>
            <input pInputText [(ngModel)]="form.support_email" /></div>
        </div>
      </p-card>

      <p-card header="Operator" styleClass="card">
        <label class="lbl">Operator name</label>
        <input pInputText [(ngModel)]="form.operator_name" />

        <label class="lbl">Operational info</label>
        <textarea pInputTextarea rows="3" [(ngModel)]="form.operational_info"></textarea>
      </p-card>

      <div class="actions">
        <button pButton type="button" icon="pi pi-save" label="Save" [loading]="saving" (click)="save()"></button>
      </div>
    </ng-container>
  `,
  styles: [
    `
      .page-head { margin-bottom: 14px; }
      .page-head h2 { margin: 0 0 4px; }
      .muted { color: #64748b; font-size: 13px; margin: 0; }
      .empty { padding: 30px; text-align: center; color: #64748b; }

      :host ::ng-deep .card { margin-bottom: 14px; }

      .grid { display: grid; gap: 14px; }
      .grid-2 { grid-template-columns: 1fr 1fr; }
      .grid-3 { grid-template-columns: 1fr 1fr 1fr; }
      .cell {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        font-size: 13px;
      }
      .lbl {
        display: block;
        font-size: 12px;
        font-weight: 700;
        color: #475569;
        margin: 10px 0 4px;
      }
      input[pInputText], textarea {
        width: 100%;
      }
      :host ::ng-deep .p-inputnumber, :host ::ng-deep .p-multiselect {
        width: 100%;
      }
      .thumb {
        margin-top: 6px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        overflow: hidden;
        max-width: 240px;
      }
      .thumb img { display: block; width: 100%; }
      .actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 16px;
      }

      @media (max-width: 880px) {
        .grid-2, .grid-3 { grid-template-columns: 1fr; }
      }
    `,
  ],
})
export class CitySettingsComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  form: CitySettings | null = null;
  loading = false;
  saving = false;

  paymentModeOptions = PAYMENT_MODE_OPTIONS;

  private files: { logo?: File; splash_screen?: File; home_bg?: File } = {};
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
      this.form = null;
      this.files = {};
      if (id != null) this.fetch();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  fetch(): void {
    if (this.cityId == null) return;
    this.loading = true;
    this.api
      .get<{ settings: CitySettings }>(`/admin/cities/${this.cityId}/settings`)
      .subscribe({
        next: (res) => {
          const s = res.settings;
          // Ensure array shape for multiselect even if backend sends null.
          if (!Array.isArray(s.allowed_driver_payment_modes)) {
            s.allowed_driver_payment_modes = [];
          }
          this.form = s;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.msg.add({ severity: 'error', summary: 'Failed to load settings' });
        },
      });
  }

  pickFile(e: Event, key: 'logo' | 'splash_screen' | 'home_bg'): void {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) this.files[key] = f;
  }

  save(): void {
    if (this.cityId == null || !this.form) return;
    this.saving = true;

    const f = this.form;
    const fd = new FormData();
    fd.append('_method', 'PATCH');

    const append = (key: string, val: unknown): void => {
      if (val === null || val === undefined) return;
      if (typeof val === 'boolean') fd.append(key, val ? '1' : '0');
      else fd.append(key, String(val));
    };

    append('chat_enabled', f.chat_enabled);
    append('show_region_specific_fare', f.show_region_specific_fare);
    append('show_vehicle_make_model', f.show_vehicle_make_model);
    append('driver_qr_booking_enabled', f.driver_qr_booking_enabled);
    append('driver_qr_booking_force_assign', f.driver_qr_booking_force_assign);
    append('city_level_otp', f.city_level_otp);

    append('mandatory_fare_capping_threshold', f.mandatory_fare_capping_threshold);
    append('night_start_time', f.night_start_time);
    append('night_end_time', f.night_end_time);
    append('advertise_credits', f.advertise_credits);

    append('theme_color', f.theme_color);
    append('onboarding_info', f.onboarding_info);
    append('customer_rate_card_info', f.customer_rate_card_info);
    append('customer_login_otp_message', f.customer_login_otp_message);
    append('customer_login_otp_message_ios', f.customer_login_otp_message_ios);

    fd.append(
      'allowed_driver_payment_modes',
      JSON.stringify(f.allowed_driver_payment_modes ?? []),
    );

    append('emergency_no', f.emergency_no);
    append('emergency_police_no', f.emergency_police_no);
    append('driver_support_no', f.driver_support_no);
    append('customer_support_no', f.customer_support_no);
    append('support_email', f.support_email);
    append('operator_name', f.operator_name);
    append('operational_info', f.operational_info);

    if (this.files.logo) fd.append('logo', this.files.logo);
    if (this.files.splash_screen) fd.append('splash_screen', this.files.splash_screen);
    if (this.files.home_bg) fd.append('home_bg', this.files.home_bg);

    this.api
      .postMultipart<{ settings: CitySettings }>(
        `/admin/cities/${this.cityId}/settings`,
        fd,
      )
      .subscribe({
        next: (res) => {
          this.saving = false;
          this.files = {};
          if (res.settings) {
            if (!Array.isArray(res.settings.allowed_driver_payment_modes)) {
              res.settings.allowed_driver_payment_modes = [];
            }
            this.form = res.settings;
          }
          this.msg.add({ severity: 'success', summary: 'Saved' });
        },
        error: () => {
          this.saving = false;
          this.msg.add({ severity: 'error', summary: 'Failed to save settings' });
        },
      });
  }
}
