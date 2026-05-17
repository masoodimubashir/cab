import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TabViewModule } from 'primeng/tabview';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { CheckboxModule } from 'primeng/checkbox';
import { InputSwitchModule } from 'primeng/inputswitch';
import { RadioButtonModule } from 'primeng/radiobutton';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MessageService } from 'primeng/api';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';

type ProductKind = 'local' | 'rental' | 'outstation';
type TollMode = 'no' | 'yes' | 'yes_locked';
type Platform = 'android' | 'ios';

interface VehicleType {
  id: number;
  city_id: number;
  ride_type_id: number;
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

@Component({
  selector: 'app-vehicle-type-details',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    TabViewModule,
    TableModule,
    DialogModule,
    DropdownModule,
    InputTextModule,
    InputNumberModule,
    CheckboxModule,
    InputSwitchModule,
    RadioButtonModule,
    ToastModule,
    ConfirmDialogModule,
  ],
  providers: [MessageService, ConfirmationService],
  template: `
    <p-toast />
    <p-confirmDialog />

    <div *ngIf="loading" class="empty">Loading…</div>

    <div class="page" *ngIf="!loading">
      <header class="page-head">
        <button pButton type="button" icon="pi pi-arrow-left" class="p-button-text"
                (click)="back()" aria-label="Back"></button>
        <div class="title">
          <div class="title__name">{{ headerName() }}</div>
          <div class="title__meta">
            <span class="chip-mute">{{ rideTypeName() }}</span>
            <span class="chip-mute">{{ activeKindCount() }} of 3 enabled</span>
          </div>
        </div>
      </header>

      <div *ngIf="!rows.length" class="empty">
        Nothing to show. Either the vehicle was just removed, or no city is selected.
      </div>

      <ng-container *ngIf="rows.length">
        <!-- Kind cards (selectable + togglable in-place) -->
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
              <p-inputSwitch
                [ngModel]="!!rowFor(k.value)?.is_active"
                (ngModelChange)="toggleKindActive(k.value, $event)"
                (click)="$event.stopPropagation()"
              ></p-inputSwitch>
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

        <!-- Flat tab editor (no card wrapping) -->
        <div *ngIf="form" class="editor">
          <p-tabView>
            <p-tabPanel header="Identity & Capacity">
              <div class="grid two">
                <div class="field">
                  <label class="lbl">Display Name</label>
                  <input pInputText [(ngModel)]="form.display_name" />
                </div>
                <div class="field">
                  <label class="lbl">Display Order</label>
                  <p-inputNumber [(ngModel)]="form.display_order" [min]="0" [max]="9999"></p-inputNumber>
                </div>
                <div class="field">
                  <label class="lbl">Max People</label>
                  <p-inputNumber [(ngModel)]="form.max_people" [min]="1" [max]="20"></p-inputNumber>
                </div>
                <div class="field">
                  <label class="lbl">Luggage Capacity</label>
                  <p-inputNumber [(ngModel)]="form.luggage_capacity" [min]="0" [max]="20"></p-inputNumber>
                </div>
              </div>
              <p class="hint">
                Vehicle icons (Android &amp; iOS, multiple slots) live in the
                <strong>Images</strong> tab.
              </p>
            </p-tabPanel>

            <p-tabPanel header="Behaviour">
              <div class="grid two">
                <label class="row">
                  <p-checkbox [(ngModel)]="form.destination_mandatory" [binary]="true"></p-checkbox>
                  Destination mandatory
                </label>
                <label class="row">
                  <p-checkbox [(ngModel)]="form.fare_mandatory" [binary]="true"></p-checkbox>
                  Fare mandatory (no bidding)
                </label>
                <label class="row">
                  <p-checkbox [(ngModel)]="form.reverse_bidding_enabled" [binary]="true"></p-checkbox>
                  Reverse bidding enabled
                </label>
                <label class="row">
                  <p-checkbox [(ngModel)]="form.waiting_charges_applicable" [binary]="true"></p-checkbox>
                  Waiting charges applicable
                </label>
                <label class="row">
                  <p-checkbox [(ngModel)]="form.customer_notes_enabled" [binary]="true"></p-checkbox>
                  Customer notes enabled
                </label>
                <label class="row">
                  <p-checkbox [(ngModel)]="form.multiple_destinations_enabled" [binary]="true"></p-checkbox>
                  Multiple destinations enabled
                </label>
                <label class="row">
                  <p-checkbox [(ngModel)]="form.show_low_wallet_alert" [binary]="true"></p-checkbox>
                  Show low-wallet alert (driver)
                </label>
                <div class="field">
                  <label class="lbl">Toll Mode</label>
                  <div class="radio-group">
                    <label *ngFor="let t of tollModes">
                      <p-radioButton
                        name="toll-mode"
                        [value]="t.value"
                        [(ngModel)]="form.toll_mode"
                      ></p-radioButton>
                      {{ t.label }}
                    </label>
                  </div>
                </div>
              </div>
            </p-tabPanel>

            <p-tabPanel header="Commercials">
              <div class="grid two">
                <div class="field">
                  <label class="lbl">Commission (%)</label>
                  <p-inputNumber [(ngModel)]="form.commission_percent" [min]="0" [max]="100" mode="decimal" [maxFractionDigits]="2"></p-inputNumber>
                </div>
                <div class="field">
                  <label class="lbl">Fixed Commission</label>
                  <p-inputNumber [(ngModel)]="form.fixed_commission" [min]="0" mode="decimal" [maxFractionDigits]="2"></p-inputNumber>
                </div>
                <div class="field">
                  <label class="lbl">Convenience Charge</label>
                  <p-inputNumber [(ngModel)]="form.convenience_charge" [min]="0" mode="decimal" [maxFractionDigits]="2"></p-inputNumber>
                </div>
                <div class="field">
                  <label class="lbl">Convenience — Customer Waiver</label>
                  <p-inputNumber [(ngModel)]="form.convenience_customer_waiver" [min]="0" mode="decimal" [maxFractionDigits]="2"></p-inputNumber>
                </div>
                <div class="field">
                  <label class="lbl">Convenience — Driver Cut</label>
                  <p-inputNumber [(ngModel)]="form.convenience_driver_cut" [min]="0" mode="decimal" [maxFractionDigits]="2"></p-inputNumber>
                </div>
                <div class="field">
                  <label class="lbl">Min Driver Balance</label>
                  <p-inputNumber [(ngModel)]="form.min_driver_balance" [min]="0" mode="decimal" [maxFractionDigits]="2"></p-inputNumber>
                </div>
              </div>
            </p-tabPanel>

            <p-tabPanel header="Dispatcher Overrides">
              <p class="hint">
                Leave a field blank to inherit the city-level Dispatcher Settings value for this kind.
              </p>
              <div class="grid two">
                <div class="field">
                  <label class="lbl">Request radius (m) — override</label>
                  <p-inputNumber [(ngModel)]="form.override_request_radius_m" [min]="0" [max]="50000"></p-inputNumber>
                </div>
                <div class="field">
                  <label class="lbl">Hop interval (sec) — override</label>
                  <p-inputNumber [(ngModel)]="form.override_hop_interval_sec" [min]="1" [max]="600"></p-inputNumber>
                </div>
                <div class="field">
                  <label class="lbl">Hop radius (m) — override</label>
                  <p-inputNumber [(ngModel)]="form.override_hop_radius_m" [min]="0" [max]="50000"></p-inputNumber>
                </div>
                <div class="field">
                  <label class="lbl">Max hops — override</label>
                  <p-inputNumber [(ngModel)]="form.override_max_hops" [min]="1" [max]="50"></p-inputNumber>
                </div>
              </div>
            </p-tabPanel>

            <p-tabPanel header="Images">
              <div class="img-head">
                <p class="hint" style="margin: 0;">
                  Each row is one slot — <code>tab_normal</code>, <code>ride_now_highlighted</code> etc. — per platform.
                </p>
                <button pButton type="button" label="Add Image" icon="pi pi-plus" class="p-button-sm" (click)="openAddImage()"></button>
              </div>

              <div *ngIf="imagesLoading" class="empty">Loading images…</div>

              <ng-container *ngIf="!imagesLoading">
                <h4 class="img-section">ANDROID APP</h4>
                <p-table [value]="imagesFor('android')" styleClass="p-datatable-sm img-table">
                  <ng-template pTemplate="header">
                    <tr>
                      <th>Image Type</th>
                      <th>Uploaded Image</th>
                      <th style="width: 220px;">Actions</th>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="body" let-img>
                    <tr>
                      <td>{{ img.key }}</td>
                      <td><img *ngIf="img.image_url" [src]="img.image_url" class="img-thumb" /></td>
                      <td>
                        <button pButton type="button" label="Replace" class="p-button-sm" (click)="replaceImage(img)"></button>
                        <button pButton type="button" label="Delete" class="p-button-sm p-button-text p-button-danger" (click)="deleteImage(img)"></button>
                      </td>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="emptymessage">
                    <tr><td colspan="3" class="empty">No Android images yet.</td></tr>
                  </ng-template>
                </p-table>

                <h4 class="img-section">iOS APP</h4>
                <p-table [value]="imagesFor('ios')" styleClass="p-datatable-sm img-table">
                  <ng-template pTemplate="header">
                    <tr>
                      <th>Image Type</th>
                      <th>Uploaded Image</th>
                      <th style="width: 220px;">Actions</th>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="body" let-img>
                    <tr>
                      <td>{{ img.key }}</td>
                      <td><img *ngIf="img.image_url" [src]="img.image_url" class="img-thumb" /></td>
                      <td>
                        <button pButton type="button" label="Replace" class="p-button-sm" (click)="replaceImage(img)"></button>
                        <button pButton type="button" label="Delete" class="p-button-sm p-button-text p-button-danger" (click)="deleteImage(img)"></button>
                      </td>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="emptymessage">
                    <tr><td colspan="3" class="empty">No iOS images yet.</td></tr>
                  </ng-template>
                </p-table>
              </ng-container>
            </p-tabPanel>
          </p-tabView>
        </div>
      </ng-container>
    </div>

    <!-- Sticky action bar -->
    <div class="action-bar" *ngIf="!loading && form">
      <button pButton type="button" label="Delete this kind" icon="pi pi-trash"
              class="p-button-text p-button-danger" (click)="confirmDeleteKind()"></button>
      <div class="action-bar__spacer"></div>
      <span class="dirty-hint">Changes apply only to <strong>{{ kindLabel(form.product_kind) }}</strong>.</span>
      <button pButton type="button" label="Save" icon="pi pi-save"
              (click)="save()" [loading]="saving"></button>
    </div>

    <!-- Add / Replace image dialog -->
    <p-dialog
      [header]="addImageMode === 'replace' ? 'Replace Image' : 'Add Image'"
      [(visible)]="addImageOpen"
      [modal]="true"
      [style]="{ width: '440px' }"
      [draggable]="false"
    >
      <div class="form">
        <label class="lbl">Type *</label>
        <p-dropdown
          [options]="platformOptions"
          [(ngModel)]="addImageForm.platform"
          optionLabel="label"
          optionValue="value"
          placeholder="Select Type"
          [disabled]="addImageMode === 'replace'"
          [style]="{ width: '100%' }"
        ></p-dropdown>

        <label class="lbl">Key *</label>
        <input
          pInputText
          [(ngModel)]="addImageForm.key"
          placeholder="e.g. tab_normal, ride_now_highlighted"
          [disabled]="addImageMode === 'replace'"
        />

        <label class="lbl">Image *</label>
        <input type="file" accept="image/*" (change)="onAddImageFile($event)" />
        <img *ngIf="addImageForm.previewUrl" [src]="addImageForm.previewUrl" class="img-thumb" />
      </div>
      <ng-template pTemplate="footer">
        <button pButton type="button" label="Cancel" class="p-button-secondary" (click)="addImageOpen = false"></button>
        <button pButton type="button" label="Save" (click)="submitAddImage()" [loading]="addImageSaving"></button>
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      :host {
        display: block;
        padding-bottom: 84px; /* room for sticky action bar */
      }
      .page { max-width: 1100px; margin: 0 auto; }

      .page-head {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 18px;
      }
      .title__name {
        font-size: 20px;
        font-weight: 800;
        color: #0f172a;
        line-height: 1.2;
      }
      .title__meta {
        display: inline-flex;
        gap: 6px;
        margin-top: 4px;
      }
      .chip-mute {
        font-size: 11px;
        font-weight: 700;
        background: #f1f5f9;
        color: #475569;
        padding: 2px 10px;
        border-radius: 999px;
        text-transform: uppercase;
        letter-spacing: 0.4px;
      }

      .empty { padding: 30px; text-align: center; color: #64748b; }

      .kind-cards {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 12px;
        margin-bottom: 18px;
      }
      .kind-card {
        background: #fff;
        border: 1.5px solid #e2e8f0;
        border-radius: 14px;
        padding: 14px;
        cursor: pointer;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .kind-card:hover { border-color: #94a3b8; }
      .kind-card.selected {
        border-color: #06b6d4;
        box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.12);
      }
      .kind-card.disabled .kind-card__label { color: #94a3b8; }
      .kind-card__top {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
      }
      .kind-card__label {
        font-weight: 800;
        font-size: 16px;
        color: #0f172a;
      }
      .kind-card__sub {
        font-size: 11px;
        color: #64748b;
        margin-top: 2px;
      }
      .kind-card__stats {
        display: flex;
        gap: 14px;
        align-items: center;
      }
      .stat {
        display: inline-flex;
        flex-direction: column;
        gap: 2px;
      }
      .stat__lbl {
        font-size: 10px;
        font-weight: 700;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.4px;
      }
      .stat__val {
        font-size: 14px;
        font-weight: 700;
        color: #0f172a;
      }

      .editor {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 4px 14px 14px;
      }
      :host ::ng-deep .editor .p-tabview .p-tabview-nav {
        border-bottom: 1px solid #e2e8f0;
      }
      :host ::ng-deep .editor .p-tabview-panels {
        background: transparent;
        padding: 14px 0 4px;
      }

      .grid { display: grid; gap: 14px; }
      .grid.two { grid-template-columns: 1fr 1fr; }
      .field { display: flex; flex-direction: column; gap: 4px; }
      .lbl { font-size: 12px; font-weight: 700; color: #475569; }
      .row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 600;
        color: #334155;
      }
      .radio-group { display: flex; flex-direction: column; gap: 6px; }
      .radio-group label {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 600;
      }
      .hint { color: #64748b; font-size: 12px; margin: 8px 0 0; }
      :host ::ng-deep .p-inputnumber { width: 100%; }
      input[pInputText] { width: 100%; }

      .img-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
        gap: 12px;
      }
      .img-section {
        margin: 18px 0 6px;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.4px;
        color: #475569;
        text-transform: uppercase;
      }
      .img-thumb {
        max-width: 80px;
        max-height: 60px;
        border-radius: 4px;
        border: 1px solid #e2e8f0;
        display: inline-block;
      }
      :host ::ng-deep .img-table .p-button-sm { margin-right: 6px; }

      .action-bar {
        position: sticky;
        bottom: 0;
        left: 0;
        right: 0;
        background: #fff;
        border-top: 1px solid #e2e8f0;
        padding: 12px 24px;
        margin: 18px -24px 0;
        display: flex;
        align-items: center;
        gap: 12px;
        box-shadow: 0 -4px 12px rgba(15, 23, 42, 0.04);
        z-index: 10;
      }
      .action-bar__spacer { flex: 1; }
      .dirty-hint {
        font-size: 12px;
        color: #475569;
        margin-right: 8px;
      }

      .form { display: flex; flex-direction: column; gap: 6px; }
      .form .lbl { font-size: 12px; font-weight: 700; color: #475569; margin-top: 6px; }

      @media (max-width: 880px) {
        .kind-cards { grid-template-columns: 1fr; }
        .grid.two { grid-template-columns: 1fr; }
        .action-bar { padding: 10px 14px; margin: 12px -14px 0; }
      }
    `,
  ],
})
export class VehicleTypeDetailsComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  rideTypeId: number | null = null;
  rows: VehicleType[] = [];
  selectedKind: ProductKind = 'local';
  loading = true;
  saving = false;

  kinds = KINDS;
  tollModes = TOLL_MODES;

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

  private subs: Subscription[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private cityCtx: CityContextService,
    private msg: MessageService,
    private confirm: ConfirmationService,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.subs.push(
      this.cityCtx.cityId$.subscribe((id) => {
        this.cityId = id;
        this.fetchRows();
      }),
      this.route.paramMap.subscribe((p) => {
        const raw = p.get('rideTypeId');
        this.rideTypeId = raw ? Number(raw) : null;
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
    this.loadImages();
  }

  /**
   * Toggle is_active on a kind from the kind card without entering the editor.
   * Persists immediately so the operator gets one-click enable/disable.
   */
  toggleKindActive(kind: ProductKind, value: boolean): void {
    if (this.cityId == null) return;
    const row = this.rowFor(kind);

    // Row already exists: just flip its is_active in place.
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
            this.msg.add({ severity: 'error', summary: 'Failed to update' });
          },
        });
      return;
    }

    // No row exists yet for this kind. The only meaningful action is to
    // create it (toggle ON). Toggle OFF on a non-existent row is a no-op.
    if (!value) return;

    const template = this.rows[0];
    if (!template) {
      this.msg.add({ severity: 'warn', summary: 'No template available to add a new kind.' });
      return;
    }

    // Create a single row for this kind, copying the basics from an existing
    // sibling so the new variant lands fully-configured.
    this.api
      .post<{ data: VehicleType[]; created_count: number }>(
        `/admin/cities/${this.cityId}/vehicle-types`,
        {
          ride_type_id: template.ride_type_id,
          vehicle_type_id: (template as VehicleType & { vehicle_type_id?: number | null }).vehicle_type_id ?? null,
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
          // Merge the returned set (might include rows we already had).
          const ids = new Set((res.data ?? []).map((r) => r.id));
          this.rows = [
            ...this.rows.filter((r) => !ids.has(r.id)),
            ...(res.data ?? []),
          ].sort((a, b) => a.product_kind.localeCompare(b.product_kind));
          this.msg.add({
            severity: 'success',
            summary: `${this.kindLabel(kind)} enabled.`,
          });
        },
        error: (err) => {
          this.msg.add({
            severity: 'error',
            summary: err?.error?.message || `Failed to add ${this.kindLabel(kind)}.`,
          });
        },
      });
  }

  back(): void {
    this.router.navigateByUrl('/settings/city');
  }

  fetchRows(): void {
    if (this.cityId == null || this.rideTypeId == null) {
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
          this.rows = all
            .filter((r) => r.ride_type_id === this.rideTypeId)
            .sort((a, b) => a.product_kind.localeCompare(b.product_kind));
          this.loading = false;
          const firstEnabled = this.rows.find((r) => r.is_active);
          this.selectedKind = (firstEnabled?.product_kind as ProductKind) || this.rows[0]?.product_kind || 'local';
          this.loadImages();
        },
        error: () => {
          this.loading = false;
          this.msg.add({ severity: 'error', summary: 'Failed to load vehicle' });
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
          this.msg.add({ severity: 'success', summary: 'Saved' });
        },
        error: () => {
          this.saving = false;
          this.msg.add({ severity: 'error', summary: 'Failed to save' });
        },
      });
  }

  confirmDeleteKind(): void {
    if (!this.form || this.cityId == null) return;
    const f = this.form;
    this.confirm.confirm({
      message: `Delete the ${this.kindLabel(f.product_kind)} variant of "${f.display_name}"? This cannot be undone.`,
      header: 'Delete this kind',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.api
          .delete(`/admin/cities/${this.cityId}/vehicle-types/${f.id}`)
          .subscribe({
            next: () => {
              this.rows = this.rows.filter((r) => r.id !== f.id);
              this.msg.add({ severity: 'success', summary: 'Deleted' });
              if (!this.rows.length) {
                this.back();
                return;
              }
              this.selectedKind = this.rows[0].product_kind;
              this.loadImages();
            },
            error: () => this.msg.add({ severity: 'error', summary: 'Failed to delete' }),
          });
      },
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
      this.msg.add({ severity: 'warn', summary: 'Type, key and image are all required' });
      return;
    }
    if (this.addImageMode === 'replace' && !f.file) {
      this.msg.add({ severity: 'warn', summary: 'Pick a new image to replace' });
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
        this.msg.add({ severity: 'success', summary: 'Image saved' });
      },
      error: (err) => {
        this.addImageSaving = false;
        this.msg.add({
          severity: 'error',
          summary: err?.error?.message || 'Failed to save image',
        });
      },
    });
  }

  deleteImage(img: VehicleTypeImage): void {
    if (!this.form || this.cityId == null) return;
    this.confirm.confirm({
      message: `Delete the "${img.key}" ${img.platform} image?`,
      header: 'Delete image',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.api
          .delete(`/admin/cities/${this.cityId}/vehicle-types/${this.form!.id}/images/${img.id}`)
          .subscribe({
            next: () => {
              this.images = this.images.filter((x) => x.id !== img.id);
              this.msg.add({ severity: 'success', summary: 'Image deleted' });
            },
            error: () => this.msg.add({ severity: 'error', summary: 'Failed to delete image' }),
          });
      },
    });
  }
}
