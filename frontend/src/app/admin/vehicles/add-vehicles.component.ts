import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, DrawerComponent } from '../../ui';
import { MasterGroup } from './master-explorer.component';
import { SetupVehicleSet } from './route-group-setup.component';

interface VehicleDraft { key: number; typeId: number | null; typeName: string; name: string; seats: number; bags: number; }
@Component({
  selector: 'app-add-vehicles', standalone: true, imports: [CommonModule, FormsModule, ButtonComponent, DrawerComponent],
  templateUrl: './add-vehicles.component.html', styleUrls: ['./add-vehicles.component.scss'],
})
export class AddVehiclesComponent {
  @Input() cityId!: number;
  @Input() types: { id: number; name: string }[] = [];
  @Input() sets: SetupVehicleSet[] = [];
  @Input() groups: MasterGroup[] = [];
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();
  private nextKey = 1;
  rows: VehicleDraft[] = [this.newRow()];
  groupIds = new Set<number>();
  setId: number | null = null;
  setName = '';
  groupSearch = '';
  saving = false;
  error = '';
  constructor(private api: ApiService, private toast: ToastService) {}
  private newRow(): VehicleDraft { return { key: this.nextKey++, typeId: null, typeName: '', name: '', seats: 4, bags: 0 }; }
  addRow(copy = false): void { if (this.saving || this.rows.length >= 30) return; const row = this.newRow(); if (copy) { const previous = this.rows[this.rows.length - 1]; Object.assign(row, { typeId: previous.typeId, typeName: previous.typeName, seats: previous.seats, bags: previous.bags }); } this.rows.push(row); }
  removeRow(index: number): void { if (!this.saving && this.rows.length > 1) this.rows.splice(index, 1); }
  trackRow(_: number, row: VehicleDraft): number { return row.key; }
  displayName(row: VehicleDraft): string { return row.name.trim() || (row.typeId === -1 ? row.typeName.trim() : this.types.find(type => type.id === row.typeId)?.name ?? ''); }
  get duplicateNames(): boolean { const names = this.rows.map(row => this.displayName(row).toLowerCase()).filter(Boolean); return new Set(names).size !== names.length; }
  get valid(): boolean { return this.rows.every(row => row.typeId !== null && !!this.displayName(row) && (row.typeId !== -1 || !!row.typeName.trim()) && Number.isInteger(row.seats) && row.seats > 0 && row.seats <= 99 && Number.isInteger(row.bags) && row.bags >= 0 && row.bags <= 99) && new Set(this.rows.map(row => this.displayName(row).toLowerCase())).size === this.rows.length; }
  get shownGroups(): MasterGroup[] { const query = this.groupSearch.trim().toLowerCase(); return this.groups.filter(group => group.name.toLowerCase().includes(query)); }
  toggleGroup(id: number): void { if (!this.saving) this.groupIds.has(id) ? this.groupIds.delete(id) : this.groupIds.add(id); }
  close(): void { if (this.saving) return; const dirty = this.rows.some(row => row.typeId !== null || !!row.name.trim() || !!row.typeName.trim() || row.seats !== 4 || row.bags !== 0) || this.groupIds.size > 0 || this.setId !== null || !!this.setName.trim(); if (!dirty || confirm('Discard your unsaved vehicles?')) this.closed.emit(); }
  save(): void {
    if (this.saving || !this.valid) return;
    this.saving = true; this.error = '';
    const body = { vehicles: this.rows.map(row => ({ vehicle_type_id: row.typeId === -1 ? null : row.typeId, vehicle_type_name: row.typeId === -1 ? row.typeName.trim() : null, display_name: this.displayName(row), max_people: row.seats, luggage_capacity: row.bags, is_active: true })), vehicle_set_id: this.setId, set_name: this.setName.trim() || null, route_group_ids: [...this.groupIds] };
    this.api.post(`/admin/cities/${this.cityId}/vehicle-types/batch`, body).subscribe({ next: () => { this.saving = false; this.toast.success(`${this.rows.length} ${this.rows.length === 1 ? 'vehicle added' : 'vehicles added'}`); this.saved.emit(); this.closed.emit(); }, error: err => { this.saving = false; const errors = err?.error?.errors; this.error = errors ? (Object.values(errors).flat()[0] as string) : err?.error?.message || 'Could not save vehicles. Your entries are kept.'; } });
  }
}
