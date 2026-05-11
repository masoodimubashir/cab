import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { DropdownModule } from 'primeng/dropdown';
import { InputSwitchModule } from 'primeng/inputswitch';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ApiService } from '../../core/api.service';

interface City {
  id: number;
  name: string;
}

interface Fleet {
  id: number;
  city_id: number;
  city_name: string | null;
  name: string;
  phone_number: string | null;
  bank: string | null;
  address: string | null;
  vat_enabled: boolean;
  vat_number: string | null;
  logo_path: string | null;
  logo_url: string | null;
  status: string;
  is_active: boolean;
}

@Component({
  selector: 'app-fleets-settings',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonModule, TableModule, DialogModule,
    InputTextModule, InputTextareaModule, DropdownModule, InputSwitchModule,
    TagModule, ToastModule, ConfirmDialogModule,
  ],
  providers: [MessageService, ConfirmationService],
  template: `
    <p-toast />
    <p-confirmDialog />

    <h2 class="page-title">Fleets</h2>
    <p class="muted small">Fleet operators that own vehicles in your cities. Each fleet is scoped to one city.</p>

    <div class="toolbar">
      <p-dropdown
        [options]="cityOptions"
        [(ngModel)]="filterCityId"
        (onChange)="fetchFleets()"
        placeholder="All cities"
        [showClear]="true"
        optionLabel="name"
        optionValue="id"
        appendTo="body"
      ></p-dropdown>
      <p-dropdown
        [options]="statusFilterOptions"
        [(ngModel)]="filterStatus"
        (onChange)="fetchFleets()"
        placeholder="All statuses"
        [showClear]="true"
        optionLabel="label"
        optionValue="value"
        appendTo="body"
      ></p-dropdown>
      <button pButton type="button" icon="pi pi-plus" label="Add Fleet" class="p-button-sm"
              (click)="openCreate()"></button>
    </div>

    <p-table [value]="fleets" styleClass="p-datatable-sm" [rowHover]="true" [paginator]="fleets.length > 20" [rows]="20">
      <ng-template pTemplate="header">
        <tr>
          <th style="width: 64px;">Logo</th>
          <th>Name</th>
          <th>City</th>
          <th>Phone</th>
          <th>VAT</th>
          <th>Status</th>
          <th style="width: 160px;">Actions</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-f>
        <tr>
          <td>
            <img *ngIf="f.logo_url" [src]="f.logo_url" class="logo" alt="" />
            <div *ngIf="!f.logo_url" class="logo logo--empty">—</div>
          </td>
          <td><strong>{{ f.name }}</strong></td>
          <td>{{ f.city_name || '—' }}</td>
          <td>{{ f.phone_number || '—' }}</td>
          <td>
            <span *ngIf="f.vat_enabled" class="vat-on">{{ f.vat_number || 'Enabled' }}</span>
            <span *ngIf="!f.vat_enabled" class="muted">—</span>
          </td>
          <td>
            <p-tag [value]="f.status" [severity]="statusSeverity(f.status)"></p-tag>
          </td>
          <td class="actions">
            <button pButton type="button" label="Edit" class="p-button-sm" (click)="openEdit(f)"></button>
            <button pButton type="button" label="Delete"
                    class="p-button-sm p-button-text p-button-danger" (click)="remove(f)"></button>
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr><td colspan="7" class="empty">No fleets match the current filters.</td></tr>
      </ng-template>
    </p-table>

    <p-dialog
      [header]="editingId ? 'Edit Fleet' : 'Add Fleet'"
      [(visible)]="open"
      [modal]="true"
      [style]="{ width: '760px' }"
      [draggable]="false"
    >
      <div class="grid">
        <div class="col">
          <label class="lbl">Name *</label>
          <input pInputText [(ngModel)]="form.name" placeholder="e.g. Baramulla Premiere" />

          <label class="lbl">City *</label>
          <p-dropdown
            [options]="cityOptions"
            [(ngModel)]="form.city_id"
            placeholder="Select city"
            optionLabel="name"
            optionValue="id"
            appendTo="body"
          ></p-dropdown>

          <label class="lbl">Phone Number *</label>
          <input pInputText [(ngModel)]="form.phone_number" placeholder="+91 90000 00000" />

          <label class="lbl">Bank</label>
          <input pInputText [(ngModel)]="form.bank" placeholder="Bank name / account label" />

          <label class="lbl">Address</label>
          <textarea pInputTextarea rows="3" [(ngModel)]="form.address"></textarea>
        </div>

        <div class="col">
          <div class="switch-row">
            <span class="lbl">VAT Enabled</span>
            <p-inputSwitch [(ngModel)]="form.vat_enabled"></p-inputSwitch>
          </div>

          <label class="lbl">VAT Number</label>
          <input pInputText [(ngModel)]="form.vat_number" [disabled]="!form.vat_enabled" />

          <label class="lbl">Status</label>
          <p-dropdown
            [options]="statusOptions"
            [(ngModel)]="form.status"
            optionLabel="label"
            optionValue="value"
            appendTo="body"
          ></p-dropdown>

          <label class="lbl">Logo (optional)</label>
          <input type="file" accept="image/*" (change)="onLogo($event)" />
          <img *ngIf="logoPreview" [src]="logoPreview" class="logo logo--preview" alt="logo preview" />
        </div>
      </div>

      <ng-template pTemplate="footer">
        <button pButton type="button" label="Cancel" class="p-button-secondary" (click)="open = false"></button>
        <button pButton type="button"
                [label]="editingId ? 'Update' : 'Create'"
                (click)="submit()" [loading]="saving"></button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .page-title { margin: 0 0 8px; font-size: 22px; font-weight: 800; color: #0f172a; }
    .muted { color: #64748b; }
    .small { font-size: 12px; margin: 0 0 14px; }

    .toolbar {
      display: flex; gap: 10px; align-items: center; margin-bottom: 12px;
    }
    .toolbar :host ::ng-deep .p-dropdown { min-width: 200px; }

    .empty { padding: 28px; text-align: center; color: #64748b; }
    .actions { display: flex; gap: 6px; }
    .vat-on {
      display: inline-block; padding: 2px 8px;
      background: #fef3c7; color: #92400e;
      border-radius: 6px; font-size: 12px; font-weight: 700;
    }

    .logo {
      width: 44px; height: 44px; object-fit: cover;
      border-radius: 8px; border: 1px solid #e2e8f0;
      background: #f8fafc;
    }
    .logo--empty {
      display: inline-flex; align-items: center; justify-content: center;
      color: #94a3b8; font-size: 13px;
    }
    .logo--preview {
      width: 96px; height: 96px; margin-top: 8px;
    }

    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    .col { display: flex; flex-direction: column; gap: 6px; }
    .lbl { font-size: 12px; font-weight: 700; color: #475569; margin-top: 6px; }
    :host ::ng-deep .col .p-dropdown { width: 100%; }
    .col input[pInputText], .col textarea { width: 100%; }
    .switch-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 12px; background: #f8fafc; border-radius: 8px; margin-top: 6px;
    }
    .switch-row .lbl { margin: 0; }
  `],
})
export class FleetsSettingsComponent implements OnInit {
  cityOptions: City[] = [];
  fleets: Fleet[] = [];

