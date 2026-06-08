import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import {
  ButtonComponent,
  IconComponent,
  IconName,
  InputComponent,
  SelectComponent,
} from '../../ui';

interface OperatorSettings {
  customer_tip_value_1: number;
  customer_tip_value_2: number;
  customer_tip_value_3: number;
  corporate_tip_value_1: number;
  corporate_tip_value_2: number;
  corporate_tip_value_3: number;
  tip_in_percentage: boolean;

  check_destination_outside_geofence: boolean;
  check_driver_debt: boolean;
  update_driver_payment_modes_enabled: boolean;

  wallet_cash_min_capping: number;
  wallet_cash_max_capping: number;

  subscription_popup_enabled: boolean;
  subscription_popup_title: string | null;
  subscription_popup_desc: string | null;
  subscription_popup_button1: string | null;
  subscription_popup_button2: string | null;

  customer_ride_accept_msg: string | null;
  ride_cancellation_msg: string | null;
}

type SectionKey =
  | 'tipping'
  | 'geofence'
  | 'wallet'
  | 'subscription'
  | 'templates';

interface SectionMeta {
  key: SectionKey;
  label: string;
  icon: IconName;
  desc: string;
}

@Component({
  selector: 'app-operator-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectComponent,
  ],
  template: `
    <div class="page">
      <header class="page-head">
        <h1 class="page-head__title">Operator Settings</h1>
        <p class="page-head__sub">
          Global, non-city-scoped configuration that applies platform-wide. Each section saves independently.
        </p>
      </header>

      <div *ngIf="loading" class="loading">
        <span class="spinner" aria-hidden="true"></span>
        <span>Loading settings…</span>
      </div>

      <div *ngIf="!loading && settings" class="layout">
        <!-- ===================== Left nav ===================== -->
        <nav class="nav" aria-label="Settings sections">
          <button
            *ngFor="let s of sections"
            type="button"
            class="nav__item"
            [class.is-active]="activeSection === s.key"
            (click)="setSection(s.key)"
          >
            <span class="nav__icon"><tm-icon [name]="s.icon" [size]="16" /></span>
            <span class="nav__label">{{ s.label }}</span>
            <tm-icon class="nav__chev" name="chevron-right" [size]="14" />
          </button>
        </nav>

        <!-- ===================== Content panel ===================== -->
        <section class="panel">
          <header class="panel__head">
            <div>
              <h2 class="panel__title">{{ currentSection.label }}</h2>
              <p class="panel__desc">{{ currentSection.desc }}</p>
            </div>
            <span class="panel__icon"><tm-icon [name]="currentSection.icon" [size]="20" /></span>
          </header>

          <div class="panel__body">
            <!-- ============= TIPPING ============= -->
            <ng-container *ngIf="activeSection === 'tipping'">
              <div class="fields">
                <div class="field">
                  <span class="field__label">Customer tip presets</span>
                  <div class="triple">
                    <tm-input type="number" [(ngModel)]="settings.customer_tip_value_1" />
                    <tm-input type="number" [(ngModel)]="settings.customer_tip_value_2" />
                    <tm-input type="number" [(ngModel)]="settings.customer_tip_value_3" />
                  </div>
                </div>
                <div class="field">
                  <span class="field__label">Corporate tip presets</span>
                  <div class="triple">
                    <tm-input type="number" [(ngModel)]="settings.corporate_tip_value_1" />
                    <tm-input type="number" [(ngModel)]="settings.corporate_tip_value_2" />
                    <tm-input type="number" [(ngModel)]="settings.corporate_tip_value_3" />
                  </div>
                </div>
              </div>
              <label class="switch-row">
                <span class="switch-row__text">
                  <span class="switch-row__title">Tip in percentage</span>
                  <span class="switch-row__sub">Treat the preset values as a percentage of the ride fare instead of flat rupees.</span>
                </span>
                <span class="switch">
                  <input type="checkbox" [(ngModel)]="settings.tip_in_percentage" />
                  <span class="switch__track"><span class="switch__thumb"></span></span>
                </span>
              </label>
            </ng-container>

            <!-- ============= GEOFENCE / DRIVER ============= -->
            <ng-container *ngIf="activeSection === 'geofence'">
              <label class="switch-row">
                <span class="switch-row__text">
                  <span class="switch-row__title">Check destination outside geofence</span>
                  <span class="switch-row__sub">Flag trips whose drop-off falls outside the operating area.</span>
                </span>
                <span class="switch">
                  <input type="checkbox" [(ngModel)]="settings.check_destination_outside_geofence" />
                  <span class="switch__track"><span class="switch__thumb"></span></span>
                </span>
              </label>
              <label class="switch-row">
                <span class="switch-row__text">
                  <span class="switch-row__title">Check driver debt</span>
                  <span class="switch-row__sub">Block dispatch for drivers carrying an outstanding balance.</span>
                </span>
                <span class="switch">
                  <input type="checkbox" [(ngModel)]="settings.check_driver_debt" />
                  <span class="switch__track"><span class="switch__thumb"></span></span>
                </span>
              </label>
              <label class="switch-row">
                <span class="switch-row__text">
                  <span class="switch-row__title">Update driver payment modes</span>
                  <span class="switch-row__sub">Allow drivers to change their accepted payment methods.</span>
                </span>
                <span class="switch">
                  <input type="checkbox" [(ngModel)]="settings.update_driver_payment_modes_enabled" />
                  <span class="switch__track"><span class="switch__thumb"></span></span>
                </span>
              </label>
            </ng-container>

            <!-- ============= WALLET ============= -->
            <ng-container *ngIf="activeSection === 'wallet'">
              <div class="fields">
                <div class="field">
                  <span class="field__label">Wallet min capping (₹)</span>
                  <tm-input type="number" [(ngModel)]="settings.wallet_cash_min_capping" />
                  <span class="field__hint">Lowest balance a wallet may reach. Can be negative (e.g. -500 allows up to ₹500 of debt). 0 = can't go below zero.</span>
                </div>
                <div class="field">
                  <span class="field__label">Wallet max capping (₹)</span>
                  <tm-input type="number" [(ngModel)]="settings.wallet_cash_max_capping" />
                  <span class="field__hint">Highest balance a wallet may hold. 0 = no upper limit.</span>
                </div>
              </div>
            </ng-container>

            <!-- ============= SUBSCRIPTION ============= -->
            <ng-container *ngIf="activeSection === 'subscription'">
              <label class="switch-row">
                <span class="switch-row__text">
                  <span class="switch-row__title">Prompt drivers to subscribe</span>
                  <span class="switch-row__sub">When on, drivers see this popup as soon as they open the Subscriptions screen. When off, it stays hidden.</span>
                </span>
                <span class="switch">
                  <input type="checkbox" [(ngModel)]="settings.subscription_popup_enabled" />
                  <span class="switch__track"><span class="switch__thumb"></span></span>
                </span>
              </label>
              <div class="fields">
                <div class="field">
                  <span class="field__label">Popup title</span>
                  <tm-input [(ngModel)]="settings.subscription_popup_title" />
                </div>
                <div class="field">
                  <span class="field__label">Popup description</span>
                  <tm-input [(ngModel)]="settings.subscription_popup_desc" />
                </div>
                <div class="field">
                  <span class="field__label">Button 1 label</span>
                  <tm-input [(ngModel)]="settings.subscription_popup_button1" />
                </div>
                <div class="field">
                  <span class="field__label">Button 2 label</span>
                  <tm-input [(ngModel)]="settings.subscription_popup_button2" />
                </div>
              </div>
            </ng-container>

            <!-- ============= TEMPLATES ============= -->
            <ng-container *ngIf="activeSection === 'templates'">
              <div class="field field--full">
                <span class="field__label">Customer ride-accept message</span>
                <textarea class="ta" rows="4" [(ngModel)]="settings.customer_ride_accept_msg"></textarea>
                <div class="placeholders">
                  <span class="chip" *ngFor="let p of acceptPlaceholders">{{ p }}</span>
                </div>
              </div>
              <div class="field field--full">
                <span class="field__label">Ride cancellation message</span>
                <textarea class="ta" rows="3" [(ngModel)]="settings.ride_cancellation_msg"></textarea>
                <div class="placeholders">
                  <span class="chip" *ngFor="let p of cancelPlaceholders">{{ p }}</span>
                </div>
              </div>
            </ng-container>
          </div>

          <footer class="panel__foot">
            <tm-button
              variant="ink"
              icon="check"
              [loading]="saving[activeSection]"
              (clicked)="save(activeSection)"
            >Save changes</tm-button>
          </footer>
        </section>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .page { display: flex; flex-direction: column; gap: var(--tm-space-5); }

    .page-head__title {
      margin: 0 0 4px;
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: var(--tm-text);
    }
    .page-head__sub { margin: 0; font-size: 13px; color: var(--tm-text-muted); font-weight: 500; }

    /* -------- Loading -------- */
    .loading {
      display: flex; align-items: center; justify-content: center; gap: 10px;
      padding: var(--tm-space-10);
      color: var(--tm-text-muted); font-weight: 600;
    }
    .spinner {
      width: 18px; height: 18px; border-radius: 50%;
      border: 2px solid var(--tm-line-2); border-top-color: var(--tm-green);
      animation: os-spin 0.7s linear infinite;
    }
    @keyframes os-spin { to { transform: rotate(360deg); } }

    /* -------- Layout -------- */
    .layout {
      display: grid;
      grid-template-columns: 248px 1fr;
      gap: var(--tm-space-4);
      align-items: start;
    }

    /* -------- Left nav -------- */
    .nav {
      display: flex; flex-direction: column; gap: 2px;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg);
      padding: 8px;
      position: sticky;
      top: var(--tm-space-4);
    }
    .nav__item {
      display: flex; align-items: center; gap: 10px;
      width: 100%;
      padding: 10px 12px;
      border: 0;
      background: transparent;
      border-radius: var(--tm-radius-md);
      color: var(--tm-text-muted);
      font-family: var(--tm-font-body);
      font-size: 13px; font-weight: 700;
      text-align: left;
      cursor: pointer;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .nav__item:hover:not(.is-active) { background: var(--tm-canvas-2); color: var(--tm-text); }
    .nav__item.is-active { background: var(--tm-ink); color: #fff; }
    .nav__icon { display: inline-flex; }
    .nav__label { flex: 1; }
    .nav__chev { opacity: 0.4; }
    .nav__item.is-active .nav__chev { opacity: 0.85; }

    /* -------- Panel -------- */
    .panel {
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg);
      overflow: hidden;
      min-width: 0;
    }
    .panel__head {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
      padding: var(--tm-space-5);
      border-bottom: 1px solid var(--tm-line);
    }
    .panel__title { margin: 0; font-size: 18px; font-weight: 800; letter-spacing: -0.01em; color: var(--tm-text); }
    .panel__desc { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); font-weight: 500; max-width: 60ch; }
    .panel__icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 40px; height: 40px; flex-shrink: 0;
      border-radius: var(--tm-radius-md);
      background: var(--tm-canvas-2);
      color: var(--tm-text-muted);
    }
    .panel__body {
      padding: var(--tm-space-5);
      display: flex; flex-direction: column; gap: var(--tm-space-4);
    }
    .panel__foot {
      display: flex; justify-content: flex-end;
      padding: var(--tm-space-4) var(--tm-space-5);
      border-top: 1px solid var(--tm-line);
      background: var(--tm-canvas);
    }

    /* -------- Fields -------- */
    .fields { display: grid; grid-template-columns: 1fr 1fr; gap: var(--tm-space-4); }
    .field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .field--full { grid-column: 1 / -1; }
    .field__label {
      font-size: 11px; font-weight: 800; letter-spacing: 0.06em;
      text-transform: uppercase; color: var(--tm-text-muted);
    }
    .field__hint { font-size: 11px; color: var(--tm-text-soft); font-weight: 500; }
    .triple { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }

    /* -------- Textarea -------- */
    .ta {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      font-family: inherit; font-size: 14px;
      color: var(--tm-text); background: var(--tm-surface);
      outline: none; resize: vertical; min-height: 92px;
      transition: border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .ta:focus { border-color: var(--tm-ink); }

    /* -------- Switch row -------- */
    .switch-row {
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      padding: 14px 16px;
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-md);
      background: var(--tm-canvas);
      cursor: pointer;
    }
    .switch-row__title { display: block; font-size: 14px; font-weight: 700; color: var(--tm-text); }
    .switch-row__sub { display: block; font-size: 12px; color: var(--tm-text-muted); margin-top: 1px; }
    .switch { display: inline-flex; flex-shrink: 0; }
    .switch input { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
    .switch__track {
      position: relative; width: 40px; height: 22px; border-radius: 999px;
      background: var(--tm-line-2);
      transition: background var(--tm-duration-fast) var(--tm-ease);
    }
    .switch__thumb {
      position: absolute; top: 3px; left: 3px;
      width: 16px; height: 16px; border-radius: 50%;
      background: #fff; box-shadow: 0 1px 2px rgba(15, 20, 25, 0.25);
      transition: transform var(--tm-duration-fast) var(--tm-ease);
    }
    .switch input:checked + .switch__track { background: var(--tm-green); }
    .switch input:checked + .switch__track .switch__thumb { transform: translateX(18px); }

    /* -------- Placeholders / chips -------- */
    .placeholders { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
    .chip {
      font-family: var(--tm-font-mono); font-size: 11px; font-weight: 700;
      padding: 3px 8px; border-radius: var(--tm-radius-pill);
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
    }

    /* -------- Responsive -------- */
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
      .nav {
        flex-direction: row; overflow-x: auto; position: static;
        scrollbar-width: none;
      }
      .nav::-webkit-scrollbar { display: none; }
      .nav__item { white-space: nowrap; }
      .nav__chev { display: none; }
      .fields, .triple { grid-template-columns: 1fr; }
    }
  `],
})
export class OperatorSettingsComponent implements OnInit {
  settings: OperatorSettings | null = null;
  loading = false;

