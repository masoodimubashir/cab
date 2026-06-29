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
import { forkJoin, Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, IconComponent, IconName } from '../../ui';

interface DispatcherSetting {
  id: number;
  city_id: number;
  kind: 'local' | 'outstation';
  automatic_dispatcher_type: boolean;
  dispatcher_hop_interval_sec: number;
  dispatcher_hop_radius_m: number;
  request_radius_m: number;
  max_hops: number;
  driver_accept_window_sec: number;
  cancel_block_radius_m: number;
  schedule_available: boolean;
  schedule_dispatcher_type: boolean;
  dispatch_only_assigned_scheduled: boolean;
  schedule_dispatch_instantly: 'DELAYED' | 'INSTANT' | 'INSTANT_AND_DELAYED';
  scheduler_alarm_min: number;
  schedule_current_time_diff_min: number;
  schedule_days_limit: number;
  schedule_days_limit_return: number | null;
  schedule_rides_limit: number;
  schedule_cancel_window_min: number;
}

const DISPATCH_MODES = [
  { label: 'Delayed', value: 'DELAYED' as const },
  { label: 'Instant', value: 'INSTANT' as const },
  { label: 'Instant & Delayed', value: 'INSTANT_AND_DELAYED' as const },
];

interface CitySettings {
  id: number;
  city_id: number;

  chat_enabled: boolean;
  show_region_specific_fare: boolean;
  show_vehicle_make_model: boolean;

  customer_login_otp_message: string | null;
  customer_login_otp_message_ios: string | null;

  allowed_driver_payment_modes: string[];
  negotiation_floor_percent: number | null;
  private_no_show_threshold_minutes: number | null;
  private_no_show_charge_per_minute: number | null;
  private_driver_no_show_grace_minutes: number;
  private_cancellation_rule: string | null;

  fixed_waiting_time_per_stop_minutes: number;
  fixed_stop_arrival_radius_m: number;
  fixed_driver_missed_stop_grace_minutes: number;
  fixed_customer_pickup_radius_m: number;
  fixed_vehicle_approaching_alert_radius_m: number;
  fixed_customer_grace_minutes: number;
  fixed_boarding_confirmation_mode: 'driver_only' | 'customer_otp' | 'qr_scan' | 'driver_customer';

  shuttle_pickup_match_distance_km: number;
  shuttle_drop_match_distance_km: number;
  shuttle_max_passenger_delay_minutes: number;
  shuttle_join_after_start_enabled: boolean;
  shuttle_fare_lock_enabled: boolean;
  shuttle_driver_waiting_time_minutes: number;
  shuttle_pickup_arrival_radius_m: number;
  shuttle_driver_missed_pickup_grace_minutes: number;
  shuttle_customer_pickup_radius_m: number;
  shuttle_approaching_alert_radius_m: number;
  shuttle_customer_grace_minutes: number;
  shuttle_driver_payout_share_percent: number | null;

  emergency_no: string | null;
  emergency_police_no: string | null;
  driver_support_no: string | null;
  customer_support_no: string | null;
  support_email: string | null;
}

const PAYMENT_MODE_OPTIONS = [
  { label: 'Cash', value: 'CASH' },
  { label: 'Razorpay', value: 'RAZORPAY' },
];

const TOGGLES: { key: keyof CitySettings; label: string; hint: string }[] = [
  { key: 'chat_enabled', label: 'In-app chat', hint: 'Let riders and drivers message during a trip.' },
  { key: 'show_region_specific_fare', label: 'Region-specific fare', hint: 'Show area-based fares in the booking flow.' },
  { key: 'show_vehicle_make_model', label: 'Vehicle make & model', hint: 'Display the car make/model to the rider.' },
];

