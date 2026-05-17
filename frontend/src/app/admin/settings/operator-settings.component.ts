import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { DropdownModule } from 'primeng/dropdown';
import { AccordionModule } from 'primeng/accordion';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { ApiService } from '../../core/api.service';

interface OperatorSettings {
  // branding
  subdomain: string | null;
  operator_name: string | null;
  support_email: string | null;
  logo_path: string | null;
  fav_icon_path: string | null;
  logo_url: string | null;
  fav_icon_url: string | null;
  main_color: string;
  secondary_color: string;

  // fares
  airport_charge_enable: boolean;
  automated_toll_enable: boolean;
  destination_toll_enable: boolean;
  hotspot_toll_enable: boolean;
  intra_geofence_fixed_fare_toll_enable: boolean;
  custom_congestion_charge_enable: boolean;
  night_time_charge_enable: boolean;
  night_start_time: string;
  night_end_time: string;
  manual_driver_fare: number;
  outstation_driver_allowance_enable: boolean;

  commission_deduction: 'no_commission' | 'commission_with_debt' | 'commission_without_debt';

  customer_tip_value_1: number;
  customer_tip_value_2: number;
  customer_tip_value_3: number;
  corporate_tip_value_1: number;
  corporate_tip_value_2: number;
  corporate_tip_value_3: number;
  tip_in_percentage: boolean;

  carpool_fare_approx_percentage: number;
  carpool_fare_threshold: Record<string, unknown> | null;

  check_destination_outside_geofence: boolean;
  check_driver_debt: boolean;
  update_driver_payment_modes_enabled: boolean;

  wallet_cash_tnc: string | null;
  wallet_cash_max_capping: number;

  subscription_popup_title: string | null;
  subscription_popup_desc: string | null;
  subscription_popup_button1: string | null;
  subscription_popup_button2: string | null;

  invite_earn_image_android: string | null;
  invite_earn_image_ios: string | null;
  invite_earn_image_android_url: string | null;
  invite_earn_image_ios_url: string | null;

  kiosk_enabled: boolean;
  kiosk_tnc_link: string | null;

  maps_preference: 'google' | 'flightmap';
  map_browser_key: string | null;
  web_google_api_key: string | null;

  use_proxy_email_creds: boolean;
  use_proxy_sms_creds: boolean;

  customer_ride_accept_msg: string | null;
  ride_cancellation_msg: string | null;
}

type SectionKey =
  | 'branding'
  | 'fares'
  | 'tipping'
  | 'commission'
  | 'carpool'
  | 'geofence'
  | 'wallet'
  | 'subscription'
  | 'referral'
  | 'kiosk'
  | 'maps'
  | 'comms'
  | 'templates'
  | 'rights';

