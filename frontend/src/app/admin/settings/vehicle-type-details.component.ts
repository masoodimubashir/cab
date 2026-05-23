import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, IconComponent, ModalComponent } from '../../ui';
import { OutstationPackagesComponent } from './outstation-packages.component';
import { VehicleBasePricingComponent } from './vehicle-base-pricing.component';

type ProductKind = 'local' | 'rental' | 'outstation';
type TollMode = 'no' | 'yes' | 'yes_locked';
type Platform = 'android' | 'ios';

interface VehicleType {
  id: number;
  city_id: number;
  ride_type_id: number;
  vehicle_type_id: number | null;
  ride_type_name: string;
  product_kind: ProductKind;
  display_name: string;
  display_order: number;
  max_people: number;
  luggage_capacity: number;
  destination_mandatory: boolean;
  fare_mandatory: boolean;
  reverse_bidding_enabled: boolean;
  waiting_charges_applicable: boolean;
  customer_notes_enabled: boolean;
  multiple_destinations_enabled: boolean;
  show_low_wallet_alert: boolean;
  toll_mode: TollMode;
  commission_percent: number;
  fixed_commission: number;
  convenience_charge: number;
  convenience_customer_waiver: number;
  convenience_driver_cut: number;
  min_driver_balance: number;
  override_request_radius_m: number | null;
  override_hop_interval_sec: number | null;
  override_hop_radius_m: number | null;
  override_max_hops: number | null;
  is_active: boolean;
}

interface VehicleTypeImage {
  id: number;
  city_vehicle_type_id: number;
  platform: Platform;
  key: string;
  image_path: string | null;
  image_url: string | null;
}

const KINDS: { label: string; value: ProductKind; sub: string }[] = [
  { label: 'Local', value: 'local', sub: 'In-city point-to-point' },
  { label: 'Rental', value: 'rental', sub: 'Hourly hire' },
  { label: 'Out Station', value: 'outstation', sub: 'Inter-city trips' },
];

const TOLL_MODES: { label: string; value: TollMode }[] = [
  { label: 'No', value: 'no' },
  { label: 'Yes', value: 'yes' },
  { label: 'Yes (driver input locked)', value: 'yes_locked' },
];

/**
 * Vehicle type detail editor — one vehicle across its Local / Rental /
 * Outstation variants. Built on the app design system.
 */
