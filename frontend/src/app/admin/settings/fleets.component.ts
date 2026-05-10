import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { DropdownModule } from 'primeng/dropdown';
import { TagModule } from 'primeng/tag';
import { CheckboxModule } from 'primeng/checkbox';
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
  is_active: boolean;
}

@Component({
  selector: 'app-fleets-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    DropdownModule,
    TagModule,
    CheckboxModule,
  ],
  template: `
    <p-card header="Fleets">
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
        <button pButton type="button" icon="pi pi-plus" label="Add Fleet" (click)="openAdd()"></button>
      </div>

      <div *ngIf="adding || editingId !== null" class="form">
        <p-dropdown
          [options]="cityOptions"
          [(ngModel)]="form.city_id"
          placeholder="Select a city"
          optionLabel="name"
          optionValue="id"
          appendTo="body"
          styleClass="form__city"
        ></p-dropdown>
        <input pInputText [(ngModel)]="form.name" placeholder="Fleet name (e.g. Baramulla Premiere)" />
        <label class="active">
          <p-checkbox [(ngModel)]="form.is_active" [binary]="true"></p-checkbox>
          Active
        </label>
        <div class="form__actions">
          <button pButton type="button" label="Cancel" class="p-button-text" (click)="cancel()"></button>
          <button
            pButton
            type="button"
            [label]="editingId !== null ? 'Save' : 'Create'"
            [disabled]="!form.city_id || !form.name.trim() || saving"
            (click)="submit()"
          ></button>
        </div>
      </div>

      <div *ngIf="error" class="error">{{ error }}</div>
      <div *ngIf="message" class="ok">{{ message }}</div>

      <table class="t-table">
        <thead>
          <tr>
            <th>Fleet</th>
            <th>City</th>
            <th>Status</th>
            <th class="actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngIf="!fleets.length"><td colspan="4" class="empty">No fleets yet.</td></tr>
          <tr *ngFor="let f of fleets">
            <td><strong>{{ f.name }}</strong></td>
            <td>{{ f.city_name || '—' }}</td>
            <td>
              <p-tag
                [value]="f.is_active ? 'active' : 'inactive'"
                [severity]="f.is_active ? 'success' : 'secondary'"
              ></p-tag>
            </td>
            <td class="actions">
              <button
                pButton
                type="button"
                icon="pi pi-pencil"
                class="p-button-text"
                (click)="openEdit(f)"
              ></button>
              <button
                pButton
                type="button"
                icon="pi pi-trash"
                class="p-button-text p-button-danger"
                (click)="remove(f)"
              ></button>
            </td>
          </tr>
        </tbody>
      </table>
    </p-card>
  `,
  styles: [
    `
      .toolbar {
        display: flex;
        gap: 10px;
        align-items: center;
        margin-bottom: 12px;
      }
      .form {
        display: grid;
        grid-template-columns: 240px 1fr auto auto;
        gap: 10px;
        align-items: center;
        padding: 12px;
        background: rgba(59, 130, 246, 0.05);
        border: 1px dashed rgba(59, 130, 246, 0.4);
        border-radius: 8px;
        margin-bottom: 12px;
      }
      .form__city {
        width: 100%;
      }
      .active {
        display: inline-flex;
        gap: 6px;
        align-items: center;
        font-size: 13px;
      }
      .form__actions {
        display: flex;
        gap: 6px;
        justify-content: flex-end;
        grid-column: 1 / -1;
      }
      .t-table {
        width: 100%;
        border-collapse: collapse;
      }
      .t-table th,
      .t-table td {
        text-align: left;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(15, 23, 42, 0.08);
      }
      .t-table th {
        background: rgba(248, 250, 252, 0.7);
        font-weight: 700;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: rgba(15, 23, 42, 0.6);
      }
      .actions {
        white-space: nowrap;
        text-align: right;
      }
      .empty {
        text-align: center;
        color: rgba(15, 23, 42, 0.55);
        padding: 24px !important;
      }
      .error {
        margin-bottom: 10px;
        color: #b00020;
        font-weight: 700;
      }
      .ok {
        margin-bottom: 10px;
        color: #1f8b4c;
        font-weight: 700;
      }
    `,
  ],
})
export class FleetsSettingsComponent implements OnInit {
  cities: City[] = [];
  cityOptions: City[] = [];
  fleets: Fleet[] = [];
  filterCityId: number | null = null;

  adding = false;
  editingId: number | null = null;
  form = { city_id: null as number | null, name: '', is_active: true };

  saving = false;
  error: string | null = null;
  message: string | null = null;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.fetchCities();
    this.fetchFleets();
  }

  private fetchCities(): void {
    this.api.get<{ data: City[] }>('/admin/cities').subscribe({
      next: (res) => {
        this.cityOptions = res?.data || [];
      },
    });
  }

  fetchFleets(): void {
    const q = this.filterCityId ? `?city_id=${this.filterCityId}` : '';
    this.api.get<{ data: Fleet[] }>(`/admin/fleets${q}`).subscribe({
      next: (res) => (this.fleets = res?.data || []),
      error: (err) => (this.error = err?.error?.message || 'Failed to load fleets'),
    });
  }

  openAdd(): void {
    this.adding = true;
    this.editingId = null;
    this.form = { city_id: this.filterCityId, name: '', is_active: true };
    this.error = null;
    this.message = null;
  }

  openEdit(f: Fleet): void {
    this.adding = false;
    this.editingId = f.id;
    this.form = { city_id: f.city_id, name: f.name, is_active: f.is_active };
    this.error = null;
    this.message = null;
  }

  cancel(): void {
    this.adding = false;
    this.editingId = null;
  }

  submit(): void {
    if (!this.form.city_id || !this.form.name.trim() || this.saving) return;
    this.saving = true;
    const payload = {
      city_id: this.form.city_id,
      name: this.form.name.trim(),
      is_active: this.form.is_active,
    };

    const req$ =
      this.editingId !== null
        ? this.api.patch<{ fleet: Fleet }>(`/admin/fleets/${this.editingId}`, payload)
        : this.api.post<{ fleet: Fleet }>('/admin/fleets', payload);

    req$.subscribe({
      next: () => {
        this.message = this.editingId !== null ? 'Fleet updated.' : 'Fleet created.';
        this.adding = false;
        this.editingId = null;
        this.fetchFleets();
      },
      error: (err) => (this.error = err?.error?.message || 'Failed to save fleet'),
      complete: () => (this.saving = false),
    });
  }

  remove(f: Fleet): void {
    if (!window.confirm(`Delete fleet "${f.name}"?`)) return;
    this.api.delete(`/admin/fleets/${f.id}`).subscribe({
      next: () => {
        this.fleets = this.fleets.filter((x) => x.id !== f.id);
        this.message = `Deleted ${f.name}.`;
      },
      error: (err) => (this.error = err?.error?.message || 'Failed to delete fleet'),
    });
  }
}
