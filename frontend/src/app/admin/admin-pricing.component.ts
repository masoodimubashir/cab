import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../core/api.service';
import { CityContextService } from '../core/city-context.service';
import { ToastService } from '../core/toast.service';
import {
  ButtonComponent,
  DrawerComponent,
  IconComponent,
  ModalComponent,
} from '../ui';

/**
 * Base Pricing — rate cards for the city chosen in the topbar switcher.
 * One rate card per ride type. The full parameter set (thresholds, waiting,
 * cancellation, pickup, no-show) is edited in a sectioned right-side drawer.
 */

type PricingForm = {
  city_id: number | null;
  ride_type_id: number | null;
  base_fare: number | null;
  per_km: number | null;
  per_min: number | null;
  surge_multiplier: number | null;
  commission_percent: number | null;
  min_fare: number | null;
  threshold_distance_1_km: number | null;
  fare_per_km_after_threshold_1: number | null;
  threshold_distance_2_km: number | null;
  fare_per_km_after_threshold_2: number | null;
  threshold_time_1_min: number | null;
  fare_per_min_after_threshold_time_1: number | null;
  threshold_time_2_min: number | null;
  fare_per_min_after_threshold_time_2: number | null;
  threshold_waiting_time_min: number | null;
  fare_per_waiting_minute: number | null;
  cancellation_charges: number | null;
  tax_percent: number | null;
  cancel_threshold_distance_km: number | null;
  cancel_threshold_time_min: number | null;
  luggage_charges: number | null;
  scheduled_ride_fare: number | null;
  pickup_charge_before_threshold: number | null;
  pickup_charge_after_threshold: number | null;
  pickup_threshold_distance_km: number | null;
  no_show_charges_per_minute: number | null;
  no_show_threshold_minutes: number | null;
  cancel_subsidy: number | null;
  cancel_subsidy_threshold_minutes: number | null;
  cancel_subsidy_threshold_distance_km: number | null;
};

type CityRef = { id: number; name: string };
type RideRef = { id: number; name: string };

type PricingRule = PricingForm & {
  id: number;
  city?: CityRef | null;
  rideType?: RideRef | null;
};

const NUMERIC_FORM_FIELDS: (keyof PricingForm)[] = [
  'base_fare', 'per_km', 'per_min', 'surge_multiplier', 'commission_percent', 'min_fare',
  'threshold_distance_1_km', 'fare_per_km_after_threshold_1',
  'threshold_distance_2_km', 'fare_per_km_after_threshold_2',
  'threshold_time_1_min', 'fare_per_min_after_threshold_time_1',
  'threshold_time_2_min', 'fare_per_min_after_threshold_time_2',
  'threshold_waiting_time_min', 'fare_per_waiting_minute',
  'cancellation_charges', 'tax_percent',
  'cancel_threshold_distance_km', 'cancel_threshold_time_min',
  'luggage_charges', 'scheduled_ride_fare',
  'pickup_charge_before_threshold', 'pickup_charge_after_threshold', 'pickup_threshold_distance_km',
  'no_show_charges_per_minute', 'no_show_threshold_minutes',
  'cancel_subsidy', 'cancel_subsidy_threshold_minutes', 'cancel_subsidy_threshold_distance_km',
];