@Component({
  selector: 'app-operator-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    InputTextareaModule,
    InputNumberModule,
    InputSwitchModule,
    DropdownModule,
    AccordionModule,
    ToastModule,
  ],
  providers: [MessageService],
  template: `
    <p-toast />

    <header class="page-head">
      <h2>Operator Settings</h2>
      <p class="muted">
        Global, non-city-scoped configuration that applies platform-wide. Each section saves
        independently.
      </p>
    </header>

    <div *ngIf="loading" class="empty">Loading…</div>

    <p-accordion *ngIf="!loading && settings" [multiple]="true" [activeIndex]="[0]">
      <!-- BRANDING -->
      <p-accordionTab header="Branding & Identity">
        <div class="subdomain-card">
          <div class="qr-block">
            <div class="qr-placeholder">
              <i class="pi pi-qrcode"></i>
            </div>
            <div *ngIf="settings.subdomain" class="qr-host">
              {{ tenantProto }}://{{ settings.subdomain }}.{{ tenantHost }}{{ tenantPortSuffix }}
            </div>
          </div>
          <div class="subdomain-row">
            <span class="proto">{{ tenantProto }}://</span>
            <input
              pInputText
              [(ngModel)]="settings.subdomain"
              placeholder="Enter Subdomain Name"
              class="sub-input"
            />
            <span class="proto">.{{ tenantHost }}{{ tenantPortSuffix }}</span>
            <button
              pButton
              label="Create"
              icon="pi pi-check"
              (click)="save('branding')"
              [loading]="saving.branding"
            ></button>
          </div>
        </div>

        <div class="grid">
          <div class="col">
            <label class="lbl">Operator Name</label>
            <input pInputText [(ngModel)]="settings.operator_name" />

            <label class="lbl">Logo</label>
            <div *ngIf="settings.logo_url" class="thumb">
              <img [src]="settings.logo_url" alt="Logo" />
            </div>
            <input type="file" accept="image/*" (change)="onFile($event, 'logo')" />
          </div>

          <div class="col">
            <label class="lbl">Support Email</label>
            <input pInputText [(ngModel)]="settings.support_email" />

            <label class="lbl">Fav Icon</label>
            <div *ngIf="settings.fav_icon_url" class="thumb sm">
              <img [src]="settings.fav_icon_url" alt="Fav icon" />
            </div>
            <input type="file" accept="image/*" (change)="onFile($event, 'fav_icon')" />
          </div>

          <div class="col">
            <label class="lbl">Main Color</label>
            <input pInputText [(ngModel)]="settings.main_color" placeholder="#1c1c1c" />
          </div>

          <div class="col">
            <label class="lbl">Secondary Color</label>
            <input pInputText [(ngModel)]="settings.secondary_color" placeholder="#02b3e4" />
          </div>
        </div>

        <div class="actions">
          <button
            pButton
            label="Update"
            icon="pi pi-save"
            (click)="save('branding')"
            [loading]="saving.branding"
          ></button>
        </div>
      </p-accordionTab>

      <!-- FARES & TOLLS -->
      <p-accordionTab header="Fares, Tolls & Night Charge">
        <div class="grid">
          <div class="col toggle-row">
            <span class="lbl">Airport Charge Enable</span>
            <p-inputSwitch [(ngModel)]="settings.airport_charge_enable"></p-inputSwitch>
          </div>
          <div class="col toggle-row">
            <span class="lbl">Automated Toll Enable</span>
            <p-inputSwitch [(ngModel)]="settings.automated_toll_enable"></p-inputSwitch>
          </div>
          <div class="col toggle-row">
            <span class="lbl">Destination Toll Enable</span>
            <p-inputSwitch [(ngModel)]="settings.destination_toll_enable"></p-inputSwitch>
          </div>
          <div class="col toggle-row">
            <span class="lbl">Hotspot Toll Enable</span>
            <p-inputSwitch [(ngModel)]="settings.hotspot_toll_enable"></p-inputSwitch>
          </div>
          <div class="col toggle-row">
            <span class="lbl">Intra Geofence Fixed Fare Toll</span>
            <p-inputSwitch [(ngModel)]="settings.intra_geofence_fixed_fare_toll_enable"></p-inputSwitch>
          </div>
          <div class="col toggle-row">
            <span class="lbl">Custom Congestion Charge</span>
            <p-inputSwitch [(ngModel)]="settings.custom_congestion_charge_enable"></p-inputSwitch>
          </div>
          <div class="col toggle-row">
            <span class="lbl">Outstation Driver Allowance</span>
            <p-inputSwitch [(ngModel)]="settings.outstation_driver_allowance_enable"></p-inputSwitch>
          </div>
          <div class="col toggle-row">
            <span class="lbl">Night Time Charge</span>
            <p-inputSwitch [(ngModel)]="settings.night_time_charge_enable"></p-inputSwitch>
          </div>
          <div class="col">
            <label class="lbl">Night Start Time (HH:MM:SS)</label>
            <input pInputText [(ngModel)]="settings.night_start_time" placeholder="21:00:00" />
          </div>
          <div class="col">
            <label class="lbl">Night End Time (HH:MM:SS)</label>
            <input pInputText [(ngModel)]="settings.night_end_time" placeholder="06:00:00" />
          </div>
          <div class="col">
            <label class="lbl">Manual Driver Fare</label>
            <input
              pInputText
              type="number"
              [(ngModel)]="settings.manual_driver_fare"
              min="0"
            />
          </div>
        </div>
        <div class="actions">
          <button
            pButton
            label="Update Fares"
            icon="pi pi-save"
            (click)="save('fares')"
            [loading]="saving.fares"
          ></button>
        </div>
      </p-accordionTab>

      <!-- TIPPING -->
      <p-accordionTab header="Tipping">
        <div class="grid">
          <div class="col">
            <label class="lbl">Customer Tip Values</label>
            <div class="triple">
              <input pInputText type="number" [(ngModel)]="settings.customer_tip_value_1" />
              <input pInputText type="number" [(ngModel)]="settings.customer_tip_value_2" />
              <input pInputText type="number" [(ngModel)]="settings.customer_tip_value_3" />
            </div>
          </div>
          <div class="col">
            <label class="lbl">Corporate Tip Values</label>
            <div class="triple">
              <input pInputText type="number" [(ngModel)]="settings.corporate_tip_value_1" />
              <input pInputText type="number" [(ngModel)]="settings.corporate_tip_value_2" />
              <input pInputText type="number" [(ngModel)]="settings.corporate_tip_value_3" />
            </div>
          </div>
          <div class="col toggle-row">
            <span class="lbl">Tip In Percentage</span>
            <p-inputSwitch [(ngModel)]="settings.tip_in_percentage"></p-inputSwitch>
          </div>
        </div>
        <div class="actions">
          <button
            pButton
            label="Update Tipping"
            icon="pi pi-save"
            (click)="save('tipping')"
            [loading]="saving.tipping"
          ></button>
        </div>
      </p-accordionTab>

      <!-- COMMISSION -->
      <p-accordionTab header="Commission Model">
        <div class="grid">
          <div class="col">
            <label class="lbl">Commission Deduction</label>
            <p-dropdown
              [options]="commissionOptions"
              [(ngModel)]="settings.commission_deduction"
              optionLabel="label"
              optionValue="value"
              [style]="{ width: '100%' }"
            ></p-dropdown>
          </div>
        </div>
        <div class="actions">
          <button
            pButton
            label="Update Commission"
            icon="pi pi-save"
            (click)="save('commission')"
            [loading]="saving.commission"
          ></button>
        </div>
      </p-accordionTab>

      <!-- CARPOOL -->
      <p-accordionTab header="Carpool / Shared Rides">
        <div class="grid">
          <div class="col">
            <label class="lbl">Carpool Fare Approx Percentage</label>
            <input
              pInputText
              type="number"
              min="0"
              max="100"
              [(ngModel)]="settings.carpool_fare_approx_percentage"
            />
          </div>
          <div class="col">
            <label class="lbl">Carpool Fare Threshold (JSON)</label>
            <textarea
              pInputTextarea
              rows="6"
              [ngModel]="thresholdJson"
              (ngModelChange)="onThresholdChange($event)"
            ></textarea>
            <small *ngIf="thresholdError" class="err">{{ thresholdError }}</small>
          </div>
        </div>
        <div class="actions">
          <button
            pButton
            label="Update Carpool"
            icon="pi pi-save"
            (click)="save('carpool')"
            [loading]="saving.carpool"
            [disabled]="!!thresholdError"
          ></button>
        </div>
      </p-accordionTab>

      <!-- GEOFENCE / DRIVER -->
      <p-accordionTab header="Driver & Geofence Controls">
        <div class="grid">
          <div class="col toggle-row">
            <span class="lbl">Check Destination Outside Geofence</span>
            <p-inputSwitch [(ngModel)]="settings.check_destination_outside_geofence"></p-inputSwitch>
          </div>
          <div class="col toggle-row">
            <span class="lbl">Check Driver Debt</span>
            <p-inputSwitch [(ngModel)]="settings.check_driver_debt"></p-inputSwitch>
          </div>
          <div class="col toggle-row">
            <span class="lbl">Update Driver Payment Modes Enabled</span>
            <p-inputSwitch [(ngModel)]="settings.update_driver_payment_modes_enabled"></p-inputSwitch>
          </div>
        </div>
        <div class="actions">
          <button
            pButton
            label="Update Driver Controls"
            icon="pi pi-save"
            (click)="save('geofence')"
            [loading]="saving.geofence"
          ></button>
        </div>
      </p-accordionTab>

      <!-- WALLET -->
      <p-accordionTab header="Wallet">
        <div class="grid">
          <div class="col">
            <label class="lbl">Wallet Cash Max Capping</label>
            <input pInputText type="number" min="0" [(ngModel)]="settings.wallet_cash_max_capping" />
          </div>
          <div class="col full">
            <label class="lbl">Wallet Cash T&amp;C</label>
            <textarea pInputTextarea rows="6" [(ngModel)]="settings.wallet_cash_tnc"></textarea>
          </div>
        </div>
        <div class="actions">
          <button
            pButton
            label="Update Wallet"
            icon="pi pi-save"
            (click)="save('wallet')"
            [loading]="saving.wallet"
          ></button>
        </div>
      </p-accordionTab>

      <!-- SUBSCRIPTIONS -->
      <p-accordionTab header="Driver Subscription Popup">
        <div class="grid">
          <div class="col">
            <label class="lbl">Popup Title</label>
            <input pInputText [(ngModel)]="settings.subscription_popup_title" />
          </div>
          <div class="col">
            <label class="lbl">Popup Description</label>
            <input pInputText [(ngModel)]="settings.subscription_popup_desc" />
          </div>
          <div class="col">
            <label class="lbl">Popup Button 1</label>
            <input pInputText [(ngModel)]="settings.subscription_popup_button1" />
          </div>
          <div class="col">
            <label class="lbl">Popup Button 2</label>
            <input pInputText [(ngModel)]="settings.subscription_popup_button2" />
          </div>
        </div>
        <div class="actions">
          <button
            pButton
            label="Update Subscription"
            icon="pi pi-save"
            (click)="save('subscription')"
            [loading]="saving.subscription"
          ></button>
        </div>
      </p-accordionTab>

      <!-- REFERRAL -->
      <p-accordionTab header="Referral / Invite-Earn Screen">
        <div class="grid">
          <div class="col">
            <label class="lbl">Invite Earn Image — Android</label>
            <div *ngIf="settings.invite_earn_image_android_url" class="thumb">
              <img [src]="settings.invite_earn_image_android_url" alt="Android" />
            </div>
            <input
              type="file"
              accept="image/*"
              (change)="onFile($event, 'invite_earn_image_android')"
            />
          </div>
          <div class="col">
            <label class="lbl">Invite Earn Image — iOS</label>
            <div *ngIf="settings.invite_earn_image_ios_url" class="thumb">
              <img [src]="settings.invite_earn_image_ios_url" alt="iOS" />
            </div>
            <input
              type="file"
              accept="image/*"
              (change)="onFile($event, 'invite_earn_image_ios')"
            />
          </div>
        </div>
        <div class="actions">
          <button
            pButton
            label="Update Referral"
            icon="pi pi-save"
            (click)="save('referral')"
            [loading]="saving.referral"
          ></button>
        </div>
      </p-accordionTab>

      <!-- KIOSK -->
      <p-accordionTab header="Kiosk Mode">
        <div class="grid">
          <div class="col toggle-row">
            <span class="lbl">Kiosk Enabled</span>
            <p-inputSwitch [(ngModel)]="settings.kiosk_enabled"></p-inputSwitch>
          </div>
          <div class="col">
            <label class="lbl">Kiosk T&amp;C Link</label>
            <input pInputText [(ngModel)]="settings.kiosk_tnc_link" />
          </div>
        </div>
        <div class="actions">
          <button
            pButton
            label="Update Kiosk"
            icon="pi pi-save"
            (click)="save('kiosk')"
            [loading]="saving.kiosk"
          ></button>
        </div>
      </p-accordionTab>

      <!-- MAPS -->
      <p-accordionTab header="Maps Integration">
        <div class="grid">
          <div class="col">
            <label class="lbl">Maps Preference</label>
            <p-dropdown
              [options]="mapsOptions"
              [(ngModel)]="settings.maps_preference"
              optionLabel="label"
              optionValue="value"
              [style]="{ width: '100%' }"
            ></p-dropdown>
          </div>
          <div class="col">
            <label class="lbl">Map Browser Key</label>
            <input pInputText [(ngModel)]="settings.map_browser_key" />
          </div>
          <div class="col full">
            <label class="lbl">Web Google API Key</label>
            <input pInputText [(ngModel)]="settings.web_google_api_key" />
            <small class="hint">
              Stored server-side. Treat as a secret — anyone with admin access can view it.
            </small>
          </div>
        </div>
        <div class="actions">
          <button
            pButton
            label="Update Maps"
            icon="pi pi-save"
            (click)="save('maps')"
            [loading]="saving.maps"
          ></button>
        </div>
      </p-accordionTab>

      <!-- COMMS -->
      <p-accordionTab header="Communications (BYO Email / SMS)">
        <div class="grid">
          <div class="col toggle-row">
            <span class="lbl">Use Proxy Email Creds</span>
            <p-inputSwitch [(ngModel)]="settings.use_proxy_email_creds"></p-inputSwitch>
          </div>
          <div class="col toggle-row">
            <span class="lbl">Use Proxy SMS Creds</span>
            <p-inputSwitch [(ngModel)]="settings.use_proxy_sms_creds"></p-inputSwitch>
          </div>
        </div>
        <div class="actions">
          <button
            pButton
            label="Update Comms"
            icon="pi pi-save"
            (click)="save('comms')"
            [loading]="saving.comms"
          ></button>
        </div>
      </p-accordionTab>

      <!-- TEMPLATES -->
      <p-accordionTab header="Notification Templates">
        <div class="grid">
          <div class="col full">
            <label class="lbl">Customer Ride Accept Message</label>
            <textarea
              pInputTextarea
              rows="4"
              [(ngModel)]="settings.customer_ride_accept_msg"
            ></textarea>
            <small class="hint">
              Placeholders:
              <code *ngFor="let p of acceptPlaceholders">{{ p }}</code>
            </small>
          </div>
          <div class="col full">
            <label class="lbl">Ride Cancellation Message</label>
            <textarea
              pInputTextarea
              rows="3"
              [(ngModel)]="settings.ride_cancellation_msg"
            ></textarea>
            <small class="hint">
              Placeholders:
              <code *ngFor="let p of cancelPlaceholders">{{ p }}</code>
            </small>
          </div>
        </div>
        <div class="actions">
          <button
            pButton
            label="Update Templates"
            icon="pi pi-save"
            (click)="save('templates')"
            [loading]="saving.templates"
          ></button>
        </div>
      </p-accordionTab>

      <!-- EXERCISE YOUR RIGHTS (informational form) -->
      <p-accordionTab header="Exercise your rights (GDPR)">
        <p class="muted">
          We take security seriously and are proud to exceed the industry standards when it comes to
          protecting your personal information.
        </p>
        <div class="grid">
          <div class="col">
            <label class="lbl">Select your Right</label>
            <p-dropdown
              [options]="rightsOptions"
              [(ngModel)]="selectedRight"
              optionLabel="label"
              optionValue="value"
              placeholder="Select Right"
              [style]="{ width: '100%' }"
            ></p-dropdown>
          </div>
          <div class="col">
            <label class="lbl">Reason</label>
            <textarea pInputTextarea rows="3" [(ngModel)]="rightsReason"></textarea>
          </div>
        </div>
        <div class="actions">
          <button
            pButton
            label="Submit DSAR"
            icon="pi pi-shield"
            (click)="submitRights()"
            [disabled]="!selectedRight"
          ></button>
        </div>
      </p-accordionTab>
    </p-accordion>
  `,
  styles: [
    `
      .page-head { margin-bottom: 14px; }
      .page-head h2 { margin: 0 0 4px; }
      .muted { color: #64748b; font-size: 13px; margin: 0 0 12px; }
      .empty { padding: 30px; text-align: center; color: #64748b; }
      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 18px;
      }
      .col { display: flex; flex-direction: column; gap: 6px; }
      .col.full { grid-column: 1 / -1; }
      .lbl {
        font-size: 12px;
        font-weight: 700;
        color: #475569;
        margin-top: 8px;
      }
      .toggle-row {
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 10px 12px;
      }
      .triple {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 8px;
      }
      .thumb {
        margin-top: 8px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        overflow: hidden;
        max-width: 320px;
      }
      .thumb.sm { max-width: 96px; }
      .thumb img { display: block; width: 100%; }
      .actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 14px;
      }
      .subdomain-card {
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 20px;
        margin-bottom: 16px;
        background: #ffffff;
      }
      .qr-block {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        margin-bottom: 12px;
      }
      .qr-placeholder {
        width: 110px; height: 110px;
        background: #f1f5f9;
        border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        font-size: 48px; color: #94a3b8;
      }
      .qr-host { font-size: 12px; color: #64748b; }
      .subdomain-row {
        display: flex; align-items: center; gap: 8px;
        justify-content: center;
      }
      .proto { color: #64748b; font-size: 13px; }
      .sub-input { max-width: 260px; }
      .hint { color: #94a3b8; font-size: 11px; }
      .hint code {
        background: #f1f5f9;
        padding: 1px 4px;
        border-radius: 3px;
        font-size: 11px;
      }
      .err { color: #dc2626; font-size: 12px; }
      @media (max-width: 720px) {
        .grid { grid-template-columns: 1fr; }
      }
    `,
  ],
})
export class OperatorSettingsComponent implements OnInit {
  settings: OperatorSettings | null = null;
  loading = false;