  activeSection: SectionKey = 'tipping';

  readonly sections: SectionMeta[] = [
    { key: 'tipping',      label: 'Tipping',           icon: 'gift',          desc: 'Preset tip amounts shown to riders, and whether they are flat ₹ or a percentage of fare.' },
    { key: 'geofence',     label: 'Driver & Geofence', icon: 'driver-helmet', desc: 'Operational safety checks applied to drivers and trips.' },
    { key: 'wallet',       label: 'Wallet',            icon: 'rupee',         desc: 'Cash-wallet limits and the terms shown to users.' },
    { key: 'subscription', label: 'Subscription',      icon: 'star',          desc: 'Copy for the driver subscription promo popup.' },
    { key: 'templates',    label: 'Templates',         icon: 'envelope',      desc: 'Notification copy with dynamic placeholders.' },
  ];

  saving: Record<SectionKey, boolean> = {
    tipping: false,
    geofence: false,
    wallet: false,
    subscription: false,
    templates: false,
  };

  // Only tokens the backend can actually fill are advertised, so a typed
  // placeholder never renders blank for the customer.
  readonly acceptPlaceholders = [
    '{{customer_name}}',
    '{{operator_name}}',
    '{{driver_name}}',
  ];

  readonly cancelPlaceholders = ['{{engagement_id}}', '{{customer_name}}'];

