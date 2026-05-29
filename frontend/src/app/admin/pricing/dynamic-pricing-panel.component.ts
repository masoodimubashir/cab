import { Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { GoogleMapsLoaderService } from '../../core/google-maps-loader.service';
import { ToastService } from '../../core/toast.service';
import {
  ButtonComponent,
  DrawerComponent,
  FilterPillComponent,
  FilterSelectComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
} from '../../ui';

interface LatLng {
  lat: number;
  lng: number;
}

interface DynamicRule {
  id: number;
  name: string;
  city_id: number | null;
  city_vehicle_type_ids: number[] | null;
  fare_type: 'flat' | 'percentage';
  customer_fare_factor: number;
  customer_priority: number;
  driver_fare_factor: number;
  driver_priority: number;
  region_polygon: LatLng[];
  date_from: string | null;
  date_to: string | null;
  start_time: string | null;
  end_time: string | null;
  days_of_week: number;
  is_active: boolean;
  is_visible: boolean;
}

interface RuleForm {
  id?: number;
  name: string;
  fare_type: 'flat' | 'percentage';
  customer_fare_factor: number | null;
  customer_priority: number | null;
  driver_fare_factor: number | null;
  city_vehicle_type_ids: number[];
  date_from: string | null;
  date_to: string | null;
  start_time: string | null;
  end_time: string | null;
  days_of_week: number;
  is_active: boolean;
  is_visible: boolean;
}

type PolygonSource = 'city' | 'custom';

/**
 * Dynamic Pricing panel — surge regions for the city chosen in the topbar
 * switcher. Restyled onto the app design system; add/edit happens in a
 * right-side drawer with an inline map for drawing the surge polygon.
 */
@Component({
  selector: 'app-dynamic-pricing-panel',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonComponent, DrawerComponent, FilterPillComponent, FilterSelectComponent,
    IconComponent, InputComponent, ModalComponent,
  ],
  template: `
    <!-- No city -->
    <div class="cue" *ngIf="cityId == null">
      <tm-icon name="map-marker" [size]="24" />
      <p class="cue__title">No city selected</p>
      <p class="cue__text">Pick a city from the switcher in the top bar to manage its surge regions.</p>
    </div>

    <ng-container *ngIf="cityId != null">
      <div class="dp__toolbar">
        <tm-input
          class="dp__search"
          icon="search"
          placeholder="Search surge regions"
          [(ngModel)]="search"
          (ngModelChange)="onSearchChange()"
        />
        <div class="dp__toolbar-right">
          <tm-filter-select
            icon="car"
            ariaLabel="Vehicle filter"
            allLabel="All vehicles"
            [options]="vehicleFilterOptions"
            [value]="vehicleFilterValue"
            (valueChange)="onVehicleFilterChange($event)"
          />
          <tm-button variant="green" icon="plus" (clicked)="openCreate()">Add surge region</tm-button>
        </div>
      </div>

      <div class="dp__pills">
        <tm-filter-pill *ngIf="search.trim()" icon="search" label="Search" [value]="search" (clear)="clearSearch()" />
        <tm-filter-pill *ngIf="filterVehicleTypeId != null" icon="car" label="Vehicle" [value]="vehicleName(filterVehicleTypeId)" (clear)="clearVehicleFilter()" />
      </div>

      <p class="dp__hint">
        Surge regions raise the customer fare inside a drawn area for chosen days and times.
      </p>

      <!-- Stats -->
      <div class="dp__stats" *ngIf="rules.length">
        <div class="stat">
          <span class="stat__v">{{ rules.length }}</span>
          <span class="stat__l">Surge regions</span>
        </div>
        <div class="stat">
          <span class="stat__v">{{ activeCount }}</span>
          <span class="stat__l">Active now</span>
        </div>
      </div>

      <!-- Overview map -->
      <div class="dp__mapcard">
        <div class="dp__maphead">
          <span class="dp__overline">Region map</span>
          <span class="dp__legend">
            <span class="dot dot--pct"></span> Percentage
            <span class="dot dot--flat"></span> Flat
          </span>
        </div>
        <div class="dp__map" #ovMap></div>
      </div>

      <!-- Loading -->
      <div class="cue" *ngIf="loading">
        <tm-icon name="refresh" [size]="20" /><p class="cue__text">Loading surge regions…</p>
      </div>

      <!-- Empty -->
      <div class="cue" *ngIf="!loading && !rules.length">
        <tm-icon name="bolt" [size]="24" />
        <p class="cue__title">No surge regions yet</p>
        <p class="cue__text">Add one to charge a higher fare in a busy area at peak times.</p>
        <tm-button variant="green" size="sm" icon="plus" (clicked)="openCreate()">Add surge region</tm-button>
      </div>

      <!-- Rule cards -->
      <div class="grid" *ngIf="!loading && rules.length">
        <article class="rcard" *ngFor="let r of filteredRules()">
          <div class="rcard__head">
            <span class="rcard__icon" [class.is-flat]="r.fare_type === 'flat'"><tm-icon name="bolt" [size]="16" /></span>
            <span class="rcard__name">{{ r.name }}</span>
            <div class="rcard__actions">
              <button class="icon-btn" (click)="openEdit(r)" aria-label="Edit"><tm-icon name="edit" [size]="14" /></button>
              <button class="icon-btn icon-btn--danger" (click)="deleteTarget = r" aria-label="Delete"><tm-icon name="trash" [size]="14" /></button>
            </div>
          </div>

          <div class="rcard__tags">
            <span class="tag" [class.tag--flat]="r.fare_type === 'flat'">
              {{ r.fare_type === 'flat' ? 'Flat' : 'Percentage' }}
            </span>
            <span class="tag" [class.tag--on]="r.is_active" [class.tag--off]="!r.is_active">
              {{ r.is_active ? 'Active' : 'Inactive' }}
            </span>
          </div>

          <div class="rcard__primary">
            <span class="rcard__fare">{{ r.customer_fare_factor }}×</span>
            <span class="rcard__fare-l">customer fare</span>
          </div>

          <div class="rcard__meta">
            <div class="rcard__metarow">
              <tm-icon name="car" [size]="13" />
              <span>{{ vehicleTypeLabel(r) }}</span>
            </div>
            <div class="rcard__metarow">
              <tm-icon name="calendar" [size]="13" />
              <span>{{ daysLabel(r.days_of_week) }}</span>
            </div>
            <div class="rcard__metarow" *ngIf="r.start_time">
              <tm-icon name="refresh" [size]="13" />
              <span>{{ r.start_time }} – {{ r.end_time }}</span>
            </div>
            <div class="rcard__metarow" *ngIf="r.date_from">
              <tm-icon name="pin" [size]="13" />
              <span>{{ r.date_from }} → {{ r.date_to }}</span>
            </div>
          </div>
        </article>
      </div>
    </ng-container>

    <!-- ========== Create / edit drawer ========== -->
    <tm-drawer
      [open]="drawerOpen"
      [title]="editMode ? 'Edit surge region' : 'Add surge region'"
      [subtitle]="cityName"
      [width]="640"
      (closed)="closeDrawer()"
    >
      <div slot="body" class="pform">
        <!-- Map -->
        <section class="psec">
          <div class="psec__head">
            <h3 class="psec__title"><tm-icon name="map" [size]="14" /> Surge region</h3>
            <div class="psec__tools" *ngIf="polygonSource === 'custom'">
              <button type="button" class="linkbtn" [disabled]="!polygon.length" (click)="undoPoint()">Undo</button>
              <button type="button" class="linkbtn linkbtn--danger" [disabled]="!polygon.length" (click)="clearPolygon()">Clear</button>
            </div>
          </div>

          <div class="srcrow" *ngIf="cityFence?.length">
            <label class="srcopt" [class.is-on]="polygonSource === 'city'">
              <input type="radio" name="psrc" value="city" [(ngModel)]="polygonSource" (ngModelChange)="onSourceChange()" />
              Whole city area
            </label>
            <label class="srcopt" [class.is-on]="polygonSource === 'custom'">
              <input type="radio" name="psrc" value="custom" [(ngModel)]="polygonSource" (ngModelChange)="onSourceChange()" />
              Draw a custom area
            </label>
          </div>

          <p class="maphint" *ngIf="polygonSource === 'custom'">
            Click inside the city to drop boundary points — at least 3. <strong>{{ polygon.length }}</strong> placed.
          </p>
          <p class="maphint" *ngIf="polygonSource === 'city'">
            Surge applies to the entire <strong>{{ cityName }}</strong> service area.
          </p>
          <div class="maphint maphint--warn" *ngIf="outsideWarning">{{ outsideWarning }}</div>

          <div class="pform__map" #editMap></div>
        </section>

        <!-- Details -->
        <section class="psec">
          <h3 class="psec__title"><tm-icon name="bolt" [size]="14" /> Surge details</h3>
          <div class="pgrid">
            <label class="pfield pfield--full">
              <span class="pfield__lbl">Region name <i>*</i></span>
              <input type="text" [(ngModel)]="form.name" placeholder="e.g. Downtown evening surge" maxlength="120" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Fare type <i>*</i></span>
              <select [(ngModel)]="form.fare_type">
                <option value="percentage">Percentage</option>
                <option value="flat">Flat charge</option>
              </select>
            </label>
            <div class="pfield pfield--full">
              <span class="pfield__lbl">Vehicles <i>*</i></span>
              <div class="vtchips vtchips--cat" *ngIf="vehicleCategories.length">
                <button
                  type="button"
                  class="vtchip vtchip--cat"
                  [class.is-on]="vehicleCategoryId == null"
                  (click)="vehicleCategoryId = null"
                >All</button>
                <button
                  *ngFor="let cat of vehicleCategories"
                  type="button"
                  class="vtchip vtchip--cat"
                  [class.is-on]="vehicleCategoryId === cat.id"
                  (click)="vehicleCategoryId = cat.id"
                >{{ cat.name }}</button>
              </div>
              <div class="vtchips">
                <button
                  *ngFor="let vt of filteredVehicleChips"
                  type="button"
                  class="vtchip"
                  [class.is-on]="form.city_vehicle_type_ids.includes(vt.id)"
                  (click)="toggleVehicleType(vt.id)"
                >{{ vt.name }}</button>
                <span class="vtchips__empty" *ngIf="!vehicleTypes.length">No vehicles in this city yet</span>
                <span class="vtchips__empty" *ngIf="vehicleTypes.length && !filteredVehicleChips.length">No vehicles in this category.</span>
              </div>
              <span class="pfield__hint">Pick at least one vehicle this surge applies to.</span>
            </div>
            <label class="pfield">
              <span class="pfield__lbl">{{ form.fare_type === 'flat' ? 'Flat Customer Charge' : 'Customer fare factor' }} <i>*</i></span>
              <input type="number" min="0" step="0.1" [placeholder]="form.fare_type === 'flat' ? '0' : '1'" [(ngModel)]="form.customer_fare_factor" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">{{ form.fare_type === 'flat' ? 'Customer Fare Factor Priority' : 'Customer priority' }} <i>*</i></span>
              <input type="number" min="0" placeholder="1" [(ngModel)]="form.customer_priority" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">{{ form.fare_type === 'flat' ? 'Flat Driver Charge' : 'Driver fare factor' }} <i>*</i></span>
              <input type="number" min="0" step="0.1" [placeholder]="form.fare_type === 'flat' ? '0' : '1'" [(ngModel)]="form.driver_fare_factor" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">{{ form.fare_type === 'flat' ? 'Driver Fare Factor Priority' : 'Driver priority' }}</span>
              <div class="locked"><span>1</span><em>Fixed</em></div>
            </label>
          </div>
        </section>

        <!-- Schedule -->
        <section class="psec">
          <h3 class="psec__title"><tm-icon name="calendar" [size]="14" /> When it applies</h3>
          <div class="pgrid">
            <label class="pfield">
              <span class="pfield__lbl">Date from <i>*</i></span>
              <input type="date" [(ngModel)]="form.date_from" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Date to <i>*</i></span>
              <input type="date" [(ngModel)]="form.date_to" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Start time <i>*</i></span>
              <input type="time" [(ngModel)]="form.start_time" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">End time <i>*</i></span>
              <input type="time" [(ngModel)]="form.end_time" />
            </label>
          </div>
          <div class="pfield pfield--full">
            <span class="pfield__lbl">Days of week <i>*</i></span>
            <div class="daypills">
              <button
                *ngFor="let d of dayLabels; let i = index"
                type="button"
                class="daypill"
                [class.is-on]="isDayOn(i)"
                (click)="toggleDay(i)"
              >{{ d }}</button>
            </div>
          </div>
        </section>

        <!-- Visibility -->
        <section class="psec">
          <h3 class="psec__title"><tm-icon name="check" [size]="14" /> Status</h3>
          <label class="toggle">
            <input type="checkbox" [(ngModel)]="form.is_active" />
            <span>Active — the surge is live</span>
          </label>
          <label class="toggle">
            <input type="checkbox" [(ngModel)]="form.is_visible" />
            <span>Visible to customers in the app</span>
          </label>
        </section>
      </div>

      <div slot="footer">
        <tm-button variant="ghost" (clicked)="closeDrawer()">Cancel</tm-button>
        <tm-button variant="green" [disabled]="submitting || !canSubmit" (clicked)="save()">
          {{ submitting ? 'Saving…' : editMode ? 'Save changes' : 'Create surge region' }}
        </tm-button>
      </div>
    </tm-drawer>

    <!-- ========== Delete confirm ========== -->
    <tm-modal [open]="!!deleteTarget" title="Delete surge region" (closed)="deleteTarget = null">
      <div slot="body">
        <p>Delete <strong>{{ deleteTarget?.name }}</strong>? This cannot be undone.</p>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="deleteTarget = null">Cancel</tm-button>
        <tm-button variant="danger" [disabled]="submitting" (clicked)="confirmDelete()">Delete</tm-button>
      </div>
    </tm-modal>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 18px; }

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

    .dp__toolbar {
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      flex-wrap: wrap;
      padding: 12px 16px;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg);
    }
    .dp__search { flex: 1 1 280px; min-width: 240px; max-width: 380px; }
    .dp__toolbar-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .dp__pills { display: flex; gap: 8px; flex-wrap: wrap; }
    .dp__pills:empty { display: none; }
    .dp__hint { margin: 0; font-size: 13px; color: var(--tm-text-muted); max-width: 480px; }

    .vtchips { display: flex; flex-wrap: wrap; gap: 7px; }
    .vtchips--cat { margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px dashed var(--tm-line); }
    .vtchip {
      padding: 7px 12px; border-radius: 999px;
      border: 1px solid var(--tm-line); background: var(--tm-canvas);
      font-size: 12px; font-weight: 700; color: var(--tm-text-muted); cursor: pointer;
    }
    .vtchip.is-on {
      background: var(--tm-green-tint, #e0f7fa);
      border-color: var(--tm-green); color: var(--tm-green);
    }
    .vtchip--cat {
      padding: 5px 11px; font-size: 11px; letter-spacing: 0.02em;
      background: var(--tm-canvas-2); border-color: transparent;
    }
    .vtchip--cat.is-on {
      background: var(--tm-text);
      border-color: var(--tm-text);
      color: var(--tm-surface);
    }
    .vtchips__empty { font-size: 12px; color: var(--tm-text-muted); }
    .pfield__hint { font-size: 11px; color: var(--tm-text-muted); margin-top: 2px; }

    .dp__stats { display: flex; gap: 10px; flex-wrap: wrap; }
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

    .dp__mapcard {
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      overflow: hidden;
    }
    .dp__maphead {
      display: flex; align-items: center; justify-content: space-between;
      gap: 10px; padding: 11px 14px;
      border-bottom: 1px solid var(--tm-line);
    }
    .dp__overline {
      font-size: 11px; font-weight: 800; letter-spacing: 0.6px;
      text-transform: uppercase; color: var(--tm-text-muted);
    }
    .dp__legend { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; color: var(--tm-text-muted); }
    .dot { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }
    .dot--pct { background: #3b82f6; }
    .dot--flat { background: #10b981; margin-left: 6px; }
    .dp__map { width: 100%; height: 340px; background: var(--tm-canvas-2); }

    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
    .rcard {
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      padding: 14px;
    }
    .rcard__head { display: flex; align-items: center; gap: 9px; }
    .rcard__icon {
      width: 30px; height: 30px; border-radius: 8px; flex: none;
      display: inline-flex; align-items: center; justify-content: center;
      background: #e0ecff; color: #3b82f6;
    }
    .rcard__icon.is-flat { background: #d6f5e8; color: #10b981; }
    .rcard__name { flex: 1; font-size: 14px; font-weight: 800; color: var(--tm-text); min-width: 0; }
    .rcard__actions { display: flex; gap: 5px; }

    .rcard__tags { display: flex; gap: 6px; margin: 10px 0 6px; }
    .tag {
      font-size: 10px; font-weight: 800; letter-spacing: 0.3px;
      padding: 2px 8px; border-radius: 999px;
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
    }
    .tag--flat { background: #d6f5e8; color: #0f7a4f; }
    .tag--on { background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .tag--off { background: var(--tm-warning-bg); color: var(--tm-warning-fg); }

    .rcard__primary { display: flex; align-items: baseline; gap: 7px; margin: 4px 0 10px; }
    .rcard__fare { font-size: 28px; font-weight: 800; color: var(--tm-text); line-height: 1; }
    .rcard__fare-l { font-size: 12px; font-weight: 700; color: var(--tm-text-muted); }

    .rcard__meta { display: flex; flex-direction: column; gap: 5px; border-top: 1px solid var(--tm-line); padding-top: 10px; }
    .rcard__metarow { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--tm-text-muted); }
    .rcard__metarow span { font-weight: 600; }

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
    .psec__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .psec__title {
      display: flex; align-items: center; gap: 6px;
      margin: 0; font-size: 12px; font-weight: 800;
      text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--tm-text-muted);
    }
    .psec__tools { display: flex; gap: 10px; }
    .linkbtn {
      background: none; border: none; cursor: pointer; padding: 0;
      font-size: 12px; font-weight: 700; color: var(--tm-green);
    }
    .linkbtn:disabled { color: var(--tm-text-muted); cursor: not-allowed; }
    .linkbtn--danger { color: var(--tm-danger, #ef4444); }

    .srcrow { display: flex; gap: 8px; flex-wrap: wrap; }
    .srcopt {
      display: flex; align-items: center; gap: 6px;
      padding: 7px 11px; border-radius: 8px;
      border: 1px solid var(--tm-line); background: var(--tm-canvas);
      font-size: 12px; font-weight: 700; color: var(--tm-text-muted); cursor: pointer;
    }
    .srcopt.is-on { border-color: var(--tm-green); color: var(--tm-text); background: var(--tm-green-tint, #e0f7fa); }
    .srcopt input { accent-color: var(--tm-green); }

    .maphint { margin: 0; font-size: 12px; color: var(--tm-text-muted); }
    .maphint strong { color: var(--tm-text); font-weight: 800; }
    .maphint--warn {
      padding: 7px 10px; border-radius: 7px;
      background: var(--tm-warning-bg, #fef3c7); color: var(--tm-warning-fg, #92400e);
      font-weight: 600;
    }
    .pform__map {
      width: 100%; height: 300px;
      border-radius: 10px; border: 1px solid var(--tm-line);
      background: var(--tm-canvas-2);
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
    .locked {
      display: flex; align-items: center; justify-content: space-between;
      height: 36px; padding: 0 12px;
      border: 1px solid var(--tm-line); border-radius: 8px;
      background: var(--tm-canvas-2);
    }
    .locked span { font-weight: 800; color: var(--tm-text-muted); }
    .locked em {
      font-size: 10px; font-weight: 800; font-style: normal;
      text-transform: uppercase; letter-spacing: 0.4px; color: var(--tm-text-muted);
      background: var(--tm-surface); padding: 2px 6px; border-radius: 5px;
    }

    .daypills { display: flex; gap: 6px; flex-wrap: wrap; }
    .daypill {
      width: 38px; height: 36px; border-radius: 8px;
      border: 1px solid var(--tm-line); background: var(--tm-canvas);
      font-size: 12px; font-weight: 800; color: var(--tm-text-muted); cursor: pointer;
    }
    .daypill.is-on { background: var(--tm-green); border-color: var(--tm-green); color: #fff; }

    .toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--tm-text); }
    .toggle input { width: 16px; height: 16px; accent-color: var(--tm-green); }
  `],
})
export class DynamicPricingPanelComponent implements OnInit, OnDestroy {
  rules: DynamicRule[] = [];
  vehicleTypes: { id: number; name: string; vehicle_type_id: number | null; vehicle_type_name: string | null }[] = [];
  filterVehicleTypeId: number | null = null;
  vehicleCategoryId: number | null = null;
  search = '';
  loading = false;

