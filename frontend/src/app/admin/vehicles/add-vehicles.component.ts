import { Component, EventEmitter, Input, OnDestroy, Output } from '@angular/core';
import { catchError, firstValueFrom, throwError } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, DrawerComponent, IconComponent } from '../../ui';

import { SelectComponent, SelectOption } from '../../ui/select/select.component';
import { CityOption } from '../../core/city-context.service';
import { VehicleCitiesComponent } from './vehicle-cities.component';

interface VehicleDraft { key: number; typeId: number | null; typeName: string; name: string; seats: number; bags: number; photo?: File; preview?: string; }
export interface AddedVehicle { id: number; display_name: string; vehicle_type_name?: string | null; max_people: number; }
@Component({
  selector: 'app-add-vehicles', standalone: true, imports: [CommonModule, FormsModule, ButtonComponent, DrawerComponent, IconComponent, SelectComponent, VehicleCitiesComponent],
  templateUrl: './add-vehicles.component.html', styleUrls: ['./add-vehicles.component.scss'],
})
export class AddVehiclesComponent implements OnDestroy {
  @Input() cityId!: number;
  @Input() cityName = '';
  @Input() cities: CityOption[] = [];
  extraCityIds: number[] = [];
  typeOptions: SelectOption<number>[] = [];
  @Input() set types(types: { id: number; name: string }[]) {
    this.typeOptions = [
      { value: -1, label: '+ Create new type' },
      ...types.map(type => ({ value: type.id, label: type.name })),
    ];
  }
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();
  private nextKey = 1;
  rows: VehicleDraft[] = [this.newRow()];
  saving = false;
  error = '';
  created: AddedVehicle[] | null = null;
  private needsCityCopy = false;
  constructor(private api: ApiService, private toast: ToastService, public auth: AuthService) {}
  choosePhoto(row: VehicleDraft, input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.saving) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'].includes(file.type) || file.size > 4 * 1024 * 1024) {
      this.toast.error('Choose a JPG, PNG, WebP, GIF or SVG image up to 4 MB.');
      return;
    }
    this.clearPhoto(row);
    row.photo = file;
    row.preview = URL.createObjectURL(file);
  }
  clearPhoto(row: VehicleDraft): void {
    if (row.preview) URL.revokeObjectURL(row.preview);
    delete row.preview;
    delete row.photo;
  }
  ngOnDestroy(): void {
    for (const row of this.rows) {
      if (row.preview) URL.revokeObjectURL(row.preview);
      delete row.preview;
    }
  }
  private newRow(): VehicleDraft { return { key: this.nextKey++, typeId: null, typeName: '', name: '', seats: 4, bags: 0 }; }
  availableTypes(row: VehicleDraft): SelectOption<number>[] {
    const taken = new Set(this.rows.filter(other => other !== row).map(other => other.typeId));
    return this.typeOptions.filter(type => type.value === -1 || !taken.has(type.value));
  }
  addRow(copy = false): void {
    if (this.saving || this.rows.length >= 30) return;
    const row = this.newRow();
    if (copy) {
      const previous = this.rows[this.rows.length - 1];
      row.seats = previous.seats;
      row.bags = previous.bags;
    }
    this.rows.push(row);
  }
  focusTypeControl(control: HTMLElement): void {
    requestAnimationFrame(() => control.focus());
  }
  removeRow(index: number): void {
    if (this.saving || this.created || this.rows.length <= 1) return;
    this.clearPhoto(this.rows[index]);
    this.rows.splice(index, 1);
  }
  trackRow(_: number, row: VehicleDraft): number { return row.key; }
  displayName(row: VehicleDraft): string { return row.name.trim() || (row.typeId === -1 ? row.typeName.trim() : this.typeOptions.find(type => type.value === row.typeId)?.label ?? ''); }
  get duplicateNames(): boolean { const names = this.rows.map(row => this.displayName(row).toLowerCase()).filter(Boolean); return new Set(names).size !== names.length; }
  get valid(): boolean { return this.rows.every(row => row.typeId !== null && !!this.displayName(row) && (row.typeId !== -1 || !!row.typeName.trim()) && Number.isInteger(row.seats) && row.seats > 0 && row.seats <= 99 && Number.isInteger(row.bags) && row.bags >= 0 && row.bags <= 99) && new Set(this.rows.map(row => this.displayName(row).toLowerCase())).size === this.rows.length; }
  close(): void { if (this.saving) return; const dirty = this.rows.some(row => row.photo || row.typeId !== null || !!row.name.trim() || !!row.typeName.trim() || row.seats !== 4 || row.bags !== 0); if (this.created || !dirty || confirm('Discard your unsaved vehicles?')) this.closed.emit(); }
  save(): void {
    if (this.saving || !this.valid) return;
    this.saving = true; this.error = '';
    if (this.created) { void this.finishSave(this.created); return; }
    this.needsCityCopy = false;
    const body = { vehicles: this.rows.map(row => ({ vehicle_type_id: row.typeId === -1 ? null : row.typeId, vehicle_type_name: row.typeId === -1 ? row.typeName.trim() : null, display_name: this.displayName(row), max_people: row.seats, luggage_capacity: row.bags, is_active: true })), route_group_ids: [] };
    const action = this.extraCityIds.length ? 'batch-in-cities' : 'batch';
    const url = `/admin/cities/${this.cityId}/vehicle-types`;
    this.api.post<{ data: AddedVehicle[] }>(`${url}/${action}`, { ...body, target_city_ids: this.extraCityIds }).pipe(
      catchError(err => {
        if (!this.extraCityIds.length || ![404, 405].includes(err.status)) return throwError(() => err);
        this.needsCityCopy = true;
        return this.api.post<{ data: AddedVehicle[] }>(`${url}/batch`, body);
      }),
    ).subscribe({
      next: res => {
        this.created = res.data;
        void this.finishSave(res.data);
      },
      error: err => {
        this.saving = false;
        const errors = err?.error?.errors;
        this.error = errors ? (Object.values(errors).flat()[0] as string) : err?.error?.message || 'Could not save vehicles. Your entries are kept.';
      },
    });
  }

  private async finishSave(vehicles: AddedVehicle[]): Promise<void> {
    if (this.needsCityCopy) {
      try {
        await firstValueFrom(this.api.post(`/admin/cities/${this.cityId}/vehicle-types/copy-to-city`, {
          vehicle_ids: vehicles.map(vehicle => vehicle.id), target_city_ids: this.extraCityIds,
          copy_pricing: true, copy_seat_layouts: true, overwrite_existing: false,
        }));
        this.needsCityCopy = false;
      } catch {
        this.error = `Vehicles saved in ${this.cityName}. Retry to finish adding them to the other cities.`;
        this.saving = false;
        this.saved.emit();
        return;
      }
    }
    for (const [index, row] of this.rows.entries()) {
      if (!row.photo) continue;
      const name = vehicles[index].display_name;
      const body = new FormData();
      body.append('display_name', name);
      body.append('key', 'booking_card');
      body.append('image', row.photo);
      try {
        await firstValueFrom(this.api.postMultipart('/admin/app-assets', body));
        this.clearPhoto(row);
      } catch {
        this.saving = false;
        this.error = `Vehicles saved. The photo for ${name} could not be uploaded. Retry or choose a different image.`;
        this.saved.emit();
        return;
      }
    }
    this.saving = false;
    const names = [this.cityName, ...this.cities.filter(city => this.extraCityIds.includes(city.id)).map(city => city.name)];
    this.toast.success(`Vehicles saved in ${names.join(', ')}.`);
    this.saved.emit();
    this.closed.emit();
  }
}
