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

  show_region_specific_fare: boolean;
  show_vehicle_make_model: boolean;

  negotiation_floor_percent: number | null;
  toll_mode: 'yes' | 'no';
  show_low_wallet_alert: boolean;
  private_no_show_threshold_minutes: number | null;
  private_no_show_charge_per_minute: number | null;
  private_driver_no_show_grace_minutes: number;
  private_cancellation_rule: string | null;
  cancellation_charge_percent: number | null;

  fixed_waiting_time_per_stop_minutes: number;
  fixed_stop_arrival_radius_m: number;
  fixed_stop_arrival_dwell_seconds: number;
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

const TOGGLES: { key: keyof CitySettings; label: string; hint: string }[] = [
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
            <div class="subsec"><h4 class="subsec__title">Ride commercials</h4>
              <div class="toggles">
                <label class="tgl"><input type="checkbox" [ngModel]="form.toll_mode === 'yes'" (ngModelChange)="form.toll_mode = $event ? 'yes' : 'no'" /><span class="tgl__track"></span><span class="tgl__meta"><span class="tgl__label">Toll applicable</span><span class="tgl__hint">Allow route tolls returned by Google to be added to fares in this city.</span></span></label>
                <label class="tgl"><input type="checkbox" [(ngModel)]="form.show_low_wallet_alert" /><span class="tgl__track"></span><span class="tgl__meta"><span class="tgl__label">Low wallet alert</span><span class="tgl__hint">Show wallet warning on the driver app for this city.</span></span></label>
              </div>
            </div>
            <div class="subsec"><h4 class="subsec__title">Support contacts</h4><div class="grid grid-3"><label class="field"><span class="field__lbl">Emergency no.<span class="info" tabindex="0" aria-label="Emergency contact number shown to users in this city." data-tip="Emergency contact number shown to users in this city.">!</span></span><input type="text" [(ngModel)]="form.emergency_no" /></label><label class="field"><span class="field__lbl">Police no.<span class="info" tabindex="0" aria-label="Police contact number shown for safety help in this city." data-tip="Police contact number shown for safety help in this city.">!</span></span><input type="text" [(ngModel)]="form.emergency_police_no" /></label><label class="field"><span class="field__lbl">Driver support no.<span class="info" tabindex="0" aria-label="Support number drivers can use for this city." data-tip="Support number drivers can use for this city.">!</span></span><input type="text" [(ngModel)]="form.driver_support_no" /></label><label class="field"><span class="field__lbl">Customer support no.<span class="info" tabindex="0" aria-label="Support number customers can use for this city." data-tip="Support number customers can use for this city.">!</span></span><input type="text" [(ngModel)]="form.customer_support_no" /></label><label class="field"><span class="field__lbl">Support email<span class="info" tabindex="0" aria-label="Support email shown to users for this city." data-tip="Support email shown to users for this city.">!</span></span><input type="email" [(ngModel)]="form.support_email" /></label></div></div>
          </div>
        </section>
        <section class="sec" id="sec-private">
          <header class="sec__head"><span class="sec__icon"><tm-icon name="rupee" [size]="16" /></span><div><h3 class="sec__title">Private Ride Settings</h3><p class="sec__desc">Rules for normal local and outstation private rides.</p></div></header>
          <div class="sec__body">
            <div class="subsec"><h4 class="subsec__title">Negotiation</h4><div class="grid grid-2"><label class="field"><span class="field__lbl">Maximum negotiation discount (%)<span class="info" tabindex="0" aria-label="Maximum discount allowed when fare negotiation is used." data-tip="Maximum discount allowed when fare negotiation is used.">!</span></span><input type="number" min="0" max="100" step="0.01" [(ngModel)]="form.negotiation_floor_percent" /></label></div></div>
            <div class="subsec" *ngIf="activeDispatcher as d">
              <h4 class="subsec__title">Private dispatch</h4>
              <div class="seg">
                <button *ngFor="let row of dispatcherSettings" type="button" class="seg__btn" [class.is-on]="activeDispatcherKind === row.kind" (click)="activeDispatcherKind = row.kind">{{ kindLabel(row.kind) }}</button>
              </div>
              <label class="tgl"><input type="checkbox" [(ngModel)]="d.automatic_dispatcher_type" /><span class="tgl__track"></span><span class="tgl__meta"><span class="tgl__label">Automatic dispatcher</span><span class="tgl__hint">Auto-send private ride requests to eligible drivers.</span></span></label>
              <div class="grid grid-4">
                <label class="field"><span class="field__lbl">Request radius (m)<span class="info" tabindex="0" aria-label="Initial distance used to find nearby drivers for private rides." data-tip="Initial distance used to find nearby drivers for private rides.">!</span></span><input type="number" min="0" max="50000" [(ngModel)]="d.request_radius_m" /></label>
                <label class="field"><span class="field__lbl">Hop interval (sec)<span class="info" tabindex="0" aria-label="Time to wait before expanding the driver search." data-tip="Time to wait before expanding the driver search.">!</span></span><input type="number" min="1" max="600" [(ngModel)]="d.dispatcher_hop_interval_sec" /></label>
                <label class="field"><span class="field__lbl">Hop radius (m)<span class="info" tabindex="0" aria-label="Extra distance added on each dispatch search hop." data-tip="Extra distance added on each dispatch search hop.">!</span></span><input type="number" min="0" max="50000" [(ngModel)]="d.dispatcher_hop_radius_m" /></label>
                <label class="field"><span class="field__lbl">Max hops<span class="info" tabindex="0" aria-label="Maximum number of times the driver search can expand." data-tip="Maximum number of times the driver search can expand.">!</span></span><input type="number" min="1" max="50" [(ngModel)]="d.max_hops" /></label>
                <label class="field"><span class="field__lbl">Driver accept window (sec)<span class="info" tabindex="0" aria-label="How long a driver has to accept a private ride request." data-tip="How long a driver has to accept a private ride request.">!</span></span><input type="number" min="0" max="600" [(ngModel)]="d.driver_accept_window_sec" /></label>
                <label class="field"><span class="field__lbl">Block cancel within (m)<span class="info" tabindex="0" aria-label="Prevents customer cancellation when driver is this close to pickup." data-tip="Prevents customer cancellation when driver is this close to pickup.">!</span></span><input type="number" min="0" max="50000" [(ngModel)]="d.cancel_block_radius_m" /></label>
              </div>
              <h4 class="subsec__title">Scheduled private rides</h4>
              <div class="toggles">
                <label class="tgl"><input type="checkbox" [(ngModel)]="d.schedule_available" /><span class="tgl__track"></span><span class="tgl__meta"><span class="tgl__label">Scheduling available</span></span></label>
                <label class="tgl"><input type="checkbox" [(ngModel)]="d.schedule_dispatcher_type" /><span class="tgl__track"></span><span class="tgl__meta"><span class="tgl__label">Auto-fire at alarm time</span></span></label>
                <label class="tgl"><input type="checkbox" [(ngModel)]="d.dispatch_only_assigned_scheduled" /><span class="tgl__track"></span><span class="tgl__meta"><span class="tgl__label">Dispatch only pre-assigned</span></span></label>
              </div>
              <div class="grid grid-4">
                <label class="field"><span class="field__lbl">Schedule dispatch mode<span class="info" tabindex="0" aria-label="Controls when scheduled private rides are dispatched." data-tip="Controls when scheduled private rides are dispatched.">!</span></span><select [(ngModel)]="d.schedule_dispatch_instantly"><option *ngFor="let mode of dispatchModes" [value]="mode.value">{{ mode.label }}</option></select></label>
                <label class="field"><span class="field__lbl">Scheduler alarm (min)<span class="info" tabindex="0" aria-label="How many minutes before pickup the scheduler should wake up." data-tip="How many minutes before pickup the scheduler should wake up.">!</span></span><input type="number" min="0" max="1440" [(ngModel)]="d.scheduler_alarm_min" /></label>
                <label class="field"><span class="field__lbl">Min lead time (min)<span class="info" tabindex="0" aria-label="Minimum time required between booking and scheduled pickup." data-tip="Minimum time required between booking and scheduled pickup.">!</span></span><input type="number" min="0" max="1440" [(ngModel)]="d.schedule_current_time_diff_min" /></label>
                <label class="field"><span class="field__lbl">Days limit<span class="info" tabindex="0" aria-label="How many days ahead customers can schedule a ride." data-tip="How many days ahead customers can schedule a ride.">!</span></span><input type="number" min="0" max="365" [(ngModel)]="d.schedule_days_limit" /></label>
                <label class="field" *ngIf="d.kind === 'outstation'"><span class="field__lbl">Return days limit<span class="info" tabindex="0" aria-label="How many days ahead return outstation rides can be scheduled." data-tip="How many days ahead return outstation rides can be scheduled.">!</span></span><input type="number" min="0" max="365" [(ngModel)]="d.schedule_days_limit_return" /></label>
                <label class="field"><span class="field__lbl">Rides limit / customer<span class="info" tabindex="0" aria-label="Maximum scheduled rides one customer can hold." data-tip="Maximum scheduled rides one customer can hold.">!</span></span><input type="number" min="0" max="100" [(ngModel)]="d.schedule_rides_limit" /></label>
                <label class="field"><span class="field__lbl">Cancel window (min)<span class="info" tabindex="0" aria-label="How long before pickup scheduled rides can still be cancelled." data-tip="How long before pickup scheduled rides can still be cancelled.">!</span></span><input type="number" min="0" max="1440" [(ngModel)]="d.schedule_cancel_window_min" /></label>
              </div>
            </div>
            <div class="subsec"><h4 class="subsec__title">No-show / cancellation</h4><div class="grid grid-4"><label class="field"><span class="field__lbl">Customer no-show threshold (min)<span class="info" tabindex="0" aria-label="Time after which a private ride customer can be treated as no-show." data-tip="Time after which a private ride customer can be treated as no-show.">!</span></span><input type="number" min="0" max="180" step="0.01" [(ngModel)]="form.private_no_show_threshold_minutes" /></label><label class="field"><span class="field__lbl">No-show charge / min<span class="info" tabindex="0" aria-label="Charge applied per minute for private ride no-show rules." data-tip="Charge applied per minute for private ride no-show rules.">!</span></span><input type="number" min="0" step="0.01" [(ngModel)]="form.private_no_show_charge_per_minute" /></label><label class="field"><span class="field__lbl">Driver no-show grace (min)<span class="info" tabindex="0" aria-label="Extra time before treating the driver as no-show." data-tip="Extra time before treating the driver as no-show.">!</span></span><input type="number" min="0" max="180" step="1" [(ngModel)]="form.private_driver_no_show_grace_minutes" /></label><label class="field"><span class="field__lbl">Cancellation charge (%)<span class="info" tabindex="0" aria-label="Percent of the fare the operator keeps when a customer cancels a private or shuttle ride while the driver is on the way. Applies to Private and Shuttle; Fixed is always a full refund before arrival." data-tip="Percent of the fare kept when a customer cancels while the driver is on the way (Private & Shuttle).">!</span></span><input type="number" min="0" max="100" step="0.01" [(ngModel)]="form.cancellation_charge_percent" /></label></div></div>
          </div>
        </section>
        <section class="sec" id="sec-fixed"><header class="sec__head"><span class="sec__icon"><tm-icon name="map-marker" [size]="16" /></span><div><h3 class="sec__title">Fixed Ride Settings</h3><p class="sec__desc">City-level boarding and no-show rules for fixed shared rides.</p></div></header><div class="sec__body"><div class="subsec"><h4 class="subsec__title">Boarding & no-show</h4><div class="grid grid-4"><label class="field"><span class="field__lbl">Wait time per stop (min)<span class="info" tabindex="0" aria-label="How long the driver waits after confirmed arrival before no-show starts." data-tip="How long the driver waits after confirmed arrival before no-show starts.">!</span></span><input type="number" min="0" max="180" step="1" [(ngModel)]="form.fixed_waiting_time_per_stop_minutes" /></label><label class="field"><span class="field__lbl">Stop arrival radius (m)<span class="info" tabindex="0" aria-label="Driver must be inside this distance from the stop." data-tip="Driver must be inside this distance from the stop.">!</span></span><input type="number" min="25" max="5000" step="5" [(ngModel)]="form.fixed_stop_arrival_radius_m" /></label><label class="field"><span class="field__lbl">Arrival dwell time (sec)<span class="info" tabindex="0" aria-label="Driver must stay inside the stop radius for this many seconds before arrival is confirmed." data-tip="Driver must stay inside the stop radius for this many seconds before arrival is confirmed.">!</span></span><input type="number" min="0" max="600" step="1" [(ngModel)]="form.fixed_stop_arrival_dwell_seconds" /></label><label class="field"><span class="field__lbl">Driver missed stop grace (min)<span class="info" tabindex="0" aria-label="Extra time before cancelling when the customer is at pickup but driver reaches a later stop first." data-tip="Extra time before cancelling when the customer is at pickup but driver reaches a later stop first.">!</span></span><input type="number" min="0" max="180" step="1" [(ngModel)]="form.fixed_driver_missed_stop_grace_minutes" /></label><label class="field"><span class="field__lbl">Customer pickup radius (m)<span class="info" tabindex="0" aria-label="Customer must be within this distance from pickup to be treated as present." data-tip="Customer must be within this distance from pickup to be treated as present.">!</span></span><input type="number" min="25" max="5000" step="5" [(ngModel)]="form.fixed_customer_pickup_radius_m" /></label><label class="field"><span class="field__lbl">Approaching alert radius (m)<span class="info" tabindex="0" aria-label="Customer gets a vehicle approaching alert inside this distance." data-tip="Customer gets a vehicle approaching alert inside this distance.">!</span></span><input type="number" min="50" max="10000" step="50" [(ngModel)]="form.fixed_vehicle_approaching_alert_radius_m" /></label><label class="field"><span class="field__lbl">Customer grace (min)<span class="info" tabindex="0" aria-label="Extra time allowed after wait time if the customer is detected near pickup." data-tip="Extra time allowed after wait time if the customer is detected near pickup.">!</span></span><input type="number" min="0" max="180" step="1" [(ngModel)]="form.fixed_customer_grace_minutes" /></label></div></div></div></section>
        <section class="sec" id="sec-shuttle">
          <header class="sec__head">
            <span class="sec__icon"><tm-icon name="send" [size]="16" /></span>
            <div>
              <div class="sec__title-row">
                <h3 class="sec__title">Shuttle Ride Settings</h3>
              </div>
              <p class="sec__desc">Dynamic Shuttle matching, boarding, and automatic no-show rules.</p>
            </div>
          </header>
          <div class="sec__body">
            <div class="subsec">
              <h4 class="subsec__title">Matching rules</h4>
              <div class="grid grid-4">
                <label class="field"><span class="field__lbl">Pickup match distance (km)<span class="info" tabindex="0" aria-label="Maximum pickup detour allowed when matching shuttle passengers." data-tip="Maximum pickup detour allowed when matching shuttle passengers.">!</span></span><input type="number" min="0" max="100" step="0.01" [(ngModel)]="form.shuttle_pickup_match_distance_km" /></label>
                <label class="field"><span class="field__lbl">Drop match distance (km)<span class="info" tabindex="0" aria-label="Maximum drop detour allowed when matching shuttle passengers." data-tip="Maximum drop detour allowed when matching shuttle passengers.">!</span></span><input type="number" min="0" max="100" step="0.01" [(ngModel)]="form.shuttle_drop_match_distance_km" /></label>
                <label class="field"><span class="field__lbl">Max passenger delay (min)<span class="info" tabindex="0" aria-label="Maximum extra delay allowed for existing shuttle passengers." data-tip="Maximum extra delay allowed for existing shuttle passengers.">!</span></span><input type="number" min="0" max="180" step="1" [(ngModel)]="form.shuttle_max_passenger_delay_minutes" /></label>
              </div>
              <div class="toggles">
                <label class="tgl"><input type="checkbox" [(ngModel)]="form.shuttle_join_after_start_enabled" /><span class="tgl__track"></span><span class="tgl__meta"><span class="tgl__label">Allow joining after ride start</span></span></label>
                <label class="tgl"><input type="checkbox" [(ngModel)]="form.shuttle_fare_lock_enabled" /><span class="tgl__track"></span><span class="tgl__meta"><span class="tgl__label">Lock fare after booking</span></span></label>
              </div>
            </div>
            <div class="subsec">
              <h4 class="subsec__title">Boarding & no-show</h4>
              <div class="grid grid-4">
                <label class="field"><span class="field__lbl">Driver waiting time (min)<span class="info" tabindex="0" aria-label="How long the shuttle driver waits at pickup before no-show handling." data-tip="How long the shuttle driver waits at pickup before no-show handling.">!</span></span><input type="number" min="0" max="180" step="1" [(ngModel)]="form.shuttle_driver_waiting_time_minutes" /></label>
                <label class="field"><span class="field__lbl">Pickup arrival radius (m)<span class="info" tabindex="0" aria-label="Shuttle driver must be inside this distance to count as arrived." data-tip="Shuttle driver must be inside this distance to count as arrived.">!</span></span><input type="number" min="25" max="5000" step="5" [(ngModel)]="form.shuttle_pickup_arrival_radius_m" /></label>
                <label class="field"><span class="field__lbl">Driver missed pickup grace (min)<span class="info" tabindex="0" aria-label="Extra time before cancelling when shuttle driver misses the pickup." data-tip="Extra time before cancelling when shuttle driver misses the pickup.">!</span></span><input type="number" min="0" max="180" step="1" [(ngModel)]="form.shuttle_driver_missed_pickup_grace_minutes" /></label>
                <label class="field"><span class="field__lbl">Customer pickup radius (m)<span class="info" tabindex="0" aria-label="Customer must be within this distance from pickup to be treated as present." data-tip="Customer must be within this distance from pickup to be treated as present.">!</span></span><input type="number" min="25" max="5000" step="5" [(ngModel)]="form.shuttle_customer_pickup_radius_m" /></label>
                <label class="field"><span class="field__lbl">Approaching alert radius (m)<span class="info" tabindex="0" aria-label="Customer gets a vehicle approaching alert inside this distance." data-tip="Customer gets a vehicle approaching alert inside this distance.">!</span></span><input type="number" min="50" max="10000" step="50" [(ngModel)]="form.shuttle_approaching_alert_radius_m" /></label>
                <label class="field"><span class="field__lbl">Customer grace (min)<span class="info" tabindex="0" aria-label="Extra time allowed after wait time if the customer is detected near pickup." data-tip="Extra time allowed after wait time if the customer is detected near pickup.">!</span></span><input type="number" min="0" max="180" step="1" [(ngModel)]="form.shuttle_customer_grace_minutes" /></label>
              </div>
            </div>
          </div>
        </section>

        <!-- Sticky save bar -->
        <div class="savebar">
          <span class="savebar__hint">Changes apply to {{ currentCityName }} only.</span>
          <div style="display: flex; gap: 8px; align-items: center;">
            <tm-button variant="outline" icon="copy" (clicked)="openCopyModal()">
              Copy settings
            </tm-button>
            <tm-button variant="green" icon="check" [disabled]="saving" (clicked)="save()">
              {{ saving ? 'Saving…' : 'Save settings' }}
            </tm-button>
          </div>
        </div>
      </div>
    </div>

    <!-- Granular Copy Settings Modal -->
    <div class="modal-backdrop" *ngIf="showCopyModal" (click)="closeCopyModal()"></div>
    <div class="modal-card" *ngIf="showCopyModal">
      <header class="modal-card__head">
        <div>
          <h3 class="modal-card__title">Copy Settings into {{ currentCityName }}</h3>
          <p class="modal-card__sub">Pick a source city and choose specifically which setting categories to copy.</p>
        </div>
        <button type="button" class="modal-card__close" (click)="closeCopyModal()">×</button>
      </header>

      <div class="modal-card__body">
        <div class="field">
          <label class="field__lbl">Select Source City to copy FROM</label>
          <select [ngModel]="sourceCityId" (ngModelChange)="onSourceCityChange($event)" class="modal-select">
            <option [ngValue]="null" disabled>-- Choose a source city --</option>
            <option *ngFor="let c of availableSourceCities" [ngValue]="c.id">
              {{ c.name }}
            </option>
          </select>
        </div>

        <!-- Loading spinner for preview -->
        <div class="preview-loading" *ngIf="loadingSourcePreview">
          <tm-icon name="refresh" [size]="16" /> Loading settings preview from selected city…
        </div>

        <!-- Live Preview Box -->
        <div class="source-preview-box" *ngIf="sourceCityId && sourcePreview">
          <div class="spb-head">
            <span class="spb-title">Live Preview of Values from <strong>{{ sourcePreview.city_name }}</strong>:</span>
          </div>

          <div class="spb-content">
            <!-- General & Contacts Preview -->
            <div class="spb-group" *ngIf="copyOpts.general">
              <span class="spb-lbl">⚙️ General & Contacts:</span>
              <div class="spb-pills">
                <span class="spb-pill">Region Fares: {{ sourcePreview.settings.show_region_specific_fare ? 'ON' : 'OFF' }}</span>
                <span class="spb-pill">Make/Model: {{ sourcePreview.settings.show_vehicle_make_model ? 'ON' : 'OFF' }}</span>
                <span class="spb-pill" *ngIf="sourcePreview.settings.emergency_no">Emergency: {{ sourcePreview.settings.emergency_no }}</span>
                <span class="spb-pill" *ngIf="sourcePreview.settings.driver_support_no">Driver Support: {{ sourcePreview.settings.driver_support_no }}</span>
                <span class="spb-pill" *ngIf="sourcePreview.settings.support_email">Email: {{ sourcePreview.settings.support_email }}</span>
              </div>
            </div>

            <!-- Private Taxi Preview -->
            <div class="spb-group" *ngIf="copyOpts.private">
              <span class="spb-lbl">🚕 Private Taxi Settings:</span>
              <div class="spb-pills">
                <span class="spb-pill">Floor Discount: {{ sourcePreview.settings.negotiation_floor_percent }}%</span>
                <span class="spb-pill">Tolls: {{ sourcePreview.settings.toll_mode }}</span>
              </div>
            </div>

            <!-- Fixed Rides Preview -->
            <div class="spb-group" *ngIf="copyOpts.fixed">
              <span class="spb-lbl">📍 Fixed Route Settings:</span>
              <div class="spb-pills">
                <span class="spb-pill">Wait Time: {{ sourcePreview.settings.fixed_waiting_time_per_stop_minutes }} min</span>
                <span class="spb-pill">Arrival Radius: {{ sourcePreview.settings.fixed_stop_arrival_radius_m }}m</span>
                <span class="spb-pill">Dwell: {{ sourcePreview.settings.fixed_stop_arrival_dwell_seconds }}s</span>
                <span class="spb-pill">Boarding: {{ sourcePreview.settings.fixed_boarding_confirmation_mode }}</span>
              </div>
            </div>

            <!-- Shuttle Rides Preview -->
            <div class="spb-group" *ngIf="copyOpts.shuttle">
              <span class="spb-lbl">🚌 Shuttle Settings:</span>
              <div class="spb-pills">
                <span class="spb-pill">Match Radius: {{ sourcePreview.settings.shuttle_pickup_match_distance_km }} km</span>
                <span class="spb-pill">Max Delay: {{ sourcePreview.settings.shuttle_max_passenger_delay_minutes }} min</span>
                <span class="spb-pill">Fare Lock: {{ sourcePreview.settings.shuttle_fare_lock_enabled ? 'Yes' : 'No' }}</span>
                <span class="spb-pill">Privacy: {{ sourcePreview.settings.shuttle_customer_privacy_rule }}</span>
              </div>
            </div>

            <!-- Auto-Dispatcher Preview -->
            <div class="spb-group" *ngIf="copyOpts.dispatchers">
              <span class="spb-lbl">⚡ Auto-Dispatcher Rules:</span>
              <div class="spb-pills">
                <span class="spb-pill" *ngFor="let d of sourcePreview.dispatchers">
                  {{ d.kind === 'outstation' ? 'Outstation' : 'Local' }}: {{ d.automatic_dispatcher_type ? 'Auto' : 'Manual' }} ({{ d.request_radius_m }}m radius, {{ d.max_hops }} hops)
                </span>
                <span class="spb-pill" *ngIf="!sourcePreview.dispatchers?.length">Default dispatcher rules</span>
              </div>
            </div>

            <!-- Vehicle Types Preview -->
            <div class="spb-group" *ngIf="copyOpts.vehicleTypes">
              <span class="spb-lbl">🚘 Vehicle Types &amp; Pricing:</span>
              <div class="spb-pills">
                <span class="spb-pill" *ngFor="let v of sourcePreview.vehicle_types">
                  {{ v.display_name }}: Base ₹{{ v.base_fare }}, Per KM ₹{{ v.per_km_rate }}
                </span>
                <span class="spb-pill" *ngIf="!sourcePreview.vehicle_types?.length">No custom vehicle types configured</span>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-quick-actions">
          <span class="modal-section-label">Choose Sections to Copy:</span>
          <div class="modal-quick-btns">
            <button type="button" class="btn-text" (click)="toggleAllCopyOpts(true)">Select All</button>
            <span>•</span>
            <button type="button" class="btn-text" (click)="toggleAllCopyOpts(false)">Deselect All</button>
          </div>
        </div>

        <div class="copy-opts-grid">
          <label class="copy-opt-card" [class.is-selected]="copyOpts.general">
            <input type="checkbox" [(ngModel)]="copyOpts.general" />
            <div class="copy-opt-meta">
              <span class="copy-opt-title">⚙️ General & Contacts</span>
              <span class="copy-opt-desc">In-app chat, region fares, emergency/police/support phone numbers & emails.</span>
            </div>
          </label>

          <label class="copy-opt-card" [class.is-selected]="copyOpts.private">
            <input type="checkbox" [(ngModel)]="copyOpts.private" />
            <div class="copy-opt-meta">
              <span class="copy-opt-title">🚕 Private Taxi Settings</span>
              <span class="copy-opt-desc">Commission %, floor discount %, payment modes (Cash/Razorpay), toll mode & cancellation rules.</span>
            </div>
          </label>

          <label class="copy-opt-card" [class.is-selected]="copyOpts.fixed">
            <input type="checkbox" [(ngModel)]="copyOpts.fixed" />
            <div class="copy-opt-meta">
              <span class="copy-opt-title">📍 Fixed Route Settings</span>
              <span class="copy-opt-desc">Wait times per stop, arrival radiuses, dwell seconds, boarding confirmation mode.</span>
            </div>
          </label>

          <label class="copy-opt-card" [class.is-selected]="copyOpts.shuttle">
            <input type="checkbox" [(ngModel)]="copyOpts.shuttle" />
            <div class="copy-opt-meta">
              <span class="copy-opt-title">🚌 Shuttle Settings</span>
              <span class="copy-opt-desc">Match distances, max passenger delay, fare lock, capacity source, privacy rules, payout share.</span>
            </div>
          </label>

          <label class="copy-opt-card" [class.is-selected]="copyOpts.dispatchers">
            <input type="checkbox" [(ngModel)]="copyOpts.dispatchers" />
            <div class="copy-opt-meta">
              <span class="copy-opt-title">⚡ Auto-Dispatcher Rules</span>
              <span class="copy-opt-desc">Hop intervals, request radiuses, max hops, driver accept window & scheduled ride rules (Local & Outstation).</span>
            </div>
          </label>

          <label class="copy-opt-card" [class.is-selected]="copyOpts.vehicleTypes">
            <input type="checkbox" [(ngModel)]="copyOpts.vehicleTypes" />
            <div class="copy-opt-meta">
              <span class="copy-opt-title">🚘 Vehicle Types & Pricing</span>
              <span class="copy-opt-desc">Vehicle categories (Hatchback/Sedan/SUV), base fares, per-km rates & minute rates.</span>
            </div>
          </label>
        </div>
      </div>

      <footer class="modal-card__foot">
        <tm-button variant="outline" (clicked)="closeCopyModal()">Cancel</tm-button>
        <tm-button variant="green" icon="copy" [disabled]="!sourceCityId || copying" (clicked)="executeCopySettings()">
          {{ copying ? 'Copying…' : 'Copy Selected Settings' }}
        </tm-button>
      </footer>
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
    .field__lbl { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .info { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; border-radius: 50%; background: var(--tm-canvas-2); color: var(--tm-text-muted); border: 1px solid var(--tm-line); font-size: 10px; font-weight: 900; cursor: help; }
    .info:hover, .info:focus { background: var(--tm-green-tint, #e0f7fa); color: var(--tm-green); border-color: var(--tm-green); outline: none; }
    .info::after { content: attr(data-tip); position: absolute; left: 50%; bottom: calc(100% + 8px); transform: translateX(-50%); width: max-content; max-width: min(260px, 72vw); padding: 8px 10px; border-radius: 8px; background: var(--tm-ink); color: #fff; box-shadow: var(--tm-shadow-pop); font-size: 11px; font-weight: 700; line-height: 1.35; white-space: normal; opacity: 0; pointer-events: none; z-index: 20; }
    .info::before { content: ''; position: absolute; left: 50%; bottom: calc(100% + 3px); transform: translateX(-50%); border: 5px solid transparent; border-top-color: var(--tm-ink); opacity: 0; pointer-events: none; z-index: 21; }
    .info:hover::after, .info:focus::after, .info:hover::before, .info:focus::before { opacity: 1; }
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
    /* Modal styles */
    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5);
      backdrop-filter: blur(4px); z-index: 998;
    }
    .modal-card {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: min(640px, 92vw); max-height: 88vh;
      background: var(--tm-surface); border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px); box-shadow: var(--tm-shadow-pop);
      display: flex; flex-direction: column; z-index: 999; overflow: hidden;
    }
    .modal-card__head {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
      padding: 16px 20px; border-bottom: 1px solid var(--tm-line);
    }
    .modal-card__title { margin: 0; font-size: 16px; font-weight: 800; color: var(--tm-text); }
    .modal-card__sub { margin: 4px 0 0; font-size: 12px; color: var(--tm-text-muted); }
    .modal-card__close {
      background: transparent; border: none; font-size: 20px; color: var(--tm-text-muted);
      cursor: pointer; padding: 0 4px; line-height: 1;
    }
    .modal-card__close:hover { color: var(--tm-text); }
    .modal-card__body { padding: 18px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
    .modal-card__foot {
      padding: 12px 20px; border-top: 1px solid var(--tm-line);
      display: flex; align-items: center; justify-content: flex-end; gap: 10px;
      background: var(--tm-canvas);
    }
    .modal-select {
      width: 100%; padding: 10px 12px; border: 1px solid var(--tm-line);
      border-radius: 9px; background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13.5px; font-weight: 700; outline: none;
    }
    .preview-loading {
      display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700;
      color: var(--tm-green); padding: 8px 12px; background: var(--tm-green-tint, #e0f7fa);
      border-radius: 8px;
    }
    .source-preview-box {
      background: var(--tm-canvas-2, #f8fafc); border: 1px solid var(--tm-line);
      border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px;
    }
    .spb-head { display: flex; align-items: center; justify-content: space-between; }
    .spb-title { font-size: 12px; color: var(--tm-text); }
    .spb-content { display: flex; flex-direction: column; gap: 8px; }
    .spb-group { display: flex; flex-direction: column; gap: 4px; }
    .spb-lbl { font-size: 11.5px; font-weight: 800; color: var(--tm-text); }
    .spb-pills { display: flex; gap: 6px; flex-wrap: wrap; }
    .spb-pill {
      font-size: 11px; font-weight: 700; color: var(--tm-text-muted);
      background: var(--tm-surface); border: 1px solid var(--tm-line);
      padding: 3px 8px; border-radius: 6px;
    }
    .modal-quick-actions { display: flex; align-items: center; justify-content: space-between; }
    .modal-section-label { font-size: 12px; font-weight: 800; color: var(--tm-text); }
    .modal-quick-btns { display: flex; align-items: center; gap: 6px; }
    .btn-text { background: transparent; border: none; color: var(--tm-green); font-size: 12px; font-weight: 700; cursor: pointer; padding: 0; }
    .btn-text:hover { text-decoration: underline; }
    .copy-opts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .copy-opt-card {
      display: flex; align-items: flex-start; gap: 10px; padding: 12px;
      border: 1.5px solid var(--tm-line); border-radius: 10px;
      background: var(--tm-canvas); cursor: pointer; transition: all 0.2s ease;
    }
    .copy-opt-card.is-selected {
      border-color: var(--tm-green); background: var(--tm-green-tint, #e0f7fa);
    }
    .copy-opt-card input { margin-top: 2px; }
    .copy-opt-meta { display: flex; flex-direction: column; gap: 2px; }
    .copy-opt-title { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .copy-opt-desc { font-size: 11px; color: var(--tm-text-muted); line-height: 1.35; }
    @media (max-width: 600px) { .copy-opts-grid { grid-template-columns: 1fr; } }
  `],
})
export class CitySettingsComponent implements OnInit, AfterViewInit, OnDestroy {
  cityId: number | null = null;
  form: CitySettings | null = null;
  loading = false;
  saving = false;
  dispatcherSettings: DispatcherSetting[] = [];
  activeDispatcherKind: 'local' | 'outstation' = 'local';

  showCopyModal = false;
  sourceCityId: number | null = null;
  copying = false;
  allCities: { id: number; name: string }[] = [];

  copyOpts = {
    general: true,
    private: true,
    fixed: true,
    shuttle: true,
    dispatchers: true,
    vehicleTypes: true,
  };

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

  sourcePreview: any = null;
  loadingSourcePreview = false;

  get availableSourceCities() {
    return this.allCities.filter((c) => c.id !== this.cityId);
  }

  get currentCityName(): string {
    return this.allCities.find((c) => c.id === this.cityId)?.name || 'Selected City';
  }

  openCopyModal(): void {
    this.sourceCityId = null;
    this.sourcePreview = null;
    this.showCopyModal = true;
  }

  closeCopyModal(): void {
    this.showCopyModal = false;
    this.sourcePreview = null;
  }

  onSourceCityChange(sourceId: number | null): void {
    this.sourceCityId = sourceId;
    this.sourcePreview = null;
    if (!sourceId) return;

    this.loadingSourcePreview = true;
    this.api.get<any>(`/admin/cities/${sourceId}/preview-settings`).subscribe({
      next: (res) => {
        this.loadingSourcePreview = false;
        this.sourcePreview = res;
      },
      error: () => {
        this.loadingSourcePreview = false;
        this.toast.error('Failed to load settings preview for selected city');
      },
    });
  }

  toggleAllCopyOpts(select: boolean): void {
    this.copyOpts = {
      general: select,
      private: select,
      fixed: select,
      shuttle: select,
      dispatchers: select,
      vehicleTypes: select,
    };
  }

  executeCopySettings(): void {
    if (!this.cityId || !this.sourceCityId || this.copying) return;
    this.copying = true;

    const payload = {
      source_city_id: this.sourceCityId,
      copy_general: this.copyOpts.general,
      copy_private: this.copyOpts.private,
      copy_fixed: this.copyOpts.fixed,
      copy_shuttle: this.copyOpts.shuttle,
      copy_dispatchers: this.copyOpts.dispatchers,
      copy_vehicle_types: this.copyOpts.vehicleTypes,
    };

    this.api.post<{ settings: CitySettings; message: string }>(`/admin/cities/${this.cityId}/copy-settings`, payload).subscribe({
      next: (res) => {
        this.copying = false;
        this.showCopyModal = false;
        this.toast.success(res.message || 'Settings copied successfully');
        this.fetch();
        this.fetchDispatcherSettings();
      },
      error: (err) => {
        this.copying = false;
        this.toast.error(err?.error?.message || 'Failed to copy settings');
      },
    });
  }

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
    this.cityCtx.cities$.subscribe((list) => {
      this.allCities = list || [];
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
          s.negotiation_floor_percent = Number(s.negotiation_floor_percent ?? 10);
          s.toll_mode = s.toll_mode ?? 'no';
          s.show_low_wallet_alert = !!s.show_low_wallet_alert;
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

    append('show_region_specific_fare', f.show_region_specific_fare);
    append('show_vehicle_make_model', f.show_vehicle_make_model);

    append('negotiation_floor_percent', f.negotiation_floor_percent ?? 10);
    append('toll_mode', f.toll_mode ?? 'no');
    append('show_low_wallet_alert', f.show_low_wallet_alert);

    const cityRuleFields: (keyof CitySettings)[] = [
      'private_no_show_threshold_minutes', 'private_no_show_charge_per_minute', 'private_driver_no_show_grace_minutes', 'cancellation_charge_percent',
      'fixed_waiting_time_per_stop_minutes', 'fixed_stop_arrival_radius_m', 'fixed_stop_arrival_dwell_seconds', 'fixed_driver_missed_stop_grace_minutes', 'fixed_customer_pickup_radius_m', 'fixed_vehicle_approaching_alert_radius_m', 'fixed_customer_grace_minutes',
      'shuttle_pickup_match_distance_km', 'shuttle_drop_match_distance_km', 'shuttle_max_passenger_delay_minutes', 'shuttle_join_after_start_enabled', 'shuttle_fare_lock_enabled',
      'shuttle_driver_waiting_time_minutes', 'shuttle_pickup_arrival_radius_m', 'shuttle_driver_missed_pickup_grace_minutes', 'shuttle_customer_pickup_radius_m', 'shuttle_approaching_alert_radius_m', 'shuttle_customer_grace_minutes',
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
          cityRes.settings.negotiation_floor_percent = Number(cityRes.settings.negotiation_floor_percent ?? 10);
          cityRes.settings.toll_mode = cityRes.settings.toll_mode ?? 'no';
          cityRes.settings.show_low_wallet_alert = !!cityRes.settings.show_low_wallet_alert;
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
