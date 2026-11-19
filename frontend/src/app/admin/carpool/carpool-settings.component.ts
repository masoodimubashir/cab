import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, ModalComponent } from '../../ui';
import { CARPOOL_ADMIN_STYLES } from './carpool-admin.styles';

interface Word { id: number; word: string; active: boolean }
interface Settings {
  enabled: boolean;
  search_distance_km: number;
  auto_complete_hours: number;
  chat_retention_days: number;
  upcoming_carpools: number;
  kill_switch: boolean;
  banned_words: Word[];
}

/** Carpool > Settings: the four editable values and the banned words (Carpool.md section 10). */
@Component({
  selector: 'app-carpool-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, ModalComponent],
  template: `
    <div class="page" *ngIf="s">
      <header>
        <h1 class="page__title">Carpool settings</h1>
        <p class="page__sub">Other carpool rules are fixed in the app.</p>
      </header>

      <p class="warn" *ngIf="s.kill_switch">The emergency kill switch is ON in the server settings. Carpool is stopped completely, whatever is chosen here.</p>

      <section class="card">
        <div class="row">
          <div>
            <b>Carpool enabled</b>
            <p>Off hides the customer tile and stops new carpools and requests. Carpools already running, their chats and jobs continue.</p>
          </div>
          <label class="switch"><input type="checkbox" [checked]="s.enabled" (change)="toggle($event)" /><span></span></label>
        </div>
        <div class="row">
          <div><b>Search distance</b><p>How far from a rider's pickup a carpool's route may pass (1 to 10 km).</p></div>
          <span class="value"><input class="num" type="number" min="1" max="10" aria-label="Search distance in kilometres" [(ngModel)]="s.search_distance_km" /><span class="unit">km</span></span>
        </div>
        <div class="row">
          <div><b>Auto-complete after</b><p>A started carpool nobody completes closes itself after this long (1 to 48 hours).</p></div>
          <span class="value"><input class="num" type="number" min="1" max="48" aria-label="Auto-complete after, in hours" [(ngModel)]="s.auto_complete_hours" /><span class="unit">hours</span></span>
        </div>
        <div class="row">
          <div><b>Chat retention</b><p>Chats of finished carpools are deleted after this many days (1 to 30).</p></div>
          <span class="value"><input class="num" type="number" min="1" max="30" aria-label="Chat retention in days" [(ngModel)]="s.chat_retention_days" /><span class="unit">days</span></span>
        </div>
        <div class="actions"><tm-button variant="ink" [loading]="busy" (clicked)="save()">Save changes</tm-button></div>
      </section>

      <section class="card card--words">
        <b>Banned words</b>
        <p class="hint">Whole words, any capitals. Applies to new messages only and shows as dots in chat.</p>
        <form class="add" (ngSubmit)="addWord()">
          <input type="text" name="word" [(ngModel)]="word" placeholder="Add a banned word" aria-label="Banned word" maxlength="60" />
          <tm-button type="submit" variant="ink" size="sm" [disabled]="word.trim().length < 2">Add</tm-button>
        </form>
        <p class="hint" *ngIf="!s.banned_words.length">No banned words yet. Add one above.</p>
        <ul class="words">
          <li *ngFor="let w of s.banned_words" [class.is-off]="!w.active">
            <span>{{ w.word }}</span>
            <label class="mini"><input type="checkbox" [checked]="w.active" (change)="setActive(w, $event)" /> On</label>
            <button type="button" class="x" (click)="removeWord(w)" aria-label="Remove">×</button>
          </li>
        </ul>
      </section>
    </div>

    <tm-modal [open]="askOff" title="Turn carpool off?" (closed)="askOff = false">
      <ng-container slot="body">
        <p>New carpools and requests stop and the customer tile disappears. {{ s?.upcoming_carpools }} upcoming carpools stay on and keep running, with their chats and jobs.</p>
      </ng-container>
      <ng-container slot="footer">
        <tm-button variant="ghost" (clicked)="askOff = false">Keep on</tm-button>
        <tm-button variant="danger" [loading]="busy" (clicked)="turnOff()">Turn off</tm-button>
      </ng-container>
    </tm-modal>
  `,
  styles: [CARPOOL_ADMIN_STYLES, `
    .page { max-width: 720px; }
    .warn { background: var(--tm-danger-bg, #fee2e2); color: var(--tm-danger-fg, #b91c1c); padding: 10px 14px; border-radius: var(--tm-radius-md); font-size: 13px; margin: 0; }
    .card { background: var(--tm-surface); border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-md); padding: 4px 20px; }
    .card--words { padding: 16px 20px 20px; }
    .row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 4px 24px; padding: 16px 0; border-bottom: 1px solid var(--tm-line-2); }
    .row:last-of-type { border-bottom: 0; }
    .row b, .card--words > b { font-size: 14px; color: var(--tm-text); }
    .row p, .hint { margin: 2px 0 0; font-size: 13px; color: var(--tm-text-muted); max-width: 52ch; }
    .value { display: inline-flex; align-items: center; gap: 8px; }
    .num { width: 72px; padding: 8px 10px; border: 1px solid var(--tm-line-2); border-radius: 8px; font: inherit; font-variant-numeric: tabular-nums; text-align: right; color: var(--tm-text); background: var(--tm-surface); }
    .num:focus-visible, .add input:focus-visible { outline: 2px solid var(--tm-green-deep); border-color: transparent; }
    .unit { font-size: 13px; color: var(--tm-text-muted); min-width: 40px; }
    .actions { display: flex; justify-content: flex-end; padding: 12px 0 16px; border-top: 1px solid var(--tm-line-2); }
    .switch { display: inline-flex; }
    .switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
    .switch span { display: inline-block; width: 42px; height: 24px; border-radius: 999px; background: var(--tm-line-2); position: relative; cursor: pointer; transition: background .15s; }
    .switch span::after { content: ''; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform .15s; }
    .switch input:checked + span { background: var(--tm-green-deep); }
    .switch input:checked + span::after { transform: translateX(18px); }
    .switch input:focus-visible + span { outline: 2px solid var(--tm-green-deep); outline-offset: 2px; }
    .add { display: flex; gap: 8px; margin: 12px 0; }
    .add input { flex: 1; min-width: 0; padding: 8px 12px; border: 1px solid var(--tm-line-2); border-radius: 8px; font: inherit; color: var(--tm-text); background: var(--tm-surface); }
    .words { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
    .words li { display: inline-flex; align-items: center; gap: 8px; padding: 4px 6px 4px 12px; border: 1px solid var(--tm-line-2); border-radius: 999px; font-size: 13px; color: var(--tm-text); }
    .words li.is-off span { text-decoration: line-through; color: var(--tm-text-muted); }
    .mini { font-size: 12px; color: var(--tm-text-muted); display: inline-flex; align-items: center; gap: 4px; }
    .x { border: 0; background: var(--tm-canvas-2); border-radius: 50%; width: 22px; height: 22px; cursor: pointer; color: var(--tm-text-muted); }
    .x:hover { color: var(--tm-text); }
    @media (max-width: 640px) { .row { grid-template-columns: 1fr; } .card { padding: 4px 16px; } }
  `],
})
export class CarpoolSettingsComponent implements OnInit {
  s: Settings | null = null;
  word = '';
  busy = false;
  askOff = false;