  // Public-facing base host for tenant subdomains. Override per environment by
  // setting `dreamcabs_tenant_host` in localStorage; defaults to `localhost`.
  readonly tenantHost =
    (typeof localStorage !== 'undefined' && localStorage.getItem('dreamcabs_tenant_host')?.trim()) ||
    'localhost';

  // Protocol always mirrors the current page (http on localhost, https in prod).
  readonly tenantProto =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https' : 'http';

  // On localhost the dev server runs on a non-standard port (e.g. :4200), so
  // include it in the preview URL so the link is actually reachable.
  readonly tenantPortSuffix =
    typeof window !== 'undefined' && window.location.port && this.isLocalLikeHost()
      ? `:${window.location.port}`
      : '';

  private isLocalLikeHost(): boolean {
    const h = (typeof localStorage !== 'undefined' && localStorage.getItem('dreamcabs_tenant_host')?.trim()) || 'localhost';
    return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1';
  }

  saving: Record<SectionKey, boolean> = {
    branding: false,
    fares: false,
    tipping: false,
    commission: false,
    carpool: false,
    geofence: false,
    wallet: false,
    subscription: false,
    referral: false,
    kiosk: false,
    maps: false,
    comms: false,
    templates: false,
    rights: false,
  };

  // Pending file uploads keyed by API field name.
  private pendingFiles: Partial<Record<string, File>> = {};

