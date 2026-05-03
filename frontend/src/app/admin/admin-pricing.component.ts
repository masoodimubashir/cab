import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { ApiService } from '../core/api.service';

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

@Component({
  selector: 'app-admin-pricing',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, TableModule, ButtonModule, InputNumberModule],
  template: `
    <p-card header="Pricing Control">
      <div class="toolbar">
        <button pButton type="button" label="Add Pricing Rule" icon="pi pi-plus" (click)="openCreate()"></button>
      </div>

      <p-table [value]="rules" *ngIf="!loading && rules?.length; else pricingState">
        <ng-template pTemplate="header">
          <tr>
            <th>City</th>
            <th>Ride</th>
            <th>Base Fare</th>
            <th>Per Km</th>
            <th>Per Min</th>
            <th>Min Fare</th>
            <th>Surge</th>
            <th>Tax %</th>
            <th>Actions</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr>
            <td>{{ row.city?.name || getCityName(row.city_id) }}</td>
            <td>{{ row.rideType?.name || getRideName(row.ride_type_id) }}</td>
            <td>{{ row.base_fare ?? '-' }}</td>
            <td>{{ row.per_km ?? '-' }}</td>
            <td>{{ row.per_min ?? '-' }}</td>
            <td>{{ row.min_fare ?? '-' }}</td>
            <td>{{ row.surge_multiplier ?? '-' }}</td>
            <td>{{ row.tax_percent ?? '-' }}</td>
            <td class="row-actions">
              <button pButton type="button" class="p-button-rounded p-button-text" icon="pi pi-eye" (click)="openView(row)"></button>
              <button pButton type="button" class="p-button-rounded p-button-text p-button-info" icon="pi pi-pencil" (click)="openEdit(row)"></button>
              <button pButton type="button" class="p-button-rounded p-button-text p-button-danger" icon="pi pi-trash" (click)="remove(row)"></button>
            </td>
          </tr>
        </ng-template>
      </p-table>

      <ng-template #pricingState>
        <div *ngIf="loading">Loading pricing rules...</div>
        <div *ngIf="!loading && !error && !rules?.length">No pricing rules found.</div>
      </ng-template>
    </p-card>

    <div *ngIf="error" style="color: #b00020; margin-top: 12px;">
      {{ error }}
    </div>

    <div class="modal-backdrop" *ngIf="showFormModal">
      <div class="modal">
        <div class="modal__header">
          <h3>{{ editMode ? 'Edit Pricing Rule' : 'Add Pricing Rule' }}</h3>
          <button pButton type="button" class="p-button-text" icon="pi pi-times" (click)="closeForm()"></button>
        </div>

        <div class="fieldset-grid">
          <fieldset class="pricing-fieldset">
            <legend>Identity & Base</legend>
            <div class="form-grid">
              <div class="form-field">
                <label>City</label>
                <select class="select" [(ngModel)]="formModel.city_id" [disabled]="editMode">
                  <option [ngValue]="null">Select city</option>
                  <option *ngFor="let c of cities" [ngValue]="c.id">{{ c.name }}</option>
                </select>
              </div>
              <div class="form-field">
                <label>Ride Type</label>
                <select class="select" [(ngModel)]="formModel.ride_type_id" [disabled]="editMode">
                  <option [ngValue]="null">Select ride type</option>
                  <option *ngFor="let rt of rideTypes" [ngValue]="rt.id">{{ rt.name }}</option>
                </select>
              </div>
              <div class="form-field"><label>Base Fare</label><p-inputNumber [(ngModel)]="formModel.base_fare" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
              <div class="form-field"><label>Per Km</label><p-inputNumber [(ngModel)]="formModel.per_km" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
              <div class="form-field"><label>Per Min</label><p-inputNumber [(ngModel)]="formModel.per_min" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
              <div class="form-field"><label>Min Fare</label><p-inputNumber [(ngModel)]="formModel.min_fare" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
              <div class="form-field"><label>Surge Multiplier</label><p-inputNumber [(ngModel)]="formModel.surge_multiplier" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
              <div class="form-field"><label>Commission %</label><p-inputNumber [(ngModel)]="formModel.commission_percent" [useGrouping]="false" [showButtons]="false" [min]="0" [max]="100" /></div>
            </div>
          </fieldset>

          <fieldset class="pricing-fieldset">
            <legend>Distance Thresholds</legend>
            <div class="form-grid">
              <div class="form-field"><label>Threshold Distance 1 (km)</label><p-inputNumber [(ngModel)]="formModel.threshold_distance_1_km" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
              <div class="form-field"><label>Fare per km after Threshold 1</label><p-inputNumber [(ngModel)]="formModel.fare_per_km_after_threshold_1" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
              <div class="form-field"><label>Threshold Distance 2 (km)</label><p-inputNumber [(ngModel)]="formModel.threshold_distance_2_km" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
              <div class="form-field"><label>Fare per km after Threshold 2</label><p-inputNumber [(ngModel)]="formModel.fare_per_km_after_threshold_2" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
            </div>
          </fieldset>

          <fieldset class="pricing-fieldset">
            <legend>Time Thresholds</legend>
            <div class="form-grid">
              <div class="form-field"><label>Threshold Time 1 (min)</label><p-inputNumber [(ngModel)]="formModel.threshold_time_1_min" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
              <div class="form-field"><label>Fare per Minute after Time 1</label><p-inputNumber [(ngModel)]="formModel.fare_per_min_after_threshold_time_1" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
              <div class="form-field"><label>Threshold Time 2 (min)</label><p-inputNumber [(ngModel)]="formModel.threshold_time_2_min" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
              <div class="form-field"><label>Fare per Minute after Time 2</label><p-inputNumber [(ngModel)]="formModel.fare_per_min_after_threshold_time_2" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
            </div>
          </fieldset>

          <fieldset class="pricing-fieldset">
            <legend>Waiting & Tax</legend>
            <div class="form-grid">
              <div class="form-field"><label>Threshold Waiting Time (min)</label><p-inputNumber [(ngModel)]="formModel.threshold_waiting_time_min" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
              <div class="form-field"><label>Fare per Waiting Minute</label><p-inputNumber [(ngModel)]="formModel.fare_per_waiting_minute" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
              <div class="form-field"><label>Tax Percentage</label><p-inputNumber [(ngModel)]="formModel.tax_percent" [useGrouping]="false" [showButtons]="false" [min]="0" [max]="100" /></div>
            </div>
          </fieldset>

          <fieldset class="pricing-fieldset">
            <legend>Cancellation</legend>
            <div class="form-grid">
              <div class="form-field"><label>Cancellation Charges</label><p-inputNumber [(ngModel)]="formModel.cancellation_charges" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
              <div class="form-field"><label>Cancel Threshold Distance (km)</label><p-inputNumber [(ngModel)]="formModel.cancel_threshold_distance_km" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
              <div class="form-field"><label>Cancel Threshold Time (min)</label><p-inputNumber [(ngModel)]="formModel.cancel_threshold_time_min" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
              <div class="form-field"><label>Luggage Charges</label><p-inputNumber [(ngModel)]="formModel.luggage_charges" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
              <div class="form-field"><label>Scheduled Ride Fare</label><p-inputNumber [(ngModel)]="formModel.scheduled_ride_fare" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
            </div>
          </fieldset>

          <fieldset class="pricing-fieldset">
            <legend>Pickup</legend>
            <div class="form-grid">
              <div class="form-field"><label>Pickup Charge Before Threshold</label><p-inputNumber [(ngModel)]="formModel.pickup_charge_before_threshold" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
              <div class="form-field"><label>Pickup Charge After Threshold</label><p-inputNumber [(ngModel)]="formModel.pickup_charge_after_threshold" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
              <div class="form-field"><label>Pickup Threshold Distance (km)</label><p-inputNumber [(ngModel)]="formModel.pickup_threshold_distance_km" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
            </div>
          </fieldset>

          <fieldset class="pricing-fieldset">
            <legend>No Show</legend>
            <div class="form-grid">
              <div class="form-field"><label>No Show Charges per Minute</label><p-inputNumber [(ngModel)]="formModel.no_show_charges_per_minute" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
              <div class="form-field"><label>No Show Threshold Minutes</label><p-inputNumber [(ngModel)]="formModel.no_show_threshold_minutes" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
            </div>
          </fieldset>

          <fieldset class="pricing-fieldset">
            <legend>Cancel Subsidy</legend>
            <div class="form-grid">
              <div class="form-field"><label>Cancel Subsidy</label><p-inputNumber [(ngModel)]="formModel.cancel_subsidy" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
              <div class="form-field"><label>Cancel Subsidy Threshold (min)</label><p-inputNumber [(ngModel)]="formModel.cancel_subsidy_threshold_minutes" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
              <div class="form-field"><label>Cancel Subsidy Threshold Distance (km)</label><p-inputNumber [(ngModel)]="formModel.cancel_subsidy_threshold_distance_km" [useGrouping]="false" [showButtons]="false" [min]="0" /></div>
            </div>
          </fieldset>
        </div>

        <div class="modal__actions">
          <button pButton type="button" class="p-button-text" label="Cancel" (click)="closeForm()"></button>
          <button pButton type="button" [label]="submitting ? 'Saving...' : (editMode ? 'Update' : 'Create')" [disabled]="submitting || !canSubmit" (click)="submitForm()"></button>
        </div>
      </div>
    </div>

    <div class="modal-backdrop" *ngIf="showViewModal && viewRule">
      <div class="modal modal--compact">
        <div class="modal__header">
          <h3>Pricing Rule Details</h3>
          <button pButton type="button" class="p-button-text" icon="pi pi-times" (click)="closeView()"></button>
        </div>
        <div class="details-grid">
          <div class="detail"><b>City:</b> {{ viewRule.city?.name || getCityName(viewRule.city_id) }}</div>
          <div class="detail"><b>Ride:</b> {{ viewRule.rideType?.name || getRideName(viewRule.ride_type_id) }}</div>
          <div class="detail"><b>Base Fare:</b> {{ viewRule.base_fare ?? '-' }}</div>
          <div class="detail"><b>Per Km:</b> {{ viewRule.per_km ?? '-' }}</div>
          <div class="detail"><b>Per Min:</b> {{ viewRule.per_min ?? '-' }}</div>
          <div class="detail"><b>Min Fare:</b> {{ viewRule.min_fare ?? '-' }}</div>
          <div class="detail"><b>Surge:</b> {{ viewRule.surge_multiplier ?? '-' }}</div>
          <div class="detail"><b>Commission %:</b> {{ viewRule.commission_percent ?? '-' }}</div>
          <div class="detail"><b>Tax %:</b> {{ viewRule.tax_percent ?? '-' }}</div>
          <div class="detail"><b>Cancellation:</b> {{ viewRule.cancellation_charges ?? '-' }}</div>
          <div class="detail"><b>No Show / min:</b> {{ viewRule.no_show_charges_per_minute ?? '-' }}</div>
          <div class="detail"><b>Luggage:</b> {{ viewRule.luggage_charges ?? '-' }}</div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .toolbar {
        display: flex;
        justify-content: flex-end;
        margin-bottom: 14px;
      }
      .row-actions {
        display: flex;
        gap: 6px;
        align-items: center;
      }
      .fieldset-grid {
        display: grid;
        gap: 12px;
      }
      .pricing-fieldset {
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 12px;
        padding: 10px 12px 12px;
        background: rgba(248, 250, 252, 0.7);
      }
      .pricing-fieldset legend {
        padding: 0 6px;
        font-size: 13px;
        font-weight: 900;
        color: #0f172a;
      }
      .form-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
      }
      .form-field label {
        display: block;
        font-size: 12px;
        font-weight: 800;
        color: rgba(15, 23, 42, 0.68);
        margin-bottom: 6px;
      }
      .select {
        width: 100%;
        height: 38px;
        border-radius: 10px;
        border: 1px solid rgba(15, 23, 42, 0.14);
        background: rgba(255, 255, 255, 0.92);
        padding: 0 10px;
        color: #0f172a;
        font-weight: 700;
      }
      .modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(2, 6, 23, 0.45);
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 14px;
      }
      .modal {
        width: min(1080px, 98vw);
        max-height: 92vh;
        overflow: auto;
        background: #fff;
        border-radius: 14px;
        padding: 14px;
      }
      .modal--compact {
        width: min(760px, 96vw);
      }
      .modal__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      .modal__header h3 {
        margin: 0;
        font-size: 18px;
        color: #0f172a;
      }
      .modal__actions {
        margin-top: 14px;
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
      .details-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .detail {
        min-width: 210px;
        padding: 8px 10px;
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.05);
      }
      @media (max-width: 980px) {
        .form-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media (max-width: 560px) {
        .form-grid {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class AdminPricingComponent implements OnInit {
  rules: any[] = [];
  error: string | null = null;
  loading = true;
  cities: any[] = [];
  rideTypes: any[] = [];

  submitting = false;
  showFormModal = false;
  showViewModal = false;
  editMode = false;
  editingId: number | null = null;
  viewRule: any | null = null;
  formModel: PricingForm = this.defaultForm();

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.loadAll();
  }

  defaultForm(): PricingForm {
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

  getRideName(rideTypeId: number | null | undefined): string {
    if (!rideTypeId) return '-';
    return this.rideTypes.find((rt) => rt.id === rideTypeId)?.name || '-';
  }

  getCityName(cityId: number | null | undefined): string {
    if (!cityId) return '-';
    return this.cities.find((c) => c.id === cityId)?.name || '-';
  }

  loadAll(): void {
    this.error = null;
    this.loading = true;

    this.api.get<any>('/admin/cities').subscribe({
      next: (res) => {
        this.cities = res?.data || [];
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load cities';
        this.loading = false;
      },
    });

    this.api.get<any>('/admin/ride-types').subscribe({
      next: (res) => {
        this.rideTypes = res?.data || [];
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load ride types';
        this.loading = false;
      },
    });

    this.api.get<any>('/admin/pricing-rules').subscribe({
      next: (res) => {
        this.rules = res?.data?.data || [];
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load pricing rules';
      },
      complete: () => {
        this.loading = false;
      },
    });
  }

  openCreate(): void {
    this.error = null;
    this.editMode = false;
    this.editingId = null;
    this.formModel = this.defaultForm();
    this.showFormModal = true;
  }

  openEdit(rule: any): void {
    this.error = null;
    this.editMode = true;
    this.editingId = rule.id;
    this.formModel = { ...this.defaultForm(), ...rule };
    this.showFormModal = true;
  }

  closeForm(): void {
    this.showFormModal = false;
    this.submitting = false;
  }

  openView(rule: any): void {
    this.viewRule = rule;
    this.showViewModal = true;
  }

  closeView(): void {
    this.showViewModal = false;
    this.viewRule = null;
  }

  submitForm(): void {
    if (!this.canSubmit || this.submitting) return;
    this.submitting = true;
    this.error = null;

    const payload = { ...this.formModel };

    if (!this.editMode) {
      this.api.post<any>('/admin/pricing-rules', payload).subscribe({
        next: () => {
          this.closeForm();
          this.loadAll();
        },
        error: (err) => {
          this.error = err?.error?.message || 'Failed to add pricing rule';
          this.submitting = false;
        },
        complete: () => {
          this.submitting = false;
        },
      });
      return;
    }

    this.api.patch<any>(`/admin/pricing-rules/${this.editingId}`, payload).subscribe({
      next: () => {
        this.closeForm();
        this.loadAll();
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to update pricing rule';
        this.submitting = false;
      },
      complete: () => {
        this.submitting = false;
      },
    });
  }

  remove(rule: any): void {
    this.error = null;
    const city = rule?.city?.name || 'selected city';
    const ride = rule?.rideType?.name || 'selected ride type';
    const ok = window.confirm(`Delete pricing rule for ${city} - ${ride}?`);
    if (!ok) return;

    this.api.delete<any>(`/admin/pricing-rules/${rule.id}`).subscribe({
      next: () => {
        this.rules = this.rules.filter((r) => r.id !== rule.id);
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to delete pricing rule';
      },
    });
  }
}