  constructor(private api: ApiService, private toast: ToastService) {}

  ngOnInit(): void {
    this.api.get<{ data: Settings }>('/admin/carpool/settings').subscribe({
      next: (r) => (this.s = r.data),
      error: (e) => this.toast.error(e?.error?.message || 'Could not load settings.'),
    });
  }

  toggle(ev: Event): void {
    const on = (ev.target as HTMLInputElement).checked;
    if (!on) {
      (ev.target as HTMLInputElement).checked = true; // stays on until confirmed
      this.askOff = true;
      return;
    }
    this.patch({ enabled: true }, 'Carpool turned on.');
  }

  turnOff(): void {
    this.patch({ enabled: false }, 'Carpool turned off.', () => (this.askOff = false));
  }

  save(): void {
    const s = this.s!;
    this.patch({
      search_distance_km: s.search_distance_km, auto_complete_hours: s.auto_complete_hours, chat_retention_days: s.chat_retention_days,
    }, 'Settings saved.');
  }

  private patch(body: object, ok: string, done?: () => void): void {
    this.busy = true;
    this.api.patch<{ data: Settings }>('/admin/carpool/settings', body).subscribe({
      next: (r) => { this.busy = false; this.s = r.data; this.toast.success(ok); done?.(); },
      error: (e) => {
        this.busy = false;
        const first = e?.error?.errors ? (Object.values(e.error.errors)[0] as string[])[0] : null;
        this.toast.error(first || e?.error?.message || 'Could not save.');
      },
    });
  }

  addWord(): void {
    this.api.post<{ data: Word }>('/admin/carpool/banned-words', { word: this.word }).subscribe({
      next: (r) => {
        if (this.s && !this.s.banned_words.some((w) => w.id === r.data.id)) {
          this.s.banned_words = [...this.s.banned_words, r.data].sort((a, b) => a.word.localeCompare(b.word));
        }
        this.word = '';
      },
      error: (e) => this.toast.error(e?.error?.message || 'Could not add.'),
    });
  }

  setActive(w: Word, ev: Event): void {
    const active = (ev.target as HTMLInputElement).checked;
    this.api.patch(`/admin/carpool/banned-words/${w.id}`, { active }).subscribe({
      next: () => (w.active = active),
      error: (e) => this.toast.error(e?.error?.message || 'Could not change.'),
    });
  }

  removeWord(w: Word): void {
    this.api.delete(`/admin/carpool/banned-words/${w.id}`).subscribe({
      next: () => { if (this.s) this.s.banned_words = this.s.banned_words.filter((x) => x.id !== w.id); },
      error: (e) => this.toast.error(e?.error?.message || 'Could not remove.'),
    });
  }
}