@Component({
  selector: 'app-admin-pricing',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonComponent, DrawerComponent, ModalComponent, IconComponent,
  ],
  template: `
    <div class="bp">
      <header class="bp__head">
        <p class="bp__sub">Fare rate cards for each ride type in this city.</p>
        <tm-button
          *ngIf="cityId != null && rideTypes.length"
          variant="green" icon="plus"
          [disabled]="!availableRideTypes.length"
          (clicked)="openCreate()"
        >Add rate card</tm-button>
      </header>

      <!-- No city -->
      <div class="cue" *ngIf="cityId == null">
        <tm-icon name="map-marker" [size]="24" />
        <p class="cue__title">No city selected</p>
        <p class="cue__text">Pick a city from the switcher in the top bar to set its pricing.</p>
      </div>

      <!-- City but no ride types at all -->
      <div class="cue" *ngIf="cityId != null && !loading && !rideTypes.length">
        <tm-icon name="road" [size]="24" />
        <p class="cue__title">No ride types yet</p>
        <p class="cue__text">Pricing is set per ride type — add ride types first.</p>
        <tm-button variant="green" size="sm" icon="arrow-right" (clicked)="goTo('/vehicles')">
          Go to Vehicles
        </tm-button>
      </div>

      <ng-container *ngIf="cityId != null && rideTypes.length">
        <!-- Summary -->
        <div class="bp__stats" *ngIf="cityRules.length">
          <div class="stat">
            <span class="stat__v">{{ cityRules.length }}</span>
            <span class="stat__l">Rate cards</span>
          </div>
          <div class="stat">
            <span class="stat__v">{{ availableRideTypes.length }}</span>
            <span class="stat__l">Ride types unpriced</span>
          </div>
          <div class="stat">
            <span class="stat__v">{{ avgBaseFare | number:'1.0-0' }}</span>
            <span class="stat__l">Avg base fare</span>
          </div>
        </div>

        <!-- Loading -->
        <div class="cue" *ngIf="loading">
          <tm-icon name="refresh" [size]="20" /><p class="cue__text">Loading pricing…</p>
        </div>

        <!-- No rules for this city -->
        <div class="cue" *ngIf="!loading && !cityRules.length">
          <tm-icon name="tag" [size]="24" />
          <p class="cue__title">This city isn't priced yet</p>
          <p class="cue__text">Add a rate card for a ride type to start accepting bookings.</p>
          <tm-button variant="green" size="sm" icon="plus" (clicked)="openCreate()">Add rate card</tm-button>
        </div>

        <!-- Rate card table -->
        <div class="tablewrap" *ngIf="!loading && cityRules.length">
          <table class="rtable">
            <thead>
              <tr>
                <th>Ride type</th>
                <th class="num">Base fare</th>
                <th class="num">Min fare</th>
                <th class="num">Per km</th>
                <th class="num">Per min</th>
                <th class="num">Commission</th>
                <th class="num">Tax</th>
                <th class="act">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let r of cityRules">
                <td class="rtable__name">
                  <span class="rtable__icon"><tm-icon name="tag" [size]="13" /></span>
                  {{ rideName(r) }}
                </td>
                <td class="num">{{ r.base_fare ?? '—' }}</td>
                <td class="num">{{ r.min_fare ?? '—' }}</td>
                <td class="num">{{ r.per_km ?? '—' }}</td>
                <td class="num">{{ r.per_min ?? '—' }}</td>
                <td class="num">{{ r.commission_percent != null ? r.commission_percent + '%' : '—' }}</td>
                <td class="num">{{ r.tax_percent != null ? r.tax_percent + '%' : '—' }}</td>
                <td class="act">
                  <div class="rtable__actions">
                    <button class="icon-btn" (click)="openEdit(r)" aria-label="Edit"><tm-icon name="edit" [size]="14" /></button>
                    <button class="icon-btn icon-btn--danger" (click)="deleteTarget = r" aria-label="Delete"><tm-icon name="trash" [size]="14" /></button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </ng-container>
    </div>

    <!-- ========== Create / edit drawer ========== -->
    <tm-drawer
      [open]="drawerOpen"
      [title]="editMode ? 'Edit rate card' : 'Add rate card'"
      [subtitle]="cityName"
      [width]="560"
      (closed)="closeForm()"
    >
      <div slot="body" class="pform">
        <!-- Identity & base -->
        <section class="psec">
          <h3 class="psec__title"><tm-icon name="tag" [size]="14" /> Ride type & base fare</h3>
          <div class="pgrid">
            <label class="pfield pfield--full">
              <span class="pfield__lbl">Ride type <i>*</i></span>
              <select [(ngModel)]="formModel.ride_type_id" [disabled]="editMode">
                <option [ngValue]="null" disabled>Select ride type</option>
                <option *ngFor="let rt of formRideOptions" [ngValue]="rt.id">{{ rt.name }}</option>
              </select>
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Base fare <i>*</i></span>
              <input type="number" min="0" [(ngModel)]="formModel.base_fare" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Minimum fare <i>*</i></span>
              <input type="number" min="0" [(ngModel)]="formModel.min_fare" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Per km <i>*</i></span>
              <input type="number" min="0" [(ngModel)]="formModel.per_km" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Per min</span>
              <input type="number" min="0" [(ngModel)]="formModel.per_min" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Commission %</span>
              <input type="number" min="0" max="100" [(ngModel)]="formModel.commission_percent" />
            </label>
          </div>
        </section>

        <!-- Distance thresholds -->
        <section class="psec">
          <h3 class="psec__title"><tm-icon name="road" [size]="14" /> Distance thresholds</h3>
          <div class="pgrid">
            <label class="pfield">
              <span class="pfield__lbl">Threshold 1 (km)</span>
              <input type="number" min="0" [(ngModel)]="formModel.threshold_distance_1_km" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Fare/km after T1</span>
              <input type="number" min="0" [(ngModel)]="formModel.fare_per_km_after_threshold_1" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Threshold 2 (km)</span>
              <input type="number" min="0" [(ngModel)]="formModel.threshold_distance_2_km" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Fare/km after T2</span>
              <input type="number" min="0" [(ngModel)]="formModel.fare_per_km_after_threshold_2" />
            </label>
          </div>
        </section>

        <!-- Time thresholds -->
        <section class="psec">
          <h3 class="psec__title"><tm-icon name="calendar" [size]="14" /> Time thresholds</h3>
          <div class="pgrid">
            <label class="pfield">
              <span class="pfield__lbl">Threshold 1 (min)</span>
              <input type="number" min="0" [(ngModel)]="formModel.threshold_time_1_min" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Fare/min after T1</span>
              <input type="number" min="0" [(ngModel)]="formModel.fare_per_min_after_threshold_time_1" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Threshold 2 (min)</span>
              <input type="number" min="0" [(ngModel)]="formModel.threshold_time_2_min" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Fare/min after T2</span>
              <input type="number" min="0" [(ngModel)]="formModel.fare_per_min_after_threshold_time_2" />
            </label>
          </div>
        </section>

        <!-- Waiting & tax -->
        <section class="psec">
          <h3 class="psec__title"><tm-icon name="refresh" [size]="14" /> Waiting & tax</h3>
          <div class="pgrid">
            <label class="pfield">
              <span class="pfield__lbl">Waiting threshold (min)</span>
              <input type="number" min="0" [(ngModel)]="formModel.threshold_waiting_time_min" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Fare per waiting min</span>
              <input type="number" min="0" [(ngModel)]="formModel.fare_per_waiting_minute" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Tax %</span>
              <input type="number" min="0" max="100" [(ngModel)]="formModel.tax_percent" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Luggage charges</span>
              <input type="number" min="0" [(ngModel)]="formModel.luggage_charges" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Scheduled-ride fare</span>
              <input type="number" min="0" [(ngModel)]="formModel.scheduled_ride_fare" />
            </label>
          </div>
        </section>

        <!-- Cancellation -->
        <section class="psec">
          <h3 class="psec__title"><tm-icon name="x" [size]="14" /> Cancellation</h3>
          <div class="pgrid">
            <label class="pfield">
              <span class="pfield__lbl">Cancellation charges</span>
              <input type="number" min="0" [(ngModel)]="formModel.cancellation_charges" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Cancel threshold (km)</span>
              <input type="number" min="0" [(ngModel)]="formModel.cancel_threshold_distance_km" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Cancel threshold (min)</span>
              <input type="number" min="0" [(ngModel)]="formModel.cancel_threshold_time_min" />
            </label>
          </div>
        </section>

        <!-- Pickup -->
        <section class="psec">
          <h3 class="psec__title"><tm-icon name="pin" [size]="14" /> Pickup</h3>
          <div class="pgrid">
            <label class="pfield">
              <span class="pfield__lbl">Charge before threshold</span>
              <input type="number" min="0" [(ngModel)]="formModel.pickup_charge_before_threshold" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Charge after threshold</span>
              <input type="number" min="0" [(ngModel)]="formModel.pickup_charge_after_threshold" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Threshold distance (km)</span>
              <input type="number" min="0" [(ngModel)]="formModel.pickup_threshold_distance_km" />
            </label>
          </div>
        </section>

        <!-- No-show & subsidy -->
        <section class="psec">
          <h3 class="psec__title"><tm-icon name="bolt" [size]="14" /> No-show & cancel subsidy</h3>
          <div class="pgrid">
            <label class="pfield">
              <span class="pfield__lbl">No-show charge / min</span>
              <input type="number" min="0" [(ngModel)]="formModel.no_show_charges_per_minute" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">No-show threshold (min)</span>
              <input type="number" min="0" [(ngModel)]="formModel.no_show_threshold_minutes" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Cancel subsidy</span>
              <input type="number" min="0" [(ngModel)]="formModel.cancel_subsidy" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Subsidy threshold (min)</span>
              <input type="number" min="0" [(ngModel)]="formModel.cancel_subsidy_threshold_minutes" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Subsidy threshold (km)</span>
              <input type="number" min="0" [(ngModel)]="formModel.cancel_subsidy_threshold_distance_km" />
            </label>
          </div>
        </section>
      </div>

      <div slot="footer">
        <tm-button variant="ghost" (clicked)="closeForm()">Cancel</tm-button>
        <tm-button variant="green" [disabled]="submitting || !canSubmit" (clicked)="submitForm()">
          {{ submitting ? 'Saving…' : editMode ? 'Save changes' : 'Create rate card' }}
        </tm-button>
      </div>
    </tm-drawer>

    <!-- ========== Delete confirm ========== -->
    <tm-modal [open]="!!deleteTarget" title="Delete rate card" (closed)="deleteTarget = null">
      <div slot="body">
        <p>Delete the <strong>{{ deleteTarget ? rideName(deleteTarget) : '' }}</strong> rate card for
        <strong>{{ cityName }}</strong>? This cannot be undone.</p>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="deleteTarget = null">Cancel</tm-button>
        <tm-button variant="danger" [disabled]="submitting" (clicked)="confirmDelete()">Delete</tm-button>
      </div>
    </tm-modal>
  `,
  styles: [`
    .bp { display: flex; flex-direction: column; gap: 18px; }
    .bp__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .bp__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); }

    .cue {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 48px 24px; text-align: center;
      background: var(--tm-surface);
      border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg);
      color: var(--tm-text-muted);
    }
    .cue__title { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .cue__text { margin: 0 0 6px; font-size: 13px; max-width: 380px; }

    .bp__stats { display: flex; gap: 10px; flex-wrap: wrap; }
    .stat {
      display: flex; flex-direction: column; gap: 2px;
      padding: 12px 18px;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-md, 10px);
      min-width: 130px;
    }
    .stat__v { font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .stat__l { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: var(--tm-text-muted); }

    .tablewrap {
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      overflow-x: auto;
    }
    .rtable { width: 100%; border-collapse: collapse; }
    .rtable th {
      text-align: left; white-space: nowrap;
      padding: 11px 14px;
      font-size: 11px; font-weight: 800; letter-spacing: 0.4px;
      text-transform: uppercase; color: var(--tm-text-muted);
      background: var(--tm-canvas-2);
      border-bottom: 1px solid var(--tm-line);
    }
    .rtable td {
      padding: 12px 14px;
      font-size: 13px; font-weight: 600; color: var(--tm-text);
      border-bottom: 1px solid var(--tm-line);
      white-space: nowrap;
    }
    .rtable tbody tr:last-child td { border-bottom: none; }
    .rtable tbody tr:hover { background: var(--tm-canvas-2); }
    .rtable th.num, .rtable td.num { text-align: right; }
    .rtable th.act, .rtable td.act { text-align: right; }
    .rtable__name { font-weight: 800; }
    .rtable__icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 7px; margin-right: 8px;
      vertical-align: middle;
      background: var(--tm-green-tint, #e0f7fa); color: var(--tm-green);
    }
    .rtable__actions { display: flex; gap: 5px; justify-content: flex-end; }

    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 7px;
      background: var(--tm-canvas-2); color: var(--tm-text-muted); cursor: pointer;
    }
    .icon-btn:hover { background: var(--tm-ink); color: #fff; }
    .icon-btn--danger:hover { background: var(--tm-danger, #ef4444); }

    /* drawer form */
    .pform { display: flex; flex-direction: column; gap: 18px; }
    .psec { display: flex; flex-direction: column; gap: 9px; }
    .psec__title {
      display: flex; align-items: center; gap: 6px;
      margin: 0; font-size: 12px; font-weight: 800;
      text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--tm-text-muted);
    }
    .pgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .pfield { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .pfield--full { grid-column: 1 / -1; }
    .pfield__lbl { font-size: 11px; font-weight: 700; color: var(--tm-text); }
    .pfield__lbl i { color: var(--tm-danger, #ef4444); font-style: normal; }
    .pfield input, .pfield select {
      width: 100%; height: 36px; padding: 0 10px;
      border: 1px solid var(--tm-line); border-radius: 8px;
      background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13px; outline: none;
    }
    .pfield input:focus, .pfield select:focus { border-color: var(--tm-green); }
  `],
})
export class AdminPricingComponent implements OnInit, OnDestroy {
  allRules: PricingRule[] = [];
  rideTypes: RideRef[] = [];
  loading = true;

