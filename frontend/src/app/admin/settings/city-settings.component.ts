import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, IconComponent, IconName } from '../../ui';

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

const TOGGLES: { key: keyof CitySettings; label: string; hint: string }[] = [
  { key: 'chat_enabled', label: 'In-app chat', hint: 'Let riders and drivers message during a trip.' },
  { key: 'show_region_specific_fare', label: 'Region-specific fare', hint: 'Show area-based fares in the booking flow.' },
  { key: 'show_vehicle_make_model', label: 'Vehicle make & model', hint: 'Display the car make/model to the rider.' },
  { key: 'driver_qr_booking_enabled', label: 'Driver QR booking', hint: 'Allow bookings started from a driver QR code.' },
  { key: 'driver_qr_booking_force_assign', label: 'QR force-assign', hint: 'Auto-assign the scanning driver to the trip.' },
  { key: 'city_level_otp', label: 'City-level OTP', hint: 'Use a single OTP policy across the city.' },
];

const NAV: { id: string; label: string; icon: IconName }[] = [
  { id: 'sec-toggles', label: 'Feature toggles', icon: 'bolt' },
  { id: 'sec-limits', label: 'Time & limits', icon: 'calendar' },
  { id: 'sec-branding', label: 'Branding', icon: 'gift' },
  { id: 'sec-messaging', label: 'Customer messaging', icon: 'envelope' },
  { id: 'sec-payment', label: 'Payment', icon: 'tag' },
  { id: 'sec-contacts', label: 'Support contacts', icon: 'phone' },
  { id: 'sec-operator', label: 'Operator', icon: 'id-card' },
];

/**
 * City Settings — per-city operational, branding and contact configuration
 * for the city chosen in the topbar switcher. A sticky section-nav rail
 * jumps between groups; everything saves together from the bottom bar.
 */