  thresholdJson = '';
  thresholdError = '';

  selectedRight: string | null = null;
  rightsReason = '';

  readonly commissionOptions = [
    { label: 'No Commission', value: 'no_commission' },
    { label: 'Commission with Debt', value: 'commission_with_debt' },
    { label: 'Commission without Debt', value: 'commission_without_debt' },
  ];

  readonly mapsOptions = [
    { label: 'Google Maps', value: 'google' },
    { label: 'FlightMap', value: 'flightmap' },
  ];

  readonly acceptPlaceholders = [
    '{{customer_name}}',
    '{{operator_name}}',
    '{{driver_name}}',
    '{{vehicle_no}}',
    '{{eta}}',
    '{{link}}',
  ];

  readonly cancelPlaceholders = ['{{engagement_id}}', '{{customer_name}}'];

  readonly rightsOptions = [
    { label: 'Right to be Forgotten', value: 'erasure' },
    { label: 'Right to Data Portability', value: 'portability' },
    { label: 'Right to Rectification', value: 'rectification' },
    { label: 'Right to Access', value: 'access' },
    { label: 'Right to Restrict Processing', value: 'restrict' },
    { label: 'Right to Object', value: 'object' },
  ];

  /** Which form fields each section is responsible for. */
  private readonly sectionFields: Record<SectionKey, string[]> = {
    branding: [
      'subdomain',
      'operator_name',
      'support_email',
      'main_color',
      'secondary_color',
      'logo',
      'fav_icon',
    ],
    fares: [
      'airport_charge_enable',
      'automated_toll_enable',
      'destination_toll_enable',
      'hotspot_toll_enable',
      'intra_geofence_fixed_fare_toll_enable',
      'custom_congestion_charge_enable',
      'night_time_charge_enable',
      'night_start_time',
      'night_end_time',
      'manual_driver_fare',
      'outstation_driver_allowance_enable',
    ],
    tipping: [
      'customer_tip_value_1',
      'customer_tip_value_2',
      'customer_tip_value_3',
      'corporate_tip_value_1',
      'corporate_tip_value_2',
      'corporate_tip_value_3',
      'tip_in_percentage',
    ],
    commission: ['commission_deduction'],
    carpool: ['carpool_fare_approx_percentage', 'carpool_fare_threshold'],
    geofence: [
      'check_destination_outside_geofence',
      'check_driver_debt',
      'update_driver_payment_modes_enabled',
    ],
    wallet: ['wallet_cash_tnc', 'wallet_cash_max_capping'],
    subscription: [
      'subscription_popup_title',
      'subscription_popup_desc',
      'subscription_popup_button1',
      'subscription_popup_button2',
    ],
    referral: ['invite_earn_image_android', 'invite_earn_image_ios'],
    kiosk: ['kiosk_enabled', 'kiosk_tnc_link'],
    maps: ['maps_preference', 'map_browser_key', 'web_google_api_key'],
    comms: ['use_proxy_email_creds', 'use_proxy_sms_creds'],
    templates: ['customer_ride_accept_msg', 'ride_cancellation_msg'],
    rights: [],
  };

