import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, ModalComponent } from '../../ui';

interface BanImpact {
  is_driver: boolean;
  upcoming_carpools: number;
  riders_told: number;
  rider_seats: number;
  rider_pending: number;
}

/**
 * "Carpool access" row used on the Drivers drawer, the Customers detail and
 * the Reports drawer (Carpool.md section 10). Pause states its effect first and
 * needs an internal note; Restore does not bring cancelled carpools back.
 * Normal Block stays separate.
 */
@Component({
  selector: 'app-carpool-access',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, ModalComponent],
  template: `
    <div class="ca">
      <div>
        <div class="ca__label">Carpool access</div>
        <div class="ca__value" [class.is-banned]="banned">{{ banned ? 'Banned' : 'Active' }}</div>
        <div class="ca__reason" *ngIf="banned && reason">{{ reason }}</div>
      </div>
      <tm-button *ngIf="!banned" variant="ghost" size="sm" (clicked)="openBan()">Pause carpool access</tm-button>
      <tm-button *ngIf="banned" variant="ghost" size="sm" [loading]="busy" (clicked)="restore()">Restore</tm-button>
    </div>

    <tm-modal [open]="open" title="Pause carpool access" (closed)="open = false">
      <ng-container slot="body">
        <p class="ca__effect" *ngIf="impact">{{ effect() }}</p>
        <p class="ca__effect">Normal rides are not affected. Restoring later does not bring back cancelled carpools or seats.</p>
        <label class="ca__field">
          <span>Internal note</span>
          <textarea rows="3" maxlength="255" [(ngModel)]="note" placeholder="Why is access paused?"></textarea>
        </label>
      </ng-container>
      <ng-container slot="footer">
        <tm-button variant="ghost" (clicked)="open = false">Cancel</tm-button>
        <tm-button variant="danger" [loading]="busy" [disabled]="note.trim().length < 3" (clicked)="ban()">Pause access</tm-button>
      </ng-container>
    </tm-modal>
  `,
  styles: [`
    .ca { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; flex-wrap: wrap; }
    .ca__label { font-size: 12px; color: var(--tm-text-muted); }
    .ca__value { font-size: 13px; font-weight: 700; color: var(--tm-text); }
    .ca__value.is-banned { color: var(--tm-danger-fg, #b91c1c); }
    .ca__reason { font-size: 12px; color: var(--tm-text-muted); margin-top: 2px; }
    .ca__effect { margin: 0 0 10px; font-size: 13px; color: var(--tm-text); }
    .ca__field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600; color: var(--tm-text); }
    .ca__field textarea { font: inherit; padding: 8px 10px; border: 1px solid var(--tm-line-2); border-radius: 8px; resize: vertical; color: var(--tm-text); background: var(--tm-surface); }
  `],
})
export class CarpoolAccessComponent {
  /** The person's user id (not the driver id). */
  @Input({ required: true }) userId!: number;
  @Input() banned = false;
  @Input() reason: string | null = null;
  /** Emits the new banned state after a ban or restore. */
  @Output() changed = new EventEmitter<boolean>();

  open = false;
  busy = false;
  note = '';
  impact: BanImpact | null = null;

  constructor(private api: ApiService, private toast: ToastService) {}

  openBan(): void {
    this.note = '';
    this.impact = null;
    this.open = true;
    this.api.get<{ data: BanImpact }>(`/admin/carpool/users/${this.userId}/ban-impact`).subscribe({
      next: (r) => (this.impact = r.data),
      error: () => (this.impact = null),
    });
  }

  effect(): string {
    const i = this.impact!;
    const parts: string[] = [];
    if (i.is_driver) {
      parts.push(`${i.upcoming_carpools} upcoming carpools will be cancelled and ${i.riders_told} riders told; carpools in progress are not affected.`);
    }
    if (i.rider_seats || i.rider_pending) {
      parts.push(`Removed from ${i.rider_seats} upcoming carpools; ${i.rider_pending} waiting requests cancelled.`);
    }
    return parts.length ? parts.join(' ') : 'This person has no upcoming carpools.';
  }

  ban(): void {
    this.busy = true;
    this.api.post(`/admin/carpool/users/${this.userId}/ban`, { note: this.note.trim() }).subscribe({
      next: () => {
        this.busy = false;
        this.open = false;
        this.banned = true;
        this.reason = this.note.trim();
        this.toast.success('Carpool access paused.');
        this.changed.emit(true);
      },
      error: (e) => {
        this.busy = false;
        this.toast.error(e?.error?.message || 'Could not pause carpool access.');
      },
    });
  }

  restore(): void {
    this.busy = true;
    this.api.post(`/admin/carpool/users/${this.userId}/restore`, {}).subscribe({
      next: () => {
        this.busy = false;
        this.banned = false;
        this.reason = null;
        this.toast.success('Carpool access restored.');
        this.changed.emit(false);
      },
      error: (e) => {
        this.busy = false;
        this.toast.error(e?.error?.message || 'Could not restore.');
      },
    });
  }
}
