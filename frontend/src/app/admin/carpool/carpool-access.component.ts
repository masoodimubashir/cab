import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, ModalComponent } from '../../ui';
import { CarpoolHistoryComponent, HistoryEntry } from './carpool-history.component';

interface BanImpact {
  is_driver: boolean;
  upcoming_carpools: number;
  riders_told: number;
  rider_seats: number;
  rider_pending: number;
  history?: HistoryEntry[];
}

/**
 * "Carpool access" row used on the Drivers page, the Customers detail, the Reports drawer and
 * Carpool > People (Carpool.md section 10). Pause states its effect first and needs an internal
 * note; Restore asks for an optional note and does not bring cancelled carpools back. Both are
 * logged, so earlier bans stay visible. Staff without the carpool permission see the status only.
 * Normal Block stays separate.
 */
@Component({
  selector: 'app-carpool-access',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ButtonComponent, ModalComponent, CarpoolHistoryComponent],
  template: `
    <div class="ca">
      <div>
        <div class="ca__label">Carpool access</div>
        <div class="ca__value" [class.is-banned]="banned">{{ banned ? 'Paused' : 'Active' }}</div>
        <div class="ca__reason" *ngIf="banned && reason">{{ reason }}</div>
        <div class="ca__links" *ngIf="canAct">
          <button type="button" class="ca__link" (click)="toggleHistory()">{{ showHistory ? 'Hide access history' : 'Access history' }}</button>
          <a *ngIf="showSummaryLink" class="ca__link" [routerLink]="['/carpool/people']" [queryParams]="{ open: userId }">Carpool summary</a>
        </div>
      </div>
      <ng-container *ngIf="canAct; else readOnly">
        <tm-button *ngIf="!banned" variant="ghost" size="sm" (clicked)="openBan()">Pause carpool access</tm-button>
        <tm-button *ngIf="banned" variant="ghost" size="sm" (clicked)="openRestore()">Restore</tm-button>
      </ng-container>
      <ng-template #readOnly><span class="ca__ro">Changing this needs the Carpool permission.</span></ng-template>
    </div>
    <div class="ca__hist" *ngIf="showHistory">
      <app-carpool-history [entries]="history" empty="Carpool access was never paused." />
    </div>

    <tm-modal [open]="open" title="Pause carpool access" (closed)="open = false">
      <ng-container slot="body">
        <p class="ca__effect" *ngIf="impact">{{ effect() }}</p>
        <label class="ca__check" *ngIf="impact && hasOpen()">
          <input type="checkbox" [(ngModel)]="cancelUpcoming" />
          <span>Also cancel their upcoming carpools and take them off carpools they joined</span>
        </label>
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

    <tm-modal [open]="openR" title="Restore carpool access?" (closed)="openR = false">
      <ng-container slot="body">
        <p class="ca__effect">They can search, join, publish and chat again. Carpools and seats cancelled by the pause don't come back. The earlier pause stays in the access history.</p>
        <label class="ca__field">
          <span>Note (optional)</span>
          <textarea rows="3" maxlength="255" [(ngModel)]="note" placeholder="Why is access restored?"></textarea>
        </label>
      </ng-container>
      <ng-container slot="footer">
        <tm-button variant="ghost" (clicked)="openR = false">Cancel</tm-button>
        <tm-button variant="ink" [loading]="busy" (clicked)="restore()">Restore access</tm-button>
      </ng-container>
    </tm-modal>
  `,
  styles: [`
    .ca { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; flex-wrap: wrap; }
    .ca__label { font-size: 12px; color: var(--tm-text-muted); }
    .ca__value { font-size: 13px; font-weight: 700; color: var(--tm-text); }
    .ca__value.is-banned { color: var(--tm-danger-fg, #b91c1c); }
    .ca__reason { font-size: 12px; color: var(--tm-text-muted); margin-top: 2px; }
    .ca__links { display: flex; gap: 14px; margin-top: 6px; }
    .ca__link { border: 0; background: none; padding: 0; font: inherit; font-size: 12px; font-weight: 600; color: var(--tm-green-deep); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
    .ca__link:focus-visible { outline: 2px solid var(--tm-green-deep); outline-offset: 2px; }
    .ca__ro { font-size: 12px; color: var(--tm-text-muted); }
    .ca__hist { padding: 4px 0 12px; }
    .ca__effect { margin: 0 0 10px; font-size: 13px; color: var(--tm-text); }
    .ca__check { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 12px; font-size: 13px; color: var(--tm-text); cursor: pointer; }
    .ca__check input { margin-top: 3px; }
    .ca__field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600; color: var(--tm-text); }
    .ca__field textarea { font: inherit; font-weight: 400; padding: 8px 10px; border: 1px solid var(--tm-line-2); border-radius: 8px; resize: vertical; color: var(--tm-text); background: var(--tm-surface); }
  `],
})
export class CarpoolAccessComponent {
  /** The person's user id (not the driver id). */
  @Input({ required: true }) userId!: number;
  @Input() banned = false;
  @Input() reason: string | null = null;
  /** Show the "Carpool summary" link (off on the People page itself). */
  @Input() showSummaryLink = true;
  /** Emits the new banned state after a pause or restore. */
  @Output() changed = new EventEmitter<boolean>();

