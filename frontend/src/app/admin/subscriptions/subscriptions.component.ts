import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import {
  ButtonComponent,
  ColumnComponent,
  DataTableComponent,
  DrawerComponent,
  FilterPillComponent,
  FilterSelectComponent,
  IconComponent,
  type IconName,
  InputComponent,
  ModalComponent,
} from '../../ui';

type MeterType = 'rides' | 'days' | 'daily' | 'earnings';
type PricingModel = 'subscription' | 'commission' | 'hybrid';

interface SubscriptionPlan {
  id: number;
  city_id: number;
  city_name: string | null;
  vehicle_type_id: number | null;
  vehicle_type_name: string | null;
  title: string;
  subtitle: string | null;
  amount: number;
  commission_percent: number;
  pricing_model: PricingModel;
  meter_type: MeterType;
  rides_count: number | null;
  days_count: number | null;
  earnings_threshold: number | null;
  terms: string | null;
  available_from: string | null;
  available_to: string | null;
  is_active: boolean;
  active_subscribers_count: number;
}

interface CityOption {
  id: number;
  name: string;
}

interface VehicleTypeOption {
  id: number;
  name: string;
}

type StatusFilter = 'all' | 'active' | 'inactive';

const METER_OPTIONS: { label: string; value: MeterType }[] = [
  { label: 'Based on ride count', value: 'rides' },
  { label: 'Based on duration', value: 'days' },
  { label: 'Based on daily subscription', value: 'daily' },
  { label: 'Based on earnings', value: 'earnings' },
];

const PRICING_MODEL_OPTIONS: {
  value: PricingModel; label: string; short: string; desc: string; icon: IconName;
}[] = [
  {
    value: 'subscription', label: 'Subscription model', short: 'Subscription', icon: 'star',
    desc: 'One-time payment · no commission on rides',
  },
  {
    value: 'commission', label: 'Commission model', short: 'Commission', icon: 'rupee',
    desc: 'No upfront fee · commission on every ride',
  },
  {
    value: 'hybrid', label: 'Hybrid model', short: 'Hybrid', icon: 'bolt',
    desc: 'One-time payment + commission per ride',
  },
];