  /** Which form fields each section is responsible for. */
  private readonly sectionFields: Record<SectionKey, string[]> = {
    tipping: [
      'customer_tip_value_1',
      'customer_tip_value_2',
      'customer_tip_value_3',
      'corporate_tip_value_1',
      'corporate_tip_value_2',
      'corporate_tip_value_3',
      'tip_in_percentage',
    ],
    geofence: [
      'check_destination_outside_geofence',
      'check_driver_debt',
      'update_driver_payment_modes_enabled',
    ],
    wallet: ['wallet_cash_min_capping', 'wallet_cash_max_capping'],
    subscription: [
      'subscription_popup_enabled',
      'subscription_popup_title',
      'subscription_popup_desc',
      'subscription_popup_button1',
      'subscription_popup_button2',
    ],
    templates: ['customer_ride_accept_msg', 'ride_cancellation_msg'],
  };

  constructor(private api: ApiService, private toast: ToastService) {}

  ngOnInit(): void {
    this.fetch();
  }

  get currentSection(): SectionMeta {
    return this.sections.find((s) => s.key === this.activeSection) ?? this.sections[0];
  }

  setSection(key: SectionKey): void {
    this.activeSection = key;
  }

  fetch(): void {
    this.loading = true;
    this.api.get<{ settings: OperatorSettings }>('/admin/operator-settings').subscribe({
      next: (res) => {
        this.settings = res.settings;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.toast.error('Failed to load operator settings', { title: 'Load failed' });
      },
    });
  }

  save(section: SectionKey): void {
    if (!this.settings) return;
    this.saving[section] = true;

    const fd = new FormData();
    fd.append('_method', 'PATCH');

    const fields = this.sectionFields[section];
    for (const field of fields) {
      const raw = (this.settings as unknown as Record<string, unknown>)[field];
      if (raw === undefined) continue;

      if (typeof raw === 'boolean') {
        fd.append(field, raw ? '1' : '0');
      } else if (raw === null) {
        fd.append(field, '');
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
          this.toast.success(`${this.titleFor(section)} saved`);
        },
        error: (err) => {
          this.saving[section] = false;
          const detail = err?.error?.errors
            ? Object.values(err.error.errors).flat().join(', ')
            : err?.error?.message || 'Save failed';
          this.toast.error(detail, { title: 'Save failed' });
        },
      });
  }

  private titleFor(section: SectionKey): string {
    return this.sections.find((s) => s.key === section)?.label ?? 'Settings';
  }
}
