import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent } from '../../ui';

interface FareField {
  key: string;
  label: string;
  req?: boolean;
}

interface FareSection {
  title: string;
  fields: FareField[];
}

/** The rate-card fields, grouped — matches the pricing_rules columns. */
const FARE_SECTIONS: FareSection[] = [
  {
    title: 'Base fare',
    fields: [
      { key: 'base_fare', label: 'Base fare', req: true },
    ],
  },
  {
    title: 'Distance thresholds',
    fields: [
      { key: 'threshold_distance_1_km', label: 'Threshold 1 (km)' },
      { key: 'fare_per_km_after_threshold_1', label: 'Fare/km after T1' },
      { key: 'threshold_distance_2_km', label: 'Threshold 2 (km)' },
      { key: 'fare_per_km_after_threshold_2', label: 'Fare/km after T2' },
    ],
  },
  {
    title: 'Time thresholds',
    fields: [
      { key: 'threshold_time_1_min', label: 'Threshold 1 (min)' },
      { key: 'fare_per_min_after_threshold_time_1', label: 'Fare/min after T1' },
      { key: 'threshold_time_2_min', label: 'Threshold 2 (min)' },
      { key: 'fare_per_min_after_threshold_time_2', label: 'Fare/min after T2' },
    ],
  },
  {
    title: 'Waiting & tax',
    fields: [
      { key: 'threshold_waiting_time_min', label: 'Waiting threshold (min)' },
      { key: 'fare_per_waiting_minute', label: 'Fare per waiting min' },
      { key: 'tax_percent', label: 'Tax %' },
      { key: 'luggage_charges', label: 'Luggage charges' },
      { key: 'scheduled_ride_fare', label: 'Scheduled-ride fare' },
    ],
  },
  {
    title: 'Cancellation',
    fields: [
      { key: 'cancellation_charges', label: 'Cancellation charges' },
      { key: 'cancel_threshold_distance_km', label: 'Cancel threshold (km)' },
      { key: 'cancel_threshold_time_min', label: 'Cancel threshold (min)' },
    ],
  },
  {
    title: 'Pickup',
    fields: [
      { key: 'pickup_charge_before_threshold', label: 'Charge before threshold' },
      { key: 'pickup_charge_after_threshold', label: 'Charge after threshold' },
      { key: 'pickup_threshold_distance_km', label: 'Threshold distance (km)' },
    ],
  },
  {
    title: 'No-show & cancel subsidy',
    fields: [
      { key: 'no_show_charges_per_minute', label: 'No-show charge / min' },
      { key: 'no_show_threshold_minutes', label: 'No-show threshold (min)' },
      { key: 'cancel_subsidy', label: 'Cancel subsidy' },
      { key: 'cancel_subsidy_threshold_minutes', label: 'Subsidy threshold (min)' },
      { key: 'cancel_subsidy_threshold_distance_km', label: 'Subsidy threshold (km)' },
    ],
  },
];

const ALL_KEYS: string[] = FARE_SECTIONS.flatMap((s) => s.fields.map((f) => f.key));

/**
 * Base Pricing editor for one vehicle — the rate card (base fare, thresholds,
 * taxes, …) for this vehicle's (city, vehicle type, product kind).
 * Embedded as a tab on the vehicle detail page.
 */