  cityId: number | null = null;
  cityName = '';

  // Drawer state
  submitting = false;
  drawerOpen = false;
  editMode = false;
  editingId: number | null = null;
  deleteTarget: PricingRule | null = null;
  formModel: PricingForm = this.defaultForm();

  private subs: Subscription[] = [];

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private toast: ToastService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.subs.push(
      this.cityCtx.cityId$.subscribe((id) => {
        this.cityId = id;
      }),
      this.cityCtx.cities$.subscribe((list) => {
        this.cityName = list.find((c) => c.id === this.cityId)?.name ?? '';
      }),
    );
    this.loadAll();
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  // ── Derived ──────────────────────────────────────────────────────

  get cityRules(): PricingRule[] {
    return this.allRules.filter((r) => r.city_id === this.cityId);
  }

  /** Ride types not yet priced for this city — selectable when creating. */
  get availableRideTypes(): RideRef[] {
    const used = new Set(this.cityRules.map((r) => r.ride_type_id));
    return this.rideTypes.filter((rt) => !used.has(rt.id));
  }

  /** Ride types shown in the form select (includes the current one on edit). */
  get formRideOptions(): RideRef[] {
    if (this.editMode) {
      const cur = this.rideTypes.find((rt) => rt.id === this.formModel.ride_type_id);
      return cur ? [cur] : this.rideTypes;
    }
    return this.availableRideTypes;
  }

