import { Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { DropdownModule } from 'primeng/dropdown';
import { MultiSelectModule } from 'primeng/multiselect';
import { ToastModule } from 'primeng/toast';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { GoogleMapsLoaderService } from '../../core/google-maps-loader.service';

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

@Component({
  selector: 'app-coupons',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonModule, TableModule, DialogModule,
    InputTextModule, InputTextareaModule, InputNumberModule, InputSwitchModule,
    DropdownModule, MultiSelectModule,
    ToastModule, ConfirmDialogModule,
  ],
  providers: [MessageService, ConfirmationService],
  template: `
    <p-toast />
    <p-confirmDialog />

    <h2 class="page-title">Coupons</h2>

    <div class="bar">
      <button pButton type="button" label="Add Coupons" icon="pi pi-plus"
              class="p-button-sm" (click)="openCreate()" [disabled]="!cityId"></button>
    </div>

    <div class="tabs">
      <button class="tab" [class.active]="tab === 'active'" (click)="setTab('active')">Active</button>
      <button class="tab" [class.active]="tab === 'inactive'" (click)="setTab('inactive')">Inactive</button>
    </div>

    <p-table [value]="rows" styleClass="p-datatable-sm" [rowHover]="true" [paginator]="rows.length > 20" [rows]="20">
      <ng-template pTemplate="header">
        <tr>
          <th>S.No</th>
          <th>Title</th>
          <th>Subtitle</th>
          <th>Promo Type</th>
          <th>Discount</th>
          <th>Max</th>
          <th>Per User</th>
          <th>Status</th>
          <th style="width: 160px;">Action</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-r let-i="rowIndex">
        <tr>
          <td>{{ i + 1 }}</td>
          <td><strong>{{ r.title }}</strong></td>
          <td>{{ r.subtitle || '—' }}</td>
          <td>{{ humanPromoType(r.promo_type) }}</td>
          <td>{{ r.discount_value }}{{ r.discount_type === 'percentage' ? '%' : '' }}</td>
          <td>{{ r.discount_maximum ?? '—' }}</td>
          <td>{{ r.per_user_limit ?? '—' }}</td>
          <td>
            <span class="pill" [class.on]="r.is_active" [class.off]="!r.is_active">
              {{ r.is_active ? 'Active' : 'Inactive' }}
            </span>
          </td>
          <td class="actions-col">
            <button pButton type="button" label="Edit" class="p-button-sm" (click)="openEdit(r)"></button>
            <button pButton type="button" label="Delete"
                    class="p-button-sm p-button-text p-button-danger" (click)="remove(r)"></button>
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr><td colspan="9" class="empty">No coupons in this list.</td></tr>
      </ng-template>
    </p-table>

    <p-dialog
      [header]="editingId ? 'Edit Coupon' : 'Add Coupons'"
      [(visible)]="open"
      [modal]="true"
      [style]="{ width: '780px' }"
      [draggable]="false"
      (onShow)="onDialogShow()"
    >
      <div class="grid">
        <div class="col">
          <label class="lbl">Title *</label>
          <input pInputText [(ngModel)]="form.title" />

          <label class="lbl">Benefit Type *</label>
          <p-dropdown [options]="benefitTypes" [(ngModel)]="form.benefit_type"
                      optionLabel="label" optionValue="value" appendTo="body"></p-dropdown>

          <label class="lbl">Promo Type *</label>
          <p-dropdown [options]="promoTypes" [(ngModel)]="form.promo_type"
                      optionLabel="label" optionValue="value" appendTo="body"
                      (onChange)="onPromoTypeChange()"></p-dropdown>

          <ng-container *ngIf="isLocationBased()">
            <label class="lbl">Location *</label>
            <input
              #locationInput
              pInputText
              [(ngModel)]="form.location_name"
              placeholder="Enter a location"
              (input)="onLocationTyped()"
            />
            <div *ngIf="form.location_name && form.latitude" class="chip">
              <span>{{ form.location_name }}</span>
              <button type="button" class="chip__x" (click)="clearLocation()" aria-label="Clear location">×</button>
            </div>
          </ng-container>

          <label class="lbl">Discount Type *</label>
          <p-dropdown [options]="discountTypes" [(ngModel)]="form.discount_type"
                      optionLabel="label" optionValue="value" appendTo="body"></p-dropdown>

          <label class="lbl">Discount {{ form.discount_type === 'percentage' ? '(%)' : '(amount)' }} *</label>
          <p-inputNumber [(ngModel)]="form.discount_value" [min]="0" [maxFractionDigits]="2"></p-inputNumber>

          <label class="lbl">Allowed Vehicles *</label>
          <p-multiSelect
            [options]="vehicleOptions"
            [(ngModel)]="form.allowed_vehicle_type_ids"
            optionLabel="display_name"
            optionValue="id"
            placeholder="Select Vehicle"
            appendTo="body"
          ></p-multiSelect>
        </div>

        <div class="col">
          <label class="lbl">Subtitle *</label>
          <input pInputText [(ngModel)]="form.subtitle" />

          <label class="lbl">Description *</label>
          <textarea pInputTextarea rows="3" [(ngModel)]="form.description"></textarea>

          <label class="lbl">Per User Limit *</label>
          <p-inputNumber [(ngModel)]="form.per_user_limit" [min]="0"></p-inputNumber>

          <ng-container *ngIf="isLocationBased()">
            <label class="lbl">Request Radius (in meters) *</label>
            <p-inputNumber [(ngModel)]="form.radius_meters" [min]="0"></p-inputNumber>
          </ng-container>

          <label class="lbl">Discount Maximum *</label>
          <p-inputNumber [(ngModel)]="form.discount_maximum" [min]="0" [maxFractionDigits]="2"></p-inputNumber>

          <div class="switch-row">
            <span class="lbl">Active</span>
            <p-inputSwitch [(ngModel)]="form.is_active"></p-inputSwitch>
          </div>
        </div>
      </div>

      <ng-template pTemplate="footer">
        <button pButton type="button" label="Cancel" class="p-button-secondary" (click)="open = false"></button>
        <button pButton type="button"
                [label]="editingId ? 'Update' : 'Add'"
                (click)="submit()" [loading]="saving"></button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .page-title { margin: 0 0 14px; font-size: 22px; font-weight: 800; color: #0f172a; }
    .bar { display: flex; justify-content: flex-start; margin: 0 0 12px; }
    .tabs {
      display: flex; gap: 0; background: #f1f5f9; border-radius: 10px;
      padding: 4px; margin: 0 0 18px; max-width: 380px;
    }
    .tab {
      flex: 1; padding: 10px 16px; background: transparent; border: 0;
      border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 13px;
      color: #475569;
    }
    .tab.active { background: #06b6d4; color: #fff; }

    .empty { padding: 28px; text-align: center; color: #64748b; }
    .pill {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px;
    }
    .pill.on { background: #dcfce7; color: #166534; }
    .pill.off { background: #f1f5f9; color: #94a3b8; }
    .actions-col { display: flex; gap: 6px; }

    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    .col { display: flex; flex-direction: column; gap: 6px; }
    .lbl { font-size: 12px; font-weight: 700; color: #475569; margin-top: 6px; }
    :host ::ng-deep .col .p-inputnumber,
    :host ::ng-deep .col .p-dropdown,
    :host ::ng-deep .col .p-multiselect { width: 100%; }
    .col input[pInputText], .col textarea { width: 100%; }
    .switch-row {
      display: flex; justify-content: space-between; align-items: center;
      margin-top: 10px; padding: 8px 10px; background: #f8fafc; border-radius: 8px;
    }
    .switch-row .lbl { margin: 0; }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 6px;
      padding: 6px 10px;
      background: #cffafe;
      border: 1px solid #67e8f9;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      color: #0e7490;
      max-width: fit-content;
    }
    .chip__x {
      background: transparent; border: 0; color: #0e7490;
      font-size: 16px; line-height: 1; cursor: pointer; padding: 0;
    }
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
  form = this.blankForm();

  @ViewChild('locationInput') locationInputRef?: ElementRef<HTMLInputElement>;
  private autocomplete: google.maps.places.Autocomplete | null = null;
  private autocompleteListener: google.maps.MapsEventListener | null = null;

  benefitTypes = [{ label: 'Discount', value: 'discount' }];
  promoTypes = [
    { label: 'Location Insensitive', value: 'location_insensitive' },
    { label: 'Pickup Based', value: 'pickup_based' },
    { label: 'Drop Based', value: 'drop_based' },
  ];
  discountTypes = [
    { label: 'Percentage', value: 'percentage' },
    { label: 'Flat', value: 'flat' },
  ];

  private sub?: Subscription;

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private maps: GoogleMapsLoaderService,
    private zone: NgZone,
    private msg: MessageService,
    private confirm: ConfirmationService,
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
    return this.promoTypes.find((x) => x.value === p)?.label || p;
  }

  fetch(): void {
    if (this.cityId == null) return;
    const active = this.tab === 'active' ? '1' : '0';
    this.api.get<{ data: CouponRow[] }>(`/admin/cities/${this.cityId}/coupons?is_active=${active}`)
      .subscribe({
        next: (r) => (this.rows = r.data ?? []),
        error: () => this.msg.add({ severity: 'error', summary: 'Failed to load coupons' }),
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
    this.form = this.blankForm();
    this.open = true;
  }

  openEdit(r: CouponRow): void {
    this.editingId = r.id;
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
  }

  onDialogShow(): void {
    if (this.isLocationBased()) setTimeout(() => this.attachAutocomplete(), 0);
  }

  onPromoTypeChange(): void {
    if (this.isLocationBased()) {
      setTimeout(() => this.attachAutocomplete(), 0);
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

  clearLocation(): void {
    this.form.location_name = '';
    this.form.latitude = null;
    this.form.longitude = null;
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
  }

  submit(): void {
    if (this.cityId == null) return;
    if (!this.form.title.trim()) {
      this.msg.add({ severity: 'warn', summary: 'Title is required' });
      return;
    }
    if (this.isLocationBased()) {
      if (!this.form.radius_meters || this.form.radius_meters <= 0) {
        this.msg.add({ severity: 'warn', summary: 'Request Radius is required' });
        return;
      }
      if (!this.form.latitude || !this.form.longitude) {
        this.msg.add({ severity: 'warn', summary: 'Pick a location from the suggestions' });
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
        this.msg.add({ severity: 'success', summary: this.editingId ? 'Updated' : 'Created' });
        this.fetch();
      },
      error: (e) => {
        this.saving = false;
        this.msg.add({ severity: 'error', summary: e?.error?.message || 'Save failed' });
      },
    });
  }

  remove(r: CouponRow): void {
    this.confirm.confirm({
      message: `Delete coupon "${r.title}"?`,
      accept: () => {
        if (this.cityId == null) return;
        this.api.delete(`/admin/cities/${this.cityId}/coupons/${r.id}`).subscribe({
          next: () => { this.msg.add({ severity: 'success', summary: 'Deleted' }); this.fetch(); },
          error: (e) => this.msg.add({ severity: 'error', summary: e?.error?.message || 'Delete failed' }),
        });
      },
    });
  }
}