@Component({
  selector: 'app-subscriptions',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonComponent, ColumnComponent, DataTableComponent,
    DrawerComponent, FilterPillComponent, FilterSelectComponent,
    IconComponent, InputComponent, ModalComponent,
  ],
  template: `
    <div class="page">
      <!-- Hero Header -->
      <header class="page__hero">
        <div>
          <h1 class="page__title">Subscriptions</h1>
          <p class="page__sub">Manage driver subscription plans, commission models & pricing tiers across cities.</p>
        </div>
        <tm-button
          variant="green" icon="plus"
          (clicked)="openCreate()"
        >Add subscription</tm-button>
      </header>

      <!-- Filter Bar -->
      <div class="filter-bar">
        <tm-input
          icon="search"
          placeholder="Search by title or subtitle."
          [(ngModel)]="search"
          (ngModelChange)="onSearchChange()"
        />

        <div class="filter-selects">
          <tm-filter-select
            icon="map-marker"
            ariaLabel="Location filter"
            allLabel="All cities"
            [options]="cityFilterOptions"
            [value]="selectedCityTab"
            (valueChange)="selectCityTab($event)"
          />
          <tm-filter-select
            icon="car"
            ariaLabel="Vehicle filter"
            allLabel="All vehicles"
            [options]="vehicleFilterOptions"
            [value]="vehicleFilter"
            (valueChange)="onVehicleFilterChange($event)"
          />
          <tm-filter-select
            icon="tag"
            ariaLabel="Model filter"
            allLabel="All models"
            [options]="modelFilterOptions"
            [value]="model"
            (valueChange)="onModelChange($event)"
          />
          <tm-filter-select
            icon="shield"
            ariaLabel="Status filter"
            allLabel="All statuses"
            [options]="statusFilterOptions"
            [value]="status"
            (valueChange)="onStatusChange($event)"
          />
          <tm-filter-select
            icon="bolt"
            ariaLabel="Plan type filter"
            allLabel="All types"
            [options]="meterFilterOptions"
            [value]="meter"
            (valueChange)="onMeterChange($event)"
          />
        </div>
      </div>

      <!-- Active Filter Pills Banner -->
      <div class="banner-row" *ngIf="search.trim() || selectedCityTab !== 'all' || vehicleFilter !== 'all' || model !== 'all' || status !== 'all' || meter !== 'all'">
        <tm-filter-pill *ngIf="search.trim()" icon="search" label="Search" [value]="search" (clear)="clearSearch()" />
        <tm-filter-pill *ngIf="selectedCityTab !== 'all'" icon="map-marker" label="Location" [value]="cityTabLabel()" (clear)="selectCityTab('all')" />
        <tm-filter-pill *ngIf="vehicleFilter !== 'all'" icon="car" label="Vehicle" [value]="vehicleFilterLabel()" (clear)="clearVehicleFilter()" />
        <tm-filter-pill *ngIf="model !== 'all'" icon="tag" label="Model" [value]="modelShort(model)" (clear)="clearModel()" />
        <tm-filter-pill *ngIf="status !== 'all'" icon="shield" label="Status" [value]="statusLabel()" (clear)="clearStatus()" />
        <tm-filter-pill *ngIf="meter !== 'all'" icon="bolt" label="Type" [value]="meterLabel(meter)" (clear)="clearMeter()" />
      </div>

      <!-- Single Data Table -->
      <tm-data-table
        [rows]="filteredPlans"
        [total]="filteredPlans.length"
        [loading]="loading"
        emptyTitle="No subscription plans"
        emptyHint="Create a plan, or clear the active filters."
      >
        <tm-column key="title" label="Plan Group">
          <ng-template let-row let-i="index">
            <div class="group-cell" [class.group-start]="isFirstInTitleGroup(i)">
              <div class="group-header-pill" *ngIf="isFirstInTitleGroup(i)">
                <span class="group-header-title">{{ row.title }}</span>
                <span class="model-chip" [attr.data-m]="row.pricing_model">{{ modelShort(row.pricing_model) }}</span>
              </div>
              <span class="cell-sub" *ngIf="row.subtitle && isFirstInTitleGroup(i)">{{ row.subtitle }}</span>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="city" label="Location" width="140">
          <ng-template let-row>
            <div class="cell-location">
              <tm-icon name="map-marker" [size]="13" class="loc-icon" />
              <span class="cell-location__name">{{ row.city_name || 'All cities' }}</span>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="vehicle" label="Vehicle" width="130">
          <ng-template let-row>
            <span *ngIf="row.vehicle_type_name" class="cell-name">{{ row.vehicle_type_name }}</span>
            <span *ngIf="!row.vehicle_type_name" class="muted">All vehicles</span>
          </ng-template>
        </tm-column>

        <tm-column key="meter" label="Type" width="180">
          <ng-template let-row>
            <div class="cell-id">
              <span class="cell-name">{{ meterLabel(row.meter_type) }}</span>
              <span class="cell-sub">{{ limitLabel(row) }}</span>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="amount" label="Price" width="110">
          <ng-template let-row>
            <span class="cell-amt">₹{{ row.amount | number: '1.0-2' }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="commission" label="Commission" width="120">
          <ng-template let-row>
            <span *ngIf="row.commission_percent > 0">{{ row.commission_percent }}%</span>
            <span *ngIf="row.commission_percent <= 0" class="cell-free">Commission-free</span>
          </ng-template>
        </tm-column>

        <tm-column key="subscribers" label="Active" width="90" align="right">
          <ng-template let-row>
            <span class="muted">{{ row.active_subscribers_count }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="status" label="Status" width="100">
          <ng-template let-row>
            <span class="status-pill" [attr.data-s]="row.is_active ? 'active' : 'inactive'">
              {{ row.is_active ? 'active' : 'inactive' }}
            </span>
          </ng-template>
        </tm-column>

        <tm-column key="actions" label="" width="90" align="right">
          <ng-template let-row>
            <div class="cell-actions">
              <button class="icon-btn" (click)="openEdit(row)" aria-label="Edit plan">
                <tm-icon name="edit" [size]="14" />
              </button>
              <button class="icon-btn icon-btn--danger" (click)="deleteTarget = row" aria-label="Delete plan">
                <tm-icon name="trash" [size]="14" />
              </button>
            </div>
          </ng-template>
        </tm-column>
      </tm-data-table>
    </div>

    <!-- Create / Edit Drawer -->
    <tm-drawer
      [open]="open"
      [title]="editingId ? 'Edit subscription' : 'Add subscription'"
      subtitle="Configure plan details, location & vehicles"
      [width]="580"
      (closed)="open = false"
    >
      <div slot="body" class="form">
        <!-- Pricing model selector -->
        <div class="model-pick" role="radiogroup" aria-label="Pricing model">
          <button
            *ngFor="let m of pricingModelOptions"
            type="button"
            class="model-card"
            [class.is-on]="form.pricing_model === m.value"
            role="radio"
            [attr.aria-checked]="form.pricing_model === m.value"
            (click)="setPricingModel(m.value)"
          >
            <span class="model-card__top">
              <tm-icon [name]="m.icon" [size]="16" />
              <tm-icon *ngIf="form.pricing_model === m.value" name="check" [size]="14" class="model-card__tick" />
            </span>
            <span class="model-card__label">{{ m.label }}</span>
            <span class="model-card__desc">{{ m.desc }}</span>
          </button>
        </div>

        <!-- Location (Cities) Multi-Select -->
        <div class="field">
          <span class="field__lbl">Locations / Cities <i>*</i></span>
          <div class="multi-box">
            <button
              type="button"
              class="multi-chip"
              [class.is-selected]="isAllCitiesSelected"
              (click)="toggleAllCities()"
            >
              <tm-icon [name]="isAllCitiesSelected ? 'check' : 'plus'" [size]="12" />
              All Cities
            </button>
            <button
              *ngFor="let c of cities"
              type="button"
              class="multi-chip"
              [class.is-selected]="!isAllCitiesSelected && isCitySelected(c.id)"
              (click)="toggleCity(c.id)"
            >
              <tm-icon [name]="!isAllCitiesSelected && isCitySelected(c.id) ? 'check' : 'plus'" [size]="12" />
              {{ c.name }}
            </button>
          </div>
          <span class="field__hint" *ngIf="isAllCitiesSelected">Applies to all active cities in the system.</span>
          <span class="field__hint" *ngIf="!isAllCitiesSelected">{{ selectedCityIds.length }} city(ies) selected.</span>
        </div>

        <!-- Vehicle Types Multi-Select -->
        <div class="field">
          <span class="field__lbl">Vehicle Types</span>
          <div class="multi-box">
            <button
              type="button"
              class="multi-chip"
              [class.is-selected]="isAllVehiclesSelected"
              (click)="toggleAllVehicles()"
            >
              <tm-icon [name]="isAllVehiclesSelected ? 'check' : 'plus'" [size]="12" />
              All Vehicle Types
            </button>
            <button
              *ngFor="let v of vehicleTypes"
              type="button"
              class="multi-chip"
              [class.is-selected]="!isAllVehiclesSelected && isVehicleSelected(v.id)"
              (click)="toggleVehicle(v.id)"
            >
              <tm-icon [name]="!isAllVehiclesSelected && isVehicleSelected(v.id) ? 'check' : 'plus'" [size]="12" />
              {{ v.name }}
            </button>
          </div>
          <span class="field__hint" *ngIf="isAllVehiclesSelected">Applies to all vehicle types in the city.</span>
          <span class="field__hint" *ngIf="!isAllVehiclesSelected">{{ selectedVehicleTypeIds.length }} vehicle type(s) selected.</span>
        </div>

        <div class="grid2">
          <label class="field" [class.is-locked]="amountLocked">
            <span class="field__lbl">
              Amount <i *ngIf="!amountLocked">*</i>
              <span class="field__tag" *ngIf="amountLocked">Not used</span>
            </span>
            <input type="number" min="0" step="0.01" [(ngModel)]="form.amount" (ngModelChange)="touched.amount = true"
                   [disabled]="amountLocked"
                   [placeholder]="amountLocked ? 'No upfront payment' : 'e.g. 49'" />
            <span class="field__err" *ngIf="!amountLocked && touched.amount && (form.amount == null || form.amount <= 0)">Enter an amount greater than 0.</span>
          </label>
          <label class="field" [class.is-locked]="commissionLocked">
            <span class="field__lbl">
              Commission (%) <i *ngIf="!commissionLocked">*</i>
              <span class="field__tag" *ngIf="commissionLocked">Not used</span>
            </span>
            <input type="number" min="0" max="100" step="0.01" [(ngModel)]="form.commission_percent" (ngModelChange)="touched.commission = true"
                   [disabled]="commissionLocked"
                   [placeholder]="commissionLocked ? 'Commission-free' : 'e.g. 15'" />
            <span class="field__err" *ngIf="!commissionLocked && touched.commission && (form.commission_percent == null || form.commission_percent <= 0)">Enter a commission greater than 0.</span>
          </label>
        </div>

        <label class="field">
          <span class="field__lbl">Title <i>*</i></span>
          <input type="text" [(ngModel)]="form.title" (ngModelChange)="touched.title = true"
                 placeholder="e.g. Daily Saver" />
          <span class="field__err" *ngIf="touched.title && !form.title.trim()">Title is required.</span>
        </label>

        <label class="field">
          <span class="field__lbl">Subtitle</span>
          <input type="text" [(ngModel)]="form.subtitle" placeholder="Short description shown to the driver" />
        </label>

        <div class="grid2">
          <label class="field">
            <span class="field__lbl">Type <i>*</i></span>
            <select [(ngModel)]="form.meter_type">
              <option *ngFor="let m of meterOptions" [value]="m.value">{{ m.label }}</option>
            </select>
          </label>

          <label class="field" *ngIf="form.meter_type === 'rides'">
            <span class="field__lbl">No. of rides <i>*</i></span>
            <input type="number" min="1" [(ngModel)]="form.rides_count" (ngModelChange)="touched.limit = true" />
            <span class="field__err" *ngIf="touched.limit && !form.rides_count">Required.</span>
          </label>
          <label class="field" *ngIf="form.meter_type === 'days'">
            <span class="field__lbl">No. of days <i>*</i></span>
            <input type="number" min="1" [(ngModel)]="form.days_count" (ngModelChange)="touched.limit = true" />
            <span class="field__err" *ngIf="touched.limit && !form.days_count">Required.</span>
          </label>
          <label class="field" *ngIf="form.meter_type === 'daily'">
            <span class="field__lbl">No. of days</span>
            <input type="number" [value]="1" disabled />
          </label>
          <label class="field" *ngIf="form.meter_type === 'earnings'">
            <span class="field__lbl">Earnings threshold <i>*</i></span>
            <input type="number" min="1" step="0.01" [(ngModel)]="form.earnings_threshold" (ngModelChange)="touched.limit = true" />
            <span class="field__err" *ngIf="touched.limit && !form.earnings_threshold">Required.</span>
          </label>
        </div>

        <div class="grid2">
          <label class="field">
            <span class="field__lbl">Available from</span>
            <input type="date" [(ngModel)]="form.available_from" />
          </label>
          <label class="field">
            <span class="field__lbl">Available to</span>
            <input type="date" [(ngModel)]="form.available_to" />
          </label>
        </div>

        <label class="field">
          <span class="field__lbl">Terms</span>
          <textarea rows="3" [(ngModel)]="form.terms" placeholder="Terms shown before the driver subscribes"></textarea>
        </label>

        <label class="toggle">
          <input type="checkbox" [(ngModel)]="form.is_active" />
          <span>Active (purchasable by drivers)</span>
        </label>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="open = false">Cancel</tm-button>
        <tm-button variant="green" [disabled]="!formValid || saving" (clicked)="submit()">
          {{ saving ? 'Saving…' : editingId ? 'Save changes' : 'Create plan' }}
        </tm-button>
      </div>
    </tm-drawer>

    <!-- Delete confirm -->
    <tm-modal [open]="!!deleteTarget" title="Delete subscription" (closed)="deleteTarget = null">
      <div slot="body">
        <p>Delete plan <strong>{{ deleteTarget?.title }}</strong>? This cannot be undone.</p>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="deleteTarget = null">Cancel</tm-button>
        <tm-button variant="danger" [disabled]="saving" (clicked)="confirmDelete()">
          {{ saving ? 'Deleting…' : 'Delete' }}
        </tm-button>
      </div>
    </tm-modal>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 16px; width: 100%; max-width: 100%; box-sizing: border-box; }
    .page__hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
    .page__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .page__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); }

    /* ---------- Filter bar ---------- */
    .filter-bar {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px;
      background: var(--tm-surface); border: 1px solid var(--tm-line); padding: 12px 14px;
      border-radius: var(--tm-radius-lg); width: 100%; box-sizing: border-box;
    }
    .filter-selects { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; max-width: 100%; }
    .banner-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: -6px; }

    /* ---------- Cells ---------- */
    .cell-location { display: inline-flex; align-items: center; gap: 5px; }
    .loc-icon { color: var(--tm-green); flex-shrink: 0; }
    .cell-id { display: flex; flex-direction: column; min-width: 0; }
    .cell-name { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .cell-sub { font-size: 11px; color: var(--tm-text-muted); }
    .cell-amt { font-family: var(--tm-font-mono); font-weight: 700; color: var(--tm-text); }
    .cell-free { color: var(--tm-green-deep); font-weight: 700; font-size: 12px; }

    /* ---------- Single Table Grouping ---------- */
    .group-cell { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .group-cell.group-start { margin-top: 4px; padding-top: 6px; border-top: 2px solid var(--tm-line); }
    .group-header-pill { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .group-header-title { font-size: 14px; font-weight: 800; color: var(--tm-text); }

    .cell-location { display: inline-flex; align-items: center; gap: 6px; }
    .cell-location__name { font-size: 13px; font-weight: 700; color: var(--tm-text); }

    .status-pill {
      display: inline-flex; align-items: center;
      text-transform: capitalize;
      font-size: 10px; font-weight: 800; letter-spacing: 0.3px;
      padding: 3px 10px; border-radius: var(--tm-radius-pill);
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
    }
    .status-pill[data-s="active"] { background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .status-pill[data-s="inactive"] { background: var(--tm-canvas-2); color: var(--tm-text-muted); }

    .muted { color: var(--tm-text-muted); font-size: 12px; }

    .cell-actions { display: inline-flex; gap: 6px; }
    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 7px;
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
      cursor: pointer; border: 0;
    }
    .icon-btn:hover { background: var(--tm-ink); color: #fff; }
    .icon-btn--danger:hover { background: var(--tm-danger, #ef4444); }

    /* ---------- Multi-select chips ---------- */
    .multi-box { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
    .multi-chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; border-radius: 20px; border: 1.5px solid var(--tm-line);
      background: var(--tm-canvas); color: var(--tm-text); font-size: 12px; font-weight: 600;
      cursor: pointer; transition: all .15s ease;
    }
    .multi-chip:hover { border-color: var(--tm-text-muted); }
    .multi-chip.is-selected {
      background: var(--tm-success-bg); border-color: var(--tm-green);
      color: var(--tm-green-deep); font-weight: 700;
    }
    .field__hint { font-size: 11px; color: var(--tm-text-muted); margin-top: 2px; }

    /* ---------- Drawer form ---------- */
    .form { display: flex; flex-direction: column; gap: 14px; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .field { display: flex; flex-direction: column; gap: 5px; }
    .field__lbl { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .field__lbl i { color: var(--tm-danger, #ef4444); font-style: normal; }
    .field input, .field textarea, .field select {
      width: 100%; padding: 9px 11px;
      border: 1px solid var(--tm-line); border-radius: 9px;
      background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13px; outline: none; font-family: inherit;
    }
    .field input:focus, .field textarea:focus, .field select:focus { border-color: var(--tm-green); }
    .field input:disabled { opacity: 0.6; }
    .field textarea { resize: vertical; }
    .field__err { font-size: 11px; font-weight: 600; color: var(--tm-danger, #ef4444); }
    .toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--tm-text); }
    .toggle input { width: 16px; height: 16px; }

    /* ---------- Pricing model selector ---------- */
    .model-pick { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .model-card {
      display: flex; flex-direction: column; gap: 6px;
      text-align: left; padding: 12px 12px 13px;
      border: 1.5px solid var(--tm-line); border-radius: 12px;
      background: var(--tm-canvas); color: var(--tm-text);
      cursor: pointer; transition: border-color .15s, background .15s, box-shadow .15s;
    }
    .model-card:hover { border-color: var(--tm-text-muted); }
    .model-card.is-on {
      border-color: var(--tm-green); background: var(--tm-success-bg);
      box-shadow: 0 0 0 1px var(--tm-green) inset;
    }
    .model-card__top { display: flex; align-items: center; justify-content: space-between; color: var(--tm-text-muted); }
    .model-card.is-on .model-card__top { color: var(--tm-green-deep); }
    .model-card__tick { color: var(--tm-green-deep); }
    .model-card__label { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .model-card__desc { font-size: 11px; line-height: 1.4; color: var(--tm-text-muted); }

    /* Locked money field */
    .field.is-locked .field__lbl { color: var(--tm-text-muted); }
    .field__tag {
      margin-left: 6px; font-size: 10px; font-weight: 800; letter-spacing: .3px;
      text-transform: uppercase; color: var(--tm-text-muted);
      background: var(--tm-canvas-2); padding: 1px 6px; border-radius: var(--tm-radius-pill);
    }
    .field.is-locked input { background: var(--tm-canvas-2); cursor: not-allowed; }

    /* ---------- List model chip ---------- */
    .cell-name-row { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
    .model-chip {
      flex-shrink: 0; font-size: 9px; font-weight: 800; letter-spacing: .3px;
      text-transform: uppercase; padding: 2px 7px; border-radius: var(--tm-radius-pill);
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
    }
    .model-chip[data-m="subscription"] { background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .model-chip[data-m="commission"] { background: var(--tm-info-bg); color: var(--tm-info-fg); }
    .model-chip[data-m="hybrid"] { background: #ede9fe; color: #6d28d9; }

    @media (max-width: 560px) { .model-pick { grid-template-columns: 1fr; } }
  `],
})
export class SubscriptionsComponent implements OnInit, OnDestroy {
  plans: SubscriptionPlan[] = [];
  cities: CityOption[] = [];
  vehicleTypes: VehicleTypeOption[] = [];
  loading = false;