@Component({
  selector: 'app-city-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, IconComponent],
  template: `
    <!-- No city -->
    <div class="cue" *ngIf="!cityId">
      <tm-icon name="map-marker" [size]="24" />
      <p class="cue__title">No city selected</p>
      <p class="cue__text">Pick a city from the switcher in the top bar to manage its settings.</p>
    </div>

    <div class="cue" *ngIf="cityId && loading">
      <tm-icon name="refresh" [size]="20" /><p class="cue__text">Loading settings…</p>
    </div>

    <div class="cs" *ngIf="cityId && !loading && form">
      <!-- Section nav rail -->
      <aside class="rail">
        <span class="rail__overline">Sections</span>
        <nav class="rail__nav">
          <button
            *ngFor="let n of nav"
            type="button"
            class="rail__item"
            [class.is-active]="activeId === n.id"
            (click)="scrollTo(n.id)"
          >
            <tm-icon [name]="n.icon" [size]="15" />
            <span>{{ n.label }}</span>
          </button>
        </nav>
      </aside>

      <!-- Sections -->
      <div class="cs__main">
        <!-- Toggles -->
        <section class="sec" id="sec-toggles">
          <header class="sec__head">
            <span class="sec__icon"><tm-icon name="bolt" [size]="16" /></span>
            <div>
              <h3 class="sec__title">Feature toggles</h3>
              <p class="sec__desc">Turn city-level features on or off.</p>
            </div>
          </header>
          <div class="sec__body toggles">
            <label class="tgl" *ngFor="let t of toggles">
              <input type="checkbox" [ngModel]="boolVal(t.key)" (ngModelChange)="setBool(t.key, $event)" />
              <span class="tgl__track"></span>
              <span class="tgl__meta">
                <span class="tgl__label">{{ t.label }}</span>
                <span class="tgl__hint">{{ t.hint }}</span>
              </span>
            </label>
          </div>
        </section>

        <!-- Time & limits -->
        <section class="sec" id="sec-limits">
          <header class="sec__head">
            <span class="sec__icon"><tm-icon name="calendar" [size]="16" /></span>
            <div>
              <h3 class="sec__title">Time & limits</h3>
              <p class="sec__desc">Fare capping, night hours and advertising credits.</p>
            </div>
          </header>
          <div class="sec__body grid grid-4">
            <label class="field">
              <span class="field__lbl">Fare capping threshold</span>
              <input type="number" min="0" max="10000" [(ngModel)]="form.mandatory_fare_capping_threshold" />
            </label>
            <label class="field">
              <span class="field__lbl">Night start time</span>
              <input type="text" [(ngModel)]="form.night_start_time" placeholder="HH:MM:SS" />
            </label>
            <label class="field">
              <span class="field__lbl">Night end time</span>
              <input type="text" [(ngModel)]="form.night_end_time" placeholder="HH:MM:SS" />
            </label>
            <label class="field">
              <span class="field__lbl">Advertise credits</span>
              <input type="number" min="0" [(ngModel)]="form.advertise_credits" />
            </label>
          </div>
        </section>

        <!-- Branding -->
        <section class="sec" id="sec-branding">
          <header class="sec__head">
            <span class="sec__icon"><tm-icon name="gift" [size]="16" /></span>
            <div>
              <h3 class="sec__title">Branding</h3>
              <p class="sec__desc">Theme colour, app imagery and rich-text content.</p>
            </div>
          </header>
          <div class="sec__body">
            <label class="field field--color">
              <span class="field__lbl">Theme colour</span>
              <div class="color-row">
                <input type="color" [(ngModel)]="themeColorSafe" />
                <input type="text" [(ngModel)]="form.theme_color" placeholder="#06b6d4" maxlength="16" />
              </div>
            </label>

            <div class="media-grid">
              <div class="media" *ngFor="let m of mediaSlots">
                <span class="field__lbl">{{ m.label }}</span>
                <div class="media__box" [class.has-img]="previewUrl(m.key)">
                  <img *ngIf="previewUrl(m.key)" [src]="previewUrl(m.key)" alt="" />
                  <span *ngIf="!previewUrl(m.key)" class="media__ph"><tm-icon name="upload" [size]="20" /></span>
                </div>
                <label class="media__btn">
                  <tm-icon name="upload" [size]="13" /> Choose file
                  <input type="file" accept="image/*" (change)="pickFile($event, m.key)" hidden />
                </label>
              </div>
            </div>

            <label class="field">
              <span class="field__lbl">Onboarding info (HTML)</span>
              <textarea rows="4" [(ngModel)]="form.onboarding_info"></textarea>
            </label>
            <label class="field">
              <span class="field__lbl">Customer rate-card info (HTML)</span>
              <textarea rows="4" [(ngModel)]="form.customer_rate_card_info"></textarea>
            </label>
          </div>
        </section>

        <!-- Messaging -->
        <section class="sec" id="sec-messaging">
          <header class="sec__head">
            <span class="sec__icon"><tm-icon name="envelope" [size]="16" /></span>
            <div>
              <h3 class="sec__title">Customer messaging</h3>
              <p class="sec__desc">OTP message templates per platform.</p>
            </div>
          </header>
          <div class="sec__body grid grid-2">
            <label class="field">
              <span class="field__lbl">Login OTP message — Android</span>
              <textarea rows="3" [(ngModel)]="form.customer_login_otp_message"></textarea>
            </label>
            <label class="field">
              <span class="field__lbl">Login OTP message — iOS</span>
              <textarea rows="3" [(ngModel)]="form.customer_login_otp_message_ios"></textarea>
            </label>
          </div>
        </section>

        <!-- Payment -->
        <section class="sec" id="sec-payment">
          <header class="sec__head">
            <span class="sec__icon"><tm-icon name="tag" [size]="16" /></span>
            <div>
              <h3 class="sec__title">Payment</h3>
              <p class="sec__desc">Payment modes drivers can accept in this city.</p>
            </div>
          </header>
          <div class="sec__body">
            <div class="chips">
              <button
                *ngFor="let p of paymentModeOptions"
                type="button"
                class="chip"
                [class.is-on]="isMode(p.value)"
                (click)="toggleMode(p.value)"
              >
                <tm-icon [name]="isMode(p.value) ? 'check' : 'plus'" [size]="13" />
                {{ p.label }}
              </button>
            </div>
          </div>
        </section>

        <!-- Contacts -->
        <section class="sec" id="sec-contacts">
          <header class="sec__head">
            <span class="sec__icon"><tm-icon name="phone" [size]="16" /></span>
            <div>
              <h3 class="sec__title">Support contacts</h3>
              <p class="sec__desc">Emergency and support numbers shown in the apps.</p>
            </div>
          </header>
          <div class="sec__body grid grid-3">
            <label class="field">
              <span class="field__lbl">Emergency no.</span>
              <input type="text" [(ngModel)]="form.emergency_no" />
            </label>
            <label class="field">
              <span class="field__lbl">Police no.</span>
              <input type="text" [(ngModel)]="form.emergency_police_no" />
            </label>
            <label class="field">
              <span class="field__lbl">Driver support no.</span>
              <input type="text" [(ngModel)]="form.driver_support_no" />
            </label>
            <label class="field">
              <span class="field__lbl">Customer support no.</span>
              <input type="text" [(ngModel)]="form.customer_support_no" />
            </label>
            <label class="field">
              <span class="field__lbl">Support email</span>
              <input type="email" [(ngModel)]="form.support_email" />
            </label>
          </div>
        </section>

        <!-- Operator -->
        <section class="sec" id="sec-operator">
          <header class="sec__head">
            <span class="sec__icon"><tm-icon name="id-card" [size]="16" /></span>
            <div>
              <h3 class="sec__title">Operator</h3>
              <p class="sec__desc">Operator identity and operational notes.</p>
            </div>
          </header>
          <div class="sec__body">
            <label class="field">
              <span class="field__lbl">Operator name</span>
              <input type="text" [(ngModel)]="form.operator_name" />
            </label>
            <label class="field">
              <span class="field__lbl">Operational info</span>
              <textarea rows="3" [(ngModel)]="form.operational_info"></textarea>
            </label>
          </div>
        </section>

        <!-- Sticky save bar -->
        <div class="savebar">
          <span class="savebar__hint">Changes apply to the selected city only.</span>
          <tm-button variant="green" icon="check" [disabled]="saving" (clicked)="save()">
            {{ saving ? 'Saving…' : 'Save settings' }}
          </tm-button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .cue {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 48px 24px; text-align: center;
      background: var(--tm-surface);
      border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg);
      color: var(--tm-text-muted);
    }
    .cue__title { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .cue__text { margin: 0; font-size: 13px; }

    .cs {
      display: grid;
      grid-template-columns: 210px 1fr;
      gap: 16px;
      align-items: start;
    }

    /* section-nav rail */
    .rail {
      position: sticky; top: 12px;
      display: flex; flex-direction: column; gap: 8px;
      padding: 12px;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
    }
    .rail__overline {
      font-size: 10px; font-weight: 800; letter-spacing: 0.6px;
      text-transform: uppercase; color: var(--tm-text-muted);
      padding: 0 8px;
    }
    .rail__nav { display: flex; flex-direction: column; gap: 2px; }
    .rail__item {
      display: flex; align-items: center; gap: 9px;
      padding: 9px 10px; border-radius: 9px;
      background: transparent; cursor: pointer; text-align: left;
      font-size: 13px; font-weight: 700; color: var(--tm-text-muted);
      transition: background var(--tm-duration-fast) var(--tm-ease), color var(--tm-duration-fast) var(--tm-ease);
    }
    .rail__item:hover { background: var(--tm-canvas-2); color: var(--tm-text); }
    .rail__item.is-active { background: var(--tm-green-tint, #e0f7fa); color: var(--tm-green); }

    .cs__main { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

    .sec {
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      overflow: hidden;
      scroll-margin-top: 80px;
    }
    .sec__head {
      display: flex; align-items: center; gap: 11px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--tm-line);
    }
    .sec__icon {
      width: 34px; height: 34px; border-radius: 9px; flex: none;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--tm-green-tint, #e0f7fa); color: var(--tm-green);
    }
    .sec__title { margin: 0; font-size: 14px; font-weight: 800; color: var(--tm-text); }
    .sec__desc { margin: 1px 0 0; font-size: 12px; color: var(--tm-text-muted); }
    .sec__body { padding: 16px; display: flex; flex-direction: column; gap: 14px; }

    .grid { display: grid; gap: 14px; }
    .grid-2 { grid-template-columns: 1fr 1fr; }
    .grid-3 { grid-template-columns: repeat(3, 1fr); }
    .grid-4 { grid-template-columns: repeat(4, 1fr); }

    /* toggles */
    .toggles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .tgl { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; }
    .tgl input { display: none; }
    .tgl__track {
      flex: none; margin-top: 1px;
      width: 38px; height: 22px; border-radius: 999px;
      background: var(--tm-line); position: relative;
      transition: background var(--tm-duration-fast) var(--tm-ease);
    }
    .tgl__track::after {
      content: ''; position: absolute; top: 2px; left: 2px;
      width: 18px; height: 18px; border-radius: 50%;
      background: #fff; box-shadow: var(--tm-shadow-sm);
      transition: transform var(--tm-duration-fast) var(--tm-ease);
    }
    .tgl input:checked + .tgl__track { background: var(--tm-green); }
    .tgl input:checked + .tgl__track::after { transform: translateX(16px); }
    .tgl__meta { display: flex; flex-direction: column; }
    .tgl__label { font-size: 13px; font-weight: 700; color: var(--tm-text); }
    .tgl__hint { font-size: 11px; color: var(--tm-text-muted); }

    /* fields */
    .field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .field__lbl { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .field input[type=text], .field input[type=number], .field input[type=email], .field textarea {
      width: 100%; padding: 9px 11px;
      border: 1px solid var(--tm-line); border-radius: 9px;
      background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13px; outline: none; font-family: inherit;
    }
    .field input:focus, .field textarea:focus { border-color: var(--tm-green); }
    .field textarea { resize: vertical; }

    .color-row { display: flex; gap: 8px; align-items: center; }
    .color-row input[type=color] {
      width: 44px; height: 38px; padding: 2px;
      border: 1px solid var(--tm-line); border-radius: 9px; background: var(--tm-canvas);
      cursor: pointer;
    }
    .color-row input[type=text] { flex: 1; max-width: 180px; }

    /* media */
    .media-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .media { display: flex; flex-direction: column; gap: 6px; }
    .media__box {
      height: 110px; border-radius: 10px;
      border: 1px dashed var(--tm-line);
      background: var(--tm-canvas-2);
      display: flex; align-items: center; justify-content: center;
      overflow: hidden;
    }
    .media__box.has-img { border-style: solid; }
    .media__box img { width: 100%; height: 100%; object-fit: cover; }
    .media__ph { color: var(--tm-text-muted); }
    .media__btn {
      display: inline-flex; align-items: center; gap: 6px; justify-content: center;
      padding: 7px 10px; border-radius: 8px;
      background: var(--tm-canvas-2); color: var(--tm-text);
      font-size: 12px; font-weight: 700; cursor: pointer;
    }
    .media__btn:hover { background: var(--tm-line); }

    /* chips */
    .chips { display: flex; gap: 8px; flex-wrap: wrap; }
    .chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 13px; border-radius: 999px;
      border: 1px solid var(--tm-line);
      background: var(--tm-canvas); color: var(--tm-text-muted);
      font-size: 13px; font-weight: 700; cursor: pointer;
      transition: all var(--tm-duration-fast) var(--tm-ease);
    }
    .chip.is-on {
      background: var(--tm-green-tint, #e0f7fa);
      border-color: var(--tm-green); color: var(--tm-green);
    }

    /* save bar */
    .savebar {
      position: sticky; bottom: 0;
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 12px 16px;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      box-shadow: var(--tm-shadow-pop);
    }
    .savebar__hint { font-size: 12px; color: var(--tm-text-muted); }

    @media (max-width: 1000px) {
      .cs { grid-template-columns: 1fr; }
      .rail { position: static; }
      .rail__nav { flex-direction: row; flex-wrap: wrap; }
      .grid-3, .grid-4, .toggles, .media-grid { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 600px) {
      .grid-2, .grid-3, .grid-4, .toggles, .media-grid { grid-template-columns: 1fr; }
    }
  `],
})
export class CitySettingsComponent implements OnInit, AfterViewInit, OnDestroy {
  cityId: number | null = null;
  form: CitySettings | null = null;
  loading = false;
  saving = false;