  open = false;
  openR = false;
  /** S10: pausing ends upcoming carpools and seats unless the admin unticks this. */
  cancelUpcoming = true;
  busy = false;
  note = '';
  impact: BanImpact | null = null;
  showHistory = false;
  history: HistoryEntry[] = [];

  constructor(private api: ApiService, private toast: ToastService, private auth: AuthService) {}

  get canAct(): boolean {
    return this.auth.hasPermission('carpool');
  }

  openBan(): void {
    this.note = '';
    this.cancelUpcoming = true;
    this.impact = null;
    this.open = true;
    this.api.get<{ data: BanImpact }>(`/admin/carpool/users/${this.userId}/ban-impact`).subscribe({
      next: (r) => (this.impact = r.data),
      error: () => (this.impact = null),
    });
  }

  openRestore(): void {
    this.note = '';
    this.openR = true;
  }

  toggleHistory(): void {
    this.showHistory = !this.showHistory;
    if (this.showHistory) this.loadHistory();
  }

  private loadHistory(): void {
    this.api.get<{ data: BanImpact }>(`/admin/carpool/users/${this.userId}/ban-impact`).subscribe({
      next: (r) => (this.history = r.data.history ?? []),
      error: () => (this.history = []),
    });
  }

  /** Is there anything open that the pause could end? */
  hasOpen(): boolean {
    const i = this.impact;
    return !!i && (i.upcoming_carpools > 0 || i.rider_seats > 0 || i.rider_pending > 0);
  }

  effect(): string {
    const i = this.impact!;
    const parts: string[] = [];
    if (!this.cancelUpcoming && this.hasOpen()) {
      return 'Their upcoming carpools and seats stay as they are. They can no longer join, publish or chat.';
    }
    if (i.is_driver) {
      parts.push(`${i.upcoming_carpools} upcoming carpools will be cancelled and ${i.riders_told} riders told; carpools on the road are not affected.`);
    }
    if (i.rider_seats || i.rider_pending) {
      parts.push(`Removed from ${i.rider_seats} upcoming carpools; ${i.rider_pending} waiting requests cancelled.`);
    }
    return parts.length ? parts.join(' ') : 'This person has no upcoming carpools.';
  }

  ban(): void {
    this.busy = true;
    this.api.post(`/admin/carpool/users/${this.userId}/ban`, { note: this.note.trim(), cancel_upcoming: this.cancelUpcoming }).subscribe({
      next: () => {
        this.busy = false;
        this.open = false;
        this.banned = true;
        this.reason = this.note.trim();
        this.toast.success('Carpool access paused.');
        this.changed.emit(true);
        if (this.showHistory) this.loadHistory();
      },
      error: (e) => {
        this.busy = false;
        this.toast.error(e?.error?.message || 'Could not pause carpool access.');
      },
    });
  }

  restore(): void {
    this.busy = true;
    this.api.post(`/admin/carpool/users/${this.userId}/restore`, { note: this.note.trim() || null }).subscribe({
      next: () => {
        this.busy = false;
        this.openR = false;
        this.banned = false;
        this.reason = null;
        this.toast.success('Carpool access restored.');
        this.changed.emit(false);
        if (this.showHistory) this.loadHistory();
      },
      error: (e) => {
        this.busy = false;
        this.toast.error(e?.error?.message || 'Could not restore.');
      },
    });
  }
}