  filterCityId: number | null = null;
  filterStatus: string | null = null;
  statusFilterOptions = [
    { label: 'Active', value: 'active' },
    { label: 'Inactive', value: 'inactive' },
    { label: 'Suspended', value: 'suspended' },
    { label: 'Pending', value: 'pending' },
  ];

  open = false;
  editingId: number | null = null;
  saving = false;

  form = this.blankForm();
  logoFile: File | null = null;
  logoPreview: string | null = null;

  statusOptions = [
    { label: 'Active', value: 'active' },
    { label: 'Inactive', value: 'inactive' },
    { label: 'Suspended', value: 'suspended' },
    { label: 'Pending', value: 'pending' },
  ];

  constructor(
    private api: ApiService,
    private msg: MessageService,
    private confirm: ConfirmationService,
  ) {}

  ngOnInit(): void {
    this.fetchCities();
    this.fetchFleets();
  }

  blankForm() {
    return {
      city_id: null as number | null,
      name: '',
      phone_number: '',
      bank: '',
      address: '',
      vat_enabled: false,
      vat_number: '',
      status: 'active',
      is_active: true,
    };
  }

  private fetchCities(): void {
    this.api.get<{ data: City[] }>('/admin/cities').subscribe({
      next: (res) => (this.cityOptions = res?.data || []),
    });
  }