  cityId: number | null = null;
  cityName = '';
  cityFence: LatLng[] | null = null;
  private cityCenter: LatLng | null = null;

  // Drawer / form
  drawerOpen = false;
  editMode = false;
  submitting = false;
  form: RuleForm = this.blankForm();
  polygon: LatLng[] = [];
  polygonSource: PolygonSource = 'custom';
  outsideWarning: string | null = null;
  deleteTarget: DynamicRule | null = null;

  dayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  // Overview map
  private ovMap: google.maps.Map | null = null;
  private ovMapEl: HTMLElement | null = null;
  private ovPolygons: google.maps.Polygon[] = [];
  private ovCityFence: google.maps.Polygon | null = null;

  // Drawer map
  private editMap: google.maps.Map | null = null;
  private editPolygonLayer: google.maps.Polygon | null = null;
  private editCityRef: google.maps.Polygon | null = null;
  private editVertexMarkers: google.maps.Marker[] = [];
  private editClickListener: google.maps.MapsEventListener | null = null;

  private outsideTimer: ReturnType<typeof setTimeout> | null = null;
  private cityList: { id: number; name: string }[] = [];
  private subs: Subscription[] = [];

  @ViewChild('ovMap')
  set ovMapRef(ref: ElementRef<HTMLDivElement> | undefined) {
    const el = ref?.nativeElement ?? null;
    if (el && el !== this.ovMapEl) {
      this.ovMapEl = el;
      this.ovMap = null;
      void this.initOverviewMap();
    }
  }

