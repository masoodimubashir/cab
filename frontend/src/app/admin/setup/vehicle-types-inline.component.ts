import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, IconComponent, StatusPillComponent } from '../../ui';

interface VehicleTypeRow { id: number; name: string; is_active: boolean; }

/**
 * Compact CRUD for the global vehicle_types registry — designed to live
 * inside the Setup Wizard's step-2 drawer. Same endpoint as the standalone
 * Vehicles page uses; no schema drift.
 */
@Component({
  selector: 'app-vehicle-types-inline',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, IconComponent, StatusPillComponent],
  template: `
    <div class="vti">
      <p class="vti__hint">Vehicle types are shared across every city — Sedan, SUV, Auto, Two-wheeler, etc. Add each one once.</p>

      <ul class="list" *ngIf="rows.length; else emptyTpl">
        <li *ngFor="let r of rows">
          <span class="list__name">{{ r.name }}</span>
          <tm-status-pill [tone]="r.is_active ? 'success' : 'neutral'">{{ r.is_active ? 'Active' : 'Off' }}</tm-status-pill>
          <button class="list__edit" (click)="startEdit(r)" aria-label="Edit"><tm-icon name="edit" [size]="14" /></button>
        </li>
      </ul>
      <ng-template #emptyTpl>
        <div class="empty" *ngIf="!loading">No vehicle types yet. Add your first one below.</div>
        <div class="empty" *ngIf="loading">Loading…</div>
      </ng-template>

      <form class="form" (submit)="save($event)">
        <label class="field">
          <span>Vehicle name <i>*</i></span>
          <input type="text" [(ngModel)]="form.name" name="name" placeholder="Auto / Bike / Sedan" required />
        </label>
        <label class="toggle" *ngIf="editingId">
          <input type="checkbox" [(ngModel)]="form.is_active" name="is_active" /> <span>Active</span>
        </label>
        <div class="form__actions">
          <tm-button *ngIf="editingId" variant="ghost" size="sm" (clicked)="reset()">Cancel edit</tm-button>
          <tm-button type="submit" variant="green" size="sm" [disabled]="!form.name.trim() || saving">
            {{ saving ? 'Saving…' : editingId ? 'Save changes' : 'Add vehicle type' }}
          </tm-button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .vti { display: flex; flex-direction: column; gap: 14px; }
    .vti__hint { margin: 0; font-size: 12px; color: var(--tm-text-muted); }
    .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .list li { display: grid; grid-template-columns: 1fr auto auto; gap: 10px; align-items: center; padding: 8px 12px; border: 1px solid var(--tm-line); border-radius: 8px; background: var(--tm-surface); }
    .list__name { font-size: 13px; font-weight: 700; color: var(--tm-text); }
    .list__edit { border: 0; background: transparent; color: var(--tm-text-muted); cursor: pointer; padding: 2px 4px; }
    .list__edit:hover { color: var(--tm-text); }
    .empty { padding: 16px; text-align: center; font-size: 12.5px; color: var(--tm-text-muted); border: 1px dashed var(--tm-line); border-radius: 8px; }
    .form { display: flex; flex-direction: column; gap: 10px; padding-top: 10px; border-top: 1px solid var(--tm-line); }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field span { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .field span i { color: var(--tm-danger, #dc2626); font-style: normal; }
    .field input { padding: 8px 10px; border: 1px solid var(--tm-line); border-radius: 8px; font-size: 13px; background: var(--tm-canvas); color: var(--tm-text); }
    .toggle { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--tm-text); }
    .toggle input { width: 16px; height: 16px; accent-color: var(--tm-green); }
    .form__actions { display: inline-flex; gap: 8px; justify-content: flex-end; }
  `],
})
export class VehicleTypesInlineComponent implements OnInit {
  @Output() changed = new EventEmitter<void>();

  rows: VehicleTypeRow[] = [];
  loading = false;
  saving = false;
  editingId: number | null = null;
  form: { name: string; is_active: boolean } = { name: '', is_active: true };

  constructor(private api: ApiService, private toast: ToastService) {}

  ngOnInit(): void { this.fetch(); }

  fetch(): void {
    this.loading = true;
    this.api.get<{ data: VehicleTypeRow[] }>('/admin/vehicle-types-global').subscribe({
      next: (res) => { this.rows = res.data || []; this.loading = false; },
      error: () => { this.loading = false; this.toast.error('Failed to load vehicle types'); },
    });
  }

  startEdit(r: VehicleTypeRow): void {
    this.editingId = r.id;
    this.form = { name: r.name, is_active: r.is_active };
  }

  reset(): void {
    this.editingId = null;
    this.form = { name: '', is_active: true };
  }

  save(ev: Event): void {
    ev.preventDefault();
    if (!this.form.name.trim() || this.saving) return;
    this.saving = true;
    const payload: { name: string; is_active?: boolean } = { name: this.form.name.trim() };
    if (this.editingId) payload.is_active = this.form.is_active;
    const req = this.editingId
      ? this.api.patch<{ vehicle_type: VehicleTypeRow }>(`/admin/vehicle-types-global/${this.editingId}`, payload)
      : this.api.post<{ vehicle_type: VehicleTypeRow }>('/admin/vehicle-types-global', payload);
    req.subscribe({
      next: () => {
        this.saving = false;
        this.toast.success(this.editingId ? 'Vehicle type updated' : 'Vehicle type added');
        this.reset();
        this.fetch();
        this.changed.emit();
      },
      error: (err) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Failed to save vehicle type');
      },
    });
  }
}