  fetchFleets(): void {
    const params = new URLSearchParams();
    if (this.filterCityId) params.set('city_id', String(this.filterCityId));
    if (this.filterStatus) params.set('status', this.filterStatus);
    const qs = params.toString() ? `?${params.toString()}` : '';
    this.api.get<{ data: Fleet[] }>(`/admin/fleets${qs}`).subscribe({
      next: (res) => (this.fleets = res?.data || []),
      error: (err) => this.msg.add({ severity: 'error', summary: err?.error?.message || 'Failed to load fleets' }),
    });
  }

  openCreate(): void {
    this.editingId = null;
    this.form = this.blankForm();
    this.form.city_id = this.filterCityId;
    this.logoFile = null;
    this.logoPreview = null;
    this.open = true;
  }

  openEdit(f: Fleet): void {
    this.editingId = f.id;
    this.form = {
      city_id: f.city_id,
      name: f.name,
      phone_number: f.phone_number || '',
      bank: f.bank || '',
      address: f.address || '',
      vat_enabled: f.vat_enabled,
      vat_number: f.vat_number || '',
      status: f.status || 'active',
      is_active: f.is_active,
    };
    this.logoFile = null;
    this.logoPreview = f.logo_url;
    this.open = true;
  }

  onLogo(ev: Event): void {
    const file = (ev.target as HTMLInputElement).files?.[0];
    this.logoFile = file ?? null;
    if (file) {
      const reader = new FileReader();
      reader.onload = () => (this.logoPreview = reader.result as string);
      reader.readAsDataURL(file);
    }
  }

  submit(): void {
    if (!this.form.name.trim()) {
      this.msg.add({ severity: 'warn', summary: 'Name is required' });
      return;
    }
    if (!this.form.city_id) {
      this.msg.add({ severity: 'warn', summary: 'City is required' });
      return;
    }
    if (!this.form.phone_number.trim()) {
      this.msg.add({ severity: 'warn', summary: 'Phone number is required' });
      return;
    }

    const fd = new FormData();
    if (this.editingId) fd.append('_method', 'PATCH');
    fd.append('city_id', String(this.form.city_id));
    fd.append('name', this.form.name.trim());
    fd.append('phone_number', this.form.phone_number.trim());
    if (this.form.bank) fd.append('bank', this.form.bank);
    if (this.form.address) fd.append('address', this.form.address);
    fd.append('vat_enabled', this.form.vat_enabled ? '1' : '0');
    if (this.form.vat_enabled && this.form.vat_number) {
      fd.append('vat_number', this.form.vat_number);
    }
    fd.append('status', this.form.status);
    fd.append('is_active', this.form.is_active ? '1' : '0');
    if (this.logoFile) fd.append('logo', this.logoFile);

    this.saving = true;
    const path = this.editingId ? `/admin/fleets/${this.editingId}` : '/admin/fleets';
    this.api.postMultipart<{ fleet: Fleet }>(path, fd).subscribe({
      next: () => {
        this.saving = false;
        this.open = false;
        this.msg.add({ severity: 'success', summary: this.editingId ? 'Fleet updated' : 'Fleet created' });
        this.fetchFleets();
      },
      error: (err) => {
        this.saving = false;
        this.msg.add({ severity: 'error', summary: err?.error?.message || 'Save failed' });
      },
    });
  }

  remove(f: Fleet): void {
    this.confirm.confirm({
      message: `Delete fleet "${f.name}"?`,
      accept: () => {
        this.api.delete(`/admin/fleets/${f.id}`).subscribe({
          next: () => { this.msg.add({ severity: 'success', summary: 'Deleted' }); this.fetchFleets(); },
          error: (err) => this.msg.add({ severity: 'error', summary: err?.error?.message || 'Delete failed' }),
        });
      },
    });
  }

  statusSeverity(s: string): 'success' | 'warning' | 'danger' | 'info' | 'secondary' {
    if (s === 'active') return 'success';
    if (s === 'suspended') return 'danger';
    if (s === 'pending') return 'warning';
    return 'secondary';
  }
}