  @ViewChild('editMap')
  set editMapRef(ref: ElementRef<HTMLDivElement> | undefined) {
    if (ref?.nativeElement) {
      void this.initEditMap(ref.nativeElement);
    } else {
      this.teardownEditMap();
    }
  }

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private toast: ToastService,
    private zone: NgZone,
    private mapsLoader: GoogleMapsLoaderService,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.subs.push(
      this.cityCtx.cities$.subscribe((list) => {
        this.cityList = list;
        this.cityName = list.find((c) => c.id === this.cityId)?.name ?? '';
      }),
      this.cityCtx.cityId$.subscribe((id) => {
        this.cityId = id;
        this.cityName = this.cityList.find((c) => c.id === id)?.name ?? '';
        this.drawerOpen = false;
        this.filterVehicleTypeId = null;
        this.loadVehicleTypes();
        this.loadCity();
        this.fetch();
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    this.ovPolygons.forEach((p) => p.setMap(null));
    this.ovCityFence?.setMap(null);
    this.ovCityFence = null;
    this.teardownEditMap();
    if (this.outsideTimer) clearTimeout(this.outsideTimer);
  }

  get activeCount(): number {
    return this.rules.filter((r) => r.is_active).length;
  }

  get canSubmit(): boolean {
    const f = this.form;
    const cff = Number(f.customer_fare_factor);
    const cp = Number(f.customer_priority);
    const dff = Number(f.driver_fare_factor);
    return (
      !!f.name.trim() &&
      this.polygon.length >= 3 &&
      f.city_vehicle_type_ids.length > 0 &&
      f.customer_fare_factor != null && Number.isFinite(cff) && cff >= 0 &&
      f.customer_priority != null && Number.isFinite(cp) && cp >= 0 &&
      f.driver_fare_factor != null && Number.isFinite(dff) && dff >= 0 &&
      !!f.date_from &&
      !!f.date_to &&
      !!f.start_time &&
      !!f.end_time &&
      f.days_of_week > 0
    );
  }

  daysLabel(mask: number): string {
    if (mask === 127) return 'Every day';
    const out: string[] = [];
    for (let i = 0; i < 7; i++) if (mask & (1 << i)) out.push(this.dayLabels[i]);
    return out.join(', ') || 'No days';
  }

  // ── Data ─────────────────────────────────────────────────────────

  /**
   * Surge rules target the per-city vehicles (the "Vehicle Name" the operator
   * and customer work with, e.g. "SWIFT/SEDAN O") — so this list is scoped to
   * the city in the topbar switcher and reloads whenever it changes.
   */
  private loadVehicleTypes(): void {
    if (this.cityId == null) {
      this.vehicleTypes = [];
      return;
    }
    this.api
      .get<{ data: { id: number; display_name: string; vehicle_type_id: number | null; vehicle_type_name: string | null }[] }>(
        `/admin/cities/${this.cityId}/vehicle-types`,
      )
      .subscribe({
        next: (res) =>
          (this.vehicleTypes = (res?.data || []).map((v) => ({
            id: v.id,
            name: v.display_name,
            vehicle_type_id: v.vehicle_type_id ?? null,
            vehicle_type_name: v.vehicle_type_name ?? null,
          }))),
        error: () => (this.vehicleTypes = []),
      });
  }

  get vehicleCategories(): { id: number; name: string }[] {
    const seen = new Map<number, string>();
    for (const v of this.vehicleTypes) {
      if (v.vehicle_type_id != null && v.vehicle_type_name && !seen.has(v.vehicle_type_id)) {
        seen.set(v.vehicle_type_id, v.vehicle_type_name);
      }
    }
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }

  get filteredVehicleChips(): typeof this.vehicleTypes {
    if (this.vehicleCategoryId == null) return this.vehicleTypes;
    return this.vehicleTypes.filter((v) => v.vehicle_type_id === this.vehicleCategoryId);
  }

  /** Rules visible under the current vehicle-type filter and search. */
  filteredRules(): DynamicRule[] {
    const id = this.filterVehicleTypeId;
    const q = this.search.trim().toLowerCase();
    return this.rules.filter((r) => {
      if (id != null) {
        const ids = r.city_vehicle_type_ids;
        const match = !ids || ids.length === 0 || ids.includes(id);
        if (!match) return false;
      }
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  // ── Toolbar filters ─────────────────────────────────────────────
  get vehicleFilterValue(): string {
    return this.filterVehicleTypeId == null ? 'all' : String(this.filterVehicleTypeId);
  }
  get vehicleFilterOptions(): { label: string; value: string }[] {
    return this.vehicleTypes.map((v) => ({ label: v.name, value: String(v.id) }));
  }
  vehicleName(id: number): string {
    return this.vehicleTypes.find((v) => v.id === id)?.name ?? `#${id}`;
  }
  onSearchChange(): void {
    this.drawOverview();
  }
  clearSearch(): void {
    this.search = '';
    this.drawOverview();
  }
  onVehicleFilterChange(value: string): void {
    this.filterVehicleTypeId = value === 'all' ? null : Number(value);
    this.drawOverview();
  }
  clearVehicleFilter(): void {
    this.filterVehicleTypeId = null;
    this.drawOverview();
  }

  toggleVehicleType(id: number): void {
    const ids = this.form.city_vehicle_type_ids;
    const i = ids.indexOf(id);
    if (i >= 0) ids.splice(i, 1);
    else ids.push(id);
  }

  /** Human label of the vehicles a rule covers. */
  vehicleTypeLabel(rule: DynamicRule): string {
    const ids = rule.city_vehicle_type_ids;
    if (!ids || ids.length === 0) return 'All vehicles';
    const names = ids
      .map((id) => this.vehicleTypes.find((vt) => vt.id === id)?.name)
      .filter((n): n is string => !!n);
    return names.length ? names.join(', ') : `${ids.length} vehicle types`;
  }

  private loadCity(): void {
    this.cityFence = null;
    this.cityCenter = null;
    if (this.cityId == null) return;
    this.api.get<any>(`/admin/cities/${this.cityId}`).subscribe({
      next: (res) => {
        const c = res?.city ?? res?.data ?? res ?? {};
        const poly: any[] = Array.isArray(c.boundary_polygon) ? c.boundary_polygon : [];
        const fence: LatLng[] = poly
          .map((p: any) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
          .filter((p: LatLng) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
        this.cityFence = fence.length ? fence : null;
        if (c.center_lat != null && c.center_lng != null) {
          this.cityCenter = { lat: Number(c.center_lat), lng: Number(c.center_lng) };
        }
        this.drawOverview();
      },
      error: () => {},
    });
  }

  private fetch(): void {
    if (this.cityId == null) {
      this.rules = [];
      return;
    }
    this.loading = true;
    this.api.get<{ data: DynamicRule[] }>(`/admin/dynamic-pricing-rules?city_id=${this.cityId}`).subscribe({
      next: (res) => {
        this.rules = (res?.data || []).map((r) => ({
          ...r,
          region_polygon: Array.isArray(r.region_polygon) ? r.region_polygon : [],
        }));
        this.loading = false;
        this.drawOverview();
      },
      error: (err) => {
        this.loading = false;
        this.toast.error(err?.error?.message || 'Failed to load surge regions');
      },
    });
  }

  // ── Drawer lifecycle ─────────────────────────────────────────────

  openCreate(): void {
    if (this.cityId == null) return;
    this.editMode = false;
    this.form = this.blankForm();
    this.vehicleCategoryId = null;
    this.outsideWarning = null;
    if (this.cityFence?.length) {
      this.polygonSource = 'city';
      this.polygon = this.cityFence.map((p) => ({ ...p }));
    } else {
      this.polygonSource = 'custom';
      this.polygon = [];
    }
    this.drawerOpen = true;
  }

  openEdit(rule: DynamicRule): void {
    this.editMode = true;
    this.vehicleCategoryId = null;
    this.outsideWarning = null;
    this.api.get<{ rule: any }>(`/admin/dynamic-pricing-rules/${rule.id}`).subscribe({
      next: (res) => {
        const r = res?.rule ?? rule;
        this.form = {
          id: r.id,
          name: r.name ?? '',
          fare_type: r.fare_type ?? 'percentage',
          customer_fare_factor: r.customer_fare_factor ?? null,
          customer_priority: r.customer_priority ?? null,
          driver_fare_factor: r.driver_fare_factor ?? null,
          city_vehicle_type_ids: Array.isArray(r.city_vehicle_type_ids) ? [...r.city_vehicle_type_ids] : [],
          date_from: r.date_from ?? null,
          date_to: r.date_to ?? null,
          start_time: r.start_time ?? null,
          end_time: r.end_time ?? null,
          days_of_week: r.days_of_week ?? 127,
          is_active: r.is_active !== false,
          is_visible: r.is_visible !== false,
        };
        this.polygon = (Array.isArray(r.region_polygon) ? r.region_polygon : [])
          .map((p: any) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
          .filter((p: LatLng) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
        this.polygonSource = this.inferSource();
        this.drawerOpen = true;
        this.redrawEdit();
        this.redrawEditCityRef();
        this.fitEdit();
      },
      error: (err) => this.toast.error(err?.error?.message || 'Failed to load surge region'),
    });
  }

  closeDrawer(): void {
    this.drawerOpen = false;
    this.submitting = false;
  }

  save(): void {
    if (!this.canSubmit || this.submitting || this.cityId == null) return;
    this.submitting = true;
    const payload = {
      name: this.form.name.trim(),
      city_id: this.cityId,
      city_vehicle_type_ids: this.form.city_vehicle_type_ids,
      fare_type: this.form.fare_type,
      customer_fare_factor: Number(this.form.customer_fare_factor ?? 1),
      customer_priority: Number(this.form.customer_priority ?? 1),
      driver_fare_factor: Number(this.form.driver_fare_factor ?? 1),
      driver_priority: 1,
      region_polygon: this.polygon,
      date_from: this.form.date_from || null,
      date_to: this.form.date_to || null,
      days_of_week: this.form.days_of_week,
      start_time: this.form.start_time || null,
      end_time: this.form.end_time || null,
      is_active: this.form.is_active,
      is_visible: this.form.is_visible,
    };
    const req = this.editMode && this.form.id
      ? this.api.patch(`/admin/dynamic-pricing-rules/${this.form.id}`, payload)
      : this.api.post('/admin/dynamic-pricing-rules', payload);

    req.subscribe({
      next: () => {
        this.submitting = false;
        this.drawerOpen = false;
        this.toast.success(this.editMode ? 'Surge region updated' : 'Surge region created');
        this.fetch();
      },
      error: (err) => {
        this.submitting = false;
        this.toast.error(err?.error?.message || 'Failed to save surge region');
      },
    });
  }

  confirmDelete(): void {
    const rule = this.deleteTarget;
    if (!rule || this.submitting) return;
    this.submitting = true;
    this.api.delete(`/admin/dynamic-pricing-rules/${rule.id}`).subscribe({
      next: () => {
        this.submitting = false;
        this.deleteTarget = null;
        this.rules = this.rules.filter((r) => r.id !== rule.id);
        this.drawOverview();
        this.toast.success('Surge region deleted');
      },
      error: (err) => {
        this.submitting = false;
        this.toast.error(err?.error?.message || 'Failed to delete');
      },
    });
  }

  // ── Form helpers ─────────────────────────────────────────────────

  toggleDay(idx: number): void {
    this.form.days_of_week ^= 1 << idx;
  }

  isDayOn(idx: number): boolean {
    return (this.form.days_of_week & (1 << idx)) > 0;
  }

  onSourceChange(): void {
    if (this.polygonSource === 'city') {
      this.polygon = (this.cityFence ?? []).map((p) => ({ ...p }));
    } else {
      this.polygon = [];
    }
    this.redrawEdit();
    this.redrawEditCityRef();
    this.fitEdit();
  }

  undoPoint(): void {
    this.polygon = this.polygon.slice(0, -1);
    this.redrawEdit();
  }

  clearPolygon(): void {
    this.polygon = [];
    this.redrawEdit();
  }

  private blankForm(): RuleForm {
    return {
      name: '',
      fare_type: 'percentage',
      customer_fare_factor: 1,
      customer_priority: 1,
      driver_fare_factor: 1,
      city_vehicle_type_ids: [],
      date_from: null,
      date_to: null,
      start_time: null,
      end_time: null,
      days_of_week: 0,
      is_active: true,
      is_visible: true,
    };
  }

  private inferSource(): PolygonSource {
    const fence = this.cityFence;
    if (!fence?.length || this.polygon.length !== fence.length) return 'custom';
    for (let i = 0; i < fence.length; i++) {
      if (
        Math.abs(fence[i].lat - this.polygon[i].lat) > 1e-6 ||
        Math.abs(fence[i].lng - this.polygon[i].lng) > 1e-6
      ) {
        return 'custom';
      }
    }
    return 'city';
  }

  // ── Overview map ─────────────────────────────────────────────────

  private async initOverviewMap(): Promise<void> {
    if (!this.ovMapEl) return;
    try {
      await this.mapsLoader.load();
    } catch {
      this.zone.run(() => this.toast.error('Could not load Google Maps.'));
      return;
    }
    this.ovMap = new google.maps.Map(this.ovMapEl, {
      center: this.cityCenter ?? { lat: 20.59, lng: 78.96 },
      zoom: this.cityCenter ? 11 : 4,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
    });
    this.drawOverview();
  }

  private drawOverview(): void {
    if (!this.ovMap) return;
    this.ovPolygons.forEach((p) => p.setMap(null));
    this.ovPolygons = [];
    this.ovCityFence?.setMap(null);
    this.ovCityFence = null;
    const bounds = new google.maps.LatLngBounds();
    let any = false;

    if (this.cityFence?.length) {
      this.ovCityFence = new google.maps.Polygon({
        paths: this.cityFence,
        strokeColor: '#94a3b8',
        strokeWeight: 1,
        strokeOpacity: 0.7,
        fillColor: '#94a3b8',
        fillOpacity: 0.08,
        clickable: false,
        zIndex: 1,
      });
      this.ovCityFence.setMap(this.ovMap);
      this.cityFence.forEach((c) => { bounds.extend(c); any = true; });
    }

    for (const rule of this.filteredRules()) {
      const coords = (rule.region_polygon || []).filter(
        (c) => Number.isFinite(c.lat) && Number.isFinite(c.lng),
      );
      if (coords.length < 3) continue;
      const color = rule.fare_type === 'flat' ? '#10b981' : '#3b82f6';
      const poly = new google.maps.Polygon({
        paths: coords,
        strokeColor: color,
        strokeWeight: 2,
        fillColor: color,
        fillOpacity: rule.is_active ? 0.2 : 0.07,
        clickable: false,
        zIndex: 2,
      });
      poly.setMap(this.ovMap);
      this.ovPolygons.push(poly);
      coords.forEach((c) => { bounds.extend(c); any = true; });
    }

    if (any) {
      this.ovMap.fitBounds(bounds, 24);
    } else if (this.cityCenter) {
      this.ovMap.setCenter(this.cityCenter);
      this.ovMap.setZoom(11);
    }
  }

  // ── Drawer map ───────────────────────────────────────────────────

  private async initEditMap(el: HTMLElement): Promise<void> {
    try {
      await this.mapsLoader.load();
    } catch {
      this.zone.run(() => this.toast.error('Could not load Google Maps.'));
      return;
    }
    this.editMap = new google.maps.Map(el, {
      center: this.cityCenter ?? { lat: 20.59, lng: 78.96 },
      zoom: this.cityCenter ? 12 : 4,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
    });
    this.editClickListener = this.editMap.addListener('click', (ev: google.maps.MapMouseEvent) => {
      if (this.polygonSource !== 'custom' || !ev.latLng) return;
      const lat = ev.latLng.lat();
      const lng = ev.latLng.lng();
      if (this.cityFence?.length && !this.pointInPolygon(lat, lng, this.cityFence)) {
        this.zone.run(() => this.flashOutside());
        return;
      }
      this.zone.run(() => {
        this.polygon = [...this.polygon, { lat, lng }];
        this.redrawEdit();
      });
    });
    this.redrawEdit();
    this.redrawEditCityRef();
    this.fitEdit();
  }

  private teardownEditMap(): void {
    this.editClickListener?.remove();
    this.editClickListener = null;
    this.editPolygonLayer?.setMap(null);
    this.editPolygonLayer = null;
    this.editCityRef?.setMap(null);
    this.editCityRef = null;
    this.editVertexMarkers.forEach((m) => m.setMap(null));
    this.editVertexMarkers = [];
    this.editMap = null;
  }

  private redrawEdit(): void {
    if (!this.editMap) return;
    this.editPolygonLayer?.setMap(null);
    this.editPolygonLayer = null;
    this.editVertexMarkers.forEach((m) => m.setMap(null));
    this.editVertexMarkers = [];

    if (this.polygon.length >= 3) {
      this.editPolygonLayer = new google.maps.Polygon({
        paths: this.polygon,
        strokeColor: '#3b82f6',
        strokeWeight: 2,
        fillColor: '#3b82f6',
        fillOpacity: 0.22,
        clickable: false,
      });
      this.editPolygonLayer.setMap(this.editMap);
    }
    if (this.polygonSource === 'custom') {
      this.polygon.forEach((p) => {
        this.editVertexMarkers.push(new google.maps.Marker({
          position: p,
          map: this.editMap!,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 5,
            fillColor: '#ffffff',
            fillOpacity: 1,
            strokeColor: '#3b82f6',
            strokeWeight: 2,
          },
        }));
      });
    }
  }

  private redrawEditCityRef(): void {
    if (!this.editMap) return;
    this.editCityRef?.setMap(null);
    this.editCityRef = null;
    if (this.polygonSource !== 'custom' || !this.cityFence?.length) return;
    this.editCityRef = new google.maps.Polygon({
      paths: this.cityFence,
      strokeColor: '#94a3b8',
      strokeWeight: 1,
      strokeOpacity: 0.7,
      fillColor: '#94a3b8',
      fillOpacity: 0.08,
      clickable: false,
      zIndex: 1,
    });
    this.editCityRef.setMap(this.editMap);
  }

  private fitEdit(): void {
    if (!this.editMap) return;
    const frame = this.polygon.length ? this.polygon : this.cityFence ?? [];
    if (frame.length) {
      const bounds = new google.maps.LatLngBounds();
      frame.forEach((p) => bounds.extend(p));
      this.editMap.fitBounds(bounds, 24);
    } else if (this.cityCenter) {
      this.editMap.setCenter(this.cityCenter);
      this.editMap.setZoom(12);
    }
  }

  private flashOutside(): void {
    this.outsideWarning = `That point is outside ${this.cityName || 'the city'}'s service area — pick somewhere inside the dimmed boundary.`;
    if (this.outsideTimer) clearTimeout(this.outsideTimer);
    this.outsideTimer = setTimeout(() => {
      this.outsideWarning = null;
      this.outsideTimer = null;
    }, 3000);
  }

  private pointInPolygon(lat: number, lng: number, polygon: LatLng[]): boolean {
    let inside = false;
    const n = polygon.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = polygon[i].lng, yi = polygon[i].lat;
      const xj = polygon[j].lng, yj = polygon[j].lat;
      const intersect =
        yi > lat !== yj > lat &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }
}