const NAV: { id: string; label: string; icon: IconName }[] = [
  { id: 'sec-general', label: 'General', icon: 'bolt' },
  { id: 'sec-private', label: 'Private rides', icon: 'rupee' },
  { id: 'sec-fixed', label: 'Fixed rides', icon: 'map-marker' },
  { id: 'sec-shuttle', label: 'Shuttle rides', icon: 'send' },
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
        <!-- General -->
        <section class="sec" id="sec-general">
          <header class="sec__head">
            <span class="sec__icon"><tm-icon name="bolt" [size]="16" /></span>
            <div><h3 class="sec__title">General</h3><p class="sec__desc">City-wide settings shared by private, fixed, and shuttle rides.</p></div>
          </header>
          <div class="sec__body">
            <div class="subsec"><h4 class="subsec__title">Feature toggles</h4><div class="toggles"><label class="tgl" *ngFor="let t of toggles"><input type="checkbox" [ngModel]="boolVal(t.key)" (ngModelChange)="setBool(t.key, $event)" /><span class="tgl__track"></span><span class="tgl__meta"><span class="tgl__label">{{ t.label }}</span><span class="tgl__hint">{{ t.hint }}</span></span></label></div></div>
            <div class="subsec"><h4 class="subsec__title">Payments</h4><div class="chips"><button *ngFor="let p of paymentModeOptions" type="button" class="chip" [class.is-on]="isMode(p.value)" (click)="toggleMode(p.value)"><tm-icon [name]="isMode(p.value) ? 'check' : 'plus'" [size]="13" />{{ p.label }}</button></div></div>
            <div class="subsec"><h4 class="subsec__title">Customer messaging</h4><div class="grid grid-2"><label class="field"><span class="field__lbl">Login OTP message - Android</span><textarea rows="3" [(ngModel)]="form.customer_login_otp_message"></textarea></label><label class="field"><span class="field__lbl">Login OTP message - iOS</span><textarea rows="3" [(ngModel)]="form.customer_login_otp_message_ios"></textarea></label></div></div>
            <div class="subsec"><h4 class="subsec__title">Support contacts</h4><div class="grid grid-3"><label class="field"><span class="field__lbl">Emergency no.</span><input type="text" [(ngModel)]="form.emergency_no" /></label><label class="field"><span class="field__lbl">Police no.</span><input type="text" [(ngModel)]="form.emergency_police_no" /></label><label class="field"><span class="field__lbl">Driver support no.</span><input type="text" [(ngModel)]="form.driver_support_no" /></label><label class="field"><span class="field__lbl">Customer support no.</span><input type="text" [(ngModel)]="form.customer_support_no" /></label><label class="field"><span class="field__lbl">Support email</span><input type="email" [(ngModel)]="form.support_email" /></label></div></div>
          </div>
        </section>
        <section class="sec" id="sec-private">
          <header class="sec__head"><span class="sec__icon"><tm-icon name="rupee" [size]="16" /></span><div><h3 class="sec__title">Private Ride Settings</h3><p class="sec__desc">Rules for normal local and outstation private rides.</p></div></header>
          <div class="sec__body">
            <div class="subsec"><h4 class="subsec__title">Negotiation</h4><div class="grid grid-2"><label class="field"><span class="field__lbl">Maximum negotiation discount (%)</span><input type="number" min="0" max="100" step="0.01" [(ngModel)]="form.negotiation_floor_percent" /></label></div></div>
            <div class="subsec" *ngIf="activeDispatcher as d">
              <h4 class="subsec__title">Private dispatch</h4>
              <div class="seg">
                <button *ngFor="let row of dispatcherSettings" type="button" class="seg__btn" [class.is-on]="activeDispatcherKind === row.kind" (click)="activeDispatcherKind = row.kind">{{ kindLabel(row.kind) }}</button>
              </div>
              <label class="tgl"><input type="checkbox" [(ngModel)]="d.automatic_dispatcher_type" /><span class="tgl__track"></span><span class="tgl__meta"><span class="tgl__label">Automatic dispatcher</span><span class="tgl__hint">Auto-send private ride requests to eligible drivers.</span></span></label>
              <div class="grid grid-4">
                <label class="field"><span class="field__lbl">Request radius (m)</span><input type="number" min="0" max="50000" [(ngModel)]="d.request_radius_m" /></label>
                <label class="field"><span class="field__lbl">Hop interval (sec)</span><input type="number" min="1" max="600" [(ngModel)]="d.dispatcher_hop_interval_sec" /></label>
                <label class="field"><span class="field__lbl">Hop radius (m)</span><input type="number" min="0" max="50000" [(ngModel)]="d.dispatcher_hop_radius_m" /></label>
                <label class="field"><span class="field__lbl">Max hops</span><input type="number" min="1" max="50" [(ngModel)]="d.max_hops" /></label>
                <label class="field"><span class="field__lbl">Driver accept window (sec)</span><input type="number" min="0" max="600" [(ngModel)]="d.driver_accept_window_sec" /></label>
                <label class="field"><span class="field__lbl">Block cancel within (m)</span><input type="number" min="0" max="50000" [(ngModel)]="d.cancel_block_radius_m" /></label>
              </div>
              <h4 class="subsec__title">Scheduled private rides</h4>
              <div class="toggles">
                <label class="tgl"><input type="checkbox" [(ngModel)]="d.schedule_available" /><span class="tgl__track"></span><span class="tgl__meta"><span class="tgl__label">Scheduling available</span></span></label>
                <label class="tgl"><input type="checkbox" [(ngModel)]="d.schedule_dispatcher_type" /><span class="tgl__track"></span><span class="tgl__meta"><span class="tgl__label">Auto-fire at alarm time</span></span></label>
                <label class="tgl"><input type="checkbox" [(ngModel)]="d.dispatch_only_assigned_scheduled" /><span class="tgl__track"></span><span class="tgl__meta"><span class="tgl__label">Dispatch only pre-assigned</span></span></label>
              </div>
              <div class="grid grid-4">
                <label class="field"><span class="field__lbl">Schedule dispatch mode</span><select [(ngModel)]="d.schedule_dispatch_instantly"><option *ngFor="let mode of dispatchModes" [value]="mode.value">{{ mode.label }}</option></select></label>
                <label class="field"><span class="field__lbl">Scheduler alarm (min)</span><input type="number" min="0" max="1440" [(ngModel)]="d.scheduler_alarm_min" /></label>
                <label class="field"><span class="field__lbl">Min lead time (min)</span><input type="number" min="0" max="1440" [(ngModel)]="d.schedule_current_time_diff_min" /></label>
                <label class="field"><span class="field__lbl">Days limit</span><input type="number" min="0" max="365" [(ngModel)]="d.schedule_days_limit" /></label>
                <label class="field" *ngIf="d.kind === 'outstation'"><span class="field__lbl">Return days limit</span><input type="number" min="0" max="365" [(ngModel)]="d.schedule_days_limit_return" /></label>
                <label class="field"><span class="field__lbl">Rides limit / customer</span><input type="number" min="0" max="100" [(ngModel)]="d.schedule_rides_limit" /></label>
                <label class="field"><span class="field__lbl">Cancel window (min)</span><input type="number" min="0" max="1440" [(ngModel)]="d.schedule_cancel_window_min" /></label>
              </div>
            </div>
            <div class="subsec"><h4 class="subsec__title">No-show / cancellation</h4><div class="grid grid-4"><label class="field"><span class="field__lbl">Customer no-show threshold (min)</span><input type="number" min="0" max="180" step="0.01" [(ngModel)]="form.private_no_show_threshold_minutes" /></label><label class="field"><span class="field__lbl">No-show charge / min</span><input type="number" min="0" step="0.01" [(ngModel)]="form.private_no_show_charge_per_minute" /></label><label class="field"><span class="field__lbl">Driver no-show grace (min)</span><input type="number" min="0" max="180" step="1" [(ngModel)]="form.private_driver_no_show_grace_minutes" /></label></div></div>
          </div>
        </section>
        <section class="sec" id="sec-fixed"><header class="sec__head"><span class="sec__icon"><tm-icon name="map-marker" [size]="16" /></span><div><h3 class="sec__title">Fixed Ride Settings</h3><p class="sec__desc">City-level boarding and no-show rules for fixed shared rides.</p></div></header><div class="sec__body"><div class="subsec"><h4 class="subsec__title">Boarding & no-show</h4><div class="grid grid-4"><label class="field"><span class="field__lbl">Wait time per stop (min)</span><input type="number" min="0" max="180" step="1" [(ngModel)]="form.fixed_waiting_time_per_stop_minutes" /></label><label class="field"><span class="field__lbl">Stop arrival radius (m)</span><input type="number" min="25" max="5000" step="5" [(ngModel)]="form.fixed_stop_arrival_radius_m" /></label><label class="field"><span class="field__lbl">Driver missed stop grace (min)</span><input type="number" min="0" max="180" step="1" [(ngModel)]="form.fixed_driver_missed_stop_grace_minutes" /></label><label class="field"><span class="field__lbl">Customer pickup radius (m)</span><input type="number" min="25" max="5000" step="5" [(ngModel)]="form.fixed_customer_pickup_radius_m" /></label><label class="field"><span class="field__lbl">Approaching alert radius (m)</span><input type="number" min="50" max="10000" step="50" [(ngModel)]="form.fixed_vehicle_approaching_alert_radius_m" /></label><label class="field"><span class="field__lbl">Customer grace (min)</span><input type="number" min="0" max="180" step="1" [(ngModel)]="form.fixed_customer_grace_minutes" /></label></div></div></div></section>
        <section class="sec sec--planned" id="sec-shuttle">
          <header class="sec__head">
            <span class="sec__icon"><tm-icon name="send" [size]="16" /></span>
            <div>
              <div class="sec__title-row">
                <h3 class="sec__title">Shuttle Ride Settings</h3>
                <span class="badge badge--planned">Planned</span>
              </div>
              <p class="sec__desc">Dynamic shuttle controls from the roadmap. These are not active in customer or driver apps yet.</p>
            </div>
          </header>
          <div class="sec__body">
            <div class="planned-note">
              <tm-icon name="shield" [size]="16" />
              <span>Keep this section as planning reference only. Enable editing after shuttle pricing, booking, matching, driver sequence, cancellation, and no-show flows are wired end to end.</span>
            </div>
            <div class="subsec">
              <h4 class="subsec__title">Matching rules</h4>
              <div class="grid grid-4">
                <label class="field"><span class="field__lbl">Pickup match distance (km)</span><input type="number" [disabled]="true" [value]="form.shuttle_pickup_match_distance_km" /></label>
                <label class="field"><span class="field__lbl">Drop match distance (km)</span><input type="number" [disabled]="true" [value]="form.shuttle_drop_match_distance_km" /></label>
                <label class="field"><span class="field__lbl">Max passenger delay (min)</span><input type="number" [disabled]="true" [value]="form.shuttle_max_passenger_delay_minutes" /></label>
              </div>
              <div class="toggles">
                <label class="tgl tgl--disabled"><input type="checkbox" [disabled]="true" [checked]="form.shuttle_join_after_start_enabled" /><span class="tgl__track"></span><span class="tgl__meta"><span class="tgl__label">Allow joining after ride start</span></span></label>
                <label class="tgl tgl--disabled"><input type="checkbox" [disabled]="true" [checked]="form.shuttle_fare_lock_enabled" /><span class="tgl__track"></span><span class="tgl__meta"><span class="tgl__label">Lock fare after booking</span></span></label>
              </div>
            </div>
            <div class="subsec">
              <h4 class="subsec__title">Boarding & no-show</h4>
              <div class="grid grid-4">
                <label class="field"><span class="field__lbl">Driver waiting time (min)</span><input type="number" [disabled]="true" [value]="form.shuttle_driver_waiting_time_minutes" /></label>
                <label class="field"><span class="field__lbl">Pickup arrival radius (m)</span><input type="number" [disabled]="true" [value]="form.shuttle_pickup_arrival_radius_m" /></label>
                <label class="field"><span class="field__lbl">Driver missed pickup grace (min)</span><input type="number" [disabled]="true" [value]="form.shuttle_driver_missed_pickup_grace_minutes" /></label>
                <label class="field"><span class="field__lbl">Customer pickup radius (m)</span><input type="number" [disabled]="true" [value]="form.shuttle_customer_pickup_radius_m" /></label>
                <label class="field"><span class="field__lbl">Approaching alert radius (m)</span><input type="number" [disabled]="true" [value]="form.shuttle_approaching_alert_radius_m" /></label>
                <label class="field"><span class="field__lbl">Customer grace (min)</span><input type="number" [disabled]="true" [value]="form.shuttle_customer_grace_minutes" /></label>
              </div>
            </div>
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
    .seg { display: inline-flex; gap: 4px; padding: 4px; align-self: flex-start; background: var(--tm-canvas-2); border-radius: 10px; }
    .seg__btn { padding: 8px 14px; border-radius: 8px; background: transparent; color: var(--tm-text-muted); font-size: 13px; font-weight: 700; cursor: pointer; }
    .seg__btn.is-on { background: var(--tm-surface); color: var(--tm-text); box-shadow: var(--tm-shadow-sm); }

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
    .sec__title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .badge {
      display: inline-flex; align-items: center; height: 22px; padding: 0 8px;
      border-radius: 999px; font-size: 11px; font-weight: 800;
    }
    .badge--planned { background: #fff7ed; color: #9a3412; border: 1px solid #fed7aa; }
    .planned-note {
      display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px;
      background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px;
      color: #9a3412; font-size: 12px; font-weight: 700; line-height: 1.45;
    }
    .sec__body { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
    .subsec { display: flex; flex-direction: column; gap: 10px; }
    .subsec + .subsec { padding-top: 16px; border-top: 1px solid var(--tm-line); }
    .subsec__title { margin: 0; font-size: 12px; font-weight: 800; color: var(--tm-text); }
    .rule-note { margin: 0; font-size: 12px; color: var(--tm-text-muted); }

    .grid { display: grid; gap: 14px; }
    .grid-2 { grid-template-columns: 1fr 1fr; }
    .grid-3 { grid-template-columns: repeat(3, 1fr); }
    .grid-4 { grid-template-columns: repeat(4, 1fr); }

    /* toggles */
    .toggles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .tgl { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; }
    .tgl--disabled { cursor: not-allowed; opacity: 0.72; }
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
    .field__hint { font-size: 11px; color: var(--tm-text-muted); line-height: 1.35; }
    .field input[type=text], .field input[type=number], .field input[type=email], .field select, .field textarea {
      width: 100%; padding: 9px 11px;
      border: 1px solid var(--tm-line); border-radius: 9px;
      background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13px; outline: none; font-family: inherit;
    }
    .field input:focus, .field select:focus, .field textarea:focus { border-color: var(--tm-green); }
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
  dispatcherSettings: DispatcherSetting[] = [];
  activeDispatcherKind: 'local' | 'outstation' = 'local';

  paymentModeOptions = PAYMENT_MODE_OPTIONS;
  dispatchModes = DISPATCH_MODES;
  toggles = TOGGLES;
  nav = NAV;
  activeId = NAV[0].id;

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
      if (id != null) {
        this.fetch();
        this.fetchDispatcherSettings();
      }
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

  get activeDispatcher(): DispatcherSetting | null {
    return this.dispatcherSettings.find((s) => s.kind === this.activeDispatcherKind) ?? this.dispatcherSettings[0] ?? null;
  }

  kindLabel(kind: 'local' | 'outstation'): string {
    return kind === 'outstation' ? 'Outstation' : 'Local';
  }

  fetchDispatcherSettings(): void {
    if (this.cityId == null) { this.dispatcherSettings = []; return; }
    this.api.get<{ data: DispatcherSetting[] }>(`/admin/cities/${this.cityId}/dispatcher-settings`).subscribe({
      next: (res) => {
        this.dispatcherSettings = (res.data ?? []).map((row) => ({ ...row }));
        if (!this.dispatcherSettings.some((row) => row.kind === this.activeDispatcherKind)) {
          this.activeDispatcherKind = this.dispatcherSettings[0]?.kind ?? 'local';
        }
      },
      error: () => {
        this.dispatcherSettings = [];
        this.toast.error('Failed to load private dispatcher settings');
      },
    });
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
          s.negotiation_floor_percent = Number(s.negotiation_floor_percent ?? 10);
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

    append('customer_login_otp_message', f.customer_login_otp_message);
    append('customer_login_otp_message_ios', f.customer_login_otp_message_ios);

    fd.append(
      'allowed_driver_payment_modes',
      JSON.stringify(f.allowed_driver_payment_modes ?? []),
    );
    append('negotiation_floor_percent', f.negotiation_floor_percent ?? 10);

    const cityRuleFields: (keyof CitySettings)[] = [
      'private_no_show_threshold_minutes', 'private_no_show_charge_per_minute', 'private_driver_no_show_grace_minutes',
      'fixed_waiting_time_per_stop_minutes', 'fixed_stop_arrival_radius_m', 'fixed_driver_missed_stop_grace_minutes', 'fixed_customer_pickup_radius_m', 'fixed_vehicle_approaching_alert_radius_m', 'fixed_customer_grace_minutes',
    ];
    cityRuleFields.forEach((key) => append(key, f[key]));

    append('emergency_no', f.emergency_no);
    append('emergency_police_no', f.emergency_police_no);
    append('driver_support_no', f.driver_support_no);
    append('customer_support_no', f.customer_support_no);
    append('support_email', f.support_email);

    const cityRequest = this.api.postMultipart<{ settings: CitySettings }>(`/admin/cities/${this.cityId}/settings`, fd);
    const dispatcherRequests = this.dispatcherSettings.map((row) => this.api.patch<{ setting: DispatcherSetting }>(
      `/admin/cities/${this.cityId}/dispatcher-settings/${row.id}`,
      {
        automatic_dispatcher_type: row.automatic_dispatcher_type,
        dispatcher_hop_interval_sec: row.dispatcher_hop_interval_sec,
        dispatcher_hop_radius_m: row.dispatcher_hop_radius_m,
        request_radius_m: row.request_radius_m,
        max_hops: row.max_hops,
        driver_accept_window_sec: row.driver_accept_window_sec,
        cancel_block_radius_m: row.cancel_block_radius_m,
        schedule_available: row.schedule_available,
        schedule_dispatcher_type: row.schedule_dispatcher_type,
        dispatch_only_assigned_scheduled: row.dispatch_only_assigned_scheduled,
        schedule_dispatch_instantly: row.schedule_dispatch_instantly,
        scheduler_alarm_min: row.scheduler_alarm_min,
        schedule_current_time_diff_min: row.schedule_current_time_diff_min,
        schedule_days_limit: row.schedule_days_limit,
        schedule_days_limit_return: row.kind === 'outstation' ? row.schedule_days_limit_return : null,
        schedule_rides_limit: row.schedule_rides_limit,
        schedule_cancel_window_min: row.schedule_cancel_window_min,
      },
    ));

    forkJoin([cityRequest, ...dispatcherRequests]).subscribe({
      next: (responses) => {
        this.saving = false;
        const cityRes = responses[0] as { settings: CitySettings };
        if (cityRes.settings) {
          if (!Array.isArray(cityRes.settings.allowed_driver_payment_modes)) {
            cityRes.settings.allowed_driver_payment_modes = [];
          }
          cityRes.settings.negotiation_floor_percent = Number(cityRes.settings.negotiation_floor_percent ?? 10);
          this.form = cityRes.settings;
        }
        this.fetchDispatcherSettings();
        this.toast.success('City settings saved');
      },
      error: (err) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Failed to save settings');
      },
    });
  }
}