  get avgBaseFare(): number {
    const fares = this.cityRules
      .map((r) => (typeof r.base_fare === 'number' ? r.base_fare : null))
      .filter((v): v is number => v != null);
    return fares.length ? fares.reduce((a, b) => a + b, 0) / fares.length : 0;
  }

  get canSubmit(): boolean {
    const f = this.formModel;
    return (
      !!this.cityId &&
      !!f.ride_type_id &&
      f.base_fare !== null && (f.base_fare as any) !== '' &&
      f.min_fare !== null && (f.min_fare as any) !== '' &&
      f.per_km !== null && (f.per_km as any) !== ''
    );
  }

  rideName(rule: PricingRule): string {
    return (
      rule.rideType?.name ||
      this.rideTypes.find((r) => r.id === rule.ride_type_id)?.name ||
      'Ride type'
    );
  }

  goTo(path: string): void {
    this.router.navigateByUrl(path);
  }

  // ── Data ─────────────────────────────────────────────────────────

  loadAll(): void {
    this.loading = true;
    let inflight = 2;
    const done = () => { if (--inflight === 0) this.loading = false; };

    this.api.get<{ data: RideRef[] }>('/admin/ride-types').subscribe({
      next: (res) => { this.rideTypes = res?.data || []; done(); },
      error: () => { this.toast.error('Failed to load ride types'); done(); },
    });

    this.api.get<{ data: { data: PricingRule[] } }>('/admin/pricing-rules').subscribe({
      next: (res) => { this.allRules = res?.data?.data || []; done(); },
      error: () => { this.toast.error('Failed to load pricing rules'); done(); },
    });
  }

