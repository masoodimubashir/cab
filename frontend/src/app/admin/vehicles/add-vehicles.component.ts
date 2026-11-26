import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, DrawerComponent, IconComponent } from '../../ui';

import { SelectComponent, SelectOption } from '../../ui/select/select.component';

interface VehicleDraft { key: number; typeId: number | null; typeName: string; name: string; seats: number; bags: number; }
@Component({
  selector: 'app-add-vehicles', standalone: true, imports: [CommonModule, FormsModule, ButtonComponent, DrawerComponent, IconComponent, SelectComponent],
  templateUrl: './add-vehicles.component.html', styleUrls: ['./add-vehicles.component.scss'],
})
export class AddVehiclesComponent {
  @Input() cityId!: number;
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
  constructor(private api: ApiService, private toast: ToastService) {}
  private newRow(): VehicleDraft { return { key: this.nextKey++, typeId: null, typeName: '', name: '', seats: 4, bags: 0 }; }
  addRow(copy = false): void { if (this.saving || this.rows.length >= 30) return; const row = this.newRow(); if (copy) { const previous = this.rows[this.rows.length - 1]; Object.assign(row, { typeId: previous.typeId, typeName: previous.typeName, seats: previous.seats, bags: previous.bags }); } this.rows.push(row); }
  focusTypeControl(control: HTMLElement): void {
    requestAnimationFrame(() => control.focus());
  }
  removeRow(index: number): void { if (!this.saving && this.rows.length > 1) this.rows.splice(index, 1); }
  trackRow(_: number, row: VehicleDraft): number { return row.key; }
  displayName(row: VehicleDraft): string { return row.name.trim() || (row.typeId === -1 ? row.typeName.trim() : this.typeOptions.find(type => type.value === row.typeId)?.label ?? ''); }
  get duplicateNames(): boolean { const names = this.rows.map(row => this.displayName(row).toLowerCase()).filter(Boolean); return new Set(names).size !== names.length; }
  get valid(): boolean { return this.rows.every(row => row.typeId !== null && !!this.displayName(row) && (row.typeId !== -1 || !!row.typeName.trim()) && Number.isInteger(row.seats) && row.seats > 0 && row.seats <= 99 && Number.isInteger(row.bags) && row.bags >= 0 && row.bags <= 99) && new Set(this.rows.map(row => this.displayName(row).toLowerCase())).size === this.rows.length; }
  close(): void { if (this.saving) return; const dirty = this.rows.some(row => row.typeId !== null || !!row.name.trim() || !!row.typeName.trim() || row.seats !== 4 || row.bags !== 0); if (!dirty || confirm('Discard your unsaved vehicles?')) this.closed.emit(); }
  save(): void {
    if (this.saving || !this.valid) return;
    this.saving = true; this.error = '';
    const body = { vehicles: this.rows.map(row => ({ vehicle_type_id: row.typeId === -1 ? null : row.typeId, vehicle_type_name: row.typeId === -1 ? row.typeName.trim() : null, display_name: this.displayName(row), max_people: row.seats, luggage_capacity: row.bags, is_active: true })), route_group_ids: [] };
    this.api.post(`/admin/cities/${this.cityId}/vehicle-types/batch`, body).subscribe({ next: () => { this.saving = false; this.toast.success(`${this.rows.length} ${this.rows.length === 1 ? 'vehicle added' : 'vehicles added'}`); this.saved.emit(); this.closed.emit(); }, error: err => { this.saving = false; const errors = err?.error?.errors; this.error = errors ? (Object.values(errors).flat()[0] as string) : err?.error?.message || 'Could not save vehicles. Your entries are kept.'; } });
  }
}