  // ── Tab & Filter state ──────────────────────────────────────────
  selectedCityTab = 'all';
  search = '';
  vehicleFilter = 'all';
  status: StatusFilter = 'all';
  meter: MeterType | 'all' = 'all';
  model: PricingModel | 'all' = 'all';

  meterOptions = METER_OPTIONS;
  pricingModelOptions = PRICING_MODEL_OPTIONS;
  statusFilterOptions: { label: string; value: string }[] = [
    { label: 'Active', value: 'active' },
    { label: 'Inactive', value: 'inactive' },
  ];

  get cityFilterOptions(): { label: string; value: string }[] {
    return this.cities.map((c) => ({ label: c.name, value: String(c.id) }));
  }

  cityTabLabel(): string {
    return this.cities.find((c) => String(c.id) === this.selectedCityTab)?.name ?? 'All cities';
  }

  get vehicleFilterOptions(): { label: string; value: string }[] {
    return this.vehicleTypes.map((v) => ({ label: v.name, value: String(v.id) }));
  }

  get meterFilterOptions(): { label: string; value: string }[] {
    return METER_OPTIONS.map((m) => ({ label: m.label, value: m.value }));
  }
  get modelFilterOptions(): { label: string; value: string }[] {
    return PRICING_MODEL_OPTIONS.map((m) => ({ label: m.short, value: m.value }));
  }