  // ── Form lifecycle ───────────────────────────────────────────────

  openCreate(): void {
    if (this.cityId == null) return;
    this.editMode = false;
    this.editingId = null;
    this.formModel = this.defaultForm();
    this.formModel.city_id = this.cityId;
    this.drawerOpen = true;
  }

  openEdit(rule: PricingRule): void {
    this.editMode = true;
    this.editingId = rule.id;
    this.formModel = { ...this.defaultForm(), ...this.toFormShape(rule) };
    this.drawerOpen = true;
  }

  closeForm(): void {
    this.drawerOpen = false;
    this.submitting = false;
  }

  submitForm(): void {
    if (!this.canSubmit || this.submitting) return;
    this.submitting = true;
    const payload = this.normalizePayload(this.formModel);
    payload.city_id = this.cityId;

    const req = !this.editMode
      ? this.api.post<unknown>('/admin/pricing-rules', payload)
      : this.api.patch<unknown>(`/admin/pricing-rules/${this.editingId}`, payload);

    req.subscribe({
      next: () => {
        this.submitting = false;
        this.drawerOpen = false;
        this.toast.success(this.editMode ? 'Rate card updated' : 'Rate card created');
        this.loadAll();
      },
      error: (err) => {
        this.submitting = false;
        this.toast.error(err?.error?.message || 'Failed to save rate card');
      },
    });
  }