@Component({
  selector: 'app-vehicle-base-pricing',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent],
  template: `
    <div class="bp">
      <div class="bp__head">
        <div>
          <h3 class="bp__title">{{ title }}</h3>
          <p class="bp__sub">{{ subtitle }}</p>
        </div>
        <tm-button variant="green" size="sm" [disabled]="saving || !canSave" (clicked)="save()">
          {{ saving ? 'Saving…' : 'Save rate card' }}
        </tm-button>
      </div>

      <div class="bp__cue" *ngIf="loading">Loading rate card…</div>

      <ng-container *ngIf="!loading">
        <section class="psec" *ngFor="let sec of sections">
          <h4 class="psec__title">{{ sec.title }}</h4>
          <div class="pgrid">
            <label class="pfield" *ngFor="let f of sec.fields">
              <span class="pfield__lbl">{{ f.label }}<i *ngIf="f.req"> *</i></span>
              <input
                type="number" min="0"
                [ngModel]="form[f.key]"
                (ngModelChange)="form[f.key] = $event"
              />
            </label>
          </div>
        </section>
      </ng-container>
    </div>
  `,
  styles: [`
    .bp { display: flex; flex-direction: column; gap: 16px; }
    .bp__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    .bp__title { margin: 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .bp__sub { margin: 2px 0 0; font-size: 12px; color: var(--tm-text-muted); }
    .bp__cue {
      padding: 26px; text-align: center; font-size: 13px; color: var(--tm-text-muted);
      background: var(--tm-surface); border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
    }

    .psec { display: flex; flex-direction: column; gap: 8px; }
    .psec__title {
      margin: 0; font-size: 12px; font-weight: 800;
      text-transform: uppercase; letter-spacing: 0.5px; color: var(--tm-text-muted);
    }
    .pgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .pfield { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .pfield__lbl { font-size: 11px; font-weight: 700; color: var(--tm-text); }
    .pfield__lbl i { color: var(--tm-danger, #ef4444); font-style: normal; }
    .pfield input {
      width: 100%; height: 36px; padding: 0 10px;
      border: 1px solid var(--tm-line); border-radius: 8px;
      background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13px; outline: none;
    }
    .pfield input:focus { border-color: var(--tm-green); }
  `],
})
export class VehicleBasePricingComponent implements OnChanges {
  @Input() cityId: number | null = null;
  @Input() cityVehicleTypeId: number | null = null;
  @Input() title = 'Base Pricing';
  @Input() subtitle = 'The fare rate card for this vehicle.';

  readonly sections = FARE_SECTIONS;

  form: Record<string, number | null> = this.blankForm();
  loading = false;
  saving = false;

  constructor(private api: ApiService, private toast: ToastService) {}

  ngOnChanges(): void {
    if (this.cityId != null && this.cityVehicleTypeId != null) {
      this.load();
    }
  }

  get canSave(): boolean {
    const filled = (v: unknown) => v !== null && v !== undefined && (v as any) !== '';
    return filled(this.form['base_fare']);
  }

  load(): void {
    if (this.cityId == null || this.cityVehicleTypeId == null) return;
    this.loading = true;
    const params = new URLSearchParams({ city_vehicle_type_id: String(this.cityVehicleTypeId) });

    this.api.get<{ rule: Record<string, any> | null }>(`/admin/pricing-rules/resolve?${params}`).subscribe({
      next: (res) => {
        const rule = res?.rule ?? null;
        const f = this.blankForm();
        if (rule) {
          for (const k of ALL_KEYS) {
            const v = rule[k];
            f[k] = v === undefined || v === null ? null : Number(v);
          }
        }
        this.form = f;
        this.loading = false;
      },
      error: () => { this.loading = false; this.toast.error('Failed to load rate card'); },
    });
  }

  save(): void {
    if (!this.canSave || this.saving || this.cityVehicleTypeId == null) return;
    this.saving = true;
    const payload: Record<string, unknown> = {
      city_vehicle_type_id: this.cityVehicleTypeId,
      surge_multiplier: 1,
    };
    for (const k of ALL_KEYS) {
      const v = this.form[k];
      payload[k] = v === undefined || (v as any) === '' ? null : v;
    }

    this.api.post('/admin/pricing-rules', payload).subscribe({
      next: () => {
        this.saving = false;
        this.toast.success('Rate card saved');
      },
      error: (err) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Failed to save rate card');
      },
    });
  }

  private blankForm(): Record<string, number | null> {
    const f: Record<string, number | null> = {};
    for (const k of ALL_KEYS) f[k] = null;
    return f;
  }
}
