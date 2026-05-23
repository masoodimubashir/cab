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
  IconComponent,
  ModalComponent,
} from '../../ui';

interface VehicleTypeOption {
  id: number;
  display_name?: string;
  name?: string;
}

interface CouponRow {
  id: number;
  title: string;
  subtitle: string | null;
  benefit_type: string;
  description: string | null;
  promo_type: string;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
  location_name: string | null;
  per_user_limit: number | null;
  discount_type: string;
  discount_value: number;
  discount_maximum: number | null;
  allowed_vehicle_type_ids: number[];
  is_active: boolean;
}

const PROMO_TYPES = [
  { label: 'Location insensitive', value: 'location_insensitive' },
  { label: 'Pickup based', value: 'pickup_based' },
  { label: 'Drop based', value: 'drop_based' },
];

/** Coupons — redeemable discounts for the city chosen in the topbar switcher. */
@Component({
  selector: 'app-coupons',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonComponent, DrawerComponent, ModalComponent, IconComponent,
  ],
  template: `
    <div class="cp">
      <header class="cp__head">
        <div>
          <h1 class="cp__title">Coupons</h1>
          <p class="cp__sub">Redeemable discount coupons for riders in this city.</p>
        </div>
        <tm-button variant="green" icon="plus" [disabled]="cityId == null" (clicked)="openCreate()">
          Add coupon
        </tm-button>
      </header>

      <div class="cue" *ngIf="cityId == null">
        <tm-icon name="map-marker" [size]="24" />
        <p class="cue__title">No city selected</p>
        <p class="cue__text">Pick a city from the switcher in the top bar to manage coupons.</p>
      </div>

      <ng-container *ngIf="cityId != null">
        <div class="seg">
          <button class="seg__btn" [class.is-on]="tab === 'active'" (click)="setTab('active')">Active</button>
          <button class="seg__btn" [class.is-on]="tab === 'inactive'" (click)="setTab('inactive')">Inactive</button>
        </div>

        <div class="grid" *ngIf="rows.length; else empty">
          <article class="card" *ngFor="let r of rows">
            <div class="card__top">
              <span class="card__title-t">{{ r.title }}</span>
              <span class="card__status" [class.on]="r.is_active" [class.off]="!r.is_active">
                {{ r.is_active ? 'Active' : 'Inactive' }}
              </span>
            </div>
            <p class="card__sub">{{ r.subtitle || r.description || '—' }}</p>
            <div class="card__discount">
              <span class="card__discount-v">{{ r.discount_value }}{{ r.discount_type === 'percentage' ? '%' : '' }}</span>
              <span class="card__discount-l">off{{ r.discount_maximum ? ' · max ' + r.discount_maximum : '' }}</span>
            </div>
            <div class="card__meta">
              <span class="tagx">{{ humanPromoType(r.promo_type) }}</span>
              <span class="tagx" *ngIf="r.per_user_limit != null">{{ r.per_user_limit }}/user</span>
              <span class="tagx" *ngIf="r.location_name"><tm-icon name="pin" [size]="11" /> {{ r.location_name }}</span>
            </div>
            <div class="card__foot">
              <button class="icon-btn" (click)="openEdit(r)" aria-label="Edit"><tm-icon name="edit" [size]="14" /></button>
              <button class="icon-btn icon-btn--danger" (click)="deleteTarget = r" aria-label="Delete"><tm-icon name="trash" [size]="14" /></button>
            </div>
          </article>
        </div>
        <ng-template #empty>
          <div class="cue">
            <tm-icon name="tag" [size]="24" />
            <p class="cue__title">No {{ tab }} coupons</p>
            <p class="cue__text" *ngIf="tab === 'active'">Create a coupon to offer riders a discount.</p>
          </div>
        </ng-template>
      </ng-container>
    </div>

    <!-- Drawer -->
    <tm-drawer
      [open]="open"
      [title]="editingId ? 'Edit coupon' : 'Add coupon'"
      [width]="560"
      (closed)="open = false"
    >
      <div slot="body" class="form">
        <label class="field">
          <span class="field__lbl">Title <i>*</i></span>
          <input type="text" [(ngModel)]="form.title" (ngModelChange)="touched = true" />
          <span class="field__err" *ngIf="touched && !form.title.trim()">Title is required.</span>
        </label>
        <label class="field">
          <span class="field__lbl">Subtitle</span>
          <input type="text" [(ngModel)]="form.subtitle" />
        </label>
        <label class="field">
          <span class="field__lbl">Description</span>
          <textarea rows="2" [(ngModel)]="form.description"></textarea>
        </label>

        <label class="field">
          <span class="field__lbl">Promo type</span>
          <select [(ngModel)]="form.promo_type" (ngModelChange)="onPromoTypeChange()">
            <option *ngFor="let p of promoTypes" [value]="p.value">{{ p.label }}</option>
          </select>
        </label>

        <ng-container *ngIf="isLocationBased()">
          <label class="field">
            <span class="field__lbl">Location <i>*</i></span>
            <input #locationInput type="text" [(ngModel)]="form.location_name"
                   placeholder="Search a location" (input)="onLocationTyped()" />
            <span class="field__ok" *ngIf="form.location_name && form.latitude">
              <tm-icon name="check" [size]="12" /> Location pinned
            </span>
          </label>
          <label class="field">
            <span class="field__lbl">Request radius (meters) <i>*</i></span>
            <input type="number" min="0" [(ngModel)]="form.radius_meters" />
          </label>
        </ng-container>

        <div class="row">
          <label class="field">
            <span class="field__lbl">Discount type</span>
            <select [(ngModel)]="form.discount_type">
              <option value="percentage">Percentage</option>
              <option value="flat">Flat</option>
            </select>
          </label>
          <label class="field">
            <span class="field__lbl">Discount {{ form.discount_type === 'percentage' ? '(%)' : '(amount)' }} <i>*</i></span>
            <input type="number" min="0" step="0.01" [(ngModel)]="form.discount_value" />
          </label>
        </div>
        <div class="row">
          <label class="field">
            <span class="field__lbl">Max discount</span>
            <input type="number" min="0" step="0.01" [(ngModel)]="form.discount_maximum" />
          </label>
          <label class="field">
            <span class="field__lbl">Per-user limit</span>
            <input type="number" min="0" [(ngModel)]="form.per_user_limit" />
          </label>
        </div>

        <div class="field">
          <span class="field__lbl">Allowed vehicle types</span>
          <div class="vchips" *ngIf="vehicleOptions.length; else noVeh">
            <button
              *ngFor="let v of vehicleOptions"
              type="button"
              class="vchip"
              [class.is-on]="form.allowed_vehicle_type_ids.includes(v.id)"
              (click)="toggleVehicle(v.id)"
            >
              <tm-icon [name]="form.allowed_vehicle_type_ids.includes(v.id) ? 'check' : 'plus'" [size]="12" />
              {{ v.display_name }}
            </button>
          </div>
          <ng-template #noVeh>
            <span class="field__hint">No vehicle types for this city yet.</span>
          </ng-template>
        </div>

        <label class="toggle">
          <input type="checkbox" [(ngModel)]="form.is_active" />
          <span>Active</span>
        </label>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="open = false">Cancel</tm-button>
        <tm-button variant="green" [disabled]="!form.title.trim() || saving" (clicked)="submit()">
          {{ saving ? 'Saving…' : editingId ? 'Save changes' : 'Create' }}
        </tm-button>
      </div>
    </tm-drawer>

    <!-- Delete confirm -->
    <tm-modal [open]="!!deleteTarget" title="Delete coupon" (closed)="deleteTarget = null">
      <div slot="body"><p>Delete coupon <strong>{{ deleteTarget?.title }}</strong>? This cannot be undone.</p></div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="deleteTarget = null">Cancel</tm-button>
        <tm-button variant="danger" [disabled]="saving" (clicked)="confirmDelete()">Delete</tm-button>
      </div>
    </tm-modal>
  `,
  styles: [`
    .cp { display: flex; flex-direction: column; gap: 16px; }
    .cp__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .cp__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .cp__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); }

    .cue {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 48px 24px; text-align: center;
      background: var(--tm-surface); border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg); color: var(--tm-text-muted);
    }
    .cue__title { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .cue__text { margin: 0; font-size: 13px; }

    .seg {
      display: inline-flex; gap: 4px; padding: 4px;
      background: var(--tm-canvas-2); border-radius: var(--tm-radius-md, 10px);
    }
    .seg__btn {
      padding: 7px 18px; border-radius: 8px;
      font-size: 13px; font-weight: 700; color: var(--tm-text-muted);
      background: transparent; cursor: pointer;
    }
    .seg__btn.is-on { background: var(--tm-surface); color: var(--tm-text); box-shadow: var(--tm-shadow-sm); }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(264px, 1fr));
      gap: 12px;
    }
    .card {
      background: var(--tm-surface); border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px); padding: 14px;
    }
    .card__top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .card__title-t { font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .card__status {
      font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.4px;
      padding: 3px 8px; border-radius: 999px;
    }
    .card__status.on { background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .card__status.off { background: var(--tm-canvas-2); color: var(--tm-text-muted); }
    .card__sub {
      margin: 5px 0 0; font-size: 12px; color: var(--tm-text-muted);
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .card__discount { display: flex; align-items: baseline; gap: 6px; margin: 10px 0; }
    .card__discount-v { font-size: 26px; font-weight: 800; color: var(--tm-text); line-height: 1; }
    .card__discount-l { font-size: 11px; font-weight: 700; color: var(--tm-text-muted); }
    .card__meta {
      display: flex; gap: 6px; flex-wrap: wrap;
      border-top: 1px solid var(--tm-line); padding-top: 10px;
    }
    .tagx {
      display: inline-flex; align-items: center; gap: 3px;
      font-size: 10px; font-weight: 700;
      padding: 3px 7px; border-radius: 6px;
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
    }
    .card__foot { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }
    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 7px;
      background: var(--tm-canvas-2); color: var(--tm-text-muted); cursor: pointer;
    }
    .icon-btn:hover { background: var(--tm-ink); color: #fff; }
    .icon-btn--danger:hover { background: var(--tm-danger, #ef4444); }

    .form { display: flex; flex-direction: column; gap: 13px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .field__lbl { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .field__lbl i { color: var(--tm-danger, #ef4444); font-style: normal; }
    .field input, .field select, .field textarea {
      width: 100%; padding: 9px 11px;
      border: 1px solid var(--tm-line); border-radius: 9px;
      background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13px; outline: none; font-family: inherit;
    }
    .field input:focus, .field select:focus, .field textarea:focus { border-color: var(--tm-green); }
    .field__err { font-size: 11px; font-weight: 600; color: var(--tm-danger, #ef4444); }
    .field__ok { font-size: 11px; font-weight: 600; color: var(--tm-success-fg); display: flex; align-items: center; gap: 3px; }
    .field__hint { font-size: 11px; color: var(--tm-text-muted); }

    .vchips { display: flex; gap: 6px; flex-wrap: wrap; }
    .vchip {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 6px 10px; border-radius: 999px;
      border: 1px solid var(--tm-line); background: var(--tm-canvas);
      color: var(--tm-text-muted); font-size: 12px; font-weight: 700; cursor: pointer;
    }
    .vchip.is-on { background: var(--tm-green-tint, #e0f7fa); border-color: var(--tm-green); color: var(--tm-green); }

    .toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--tm-text); }
    .toggle input { width: 16px; height: 16px; }
  `],
})
export class CouponsComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  tab: 'active' | 'inactive' = 'active';
  rows: CouponRow[] = [];
  vehicleOptions: VehicleTypeOption[] = [];

  open = false;
  editingId: number | null = null;
  saving = false;
  touched = false;
  form = this.blankForm();
  deleteTarget: CouponRow | null = null;

  promoTypes = PROMO_TYPES;

  @ViewChild('locationInput') locationInputRef?: ElementRef<HTMLInputElement>;
  private autocomplete: google.maps.places.Autocomplete | null = null;
  private autocompleteListener: google.maps.MapsEventListener | null = null;

  private sub?: Subscription;

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private maps: GoogleMapsLoaderService,
    private zone: NgZone,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.maps.load().catch(() => {});
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.sub = this.cityCtx.cityId$.subscribe((id) => {
      this.cityId = id;
      if (id != null) {
        this.fetchVehicles();
        this.fetch();
      } else {
        this.rows = [];
        this.vehicleOptions = [];
      }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.detachAutocomplete();
  }

  setTab(t: 'active' | 'inactive'): void {
    if (this.tab === t) return;
    this.tab = t;
    this.fetch();
  }

  isLocationBased(): boolean {
    return this.form.promo_type === 'pickup_based' || this.form.promo_type === 'drop_based';
  }

  humanPromoType(p: string): string {
    return PROMO_TYPES.find((x) => x.value === p)?.label || p;
  }

  toggleVehicle(id: number): void {
    const list = this.form.allowed_vehicle_type_ids;
    this.form.allowed_vehicle_type_ids = list.includes(id)
      ? list.filter((x) => x !== id)
      : [...list, id];
  }

  fetch(): void {
    if (this.cityId == null) return;
    const active = this.tab === 'active' ? '1' : '0';
    this.api.get<{ data: CouponRow[] }>(`/admin/cities/${this.cityId}/coupons?is_active=${active}`)
      .subscribe({
        next: (r) => (this.rows = r.data ?? []),
        error: () => this.toast.error('Failed to load coupons'),
      });
  }

  fetchVehicles(): void {
    if (this.cityId == null) return;
    this.api.get<{ data: VehicleTypeOption[] }>(`/admin/cities/${this.cityId}/vehicle-types`)
      .subscribe({
        next: (r) => (this.vehicleOptions = (r.data ?? []).map((v) => ({
          id: v.id,
          display_name: v.display_name || v.name || `#${v.id}`,
        }))),
        error: () => (this.vehicleOptions = []),
      });
  }

  blankForm() {
    return {
      title: '',
      subtitle: '',
      benefit_type: 'discount',
      description: '',
      promo_type: 'location_insensitive',
      location_name: '' as string | null,
      latitude: null as number | null,
      longitude: null as number | null,
      radius_meters: null as number | null,
      per_user_limit: 1 as number | null,
      discount_type: 'percentage',
      discount_value: 0,
      discount_maximum: 0 as number | null,
      allowed_vehicle_type_ids: [] as number[],
      is_active: true,
    };
  }

  openCreate(): void {
    this.editingId = null;
    this.touched = false;
    this.form = this.blankForm();
    this.open = true;
    this.maybeAttachAutocomplete();
  }

  openEdit(r: CouponRow): void {
    this.editingId = r.id;
    this.touched = false;
    this.form = {
      title: r.title,
      subtitle: r.subtitle || '',
      benefit_type: r.benefit_type,
      description: r.description || '',
      promo_type: r.promo_type,
      location_name: r.location_name || '',
      latitude: r.latitude,
      longitude: r.longitude,
      radius_meters: r.radius_meters,
      per_user_limit: r.per_user_limit,
      discount_type: r.discount_type,
      discount_value: r.discount_value,
      discount_maximum: r.discount_maximum,
      allowed_vehicle_type_ids: r.allowed_vehicle_type_ids ?? [],
      is_active: r.is_active,
    };
    this.open = true;
    this.maybeAttachAutocomplete();
  }

  onPromoTypeChange(): void {
    if (this.isLocationBased()) {
      this.maybeAttachAutocomplete();
    } else {
      this.detachAutocomplete();
      this.form.location_name = '';
      this.form.latitude = null;
      this.form.longitude = null;
    }
  }

  onLocationTyped(): void {
    if (!this.form.location_name) {
      this.form.latitude = null;
      this.form.longitude = null;
    }
  }

  /** Wait for the drawer to mount the location input, then bind Places autocomplete. */
  private maybeAttachAutocomplete(): void {
    if (!this.isLocationBased()) return;
    setTimeout(() => this.attachAutocomplete(), 320);
  }

  private attachAutocomplete(): void {
    if (!window.google?.maps?.places || !this.locationInputRef?.nativeElement) return;
    this.detachAutocomplete();
    const el = this.locationInputRef.nativeElement;
    this.autocomplete = new google.maps.places.Autocomplete(el, {
      fields: ['name', 'formatted_address', 'geometry'],
    });
    this.autocompleteListener = this.autocomplete.addListener('place_changed', () => {
      const place = this.autocomplete!.getPlace();
      if (!place?.geometry?.location) return;
      this.zone.run(() => {
        this.form.location_name = place.formatted_address || place.name || '';
        this.form.latitude = place.geometry!.location!.lat();
        this.form.longitude = place.geometry!.location!.lng();
      });
    });
  }

  private detachAutocomplete(): void {
    this.autocompleteListener?.remove();
    this.autocompleteListener = null;
    this.autocomplete = null;
    document.querySelectorAll('.pac-container').forEach((el) => el.remove());
  }

  submit(): void {
    this.touched = true;
    if (this.cityId == null || !this.form.title.trim() || this.saving) return;
    if (this.isLocationBased()) {
      if (!this.form.radius_meters || this.form.radius_meters <= 0) {
        this.toast.warning('Request radius is required for location-based coupons');
        return;
      }
      if (!this.form.latitude || !this.form.longitude) {
        this.toast.warning('Pick a location from the suggestions');
        return;
      }
    }

    const body: any = { ...this.form };
    if (!this.isLocationBased()) {
      body.location_name = null;
      body.latitude = null;
      body.longitude = null;
      body.radius_meters = null;
    }

    this.saving = true;
    const path = this.editingId
      ? `/admin/cities/${this.cityId}/coupons/${this.editingId}`
      : `/admin/cities/${this.cityId}/coupons`;
    const req$ = this.editingId ? this.api.patch(path, body) : this.api.post(path, body);
    req$.subscribe({
      next: () => {
        this.saving = false;
        this.open = false;
        this.detachAutocomplete();
        this.toast.success(this.editingId ? 'Coupon updated' : 'Coupon created');
        this.fetch();
      },
      error: (e) => {
        this.saving = false;
        this.toast.error(e?.error?.message || 'Save failed');
      },
    });
  }

  confirmDelete(): void {
    const r = this.deleteTarget;
    if (!r || this.cityId == null || this.saving) return;
    this.saving = true;
    this.api.delete(`/admin/cities/${this.cityId}/coupons/${r.id}`).subscribe({
      next: () => {
        this.saving = false;
        this.deleteTarget = null;
        this.toast.success('Coupon deleted');
        this.fetch();
      },
      error: (e) => {
        this.saving = false;
        this.toast.error(e?.error?.message || 'Delete failed');
      },
    });
  }
}
