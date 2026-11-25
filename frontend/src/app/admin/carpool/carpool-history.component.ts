import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { inTime } from './carpool-admin.styles';

export interface HistoryEntry {
  id: number;
  at: string | null;
  admin: string;
  action: string;
  label: string;
  note: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/** "History": what admins did, newest first, from the carpool admin log. */
@Component({
  selector: 'app-carpool-history',
  standalone: true,
  imports: [CommonModule],
  template: `
    <p class="none" *ngIf="!entries?.length">{{ empty }}</p>
    <ol class="hist" *ngIf="entries?.length">
      <li *ngFor="let e of entries">
        <div class="hist__line"><b>{{ e.label }}</b><span> by {{ e.admin }}</span></div>
        <time>{{ when(e.at) }}</time>
        <p class="hist__note" *ngIf="e.note">“{{ e.note }}”</p>
        <p class="hist__change" *ngIf="change(e) as c">{{ c }}</p>
      </li>
    </ol>
  `,
  styles: [`
    :host { display: block; }
    .none { margin: 0; color: var(--tm-text-muted); font-size: 13px; }
    .hist { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
    .hist li { padding-left: 12px; border-left: 2px solid var(--tm-line-2); font-size: 13px; color: var(--tm-text); }
    .hist__line span { color: var(--tm-text-muted); }
    time { display: block; color: var(--tm-text-muted); font-size: 12px; margin-top: 1px; }
    .hist__note { margin: 4px 0 0; color: var(--tm-text); }
    .hist__change { margin: 4px 0 0; color: var(--tm-text-muted); font-size: 12px; overflow-wrap: anywhere; }
  `],
})
export class CarpoolHistoryComponent {
  @Input() entries: HistoryEntry[] | null = [];
  @Input() empty = 'No admin actions yet.';

  when(at: string | null): string {
    return inTime(at, true);
  }

  /** A short "from → to" line for edits that carry before/after values. */
  change(e: HistoryEntry): string | null {
    if (!e.before || !e.after || e.action === 'ban') return null;
    const keys = Object.keys(e.after).filter((k) => k !== 'plan_ids' && k in (e.before as object));
    if (!keys.length) return null;
    return keys.map((k) => `${k.replace(/_/g, ' ')}: ${this.v((e.before as Record<string, unknown>)[k])} → ${this.v((e.after as Record<string, unknown>)[k])}`).join('; ');
  }

  private v(x: unknown): string {
    if (x === null || x === undefined || x === '') return '—';
    if (typeof x === 'boolean') return x ? 'on' : 'off';
    return String(x).replace(/_/g, ' ');
  }
}