  constructor(private api: ApiService, private msg: MessageService) {}

  ngOnInit(): void {
    this.fetch();
  }

  fetch(): void {
    this.loading = true;
    this.api.get<{ settings: OperatorSettings }>('/admin/operator-settings').subscribe({
      next: (res) => {
        this.settings = res.settings;
        this.thresholdJson = this.settings.carpool_fare_threshold
          ? JSON.stringify(this.settings.carpool_fare_threshold, null, 2)
          : '{}';
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.msg.add({ severity: 'error', summary: 'Failed to load operator settings' });
      },
    });
  }

  onFile(e: Event, field: string): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      this.pendingFiles[field] = file;
    }
  }

  onThresholdChange(value: string): void {
    this.thresholdJson = value;
    if (!value.trim()) {
      this.thresholdError = '';
      if (this.settings) this.settings.carpool_fare_threshold = null;
      return;
    }
    try {
      const parsed = JSON.parse(value);
      this.thresholdError = '';
      if (this.settings) this.settings.carpool_fare_threshold = parsed;
    } catch {
      this.thresholdError = 'Invalid JSON';
    }
  }

  save(section: SectionKey): void {
    if (!this.settings) return;
    this.saving[section] = true;

    const fd = new FormData();
    fd.append('_method', 'PATCH');

    const fields = this.sectionFields[section];
    for (const field of fields) {
      // Image-upload fields read from pendingFiles.
      if (this.pendingFiles[field]) {
        fd.append(field, this.pendingFiles[field] as File);
        continue;
      }
      // The two file-only sections never have a value column to send.
      if (field === 'logo' || field === 'fav_icon') continue;

      const raw = (this.settings as unknown as Record<string, unknown>)[field];
      if (raw === undefined) continue;

      if (typeof raw === 'boolean') {
        fd.append(field, raw ? '1' : '0');
      } else if (raw === null) {
        fd.append(field, '');
      } else if (typeof raw === 'object') {
        fd.append(field, JSON.stringify(raw));
      } else {
        fd.append(field, String(raw));
      }
    }

    this.api
      .postMultipart<{ settings: OperatorSettings; message: string }>(
        '/admin/operator-settings',
        fd,
      )
      .subscribe({
        next: (res) => {
          this.saving[section] = false;
          this.settings = res.settings;
          this.thresholdJson = res.settings.carpool_fare_threshold
            ? JSON.stringify(res.settings.carpool_fare_threshold, null, 2)
            : '{}';
          // Clear any consumed file inputs.
          for (const f of fields) delete this.pendingFiles[f];
          this.msg.add({ severity: 'success', summary: 'Saved', detail: this.titleFor(section) });
        },
        error: (err) => {
          this.saving[section] = false;
          const detail =
            err?.error?.errors
              ? Object.values(err.error.errors).flat().join(', ')
              : err?.error?.message || 'Save failed';
          this.msg.add({ severity: 'error', summary: 'Save failed', detail });
        },
      });
  }

  submitRights(): void {
    // Wire-up placeholder — DSAR submission endpoint to be added later.
    this.msg.add({
      severity: 'info',
      summary: 'DSAR queued',
      detail: `${this.selectedRight}: ${this.rightsReason || '(no reason)'}`,
    });
    this.selectedRight = null;
    this.rightsReason = '';
  }

  private titleFor(section: SectionKey): string {
    const map: Record<SectionKey, string> = {
      branding: 'Branding & Identity',
      fares: 'Fares & Tolls',
      tipping: 'Tipping',
      commission: 'Commission',
      carpool: 'Carpool',
      geofence: 'Driver controls',
      wallet: 'Wallet',
      subscription: 'Subscription popup',
      referral: 'Referral images',
      kiosk: 'Kiosk',
      maps: 'Maps',
      comms: 'Communications',
      templates: 'Notification templates',
      rights: 'Rights',
    };
    return map[section];
  }
}