  /** Sorted and grouped by Plan Title */
  get filteredPlans(): SubscriptionPlan[] {
    let list = this.plans;
    if (this.selectedCityTab !== 'all') {
      const targetCityId = Number(this.selectedCityTab);
      list = list.filter((p) => p.city_id === targetCityId);
    }
    return list.slice().sort((a, b) => {
      const titleCompare = a.title.localeCompare(b.title);
      if (titleCompare !== 0) return titleCompare;
      return (a.city_name || '').localeCompare(b.city_name || '');
    });
  }

  isFirstInTitleGroup(index: number): boolean {
    if (index === 0) return true;
    const list = this.filteredPlans;
    return list[index - 1]?.title?.trim() !== list[index]?.title?.trim();
  }

  selectCityTab(tab: string | number): void {
    this.selectedCityTab = String(tab);
  }

  // ── Drawer / multi-select state ───────────────────────────────
  open = false;
  editingId: number | null = null;
  saving = false;
  deleteTarget: SubscriptionPlan | null = null;

  selectedCityIds: number[] = [];
  isAllCitiesSelected = true;

  selectedVehicleTypeIds: number[] = [];
  isAllVehiclesSelected = true;

  form = this.blankForm();
  touched = { title: false, amount: false, commission: false, limit: false };

  private subs: Subscription[] = [];
  private searchDebounce: any = null;

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.loadVehicleTypes();
    this.subs.push(
      this.cityCtx.cities$.subscribe((list) => {
        this.cities = list;
      }),
    );
    this.fetchPlans();
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
  }

  loadVehicleTypes(): void {
    this.api.get<{ data: VehicleTypeOption[] }>('/admin/vehicle-types-global?active_only=1').subscribe({
      next: (res) => (this.vehicleTypes = res?.data || []),
      error: () => (this.vehicleTypes = []),
    });
  }

  fetchPlans(): void {
    const params = new URLSearchParams();
    if (this.vehicleFilter !== 'all') params.set('vehicle_type_id', this.vehicleFilter);
    if (this.status !== 'all') params.set('is_active', this.status === 'active' ? '1' : '0');
    if (this.meter !== 'all') params.set('meter_type', this.meter);
    if (this.model !== 'all') params.set('pricing_model', this.model);
    const q = this.search.trim();
    if (q) params.set('q', q);

    this.loading = true;
    const qs = params.toString();
    this.api.get<{ data: SubscriptionPlan[] }>(`/admin/subscription-plans${qs ? '?' + qs : ''}`).subscribe({
      next: (res) => {
        this.plans = res?.data || [];
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.toast.error(err?.error?.message || 'Failed to load subscription plans');
      },
    });
  }

  // ── Filter handlers ─────────────────────────────────────────────
  onSearchChange(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => this.fetchPlans(), 300);
  }
  clearSearch(): void {
    if (!this.search) return;
    this.search = '';
    this.fetchPlans();
  }

  onVehicleFilterChange(value: string): void {
    this.vehicleFilter = value;
    this.fetchPlans();
  }
  clearVehicleFilter(): void {
    if (this.vehicleFilter === 'all') return;
    this.vehicleFilter = 'all';
    this.fetchPlans();
  }
  vehicleFilterLabel(): string {
    return this.vehicleTypes.find((v) => String(v.id) === this.vehicleFilter)?.name ?? 'All vehicles';
  }

  statusLabel(): string {
    if (this.status === 'all') return 'All statuses';
    return this.status === 'active' ? 'Active' : 'Inactive';
  }
  onStatusChange(value: string): void {
    this.status = value as StatusFilter;
    this.fetchPlans();
  }
  clearStatus(): void {
    if (this.status === 'all') return;
    this.status = 'all';
    this.fetchPlans();
  }

  onMeterChange(value: string): void {
    this.meter = value as MeterType | 'all';
    this.fetchPlans();
  }
  clearMeter(): void {
    if (this.meter === 'all') return;
    this.meter = 'all';
    this.fetchPlans();
  }

  onModelChange(value: string): void {
    this.model = value as PricingModel | 'all';
    this.fetchPlans();
  }
  clearModel(): void {
    if (this.model === 'all') return;
    this.model = 'all';
    this.fetchPlans();
  }

  // ── Display helpers ─────────────────────────────────────────────
  meterLabel(m: MeterType | 'all'): string {
    return METER_OPTIONS.find((o) => o.value === m)?.label ?? 'All types';
  }
  modelShort(m: PricingModel | 'all'): string {
    if (m === 'all') return 'All models';
    return PRICING_MODEL_OPTIONS.find((o) => o.value === m)?.short ?? 'Subscription';
  }

  get commissionLocked(): boolean {
    return this.form.pricing_model === 'subscription';
  }
  get amountLocked(): boolean {
    return this.form.pricing_model === 'commission';
  }

  setPricingModel(model: PricingModel): void {
    this.form.pricing_model = model;
    if (model === 'subscription') this.form.commission_percent = 0;
    if (model === 'commission') this.form.amount = 0;
  }

  limitLabel(row: SubscriptionPlan): string {
    switch (row.meter_type) {
      case 'rides': return `${row.rides_count ?? 0} rides`;
      case 'days': return `${row.days_count ?? 0} days`;
      case 'daily': return 'Per-day pass';
      case 'earnings': return `Up to ₹${row.earnings_threshold ?? 0}`;
      default: return '';
    }
  }

  // ── Multi-select logic ──────────────────────────────────────────
  toggleAllCities(): void {
    this.isAllCitiesSelected = true;
    this.selectedCityIds = [];
  }

  isCitySelected(id: number): boolean {
    return this.selectedCityIds.includes(id);
  }

  toggleCity(id: number): void {
    if (this.isAllCitiesSelected) {
      this.isAllCitiesSelected = false;
      this.selectedCityIds = [id];
    } else {
      const idx = this.selectedCityIds.indexOf(id);
      if (idx >= 0) {
        this.selectedCityIds.splice(idx, 1);
        if (this.selectedCityIds.length === 0) {
          this.isAllCitiesSelected = true;
        }
      } else {
        this.selectedCityIds.push(id);
      }
    }
  }

  toggleAllVehicles(): void {
    this.isAllVehiclesSelected = true;
    this.selectedVehicleTypeIds = [];
  }

  isVehicleSelected(id: number): boolean {
    return this.selectedVehicleTypeIds.includes(id);
  }

  toggleVehicle(id: number): void {
    if (this.isAllVehiclesSelected) {
      this.isAllVehiclesSelected = false;
      this.selectedVehicleTypeIds = [id];
    } else {
      const idx = this.selectedVehicleTypeIds.indexOf(id);
      if (idx >= 0) {
        this.selectedVehicleTypeIds.splice(idx, 1);
        if (this.selectedVehicleTypeIds.length === 0) {
          this.isAllVehiclesSelected = true;
        }
      } else {
        this.selectedVehicleTypeIds.push(id);
      }
    }
  }

  // ── Drawer / form ───────────────────────────────────────────────
  blankForm() {
    return {
      title: '',
      subtitle: '',
      amount: null as number | null,
      commission_percent: 0 as number | null,
      pricing_model: 'subscription' as PricingModel,
      meter_type: 'daily' as MeterType,
      rides_count: null as number | null,
      days_count: null as number | null,
      earnings_threshold: null as number | null,
      terms: '',
      available_from: '' as string | null,
      available_to: '' as string | null,
      is_active: true,
    };
  }

  openCreate(): void {
    this.editingId = null;
    this.form = this.blankForm();
    this.isAllCitiesSelected = true;
    this.selectedCityIds = [];
    this.isAllVehiclesSelected = true;
    this.selectedVehicleTypeIds = [];
    this.touched = { title: false, amount: false, commission: false, limit: false };
    this.open = true;
  }

  openEdit(p: SubscriptionPlan): void {
    this.editingId = p.id;
    this.touched = { title: false, amount: false, commission: false, limit: false };
    this.isAllCitiesSelected = false;
    this.selectedCityIds = [p.city_id];
    this.isAllVehiclesSelected = p.vehicle_type_id == null;
    this.selectedVehicleTypeIds = p.vehicle_type_id != null ? [p.vehicle_type_id] : [];
    this.form = {
      title: p.title,
      subtitle: p.subtitle || '',
      amount: p.amount,
      commission_percent: p.commission_percent,
      pricing_model: p.pricing_model ?? 'subscription',
      meter_type: p.meter_type,
      rides_count: p.rides_count,
      days_count: p.days_count,
      earnings_threshold: p.earnings_threshold,
      terms: p.terms || '',
      available_from: p.available_from || '',
      available_to: p.available_to || '',
      is_active: p.is_active,
    };
    this.open = true;
  }

  get formValid(): boolean {
    if (!this.form.title.trim()) return false;
    if (!this.amountLocked && (this.form.amount == null || this.form.amount <= 0)) return false;
    if (!this.commissionLocked && (this.form.commission_percent == null || this.form.commission_percent <= 0)) return false;
    if (this.form.meter_type === 'rides' && !this.form.rides_count) return false;
    if (this.form.meter_type === 'days' && !this.form.days_count) return false;
    if (this.form.meter_type === 'earnings' && !this.form.earnings_threshold) return false;
    return true;
  }

  submit(): void {
    this.touched = { title: true, amount: true, commission: true, limit: true };
    if (!this.formValid || this.saving) return;

    const f = this.form;
    const body: Record<string, unknown> = {
      title: f.title.trim(),
      subtitle: f.subtitle?.trim() || null,
      amount: this.amountLocked ? 0 : f.amount,
      commission_percent: this.commissionLocked ? 0 : (f.commission_percent ?? 0),
      pricing_model: f.pricing_model,
      meter_type: f.meter_type,
      city_ids: this.isAllCitiesSelected ? ['all'] : this.selectedCityIds,
      vehicle_type_ids: this.isAllVehiclesSelected ? ['all'] : this.selectedVehicleTypeIds,
      terms: f.terms?.trim() || null,
      available_from: f.available_from || null,
      available_to: f.available_to || null,
      is_active: f.is_active,
      rides_count: f.meter_type === 'rides' ? f.rides_count : null,
      days_count: f.meter_type === 'days' ? f.days_count : (f.meter_type === 'daily' ? 1 : null),
      earnings_threshold: f.meter_type === 'earnings' ? f.earnings_threshold : null,
    };

    this.saving = true;
    const req = this.editingId
      ? this.api.patch<{ plan: SubscriptionPlan }>(`/admin/subscription-plans/${this.editingId}`, {
          ...body,
          city_id: this.selectedCityIds[0] || null,
          vehicle_type_id: this.selectedVehicleTypeIds[0] || null,
        })
      : this.api.post<{ plan: SubscriptionPlan }>(`/admin/subscription-plans`, body);

    req.subscribe({
      next: (res: any) => {
        this.saving = false;
        this.open = false;
        this.toast.success(res?.message || (this.editingId ? 'Subscription updated' : 'Subscription created'));
        this.fetchPlans();
      },
      error: (err) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Save failed');
      },
    });
  }

  confirmDelete(): void {
    const p = this.deleteTarget;
    if (!p || this.saving) return;
    this.saving = true;
    this.api.delete(`/admin/subscription-plans/${p.id}`).subscribe({
      next: () => {
        this.saving = false;
        this.deleteTarget = null;
        this.toast.success('Subscription deleted');
        this.fetchPlans();
      },
      error: (err) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Delete failed');
      },
    });
  }
}