  paymentModeOptions = PAYMENT_MODE_OPTIONS;
  toggles = TOGGLES;
  nav = NAV;
  activeId = NAV[0].id;
  mediaSlots: { key: 'logo' | 'splash_screen' | 'home_bg'; label: string }[] = [
    { key: 'logo', label: 'Logo' },
    { key: 'splash_screen', label: 'Splash screen' },
    { key: 'home_bg', label: 'Home background' },
  ];

  private files: { logo?: File; splash_screen?: File; home_bg?: File } = {};
  private localPreviews: { [k: string]: string } = {};
  private sub?: Subscription;
  private spy?: IntersectionObserver;

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private toast: ToastService,
    private host: ElementRef<HTMLElement>,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.sub = this.cityCtx.cityId$.subscribe((id) => {
      this.cityId = id;
      this.form = null;
      this.files = {};
      this.localPreviews = {};
      if (id != null) this.fetch();
    });
  }

  ngAfterViewInit(): void {
    // Observer attaches once sections exist; re-armed after each fetch.
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.spy?.disconnect();
  }

  // ── section-nav ──
  scrollTo(id: string): void {
    this.activeId = id;
    this.host.nativeElement.querySelector('#' + id)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }

  private armScrollSpy(): void {
    this.spy?.disconnect();
    const sections = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>('.sec[id]'),
    );
    if (!sections.length) return;
    this.spy = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) {
          this.activeId = visible.target.id;
          this.cdr.markForCheck();
        }
      },
      { rootMargin: '-72px 0px -55% 0px', threshold: 0 },
    );
    sections.forEach((s) => this.spy!.observe(s));
  }

  // ── toggle helpers (typed access into the form object) ──
  boolVal(key: keyof CitySettings): boolean {
    return !!(this.form as any)?.[key];
  }
  setBool(key: keyof CitySettings, val: boolean): void {
    if (this.form) (this.form as any)[key] = val;
  }

  get themeColorSafe(): string {
    const c = this.form?.theme_color || '';
    return /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#06b6d4';
  }
  set themeColorSafe(val: string) {
    if (this.form) this.form.theme_color = val;
  }

  isMode(mode: string): boolean {
    return (this.form?.allowed_driver_payment_modes ?? []).includes(mode);
  }
  toggleMode(mode: string): void {
    if (!this.form) return;
    const list = this.form.allowed_driver_payment_modes ?? [];
    this.form.allowed_driver_payment_modes = list.includes(mode)
      ? list.filter((m) => m !== mode)
      : [...list, mode];
  }

  previewUrl(key: 'logo' | 'splash_screen' | 'home_bg'): string | null {
    if (this.localPreviews[key]) return this.localPreviews[key];
    return (this.form as any)?.[`${key}_url`] ?? null;
  }

  fetch(): void {
    if (this.cityId == null) return;
    this.loading = true;
    this.api
      .get<{ settings: CitySettings }>(`/admin/cities/${this.cityId}/settings`)
      .subscribe({
        next: (res) => {
          const s = res.settings;
          if (!Array.isArray(s.allowed_driver_payment_modes)) {
            s.allowed_driver_payment_modes = [];
          }
          this.form = s;
          this.loading = false;
          this.activeId = NAV[0].id;
          // Sections render on the next tick — arm the scroll-spy then.
          setTimeout(() => this.armScrollSpy(), 0);
        },
        error: () => {
          this.loading = false;
          this.toast.error('Failed to load settings');
        },
      });
  }

  pickFile(e: Event, key: 'logo' | 'splash_screen' | 'home_bg'): void {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    this.files[key] = f;
    const reader = new FileReader();
    reader.onload = () => (this.localPreviews[key] = reader.result as string);
    reader.readAsDataURL(f);
  }

  save(): void {
    if (this.cityId == null || !this.form || this.saving) return;
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
      .postMultipart<{ settings: CitySettings }>(`/admin/cities/${this.cityId}/settings`, fd)
      .subscribe({
        next: (res) => {
          this.saving = false;
          this.files = {};
          this.localPreviews = {};
          if (res.settings) {
            if (!Array.isArray(res.settings.allowed_driver_payment_modes)) {
              res.settings.allowed_driver_payment_modes = [];
            }
            this.form = res.settings;
          }
          this.toast.success('City settings saved');
        },
        error: () => {
          this.saving = false;
          this.toast.error('Failed to save settings');
        },
      });
  }
}
