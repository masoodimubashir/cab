import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, ModalComponent } from '../../ui';

export interface CarpoolCar { make: string; model: string; colour: string; plate: string; seats: number }

/**
 * "Edit car" for a carpool driver (Admin-Audit.md C-04). Approved drivers can't change their car in
 * the app ("contact support"), so support does it here. The server checks the plate is not used by
 * any other driver (both types), keeps seats at or above seats already taken, tells riders of upcoming
 * carpools when the plate changes, and logs the change with the reason.
 */
@Component({
  selector: 'app-carpool-car-edit',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, ModalComponent],
  template: `
    <tm-modal [open]="open" title="Edit car" (closed)="closed.emit()">
      <ng-container slot="body">
        <p class="lead">Riders see these details at pickup. If the number plate changes, riders on upcoming carpools are told.</p>
        <div class="grid">
          <label class="f"><span>Make</span><input [(ngModel)]="form.make" maxlength="60" autocomplete="off" /></label>
          <label class="f"><span>Model</span><input [(ngModel)]="form.model" maxlength="60" autocomplete="off" /></label>
          <label class="f"><span>Colour</span><input [(ngModel)]="form.colour" maxlength="40" autocomplete="off" /></label>
          <label class="f"><span>Number plate</span><input [(ngModel)]="form.plate" maxlength="20" autocomplete="off" class="plate" /></label>
          <label class="f"><span>Seats for riders</span><input type="number" min="1" max="8" [(ngModel)]="form.seats" /></label>
        </div>
        <label class="f f--wide"><span>Reason, kept in the history</span><textarea rows="2" maxlength="500" [(ngModel)]="note" placeholder="For example: driver sent the new RC by WhatsApp"></textarea></label>
        <p class="err" *ngIf="error" role="alert">{{ error }}</p>
      </ng-container>
      <ng-container slot="footer">
        <tm-button variant="ghost" (clicked)="closed.emit()">Cancel</tm-button>
        <tm-button variant="ink" [loading]="busy" [disabled]="!valid()" (clicked)="save()">Save car</tm-button>
      </ng-container>
    </tm-modal>
  `,
  styles: [`
    .lead { margin: 0 0 14px; font-size: 13px; color: var(--tm-text-muted); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
    .f { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600; color: var(--tm-text); }
    .f input, .f textarea { font: inherit; font-weight: 400; padding: 9px 12px; border: 1px solid var(--tm-line-2); border-radius: 8px; background: var(--tm-surface); color: var(--tm-text); }
    .f input:focus-visible, .f textarea:focus-visible { outline: 2px solid var(--tm-green-deep); outline-offset: 0; border-color: transparent; }
    .f .plate { text-transform: uppercase; letter-spacing: 0.04em; }
    .f--wide { grid-column: 1 / -1; }
    .err { margin: 10px 0 0; color: var(--tm-danger); font-size: 13px; }
  `],
})
export class CarpoolCarEditComponent implements OnChanges {
  @Input() open = false;
  @Input({ required: true }) driverId!: number;
  @Input() car: CarpoolCar | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<CarpoolCar>();

  form: CarpoolCar = { make: '', model: '', colour: '', plate: '', seats: 4 };
  note = '';
  busy = false;
  error = '';

  constructor(private api: ApiService, private toast: ToastService) {}

  ngOnChanges(): void {
    if (this.open) {
      this.form = this.car ? { ...this.car } : { make: '', model: '', colour: '', plate: '', seats: 4 };
      this.note = '';
      this.error = '';
    }
  }

  valid(): boolean {
    const f = this.form;
    return !!(f.make?.trim() && f.model?.trim() && f.colour?.trim() && f.plate?.replace(/[^A-Za-z0-9]/g, '').length >= 4
      && f.seats >= 1 && f.seats <= 8 && this.note.trim().length >= 3);
  }

  save(): void {
    this.busy = true;
    this.error = '';
    this.api.patch<{ data: CarpoolCar }>(`/admin/carpool/drivers/${this.driverId}/car`, { ...this.form, note: this.note.trim() }).subscribe({
      next: (r) => { this.busy = false; this.toast.success('Car saved.'); this.saved.emit(r.data); },
      error: (e) => {
        this.busy = false;
        const errs = e?.error?.errors;
        this.error = (errs && (Object.values(errs)[0] as string[])?.[0]) || e?.error?.message || 'Could not save the car.';
      },
    });
  }
}
