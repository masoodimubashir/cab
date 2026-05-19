import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectComponent,
  SelectOption,
} from '../ui';
import {
  ColumnComponent,
  DataTableComponent,
} from '../ui';

/**
 * Base Pricing — admin module. Mirrors the look-and-feel of the drivers list
 * (KPI strip + tm-data-table with toolbar search + filters + per-row actions,
 * tm-modal for create/edit/view). Server returns the full pricing-rules list
 * once; search and city/ride filtering happen client-side, same as the drivers
 * approvals tab does today.
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
    CommonModule,
    FormsModule,
    CardComponent,
    IconComponent,
    InputComponent,
    ButtonComponent,
    SelectComponent,
    ModalComponent,
    DataTableComponent,
    ColumnComponent,
  ],
  template: `
    <div class="pricing-page">
      <!-- ============ KPI strip ============ -->
      <section class="kpis">
        <tm-card class="kpi">
          <span class="kpi__label">Total rules</span>
          <span class="kpi__value">{{ allRules.length }}</span>
        </tm-card>
        <tm-card class="kpi">
          <span class="kpi__label">Cities covered</span>
          <span class="kpi__value">{{ citiesCoveredCount }}</span>
        </tm-card>
        <tm-card class="kpi">
          <span class="kpi__label">Ride types</span>
          <span class="kpi__value">{{ rideTypesCoveredCount }}</span>
        </tm-card>
        <tm-card class="kpi">
          <span class="kpi__label">Avg base fare</span>
          <span class="kpi__value">{{ avgBaseFare | number:'1.0-0' }}</span>
        </tm-card>
      </section>

      <!-- ============ Reusable table ============ -->
      <tm-data-table
        [rows]="filteredRules"
        [total]="filteredRules.length"
        [loading]="loading"
        emptyTitle="No pricing rules"
        emptyHint="Try a different search, or add a new rule for a city + ride type."
      >
        <!-- Search (left) -->
        <tm-input
          slot="search"
          icon="search"
          placeholder="Search by city or ride type"
          [(ngModel)]="search"
          (ngModelChange)="applyFilters()"
        />

        <!-- Filters + Add button (right) -->
        <ng-container slot="filters">
          <tm-select
            class="filter-select"
            [options]="cityFilterOptions"
            [(ngModel)]="cityFilter"
            (ngModelChange)="applyFilters()"
            placeholder="All cities"
          />
          <tm-select
            class="filter-select"
            [options]="rideFilterOptions"
            [(ngModel)]="rideFilter"
            (ngModelChange)="applyFilters()"
            placeholder="All ride types"
          />
          <tm-button variant="green" icon="plus" (clicked)="openCreate()">
            Add pricing rule
          </tm-button>
        </ng-container>

        <!-- Columns -->
        <tm-column key="id" label="ID" width="80">
          <ng-template let-row>
            <span class="cell-id cell-id--static">#{{ row.id }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="city" label="City">
          <ng-template let-row>
            <div class="cell-user">
              <span class="cell-avatar">{{ initials(cityName(row)) }}</span>
              <div class="cell-user__meta">
                <span class="cell-user__name">{{ cityName(row) }}</span>
                <span class="cell-user__sub">{{ rideName(row) }}</span>
              </div>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="base_fare" label="Base" width="90" align="right">
          <ng-template let-row>
            <span class="num">{{ row.base_fare ?? '—' }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="per_km" label="Per km" width="90" align="right">
          <ng-template let-row>
            <span class="num">{{ row.per_km ?? '—' }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="per_min" label="Per min" width="90" align="right">
          <ng-template let-row>
            <span class="num">{{ row.per_min ?? '—' }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="min_fare" label="Min fare" width="100" align="right">
          <ng-template let-row>
            <span class="num">{{ row.min_fare ?? '—' }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="surge_multiplier" label="Surge" width="90" align="right">
          <ng-template let-row>
            <span class="num">{{ row.surge_multiplier ?? '—' }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="tax_percent" label="Tax %" width="90" align="right">
          <ng-template let-row>
            <span class="num">{{ row.tax_percent ?? '—' }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="actions" label="" width="140" align="right">
          <ng-template let-row>
            <div class="row-actions">
              <button
                type="button"
                class="row-action"
                aria-label="View"
                (click)="openView(row)"
              >
                <tm-icon name="eye" [size]="14" />
              </button>
              <button
                type="button"
                class="row-action"
                aria-label="Edit"
                (click)="openEdit(row)"
              >
                <tm-icon name="edit" [size]="14" />
              </button>
              <button
                type="button"
                class="row-action row-action--danger"
                aria-label="Delete"
                (click)="remove(row)"
              >
                <tm-icon name="trash" [size]="14" />
              </button>
            </div>
          </ng-template>
        </tm-column>
      </tm-data-table>

      <p class="error" *ngIf="error">{{ error }}</p>
    </div>

    <!-- ============ Create / Edit modal ============ -->
    <tm-modal
      [open]="showFormModal"
      [title]="editMode ? 'Edit pricing rule' : 'Add pricing rule'"
      (closed)="closeForm()"
    >
      <div slot="body" class="fieldsets">
        <fieldset class="fs">
          <legend>Identity & base</legend>
          <div class="grid grid--4">
            <!-- div, not label — a label-for-tm-select synthesizes a 2nd click
                 on the trigger button when you pick an option, re-opening the
                 menu. The plain number inputs below keep their <label> tags. -->
            <div class="field">
              <span class="field__lbl">City</span>
              <tm-select
                [options]="cityOptions"
                [(ngModel)]="formModel.city_id"
                [disabled]="editMode"
                placeholder="Select city"
              />
            </div>
            <div class="field">
              <span class="field__lbl">Ride type</span>
              <tm-select
                [options]="rideOptions"
                [(ngModel)]="formModel.ride_type_id"
                [disabled]="editMode"
                placeholder="Select ride type"
              />
            </div>
            <label class="field">
              <span class="field__lbl">Base fare</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.base_fare" />
            </label>
            <label class="field">
              <span class="field__lbl">Per km</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.per_km" />
            </label>
            <label class="field">
              <span class="field__lbl">Per min</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.per_min" />
            </label>
            <label class="field">
              <span class="field__lbl">Min fare</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.min_fare" />
            </label>
            <label class="field">
              <span class="field__lbl">Surge multiplier</span>
              <input class="num-input" type="number" min="0" step="0.1" [(ngModel)]="formModel.surge_multiplier" />
            </label>
            <label class="field">
              <span class="field__lbl">Commission %</span>
              <input class="num-input" type="number" min="0" max="100" [(ngModel)]="formModel.commission_percent" />
            </label>
          </div>
        </fieldset>

        <fieldset class="fs">
          <legend>Distance thresholds</legend>
          <div class="grid grid--4">
            <label class="field">
              <span class="field__lbl">Threshold 1 (km)</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.threshold_distance_1_km" />
            </label>
            <label class="field">
              <span class="field__lbl">Fare/km after T1</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.fare_per_km_after_threshold_1" />
            </label>
            <label class="field">
              <span class="field__lbl">Threshold 2 (km)</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.threshold_distance_2_km" />
            </label>
            <label class="field">
              <span class="field__lbl">Fare/km after T2</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.fare_per_km_after_threshold_2" />
            </label>
          </div>
        </fieldset>

        <fieldset class="fs">
          <legend>Time thresholds</legend>
          <div class="grid grid--4">
            <label class="field">
              <span class="field__lbl">Threshold 1 (min)</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.threshold_time_1_min" />
            </label>
            <label class="field">
              <span class="field__lbl">Fare/min after T1</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.fare_per_min_after_threshold_time_1" />
            </label>
            <label class="field">
              <span class="field__lbl">Threshold 2 (min)</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.threshold_time_2_min" />
            </label>
            <label class="field">
              <span class="field__lbl">Fare/min after T2</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.fare_per_min_after_threshold_time_2" />
            </label>
          </div>
        </fieldset>

        <fieldset class="fs">
          <legend>Waiting & tax</legend>
          <div class="grid grid--4">
            <label class="field">
              <span class="field__lbl">Waiting threshold (min)</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.threshold_waiting_time_min" />
            </label>
            <label class="field">
              <span class="field__lbl">Fare per waiting min</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.fare_per_waiting_minute" />
            </label>
            <label class="field">
              <span class="field__lbl">Tax %</span>
              <input class="num-input" type="number" min="0" max="100" [(ngModel)]="formModel.tax_percent" />
            </label>
          </div>
        </fieldset>

        <fieldset class="fs">
          <legend>Cancellation</legend>
          <div class="grid grid--4">
            <label class="field">
              <span class="field__lbl">Cancellation charges</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.cancellation_charges" />
            </label>
            <label class="field">
              <span class="field__lbl">Cancel threshold (km)</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.cancel_threshold_distance_km" />
            </label>
            <label class="field">
              <span class="field__lbl">Cancel threshold (min)</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.cancel_threshold_time_min" />
            </label>
            <label class="field">
              <span class="field__lbl">Luggage charges</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.luggage_charges" />
            </label>
            <label class="field">
              <span class="field__lbl">Scheduled-ride fare</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.scheduled_ride_fare" />
            </label>
          </div>
        </fieldset>

        <fieldset class="fs">
          <legend>Pickup</legend>
          <div class="grid grid--4">
            <label class="field">
              <span class="field__lbl">Charge before threshold</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.pickup_charge_before_threshold" />
            </label>
            <label class="field">
              <span class="field__lbl">Charge after threshold</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.pickup_charge_after_threshold" />
            </label>
            <label class="field">
              <span class="field__lbl">Threshold distance (km)</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.pickup_threshold_distance_km" />
            </label>
          </div>
        </fieldset>

        <fieldset class="fs">
          <legend>No-show & cancel subsidy</legend>
          <div class="grid grid--4">
            <label class="field">
              <span class="field__lbl">No-show charge / min</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.no_show_charges_per_minute" />
            </label>
            <label class="field">
              <span class="field__lbl">No-show threshold (min)</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.no_show_threshold_minutes" />
            </label>
            <label class="field">
              <span class="field__lbl">Cancel subsidy</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.cancel_subsidy" />
            </label>
            <label class="field">
              <span class="field__lbl">Subsidy threshold (min)</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.cancel_subsidy_threshold_minutes" />
            </label>
            <label class="field">
              <span class="field__lbl">Subsidy threshold (km)</span>
              <input class="num-input" type="number" min="0" [(ngModel)]="formModel.cancel_subsidy_threshold_distance_km" />
            </label>
          </div>
        </fieldset>
      </div>

      <ng-container slot="footer">
        <tm-button variant="ghost" (clicked)="closeForm()">Cancel</tm-button>
        <tm-button
          variant="green"
          [disabled]="submitting || !canSubmit"
          [loading]="submitting"
          (clicked)="submitForm()"
        >
          {{ editMode ? 'Update' : 'Create' }}
        </tm-button>
      </ng-container>
    </tm-modal>

    <!-- ============ View modal ============ -->
    <tm-modal
      [open]="showViewModal"
      [title]="'Pricing rule details'"
      (closed)="closeView()"
    >
      <div slot="body" class="details-grid" *ngIf="viewRule">
        <div class="detail"><span class="lbl">City</span><span>{{ cityName(viewRule) }}</span></div>
        <div class="detail"><span class="lbl">Ride</span><span>{{ rideName(viewRule) }}</span></div>
        <div class="detail"><span class="lbl">Base fare</span><span>{{ viewRule.base_fare ?? '—' }}</span></div>
        <div class="detail"><span class="lbl">Per km</span><span>{{ viewRule.per_km ?? '—' }}</span></div>
        <div class="detail"><span class="lbl">Per min</span><span>{{ viewRule.per_min ?? '—' }}</span></div>
        <div class="detail"><span class="lbl">Min fare</span><span>{{ viewRule.min_fare ?? '—' }}</span></div>
        <div class="detail"><span class="lbl">Surge</span><span>{{ viewRule.surge_multiplier ?? '—' }}</span></div>
        <div class="detail"><span class="lbl">Commission %</span><span>{{ viewRule.commission_percent ?? '—' }}</span></div>
        <div class="detail"><span class="lbl">Tax %</span><span>{{ viewRule.tax_percent ?? '—' }}</span></div>
        <div class="detail"><span class="lbl">Cancellation</span><span>{{ viewRule.cancellation_charges ?? '—' }}</span></div>
        <div class="detail"><span class="lbl">No-show / min</span><span>{{ viewRule.no_show_charges_per_minute ?? '—' }}</span></div>
        <div class="detail"><span class="lbl">Luggage</span><span>{{ viewRule.luggage_charges ?? '—' }}</span></div>
      </div>

      <ng-container slot="footer">
        <tm-button variant="ghost" (clicked)="closeView()">Close</tm-button>
        <tm-button variant="green" icon="edit" (clicked)="editFromView()" *ngIf="viewRule">Edit</tm-button>
      </ng-container>
    </tm-modal>
  `,
  styles: [`
    :host { display: block; }

    .pricing-page {
      display: flex;
      flex-direction: column;
      gap: var(--tm-space-5);
    }

    /* KPI strip */
    .kpis {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--tm-space-4);
    }
    .kpi {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 14px 16px;
    }
    .kpi__label {
      font-size: 12px;
      color: var(--tm-text-soft);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .kpi__value {
      font-family: var(--tm-font-display);
      font-size: 26px;
      font-weight: 800;
      color: var(--tm-ink);
      line-height: 1.1;
    }

    /* Table cell helpers — mirror drivers list */
    .cell-id { font-family: var(--tm-font-mono); font-weight: 700; color: var(--tm-text-soft); font-size: 12px; }
    .cell-user { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .cell-avatar {
      width: 32px; height: 32px;
      border-radius: 50%;
      background: var(--tm-green-tint);
      color: var(--tm-green-deep);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 800;
      flex-shrink: 0;
    }
    .cell-user__meta { display: flex; flex-direction: column; min-width: 0; }
    .cell-user__name {
      font-weight: 700;
      color: var(--tm-text);
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cell-user__sub {
      font-size: 12px;
      color: var(--tm-text-soft);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .num { font-family: var(--tm-font-mono); font-weight: 700; font-size: 13px; color: var(--tm-text); }

    /* Row actions — circular icon buttons */
    .row-actions {
      display: inline-flex;
      gap: 4px;
      align-items: center;
      justify-content: flex-end;
    }
    .row-action {
      width: 28px; height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      border: 0;
      background: transparent;
      color: var(--tm-text-soft);
      cursor: pointer;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .row-action:hover { background: var(--tm-canvas-2); color: var(--tm-text); }
    .row-action--danger:hover { background: rgba(220, 38, 38, 0.10); color: #b91c1c; }

    /* Keep the filters compact so the search + 2 selects + Add button stay on
       one line in the toolbar. tm-select fills its container, so we cap each
       chip here rather than touching the primitive. */
    .filter-select {
      width: 150px;
      flex: 0 0 auto;
    }
    @media (max-width: 720px) { .filter-select { width: 140px; } }

    /* Uniform toolbar control height — input/select/button each ship with
       their own padding so they end up 36–40px tall. Lock them all to 40px
       so the four chips read as a single bar. Scoped to this page only.
       tm-input renders .field, tm-select renders .trigger, tm-button renders
       .tm-btn — those are the inner elements whose padding sets the height. */
    :host ::ng-deep .tm-dt__toolbar tm-input .field,
    :host ::ng-deep .tm-dt__toolbar tm-select .trigger,
    :host ::ng-deep .tm-dt__toolbar tm-button .tm-btn {
      height: 40px;
      box-sizing: border-box;
      padding-top: 0;
      padding-bottom: 0;
    }

    .error {
      margin: 0;
      padding: 10px 14px;
      border-radius: var(--tm-radius-md);
      background: rgba(220, 38, 38, 0.08);
      color: #b91c1c;
      font-weight: 600;
      font-size: 13px;
    }

    /* ============ Modal form ============ */
    .fieldsets { display: flex; flex-direction: column; gap: 14px; }
    .fs {
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-md);
      padding: 12px 14px 14px;
      margin: 0;
      background: var(--tm-canvas);
    }
    .fs legend {
      padding: 0 6px;
      font-size: 12px;
      font-weight: 800;
      color: var(--tm-text);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .grid { display: grid; gap: 10px 12px; }
    .grid--4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    @media (max-width: 980px) { .grid--4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 560px) { .grid--4 { grid-template-columns: 1fr; } }

    .field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .field__lbl {
      font-size: 11px;
      font-weight: 800;
      color: var(--tm-text-soft);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .num-input {
      width: 100%;
      height: 36px;
      padding: 0 12px;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-sm);
      background: var(--tm-surface);
      font-family: var(--tm-font-body);
      font-size: 13px;
      font-weight: 600;
      color: var(--tm-text);
      transition: border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .num-input:hover { border-color: var(--tm-ink); }
    .num-input:focus { outline: 0; border-color: var(--tm-ink); }

    .details-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px 12px;
    }
    @media (max-width: 560px) { .details-grid { grid-template-columns: 1fr; } }
    .detail {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border-radius: var(--tm-radius-sm);
      background: var(--tm-canvas-2);
      font-size: 13px;
      font-weight: 700;
      color: var(--tm-text);
    }
    .detail .lbl {
      font-size: 11px;
      font-weight: 800;
      color: var(--tm-text-soft);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    @media (max-width: 980px) { .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 560px) { .kpis { grid-template-columns: 1fr; } }

    /* tm-modal locks the panel to min(480px, 100%). Widen it per modal: the
       form modal has a 4-col fieldset grid and needs the room; the view
       modal only renders 2-col detail chips. Using :has() so we can target
       each panel by the marker class on its body content. */
    :host ::ng-deep .tm-modal__panel:has(.fieldsets) {
      width: min(1280px, 96vw);
    }
    :host ::ng-deep .tm-modal__panel:has(.details-grid) {
      width: min(760px, 96vw);
    }
  `],
})
export class AdminPricingComponent implements OnInit {
  allRules: PricingRule[] = [];
  filteredRules: PricingRule[] = [];
  error: string | null = null;
  loading = true;

  cities: CityRef[] = [];
  rideTypes: RideRef[] = [];

  // Filters
  search = '';
  cityFilter: number | null = null;
  rideFilter: number | null = null;

  // Modal state
  submitting = false;
  showFormModal = false;
  showViewModal = false;
  editMode = false;
  editingId: number | null = null;
  viewRule: PricingRule | null = null;
  formModel: PricingForm = this.defaultForm();

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.loadAll();
  }

  // ── Derived data ────────────────────────────────────────────────

  get cityFilterOptions(): SelectOption<number | null>[] {
    return [
      { label: 'All cities', value: null },
      ...this.cities.map((c) => ({ label: c.name, value: c.id })),
    ];
  }

  get rideFilterOptions(): SelectOption<number | null>[] {
    return [
      { label: 'All ride types', value: null },
      ...this.rideTypes.map((r) => ({ label: r.name, value: r.id })),
    ];
  }

  get cityOptions(): SelectOption<number | null>[] {
    return this.cities.map((c) => ({ label: c.name, value: c.id }));
  }

  get rideOptions(): SelectOption<number | null>[] {
    return this.rideTypes.map((r) => ({ label: r.name, value: r.id }));
  }

  get citiesCoveredCount(): number {
    return new Set(this.allRules.map((r) => r.city_id).filter((id) => id != null)).size;
  }

  get rideTypesCoveredCount(): number {
    return new Set(this.allRules.map((r) => r.ride_type_id).filter((id) => id != null)).size;
  }

  get avgBaseFare(): number {
    const fares = this.allRules
      .map((r) => (typeof r.base_fare === 'number' ? r.base_fare : null))
      .filter((v): v is number => v != null);
    if (!fares.length) return 0;
    return fares.reduce((a, b) => a + b, 0) / fares.length;
  }

  get canCreate(): boolean {
    return (
      !!this.formModel.city_id &&
      !!this.formModel.ride_type_id &&
      this.formModel.base_fare !== null &&
      this.formModel.per_km !== null &&
      this.formModel.per_min !== null &&
      this.formModel.surge_multiplier !== null &&
      this.formModel.commission_percent !== null
    );
  }

  get canSubmit(): boolean {
    return this.editMode ? this.editingId !== null : this.canCreate;
  }

  // ── View helpers ────────────────────────────────────────────────

  cityName(rule: PricingRule): string {
    return rule.city?.name || this.cities.find((c) => c.id === rule.city_id)?.name || '—';
  }

  rideName(rule: PricingRule): string {
    return rule.rideType?.name || this.rideTypes.find((r) => r.id === rule.ride_type_id)?.name || '—';
  }

  initials(name: string | null | undefined): string {
    if (!name) return '·';
    const parts = name.trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '·';
  }

  // ── Filtering ───────────────────────────────────────────────────

  applyFilters(): void {
    const q = this.search.trim().toLowerCase();
    this.filteredRules = this.allRules.filter((r) => {
      if (this.cityFilter != null && r.city_id !== this.cityFilter) return false;
      if (this.rideFilter != null && r.ride_type_id !== this.rideFilter) return false;
      if (!q) return true;
      return (
        this.cityName(r).toLowerCase().includes(q) ||
        this.rideName(r).toLowerCase().includes(q)
      );
    });
  }

  // ── Data ────────────────────────────────────────────────────────

  loadAll(): void {
    this.error = null;
    this.loading = true;
    let inflight = 3;
    const done = () => { if (--inflight === 0) this.loading = false; };

    this.api.get<{ data: CityRef[] }>('/admin/cities').subscribe({
      next: (res) => { this.cities = res?.data || []; done(); },
      error: (err) => { this.error = err?.error?.message || 'Failed to load cities'; done(); },
    });

    this.api.get<{ data: RideRef[] }>('/admin/ride-types').subscribe({
      next: (res) => { this.rideTypes = res?.data || []; done(); },
      error: (err) => { this.error = err?.error?.message || 'Failed to load ride types'; done(); },
    });

    this.api.get<{ data: { data: PricingRule[] } }>('/admin/pricing-rules').subscribe({
      next: (res) => {
        this.allRules = res?.data?.data || [];
        this.applyFilters();
        done();
      },
      error: (err) => { this.error = err?.error?.message || 'Failed to load pricing rules'; done(); },
    });
  }

  // ── Form lifecycle ──────────────────────────────────────────────

  openCreate(): void {
    this.error = null;
    this.editMode = false;
    this.editingId = null;
    this.formModel = this.defaultForm();
    this.showFormModal = true;
  }

  openEdit(rule: PricingRule): void {
    this.error = null;
    this.editMode = true;
    this.editingId = rule.id;
    this.formModel = { ...this.defaultForm(), ...this.toFormShape(rule) };
    this.showFormModal = true;
  }

  closeForm(): void {
    this.showFormModal = false;
    this.submitting = false;
  }

  openView(rule: PricingRule): void {
    this.viewRule = rule;
    this.showViewModal = true;
  }

  closeView(): void {
    this.showViewModal = false;
    this.viewRule = null;
  }

  editFromView(): void {
    const rule = this.viewRule;
    this.closeView();
    if (rule) this.openEdit(rule);
  }

  submitForm(): void {
    if (!this.canSubmit || this.submitting) return;
    this.submitting = true;
    this.error = null;

    const payload = this.normalizePayload(this.formModel);
    const req = !this.editMode
      ? this.api.post<unknown>('/admin/pricing-rules', payload)
      : this.api.patch<unknown>(`/admin/pricing-rules/${this.editingId}`, payload);

    req.subscribe({
      next: () => {
        this.closeForm();
        this.loadAll();
      },
      error: (err) => {
        this.error = err?.error?.message || (this.editMode ? 'Failed to update pricing rule' : 'Failed to add pricing rule');
        this.submitting = false;
      },
      complete: () => { this.submitting = false; },
    });
  }

  remove(rule: PricingRule): void {
    this.error = null;
    const city = rule?.city?.name || this.cityName(rule);
    const ride = rule?.rideType?.name || this.rideName(rule);
    const ok = window.confirm(`Delete pricing rule for ${city} — ${ride}?`);
    if (!ok) return;

    this.api.delete<unknown>(`/admin/pricing-rules/${rule.id}`).subscribe({
      next: () => {
        this.allRules = this.allRules.filter((r) => r.id !== rule.id);
        this.applyFilters();
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to delete pricing rule';
      },
    });
  }

  // ── Form shape helpers ──────────────────────────────────────────

  private defaultForm(): PricingForm {
    return {
      city_id: null,
      ride_type_id: null,
      base_fare: 0,
      per_km: 0,
      per_min: 0,
      surge_multiplier: 1,
      commission_percent: 20,
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

  /**
   * Strip server-only/non-form keys from a row so we don't accidentally feed
   * Eloquent relation objects (city, rideType) back into the form model.
   */
  private toFormShape(rule: PricingRule): PricingForm {
    const f = this.defaultForm();
    (Object.keys(f) as (keyof PricingForm)[]).forEach((k) => {
      const v = (rule as any)[k];
      (f as any)[k] = v === undefined ? null : v;
    });
    return f;
  }

  /**
   * Coerce empty `<input type="number">` values (which arrive as `''`) back to
   * `null` so the backend validator doesn't see them as zero or invalid.
   */
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