@Component({
  selector: 'app-vehicle-type-details',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    IconComponent,
    ModalComponent,
    OutstationPackagesComponent,
    VehicleBasePricingComponent,
  ],
  template: `
    <div *ngIf="loading" class="cue">Loading…</div>

    <div class="page" *ngIf="!loading">
      <header class="page-head">
        <button type="button" class="icon-btn" (click)="back()" aria-label="Back">
          <tm-icon name="chevron-left" [size]="18" />
        </button>
        <div class="title">
          <div class="title__name">{{ headerName() }}</div>
          <div class="title__meta">
            <span class="chip-mute">{{ rideTypeName() }}</span>
            <span class="chip-mute">{{ activeKindCount() }} of 3 enabled</span>
          </div>
        </div>
      </header>

      <div *ngIf="!rows.length" class="cue">
        Nothing to show. Either the vehicle was just removed, or no city is selected.
      </div>

      <ng-container *ngIf="rows.length">
        <!-- Kind cards -->
        <div class="kind-cards">
          <div
            *ngFor="let k of kinds"
            class="kind-card"
            [class.selected]="selectedKind === k.value"
            [class.disabled]="!rowFor(k.value)?.is_active"
            (click)="selectKind(k.value)"
          >
            <div class="kind-card__top">
              <div>
                <div class="kind-card__label">{{ k.label }}</div>
                <div class="kind-card__sub">{{ k.sub }}</div>
              </div>
              <label class="switch" (click)="$event.stopPropagation()">
                <input
                  type="checkbox"
                  [ngModel]="!!rowFor(k.value)?.is_active"
                  (ngModelChange)="toggleKindActive(k.value, $event)"
                />
                <span class="switch__track"></span>
              </label>
            </div>
            <div class="kind-card__stats">
              <span class="stat">
                <span class="stat__lbl">Comm</span>
                <span class="stat__val">{{ rowFor(k.value)?.commission_percent || 0 }}%</span>
              </span>
              <span class="stat">
                <span class="stat__lbl">Seats</span>
                <span class="stat__val">{{ rowFor(k.value)?.max_people || 0 }}</span>
              </span>
              <span class="stat" *ngIf="selectedKind === k.value">
                <span class="stat__lbl">Editing</span>
              </span>
            </div>
          </div>
        </div>

        <!-- Tabbed editor -->
        <div *ngIf="form" class="editor">
          <nav class="vtabs" role="tablist">
            <button
              *ngFor="let t of visibleTabs()"
              type="button"
              class="vtab"
              [class.is-on]="activeTab === t.id"
              (click)="activeTab = t.id"
            >{{ t.label }}</button>
          </nav>

          <div class="vpanels">
          <!-- Identity & Capacity -->
          <div class="panel" *ngIf="activeTab === 0">
            <div class="grid two">
              <label class="field">
                <span class="lbl">Display Name</span>
                <input type="text" [(ngModel)]="form.display_name" />
              </label>
              <label class="field">
                <span class="lbl">Display Order</span>
                <input type="number" min="0" max="9999" [(ngModel)]="form.display_order" />
              </label>
              <label class="field">
                <span class="lbl">Max People</span>
                <input type="number" min="1" max="20" [(ngModel)]="form.max_people" />
              </label>
              <label class="field">
                <span class="lbl">Luggage Capacity</span>
                <input type="number" min="0" max="20" [(ngModel)]="form.luggage_capacity" />
              </label>
            </div>
            <p class="hint">
              Vehicle icons (Android &amp; iOS, multiple slots) live in the <strong>Images</strong> tab.
            </p>
          </div>

          <!-- Behaviour -->
          <div class="panel" *ngIf="activeTab === 1">
            <div class="grid two">
              <label class="row"><input type="checkbox" [(ngModel)]="form.destination_mandatory" /> Destination mandatory</label>
              <label class="row"><input type="checkbox" [(ngModel)]="form.fare_mandatory" /> Fare mandatory (no bidding)</label>
              <label class="row"><input type="checkbox" [(ngModel)]="form.reverse_bidding_enabled" /> Reverse bidding enabled</label>
              <label class="row"><input type="checkbox" [(ngModel)]="form.waiting_charges_applicable" /> Waiting charges applicable</label>
              <label class="row"><input type="checkbox" [(ngModel)]="form.customer_notes_enabled" /> Customer notes enabled</label>
              <label class="row"><input type="checkbox" [(ngModel)]="form.multiple_destinations_enabled" /> Multiple destinations enabled</label>
              <label class="row"><input type="checkbox" [(ngModel)]="form.show_low_wallet_alert" /> Show low-wallet alert (driver)</label>
              <div class="field">
                <span class="lbl">Toll Mode</span>
                <div class="radio-group">
                  <label *ngFor="let t of tollModes">
                    <input type="radio" name="toll-mode" [value]="t.value" [(ngModel)]="form.toll_mode" />
                    {{ t.label }}
                  </label>
                </div>
              </div>
            </div>
          </div>

          <!-- Commercials -->
          <div class="panel" *ngIf="activeTab === 2">
            <div class="grid two">
              <label class="field">
                <span class="lbl">Commission (%)</span>
                <input type="number" min="0" max="100" step="0.01" [(ngModel)]="form.commission_percent" />
              </label>
              <label class="field">
                <span class="lbl">Fixed Commission</span>
                <input type="number" min="0" step="0.01" [(ngModel)]="form.fixed_commission" />
              </label>
              <label class="field">
                <span class="lbl">Convenience Charge</span>
                <input type="number" min="0" step="0.01" [(ngModel)]="form.convenience_charge" />
              </label>
              <label class="field">
                <span class="lbl">Convenience — Customer Waiver</span>
                <input type="number" min="0" step="0.01" [(ngModel)]="form.convenience_customer_waiver" />
              </label>
              <label class="field">
                <span class="lbl">Convenience — Driver Cut</span>
                <input type="number" min="0" step="0.01" [(ngModel)]="form.convenience_driver_cut" />
              </label>
              <label class="field">
                <span class="lbl">Min Driver Balance</span>
                <input type="number" min="0" step="0.01" [(ngModel)]="form.min_driver_balance" />
              </label>
            </div>
          </div>

          <!-- Dispatcher Overrides -->
          <div class="panel" *ngIf="activeTab === 3">
            <p class="hint">Leave a field blank to inherit the city-level Dispatcher Settings value for this kind.</p>
            <div class="grid two">
              <label class="field">
                <span class="lbl">Request radius (m) — override</span>
                <input type="number" min="0" max="50000" [(ngModel)]="form.override_request_radius_m" />
              </label>
              <label class="field">
                <span class="lbl">Hop interval (sec) — override</span>
                <input type="number" min="1" max="600" [(ngModel)]="form.override_hop_interval_sec" />
              </label>
              <label class="field">
                <span class="lbl">Hop radius (m) — override</span>
                <input type="number" min="0" max="50000" [(ngModel)]="form.override_hop_radius_m" />
              </label>
              <label class="field">
                <span class="lbl">Max hops — override</span>
                <input type="number" min="1" max="50" [(ngModel)]="form.override_max_hops" />
              </label>
            </div>
          </div>

          <!-- Images -->
          <div class="panel" *ngIf="activeTab === 4">
            <div class="img-head">
              <p class="hint" style="margin: 0;">
                Each row is one slot — <code>tab_normal</code>, <code>ride_now_highlighted</code> etc. — per platform.
              </p>
              <tm-button variant="green" size="sm" icon="plus" (clicked)="openAddImage()">Add Image</tm-button>
            </div>

            <div *ngIf="imagesLoading" class="cue">Loading images…</div>

            <ng-container *ngIf="!imagesLoading">
              <div *ngFor="let plat of platformOptions" class="img-group">
                <h4 class="img-section">{{ plat.label }} APP</h4>
                <table class="dtable">
                  <thead>
                    <tr><th>Image Type</th><th>Uploaded Image</th><th class="act">Actions</th></tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let img of imagesFor(plat.value)">
                      <td>{{ img.key }}</td>
                      <td><img *ngIf="img.image_url" [src]="img.image_url" class="img-thumb" /></td>
                      <td class="act">
                        <tm-button variant="ghost" size="sm" (clicked)="replaceImage(img)">Replace</tm-button>
                        <button type="button" class="danger-link" (click)="deleteImage(img)">Delete</button>
                      </td>
                    </tr>
                    <tr *ngIf="!imagesFor(plat.value).length">
                      <td colspan="3" class="dtable__empty">No {{ plat.label }} images yet.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </ng-container>
          </div>

          <!-- Base Pricing -->
          <div class="panel" *ngIf="activeTab === 5">
            <app-vehicle-base-pricing
              [cityId]="cityId"
              [vehicleTypeId]="form.vehicle_type_id"
              [rideTypeId]="form.ride_type_id"
              [productKind]="form.product_kind"
            ></app-vehicle-base-pricing>
          </div>

          <!-- Fare Packages -->
          <div class="panel" *ngIf="activeTab === 6 && form.product_kind === 'outstation'">
            <app-outstation-packages [cityId]="cityId" [vehicleTypeId]="form.id"></app-outstation-packages>
          </div>
          </div>
        </div>
      </ng-container>
    </div>

    <!-- Sticky action bar -->
    <div class="action-bar" *ngIf="!loading && form">
      <tm-button variant="ghost" size="sm" icon="trash" (clicked)="deleteKindOpen = true">
        Delete this kind
      </tm-button>
      <div class="action-bar__spacer"></div>
      <span class="dirty-hint">Changes apply only to <strong>{{ kindLabel(form.product_kind) }}</strong>.</span>
      <tm-button variant="green" icon="check" [disabled]="saving" (clicked)="save()">
        {{ saving ? 'Saving…' : 'Save' }}
      </tm-button>
    </div>

    <!-- Add / Replace image modal -->
    <tm-modal
      [open]="addImageOpen"
      [title]="addImageMode === 'replace' ? 'Replace Image' : 'Add Image'"
      (closed)="addImageOpen = false"
    >
      <div slot="body" class="form">
        <label class="field">
          <span class="lbl">Type <i>*</i></span>
          <select [(ngModel)]="addImageForm.platform" [disabled]="addImageMode === 'replace'">
            <option [ngValue]="null" disabled>Select type</option>
            <option *ngFor="let p of platformOptions" [ngValue]="p.value">{{ p.label }}</option>
          </select>
        </label>
        <label class="field">
          <span class="lbl">Key <i>*</i></span>
          <input
            type="text"
            [(ngModel)]="addImageForm.key"
            placeholder="e.g. tab_normal, ride_now_highlighted"
            [disabled]="addImageMode === 'replace'"
          />
        </label>
        <label class="field">
          <span class="lbl">Image <i>*</i></span>
          <input type="file" accept="image/*" (change)="onAddImageFile($event)" />
        </label>
        <img *ngIf="addImageForm.previewUrl" [src]="addImageForm.previewUrl" class="img-thumb" />
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="addImageOpen = false">Cancel</tm-button>
        <tm-button variant="green" [disabled]="addImageSaving" (clicked)="submitAddImage()">
          {{ addImageSaving ? 'Saving…' : 'Save' }}
        </tm-button>
      </div>
    </tm-modal>

    <!-- Delete kind confirm -->
    <tm-modal [open]="deleteKindOpen" title="Delete this kind" (closed)="deleteKindOpen = false">
      <div slot="body">
        <p>Delete the <strong>{{ form ? kindLabel(form.product_kind) : '' }}</strong> variant of
        <strong>{{ form?.display_name }}</strong>? This cannot be undone.</p>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="deleteKindOpen = false">Cancel</tm-button>
        <tm-button variant="danger" (clicked)="doDeleteKind()">Delete</tm-button>
      </div>
    </tm-modal>

    <!-- Delete image confirm -->
    <tm-modal [open]="!!imageToDelete" title="Delete image" (closed)="imageToDelete = null">
      <div slot="body">
        <p>Delete the <strong>{{ imageToDelete?.key }}</strong> {{ imageToDelete?.platform }} image?</p>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="imageToDelete = null">Cancel</tm-button>
        <tm-button variant="danger" (clicked)="doDeleteImage()">Delete</tm-button>
      </div>
    </tm-modal>
  `,
  styles: [`
    :host { display: block; }
    .page { width: 100%; }

    .cue { padding: 30px; text-align: center; color: var(--tm-text-muted); font-size: 13px; }

    .page-head { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
    .title__name { font-size: 20px; font-weight: 800; color: var(--tm-text); line-height: 1.2; }
    .title__meta { display: inline-flex; gap: 6px; margin-top: 4px; }
    .chip-mute {
      font-size: 11px; font-weight: 700;
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
      padding: 2px 10px; border-radius: 999px;
      text-transform: uppercase; letter-spacing: 0.4px;
    }

    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border-radius: 8px; flex: none;
      background: var(--tm-canvas-2); color: var(--tm-text-muted); cursor: pointer;
    }
    .icon-btn:hover { background: var(--tm-ink); color: #fff; }

    .kind-cards { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 18px; }
    .kind-card {
      background: var(--tm-surface); border: 1.5px solid var(--tm-line);
      border-radius: 14px; padding: 14px; cursor: pointer;
      display: flex; flex-direction: column; gap: 10px;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .kind-card:hover { border-color: var(--tm-text-muted); }
    .kind-card.selected {
      border-color: var(--tm-green); box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.12);
    }
    .kind-card.disabled .kind-card__label { color: var(--tm-text-muted); }
    .kind-card__top { display: flex; justify-content: space-between; align-items: flex-start; }
    .kind-card__label { font-weight: 800; font-size: 16px; color: var(--tm-text); }
    .kind-card__sub { font-size: 11px; color: var(--tm-text-muted); margin-top: 2px; }
    .kind-card__stats { display: flex; gap: 14px; align-items: center; }
    .stat { display: inline-flex; flex-direction: column; gap: 2px; }
    .stat__lbl {
      font-size: 10px; font-weight: 700; color: var(--tm-text-muted);
      text-transform: uppercase; letter-spacing: 0.4px;
    }
    .stat__val { font-size: 14px; font-weight: 700; color: var(--tm-text); }
    .switch {
      position: relative; display: inline-block;
      width: 38px; height: 22px; flex: none; cursor: pointer;
    }
    .switch input { position: absolute; opacity: 0; width: 0; height: 0; }
    .switch__track {
      position: absolute; inset: 0; border-radius: 999px;
      background: var(--tm-line); transition: background 0.15s ease;
    }
    .switch__track::after {
      content: ''; position: absolute; top: 2px; left: 2px;
      width: 18px; height: 18px; border-radius: 50%;
      background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
      transition: transform 0.15s ease;
    }
    .switch input:checked + .switch__track { background: var(--tm-green); }
    .switch input:checked + .switch__track::after { transform: translateX(16px); }

    .editor {
      display: grid; grid-template-columns: 210px 1fr;
      background: var(--tm-surface); border: 1px solid var(--tm-line);
      border-radius: 12px; overflow: hidden;
    }
    .vtabs {
      display: flex; flex-direction: column; gap: 2px;
      padding: 12px 10px;
      background: var(--tm-canvas-2);
      border-right: 1px solid var(--tm-line);
    }
    .vtab {
      text-align: left; padding: 10px 12px; border-radius: 8px;
      background: transparent; border: 0;
      font-size: 13px; font-weight: 700; white-space: nowrap;
      color: var(--tm-text-muted); cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .vtab:hover { background: var(--tm-surface); color: var(--tm-text); }
    .vtab.is-on { background: var(--tm-green-tint, #e0f7fa); color: var(--tm-green); }
    .vpanels { padding: 20px 22px; min-width: 0; }

    .grid { display: grid; gap: 14px; }
    .grid.two { grid-template-columns: 1fr 1fr; }
    .field { display: flex; flex-direction: column; gap: 5px; }
    .lbl { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .lbl i { color: var(--tm-danger, #ef4444); font-style: normal; }
    .field input, .field select {
      width: 100%; height: 38px; padding: 0 11px;
      border: 1px solid var(--tm-line); border-radius: 9px;
      background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13px; outline: none; font-family: inherit;
    }
    .field input[type="file"] { height: auto; padding: 8px 11px; }
    .field input:focus, .field select:focus { border-color: var(--tm-green); }
    .row {
      display: flex; align-items: center; gap: 8px;
      font-size: 13px; font-weight: 600; color: var(--tm-text);
    }
    .row input { width: 16px; height: 16px; accent-color: var(--tm-green); }
    .radio-group { display: flex; flex-direction: column; gap: 6px; }
    .radio-group label { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
    .radio-group input { accent-color: var(--tm-green); }
    .hint { color: var(--tm-text-muted); font-size: 12px; margin: 10px 0 0; }

    .img-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
    .img-section {
      margin: 18px 0 6px; font-size: 12px; font-weight: 800;
      letter-spacing: 0.4px; color: var(--tm-text-muted); text-transform: uppercase;
    }
    .img-thumb {
      max-width: 80px; max-height: 60px; border-radius: 4px;
      border: 1px solid var(--tm-line); display: inline-block;
    }
    .dtable { width: 100%; border-collapse: collapse; margin-top: 6px; }
    .dtable th {
      text-align: left; padding: 9px 12px;
      font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.3px;
      color: var(--tm-text-muted); background: var(--tm-canvas-2);
      border-bottom: 1px solid var(--tm-line);
    }
    .dtable td {
      padding: 9px 12px; font-size: 13px; color: var(--tm-text);
      border-bottom: 1px solid var(--tm-line);
    }
    .dtable th.act, .dtable td.act { text-align: right; }
    .dtable td.act { display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
    .dtable__empty { text-align: center; color: var(--tm-text-muted); }
    .danger-link {
      background: none; border: none; cursor: pointer;
      font-size: 12px; font-weight: 700; color: var(--tm-danger, #ef4444);
    }

    .action-bar {
      margin: 16px 0 0;
      background: var(--tm-surface); border: 1px solid var(--tm-line);
      border-radius: 12px; padding: 12px 16px;
      display: flex; align-items: center; gap: 12px;
    }
    .action-bar__spacer { flex: 1; }
    .dirty-hint { font-size: 12px; color: var(--tm-text-muted); margin-right: 8px; }

    .form { display: flex; flex-direction: column; gap: 12px; }

    @media (max-width: 880px) {
      .kind-cards { grid-template-columns: 1fr; }
      .grid.two { grid-template-columns: 1fr; }
      .action-bar { padding: 10px 14px; margin: 12px 0 0; }
      .editor { grid-template-columns: 1fr; }
      .vtabs {
        flex-direction: row; overflow-x: auto;
        border-right: 0; border-bottom: 1px solid var(--tm-line);
      }
    }
  `],
})
export class VehicleTypeDetailsComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  /** One of the vehicle's product-kind row ids — carried by the route. */
  vehicleRowId: number | null = null;
  rows: VehicleType[] = [];
  selectedKind: ProductKind = 'local';
  loading = true;
  saving = false;
  activeTab = 0;

  kinds = KINDS;
  tollModes = TOLL_MODES;

  private readonly tabs = [
    { id: 0, label: 'Identity & Capacity' },
    { id: 1, label: 'Behaviour' },
    { id: 2, label: 'Commercials' },
    { id: 3, label: 'Dispatcher Overrides' },
    { id: 4, label: 'Images' },
    { id: 5, label: 'Base Pricing' },
    { id: 6, label: 'Fare Packages' },
  ];

  // Images state for currently selected row
  images: VehicleTypeImage[] = [];
  imagesLoading = false;
  platformOptions = [
    { label: 'Android', value: 'android' as const },
    { label: 'iOS', value: 'ios' as const },
  ];
  addImageOpen = false;
  addImageSaving = false;
  addImageMode: 'create' | 'replace' = 'create';
  addImageTargetId: number | null = null;
  addImageForm: {
    platform: Platform | null;
    key: string;
    file: File | null;
    previewUrl: string | null;
  } = { platform: null, key: '', file: null, previewUrl: null };

  deleteKindOpen = false;
  imageToDelete: VehicleTypeImage | null = null;

  private subs: Subscription[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private cityCtx: CityContextService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.subs.push(
      this.cityCtx.cityId$.subscribe((id) => {
        this.cityId = id;
        this.fetchRows();
      }),
      this.route.paramMap.subscribe((p) => {
        const raw = p.get('vehicleRowId');
        this.vehicleRowId = raw ? Number(raw) : null;
        this.fetchRows();
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  get form(): VehicleType | null {
    return this.rowFor(this.selectedKind);
  }

  /** Tabs to show — Fare Packages only appears for outstation vehicles. */
  visibleTabs(): { id: number; label: string }[] {
    return this.tabs.filter((t) => t.id !== 6 || this.form?.product_kind === 'outstation');
  }

  rowFor(kind: ProductKind): VehicleType | null {
    return this.rows.find((r) => r.product_kind === kind) ?? null;
  }

  activeKindCount(): number {
    return this.rows.filter((r) => r.is_active).length;
  }

  kindLabel(k: ProductKind): string {
    return KINDS.find((x) => x.value === k)?.label ?? k;
  }

  headerName(): string {
    return this.rows[0]?.display_name || 'Vehicle';
  }
  rideTypeName(): string {
    return this.rows[0]?.ride_type_name || '';
  }

  selectKind(k: ProductKind): void {
    this.selectedKind = k;
    // Fare Packages tab only exists for outstation — bounce off it otherwise.
    if (this.activeTab === 6 && k !== 'outstation') this.activeTab = 0;
    this.loadImages();
  }

  /** Toggle is_active on a kind directly from its card; persists immediately. */
  toggleKindActive(kind: ProductKind, value: boolean): void {
    if (this.cityId == null) return;
    const row = this.rowFor(kind);

    if (row) {
      row.is_active = value; // optimistic
      const fd = new FormData();
      fd.append('_method', 'PATCH');
      fd.append('is_active', value ? '1' : '0');
      this.api
        .postMultipart<{ vehicle_type: VehicleType }>(
          `/admin/cities/${this.cityId}/vehicle-types/${row.id}`,
          fd,
        )
        .subscribe({
          next: (res) => {
            const idx = this.rows.findIndex((r) => r.id === res.vehicle_type.id);
            if (idx >= 0) this.rows[idx] = res.vehicle_type;
          },
          error: () => {
            row.is_active = !value; // rollback
            this.toast.error('Failed to update');
          },
        });
      return;
    }

    if (!value) return;

    const template = this.rows[0];
    if (!template) {
      this.toast.error('No template available to add a new kind.');
      return;
    }

    this.api
      .post<{ data: VehicleType[]; created_count: number }>(
        `/admin/cities/${this.cityId}/vehicle-types`,
        {
          ride_type_id: template.ride_type_id,
          vehicle_type_id: template.vehicle_type_id ?? null,
          display_name: template.display_name,
          max_people: template.max_people,
          luggage_capacity: template.luggage_capacity,
          commission_percent: template.commission_percent,
          destination_mandatory: template.destination_mandatory,
          kinds: [kind],
        },
      )
      .subscribe({
        next: (res) => {
          const ids = new Set((res.data ?? []).map((r) => r.id));
          this.rows = [
            ...this.rows.filter((r) => !ids.has(r.id)),
            ...(res.data ?? []),
          ].sort((a, b) => a.product_kind.localeCompare(b.product_kind));
          this.toast.success(`${this.kindLabel(kind)} enabled.`);
        },
        error: (err) => {
          this.toast.error(err?.error?.message || `Failed to add ${this.kindLabel(kind)}.`);
        },
      });
  }

  back(): void {
    this.router.navigateByUrl('/vehicle-fares');
  }

  fetchRows(): void {
    if (this.cityId == null || this.vehicleRowId == null) {
      this.rows = [];
      this.loading = false;
      return;
    }
    this.loading = true;
    this.api
      .get<{ data: VehicleType[] }>(`/admin/cities/${this.cityId}/vehicle-types`)
      .subscribe({
        next: (res) => {
          const all = res.data ?? [];
          // The route carries one of the vehicle's product-kind row ids —
          // gather its siblings (same ride type + Vehicle Name).
          const anchor = all.find((r) => r.id === this.vehicleRowId);
          this.rows = anchor
            ? all
                .filter(
                  (r) =>
                    r.ride_type_id === anchor.ride_type_id &&
                    r.display_name === anchor.display_name,
                )
                .sort((a, b) => a.product_kind.localeCompare(b.product_kind))
            : [];
          this.loading = false;
          const firstEnabled = this.rows.find((r) => r.is_active);
          this.selectedKind = firstEnabled?.product_kind || this.rows[0]?.product_kind || 'local';
          this.loadImages();
        },
        error: () => {
          this.loading = false;
          this.toast.error('Failed to load vehicle');
        },
      });
  }

  save(): void {
    if (!this.form || this.cityId == null) return;
    this.saving = true;
    const f = this.form;
    const fd = new FormData();
    fd.append('_method', 'PATCH');

    const append = (key: string, val: unknown): void => {
      if (val === null || val === undefined || val === '') return;
      if (typeof val === 'boolean') fd.append(key, val ? '1' : '0');
      else fd.append(key, String(val));
    };

    append('display_name', f.display_name);
    append('display_order', f.display_order);
    append('max_people', f.max_people);
    append('luggage_capacity', f.luggage_capacity);
    append('destination_mandatory', f.destination_mandatory);
    append('fare_mandatory', f.fare_mandatory);
    append('reverse_bidding_enabled', f.reverse_bidding_enabled);
    append('waiting_charges_applicable', f.waiting_charges_applicable);
    append('customer_notes_enabled', f.customer_notes_enabled);
    append('multiple_destinations_enabled', f.multiple_destinations_enabled);
    append('show_low_wallet_alert', f.show_low_wallet_alert);
    append('toll_mode', f.toll_mode);
    append('commission_percent', f.commission_percent);
    append('fixed_commission', f.fixed_commission);
    append('convenience_charge', f.convenience_charge);
    append('convenience_customer_waiver', f.convenience_customer_waiver);
    append('convenience_driver_cut', f.convenience_driver_cut);
    append('min_driver_balance', f.min_driver_balance);
    append('is_active', f.is_active);

    for (const k of [
      'override_request_radius_m',
      'override_hop_interval_sec',
      'override_hop_radius_m',
      'override_max_hops',
    ] as const) {
      const v = f[k];
      if (v !== null && v !== undefined && v !== ('' as unknown)) {
        fd.append(k, String(v));
      }
    }

    this.api
      .postMultipart<{ vehicle_type: VehicleType }>(
        `/admin/cities/${this.cityId}/vehicle-types/${f.id}`,
        fd,
      )
      .subscribe({
        next: (res) => {
          this.saving = false;
          const idx = this.rows.findIndex((r) => r.id === res.vehicle_type.id);
          if (idx >= 0) this.rows[idx] = res.vehicle_type;
          this.toast.success('Saved');
        },
        error: () => {
          this.saving = false;
          this.toast.error('Failed to save');
        },
      });
  }

  doDeleteKind(): void {
    if (!this.form || this.cityId == null) return;
    const f = this.form;
    this.api
      .delete(`/admin/cities/${this.cityId}/vehicle-types/${f.id}`)
      .subscribe({
        next: () => {
          this.deleteKindOpen = false;
          this.rows = this.rows.filter((r) => r.id !== f.id);
          this.toast.success('Deleted');
          if (!this.rows.length) {
            this.back();
            return;
          }
          // Keep the route anchor valid if the deleted row was the anchor.
          if (this.vehicleRowId === f.id) {
            this.vehicleRowId = this.rows[0].id;
          }
          this.selectedKind = this.rows[0].product_kind;
          this.loadImages();
        },
        error: () => this.toast.error('Failed to delete'),
      });
  }

  // ---- Images ----
  imagesFor(platform: Platform): VehicleTypeImage[] {
    return this.images.filter((i) => i.platform === platform);
  }

  loadImages(): void {
    if (this.cityId == null || !this.form) {
      this.images = [];
      return;
    }
    this.images = [];
    this.imagesLoading = true;
    this.api
      .get<{ data: VehicleTypeImage[] }>(
        `/admin/cities/${this.cityId}/vehicle-types/${this.form.id}/images`,
      )
      .subscribe({
        next: (res) => {
          this.images = res.data ?? [];
          this.imagesLoading = false;
        },
        error: () => {
          this.imagesLoading = false;
        },
      });
  }

  openAddImage(): void {
    this.addImageMode = 'create';
    this.addImageTargetId = null;
    this.addImageForm = { platform: null, key: '', file: null, previewUrl: null };
    this.addImageOpen = true;
  }

  replaceImage(img: VehicleTypeImage): void {
    this.addImageMode = 'replace';
    this.addImageTargetId = img.id;
    this.addImageForm = {
      platform: img.platform,
      key: img.key,
      file: null,
      previewUrl: img.image_url,
    };
    this.addImageOpen = true;
  }

  onAddImageFile(ev: Event): void {
    const f = (ev.target as HTMLInputElement).files?.[0];
    this.addImageForm.file = f ?? null;
    if (f) {
      const reader = new FileReader();
      reader.onload = () => (this.addImageForm.previewUrl = reader.result as string);
      reader.readAsDataURL(f);
    }
  }

  submitAddImage(): void {
    if (!this.form || this.cityId == null) return;
    const f = this.addImageForm;
    if (this.addImageMode === 'create' && (!f.platform || !f.key.trim() || !f.file)) {
      this.toast.error('Type, key and image are all required');
      return;
    }
    if (this.addImageMode === 'replace' && !f.file) {
      this.toast.error('Pick a new image to replace');
      return;
    }

    this.addImageSaving = true;
    const fd = new FormData();
    if (this.addImageMode === 'create') {
      fd.append('platform', f.platform as string);
      fd.append('key', f.key.trim());
      fd.append('image', f.file as File);
    } else {
      fd.append('_method', 'PATCH');
      fd.append('image', f.file as File);
    }

    const url = this.addImageMode === 'create'
      ? `/admin/cities/${this.cityId}/vehicle-types/${this.form.id}/images`
      : `/admin/cities/${this.cityId}/vehicle-types/${this.form.id}/images/${this.addImageTargetId}`;

    this.api.postMultipart<{ image: VehicleTypeImage }>(url, fd).subscribe({
      next: (res) => {
        this.addImageSaving = false;
        this.addImageOpen = false;
        const idx = this.images.findIndex((x) => x.id === res.image.id);
        if (idx >= 0) this.images[idx] = res.image;
        else this.images = [...this.images, res.image];
        this.toast.success('Image saved');
      },
      error: (err) => {
        this.addImageSaving = false;
        this.toast.error(err?.error?.message || 'Failed to save image');
      },
    });
  }

  deleteImage(img: VehicleTypeImage): void {
    this.imageToDelete = img;
  }

  doDeleteImage(): void {
    const img = this.imageToDelete;
    if (!img || !this.form || this.cityId == null) return;
    this.api
      .delete(`/admin/cities/${this.cityId}/vehicle-types/${this.form.id}/images/${img.id}`)
      .subscribe({
        next: () => {
          this.imageToDelete = null;
          this.images = this.images.filter((x) => x.id !== img.id);
          this.toast.success('Image deleted');
        },
        error: () => this.toast.error('Failed to delete image'),
      });
  }
}