  confirmDelete(): void {
    const rule = this.deleteTarget;
    if (!rule || this.submitting) return;
    this.submitting = true;
    this.api.delete<unknown>(`/admin/pricing-rules/${rule.id}`).subscribe({
      next: () => {
        this.submitting = false;
        this.deleteTarget = null;
        this.allRules = this.allRules.filter((r) => r.id !== rule.id);
        this.toast.success('Rate card deleted');
      },
      error: (err) => {
        this.submitting = false;
        this.toast.error(err?.error?.message || 'Failed to delete rate card');
      },
    });
  }

  // ── Form shape helpers ───────────────────────────────────────────

  private defaultForm(): PricingForm {
    return {
      city_id: null,
      ride_type_id: null,
      base_fare: null,
      per_km: null,
      per_min: null,
      surge_multiplier: 1,
      commission_percent: null,
      min_fare: null,
      threshold_distance_1_km: null,
      fare_per_km_after_threshold_1: null,
      threshold_distance_2_km: null,
      fare_per_km_after_threshold_2: null,
      threshold_time_1_min: null,
      fare_per_min_after_threshold_time_1: null,
      threshold_time_2_min: null,
      fare_per_min_after_threshold_time_2: null,
      threshold_waiting_time_min: null,
      fare_per_waiting_minute: null,
      cancellation_charges: null,
      tax_percent: null,
      cancel_threshold_distance_km: null,
      cancel_threshold_time_min: null,
      luggage_charges: null,
      scheduled_ride_fare: null,
      pickup_charge_before_threshold: null,
      pickup_charge_after_threshold: null,
      pickup_threshold_distance_km: null,
      no_show_charges_per_minute: null,
      no_show_threshold_minutes: null,
      cancel_subsidy: null,
      cancel_subsidy_threshold_minutes: null,
      cancel_subsidy_threshold_distance_km: null,
    };
  }

  private toFormShape(rule: PricingRule): PricingForm {
    const f = this.defaultForm();
    (Object.keys(f) as (keyof PricingForm)[]).forEach((k) => {
      const v = (rule as any)[k];
      (f as any)[k] = v === undefined ? null : v;
    });
    return f;
  }

  private normalizePayload(form: PricingForm): PricingForm {
    const out: any = { ...form };
    for (const k of NUMERIC_FORM_FIELDS) {
      const v = out[k];
      if (v === '' || v === undefined) out[k] = null;
      else if (typeof v === 'string' && v.trim() !== '') out[k] = Number(v);
    }
    return out as PricingForm;
  }
}
