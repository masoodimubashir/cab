import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, ModalComponent } from '../../ui';
import { CARPOOL_ADMIN_STYLES, inTime } from './carpool-admin.styles';
import { CarpoolHistoryComponent, HistoryEntry } from './carpool-history.component';

interface Word { id: number; word: string; active: boolean }
interface BulkResult { added: Word[]; already_there: number; skipped: string[]; skipped_count: number; over_limit: number; total: number; max: number }

/** The same rules the server uses to read a pasted list: split on commas, semicolons and new lines. */
export function parseWords(text: string): string[] {
  const seen = new Set<string>();
  for (const part of (text || '').split(/[\r\n,;]+/)) {
    const w = part.replace(/\s+/g, ' ').trim().toLowerCase();
    if (w.length >= 2 && w.length <= 60) seen.add(w);
  }
  return [...seen];
}
interface Limit { min: number; max: number; default: number | null; unit: string; nullable: boolean }

/** The values an admin edits. Names are the API's names (search distance is in km). */
interface Values {
  search_distance_km: number;
  publish_horizon_days: number;
  start_early_minutes: number;
  pending_expire_minutes: number;
  auto_complete_hours: number;
  missed_departure_days: number;
  plan_grace_days: number;
  chat_retention_days: number;
  plan_warning_days: number;
  report_retention_days: number;
}
type Key = keyof Values;

interface Job { job: string; label: string; finished_at: string | null; error: string | null; late: boolean }

interface Reason { id: number; key: string; label: string; applies_to: 'person' | 'message' | 'both'; active: boolean; reports: number }

interface Settings extends Values {
  version: string;
  enabled: boolean;
  limits: Record<Key, Limit>;
  upcoming_carpools: number;
  carpools_on_the_road: number;
  waiting_requests: number;
  kill_switch: boolean;
  banned_words: Word[];
  banned_words_max: number;
  report_reasons?: Reason[];
  /** False for staff without the carpool_settings permission: the page is read only. */
  can_edit: boolean;
  jobs: Job[];
  history: HistoryEntry[];
}

interface Row { key: Key; label: string; help: string }

/** The info icon texts: very simple words for an operator, each starting "This setting", with an example. Shown on hover or keyboard focus. */
const TIPS: Record<Key | 'enabled' | 'banned_words', string> = {
  enabled: "This setting turns carpool on or off for everyone. When it is off, nobody can make a new carpool or ask to join. Rides that are already running keep going.",
  search_distance_km: "This setting decides how far from the rider's pickup point we look for carpools. Example: 2 km means a rider sees carpools that pass within 2 km of where they will wait.",
  publish_horizon_days: "This setting decides how many days ahead a driver can publish a carpool and a rider can search. Example: 30 days means up to 30 days from today.",
  start_early_minutes: "This setting decides how early the driver can press Start ride. Example: 60 minutes means a 9:00 carpool can be started from 8:00.",
  pending_expire_minutes: "This setting decides when a join request closes if the driver did not answer and the car has already left. Example: 15 minutes after the planned pickup time.",
  auto_complete_hours: "This setting decides when a ride that was started but never finished is closed by itself, after this many hours.",
  missed_departure_days: "This setting decides when a carpool is cancelled if the driver never pressed Start ride. End of the departure day: cancelled just after midnight that night. End of the next day: the driver gets one more day. Riders are told when it is cancelled.",
  plan_grace_days: "This setting decides how many extra days a driver's carpools keep running after their plan ends. Example: with 1 day, a plan that ends on Friday still runs Saturday's carpools. Later ones are cancelled.",
  chat_retention_days: "This setting decides how long a chat is kept after its carpool is finished. After this many days the messages are deleted.",
  plan_warning_days: "This setting decides how many days before a plan ends the driver app starts showing \"Your plan ends soon\". Example: 3 days means a plan ending on Friday shows the warning from Tuesday.",
  report_retention_days: "This setting decides how long a closed report keeps the reported message and its details. After this many days the text is cleared; the report, who reported whom and the outcome stay.",
  banned_words: "This list helps you block bad words in chat. Paste many at once, separated by commas or new lines. A message with one of these words shows dots instead. Switch a word off to pause it.",
};
interface Group { id: string; title: string; desc: string; rows: Row[] }

const KEYS: Key[] = [
  'search_distance_km', 'publish_horizon_days', 'start_early_minutes', 'pending_expire_minutes',
  'auto_complete_hours', 'missed_departure_days', 'plan_grace_days', 'chat_retention_days',
  'plan_warning_days', 'report_retention_days',
];
/** Changing one of these reaches carpools that are already booked, so Save asks first. */
const TIMING: Key[] = ['publish_horizon_days', 'start_early_minutes', 'pending_expire_minutes', 'missed_departure_days', 'plan_grace_days'];

/** Carpool > Settings: every value an admin can change, and the banned words (Carpool.md section 10). */
@Component({
  selector: 'app-carpool-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, ModalComponent, CarpoolHistoryComponent],
  template: `
    <div class="page" *ngIf="s">
      <header>
        <h1 class="page__title">Carpool settings</h1>
        <p class="page__sub">Every other carpool rule is fixed in the app. A change applies from the moment you save, including carpools already booked.</p>
      </header>

      <p class="notice notice--info" *ngIf="!s.can_edit">You can see these settings but not change them. Changing carpool settings, switching carpool on or off and editing banned words needs the Carpool settings permission.</p>

      <p class="warn" *ngIf="s.kill_switch">The emergency kill switch is ON in the server settings. Carpool is stopped completely, whatever is chosen here.</p>

      <div class="cs">
        <nav class="rail" aria-label="Settings sections">
          <button type="button" *ngFor="let n of nav" class="rail__item" [class.is-active]="active === n.id" (click)="goTo(n.id)">{{ n.label }}</button>
        </nav>

        <div class="stack">
          <section class="panel" id="jobs">
            <div class="panel__head">
              <div>
                <h2 class="panel__title">Job status</h2>
                <p class="panel__desc">Carpool depends on jobs the server runs on a timer. If one is late, carpools that should be cancelled or finished stay as they are.</p>
              </div>
            </div>
            <div class="panel__body">
              <ul class="jobs">
                <li *ngFor="let j of s.jobs" [class.is-late]="j.late" [class.is-err]="j.error">
                  <span class="jobs__dot" aria-hidden="true"></span>
                  <span class="jobs__main">
                    <b>{{ j.label }}</b>
                    <span class="jobs__sub">{{ j.finished_at ? 'Last finished ' + when(j.finished_at) : 'Has not run yet on this server' }}{{ j.late ? '. Late: check that the scheduler is running.' : '' }}</span>
                    <span class="jobs__err" *ngIf="j.error">Last error: {{ j.error }}</span>
                  </span>
                  <span class="jobs__state">{{ j.error ? 'Error' : j.late ? 'Late' : 'OK' }}</span>
                </li>
              </ul>
            </div>
          </section>

          <fieldset class="lock" [disabled]="!s.can_edit">
          <section class="panel" id="availability">
            <div class="panel__head">
              <div>
                <h2 class="panel__title">Availability</h2>
                <p class="panel__desc">Turn carpool on or off for everyone.</p>
              </div>
            </div>
            <div class="panel__body">
              <label class="switch-row">
                <span>
                  <span class="switch-row__title">Carpool enabled<span class="info" tabindex="0" role="note" [attr.aria-label]="tips.enabled"><svg class="info__ic" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="10" fill="currentColor"/><circle cx="10" cy="5.6" r="1.3" fill="#fff"/><rect x="8.8" y="8.4" width="2.4" height="6.6" rx="1.2" fill="#fff"/></svg><span class="info__tip" role="tooltip">{{ tips.enabled }}</span></span></span>
                  <span class="switch-row__sub">Off hides the customer tile and stops new carpools and requests. Carpools already running, their chats and jobs continue.</span>
                </span>
                <span class="switch"><input type="checkbox" [checked]="s.enabled" (change)="toggle($event)" aria-label="Carpool enabled" /><span class="switch__track"><span class="switch__thumb"></span></span></span>
              </label>
            </div>
          </section>

          <section class="panel" *ngFor="let g of groups" [id]="g.id">
            <div class="panel__head">
              <div>
                <h2 class="panel__title">{{ g.title }}</h2>
                <p class="panel__desc">{{ g.desc }}</p>
              </div>
            </div>
            <div class="panel__body">
              <div class="tiles">
                <ng-container *ngFor="let r of g.rows">
                  <div class="tile" [class.is-changed]="isChanged(r.key)" [class.is-bad]="err(r.key)">
                    <b class="tile__title">{{ r.label }}<span class="info" tabindex="0" role="note" [attr.aria-label]="tip(r.key)"><svg class="info__ic" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="10" fill="currentColor"/><circle cx="10" cy="5.6" r="1.3" fill="#fff"/><rect x="8.8" y="8.4" width="2.4" height="6.6" rx="1.2" fill="#fff"/></svg><span class="info__tip" role="tooltip">{{ tip(r.key) }}</span></span></b>
                    <p class="tile__help">{{ r.help }}</p>

                    <div class="tile__control" *ngIf="r.key !== 'missed_departure_days'; else missed">
                      <input class="num" type="number" [attr.min]="lim(r.key).min" [attr.max]="lim(r.key).max" step="1"
                             [attr.aria-label]="r.label + ', in ' + lim(r.key).unit" [(ngModel)]="f[r.key]" />
                      <span class="unit">{{ lim(r.key).unit }}</span>
                      <span class="tile__range">{{ hint(r.key) }}</span>
                    </div>
                    <ng-template #missed>
                      <div class="tile__control">
                        <select class="sel" aria-label="When to cancel a carpool nobody started" [(ngModel)]="f.missed_departure_days">
                          <option [ngValue]="0">End of the departure day</option>
                          <option [ngValue]="1">End of the next day</option>
                        </select>
                        <span class="tile__range">{{ hint(r.key) }}</span>
                      </div>
                    </ng-template>

                    <span class="tile__err" *ngIf="err(r.key) as e" role="alert">{{ e }}</span>
                  </div>
                </ng-container>
              </div>
            </div>
          </section>

          <section class="panel" id="banned-words">
            <div class="panel__head">
              <div>
                <h2 class="panel__title">Banned words<span class="info" tabindex="0" role="note" [attr.aria-label]="tips.banned_words"><svg class="info__ic" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="10" fill="currentColor"/><circle cx="10" cy="5.6" r="1.3" fill="#fff"/><rect x="8.8" y="8.4" width="2.4" height="6.6" rx="1.2" fill="#fff"/></svg><span class="info__tip" role="tooltip">{{ tips.banned_words }}</span></span></h2>
                <p class="panel__desc">Whole words, any capitals. Applies to new messages only and shows as dots in chat.</p>
              </div>
              <span class="bw-count" [class.is-full]="s.banned_words.length >= s.banned_words_max">{{ s.banned_words.length }} of {{ s.banned_words_max }} words</span>
            </div>
            <div class="panel__body">
              <form class="bulk" (ngSubmit)="addWords()">
                <label class="bulk__label" for="bw-input">Add words</label>
                <textarea id="bw-input" name="words" rows="3" maxlength="10000" [(ngModel)]="word"
                          placeholder="Type one word, or paste many. Separate them with commas or new lines."></textarea>
                <div class="bulk__row">
                  <span class="bulk__hint">{{ wordCount === 0 ? (word.trim() ? 'Nothing new to add.' : '') : wordCount + (wordCount === 1 ? ' new word ready to add' : ' new words ready to add') }}</span>
                  <tm-button type="submit" variant="ink" size="sm" [loading]="adding" [disabled]="wordCount === 0">Add {{ wordCount > 1 ? wordCount + ' words' : 'word' }}</tm-button>
                </div>
                <p class="bulk__result" *ngIf="result" [class.is-warn]="result.warn" role="status">{{ result.text }}</p>
              </form>

              <p class="hint" *ngIf="!s.banned_words.length">No banned words yet. Add some above.</p>
              <div class="bw-tools" *ngIf="s.banned_words.length">
                <input type="search" class="bw-search" [(ngModel)]="wordFilter" placeholder="Search words" aria-label="Search banned words" *ngIf="s.banned_words.length > 10" />
                <button type="button" class="bw-link" (click)="copyWords()">Copy all words</button>
              </div>
              <p class="hint" *ngIf="s.banned_words.length && !shownWords.length">No word matches "{{ wordFilter }}".</p>
              <ul class="words">
                <li *ngFor="let w of shownWords" [class.is-off]="!w.active">
                  <span>{{ w.word }}</span>
                  <label class="mini"><input type="checkbox" [checked]="w.active" (change)="setActive(w, $event)" /> On</label>
                  <button type="button" class="x" (click)="removeWord(w)" aria-label="Remove">×</button>
                </li>
              </ul>
            </div>
          </section>

          <section class="panel" id="report-reasons">
            <div class="panel__head">
              <div>
                <h2 class="panel__title">Report reasons</h2>
                <p class="panel__desc">What riders and drivers can pick when they report someone. Turn a reason off instead of deleting it: old reports keep their label. At least one reason must stay on for people and one for messages.</p>
              </div>
            </div>
            <div class="panel__body">
              <form class="rr-add" (ngSubmit)="addReason()">
                <input name="rlabel" class="rr-input" [(ngModel)]="newReason" maxlength="60" placeholder="New reason, for example: Asked for extra money" aria-label="New report reason" />
                <select name="rapplies" class="sel" [(ngModel)]="newApplies" aria-label="Where it is offered">
                  <option value="both">On people and messages</option>
                  <option value="person">On people only</option>
                  <option value="message">On messages only</option>
                </select>
                <tm-button type="submit" variant="ink" size="sm" [loading]="addingReason" [disabled]="newReason.trim().length < 3">Add reason</tm-button>
              </form>
              <ul class="reasons">
                <li *ngFor="let r of reasons" [class.is-off]="!r.active">
                  <input class="rr-input" [value]="r.label" maxlength="60" (change)="renameReason(r, $any($event.target))" [attr.aria-label]="'Label for ' + r.label" />
                  <select class="sel" [ngModel]="r.applies_to" (ngModelChange)="changeApplies(r, $event)" [attr.aria-label]="'Where ' + r.label + ' is offered'">
                    <option value="both">People and messages</option>
                    <option value="person">People only</option>
                    <option value="message">Messages only</option>
                  </select>
                  <span class="rr-used">{{ r.reports }} {{ r.reports === 1 ? 'report' : 'reports' }}</span>
                  <label class="mini"><input type="checkbox" [checked]="r.active" (change)="toggleReason(r, $event)" /> On</label>
                </li>
              </ul>
            </div>
          </section>

          </fieldset>

          <section class="panel" id="history">
            <div class="panel__head">
              <div>
                <h2 class="panel__title">History</h2>
                <p class="panel__desc">The last 20 changes to settings, banned words and report reasons, with who made them.</p>
              </div>
            </div>
            <div class="panel__body">
              <app-carpool-history [entries]="s.history" empty="No changes recorded yet." />
            </div>
          </section>

          <div class="savebar" *ngIf="s.can_edit">
            <span class="savebar__hint" [class.is-dirty]="dirty">{{ dirty ? changedKeys.length + (changedKeys.length === 1 ? ' unsaved change' : ' unsaved changes') : 'No unsaved changes.' }}</span>
            <span class="savebar__actions">
              <tm-button variant="ghost" [disabled]="!dirty || busy" (clicked)="discard()">Discard</tm-button>
              <tm-button variant="ink" [loading]="busy" [disabled]="!dirty || invalid" (clicked)="save()">Save changes</tm-button>
            </span>
          </div>
        </div>
      </div>
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

    <tm-modal [open]="askApply" title="Apply these changes now?" (closed)="askApply = false">
      <ng-container slot="body">
        <p>This reaches carpools that are already booked: {{ s?.upcoming_carpools }} upcoming, {{ s?.carpools_on_the_road }} on the road and {{ s?.waiting_requests }} waiting {{ s?.waiting_requests === 1 ? 'request' : 'requests' }}. Riders are not told about a change in these rules.</p>
      </ng-container>
      <ng-container slot="footer">
        <tm-button variant="ghost" (clicked)="askApply = false">Go back</tm-button>
        <tm-button variant="ink" [loading]="busy" (clicked)="apply()">Apply and save</tm-button>
      </ng-container>
    </tm-modal>
  `,
  styles: [CARPOOL_ADMIN_STYLES, `
    .lock { border: 0; margin: 0; padding: 0; min-width: 0; display: contents; }
    .jobs { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
    .jobs li { display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px; border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-md); }
    .jobs__dot { width: 10px; height: 10px; border-radius: 50%; background: var(--tm-success, #16a34a); margin-top: 4px; flex: none; }
    .jobs li.is-late .jobs__dot { background: var(--tm-warning, #d97706); }
    .jobs li.is-err .jobs__dot { background: var(--tm-danger, #dc2626); }
    .jobs__main { flex: 1; display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
    .jobs__sub { color: var(--tm-text-muted); }
    .jobs__err { color: var(--tm-danger-fg); font-size: 12px; overflow-wrap: anywhere; }
    .jobs__state { font-size: 12px; font-weight: 700; color: var(--tm-text-muted); }
    .jobs li.is-late .jobs__state { color: var(--tm-warning-fg); }
    .jobs li.is-err .jobs__state { color: var(--tm-danger-fg); }
    .warn { background: var(--tm-danger-bg, #fee2e2); color: var(--tm-danger-fg, #b91c1c); padding: 10px 14px; border-radius: var(--tm-radius-md); font-size: 13px; margin: 0; }

    /* Same frame as City Settings: a section rail on the left, panels filling the rest. */
    .cs { display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 16px; align-items: start; }
    .rail { position: sticky; top: 12px; display: flex; flex-direction: column; gap: 2px; padding: 10px; background: var(--tm-surface); border: 1px solid var(--tm-line); border-radius: var(--tm-radius-lg, 14px); }
    .rail__item { padding: 9px 12px; border: 0; border-radius: 9px; background: transparent; text-align: left; font: inherit; font-size: 13px; font-weight: 700; color: var(--tm-text-muted); cursor: pointer; }
    .rail__item:hover { background: var(--tm-canvas-2); color: var(--tm-text); }
    .rail__item.is-active { background: var(--tm-green-tint, #e0f7fa); color: var(--tm-green); }
    .rail__item:focus-visible { outline: 2px solid var(--tm-green-deep); outline-offset: 1px; }

    .stack { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
    .panel { background: var(--tm-surface); border: 1px solid var(--tm-line); border-radius: var(--tm-radius-lg, 14px); scroll-margin-top: 12px; }
    .panel__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: var(--tm-space-5); border-bottom: 1px solid var(--tm-line); }
    .panel__title { margin: 0; font-size: 18px; font-weight: 800; letter-spacing: -0.01em; color: var(--tm-text); }
    .panel__desc { margin: 4px 0 0; font-size: 13px; font-weight: 500; color: var(--tm-text-muted); max-width: 70ch; }
    .panel__body { padding: var(--tm-space-5); display: flex; flex-direction: column; gap: var(--tm-space-4); }

    .switch-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 16px; border: 1px solid var(--tm-line); border-radius: var(--tm-radius-md); background: var(--tm-canvas); cursor: pointer; }
    .switch-row__title { display: block; font-size: 14px; font-weight: 700; color: var(--tm-text); }
    .switch-row__sub { display: block; margin-top: 1px; font-size: 12px; color: var(--tm-text-muted); max-width: 90ch; }
    .switch { display: inline-flex; flex-shrink: 0; }
    .switch input { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
    .switch__track { position: relative; width: 40px; height: 22px; border-radius: 999px; background: var(--tm-line-2); transition: background .15s; }
    .switch__thumb { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(15, 20, 25, 0.25); transition: transform .15s; }
    .switch input:checked + .switch__track { background: var(--tm-green); }
    .switch input:checked + .switch__track .switch__thumb { transform: translateX(18px); }
    .switch input:focus-visible + .switch__track { outline: 2px solid var(--tm-green-deep); outline-offset: 2px; }

    /* One tile per setting: what it is, then the control, then what is allowed. */
    .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 12px; }
    .tile { display: flex; flex-direction: column; gap: 4px; padding: 16px; border: 1px solid var(--tm-line); border-radius: var(--tm-radius-md); background: var(--tm-canvas); }
    .tile.is-changed { border-color: var(--tm-green); background: var(--tm-green-tint, #e0f7fa); }
    .tile.is-bad { border-color: var(--tm-danger-fg, #b91c1c); }
    .tile__title { font-size: 14px; font-weight: 700; color: var(--tm-text); }
    .tile__help { margin: 0; font-size: 13px; color: var(--tm-text-muted); max-width: 60ch; flex: 1; }
    .tile__control { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .tile__range { margin-left: auto; font-size: 12px; color: var(--tm-text-muted); }
    .tile__err { margin-top: 6px; font-size: 12px; font-weight: 600; color: var(--tm-danger-fg, #b91c1c); }
    .num { width: 84px; padding: 8px 10px; border: 1px solid var(--tm-line-2); border-radius: 8px; font: inherit; font-variant-numeric: tabular-nums; text-align: right; color: var(--tm-text); background: var(--tm-surface); }
    .sel { padding: 8px 10px; border: 1px solid var(--tm-line-2); border-radius: 8px; font: inherit; color: var(--tm-text); background: var(--tm-surface); }
    .num:focus-visible, .sel:focus-visible, .bulk textarea:focus-visible, .bw-search:focus-visible { outline: 2px solid var(--tm-green-deep); border-color: transparent; }
    .unit { font-size: 13px; color: var(--tm-text-muted); }

    /* The small "i" next to a title: hover or keyboard focus opens a short plain-words explanation. */
    .info { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; margin-left: 8px; color: var(--tm-text-muted); cursor: help; vertical-align: -3px; text-transform: none; letter-spacing: 0; border-radius: 50%; }
    .info__ic { display: block; }
    .info:hover, .info:focus-visible { color: var(--tm-green); outline: none; }
    .info:focus-visible { box-shadow: 0 0 0 3px var(--tm-green-tint, #e0f7fa); }
    .info__tip { display: none; position: absolute; z-index: 20; top: 24px; left: -8px; width: 320px; padding: 12px 14px; border-radius: var(--tm-radius-md); background: var(--tm-ink, #0f1419); color: #fff; font-size: 13px; font-style: normal; font-weight: 500; line-height: 1.5; text-align: left; white-space: normal; box-shadow: var(--tm-shadow-pop); cursor: default; }
    .info:hover .info__tip, .info:focus .info__tip { display: block; }
    /* Tiles in the right-hand column open their text towards the left so it stays on screen. */
    .tile:nth-child(even) .info__tip { left: auto; right: -8px; }

    .bw-count { flex-shrink: 0; align-self: center; padding: 4px 10px; border-radius: 999px; background: var(--tm-canvas-2); font-size: 12px; font-weight: 700; color: var(--tm-text-muted); font-variant-numeric: tabular-nums; }
    .bw-count.is-full { background: var(--tm-danger-bg, #fee2e2); color: var(--tm-danger-fg, #b91c1c); }
    .bulk { display: flex; flex-direction: column; gap: 8px; }
    .bulk__label { font-size: 13px; font-weight: 700; color: var(--tm-text); }
    .bulk textarea { width: 100%; box-sizing: border-box; min-height: 76px; padding: 10px 12px; border: 1px solid var(--tm-line-2); border-radius: 8px; font: inherit; font-size: 14px; line-height: 1.5; color: var(--tm-text); background: var(--tm-surface); resize: vertical; }
    .bulk__row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .bulk__hint { font-size: 12px; color: var(--tm-text-muted); }
    .bulk__result { margin: 0; padding: 8px 12px; border-radius: 8px; background: var(--tm-green-tint, #e0f7fa); font-size: 13px; color: var(--tm-text); }
    .bulk__result.is-warn { background: var(--tm-warning-bg, #fef3c7); }
    .bw-tools { display: flex; align-items: center; gap: 12px; }
    .bw-search { flex: 1; max-width: 320px; min-width: 0; padding: 8px 12px; border: 1px solid var(--tm-line-2); border-radius: 8px; font: inherit; font-size: 13px; color: var(--tm-text); background: var(--tm-surface); }
    .bw-link { margin-left: auto; border: 0; background: transparent; font: inherit; font-size: 13px; font-weight: 700; color: var(--tm-green); cursor: pointer; padding: 4px 0; }
    .bw-link:hover { text-decoration: underline; }
    .hint { margin: 0; font-size: 13px; color: var(--tm-text-muted); }
    .rr-add { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }
    .rr-input { flex: 1 1 260px; min-width: 200px; padding: 8px 10px; border: 1px solid var(--tm-line-2); border-radius: 8px; font: inherit; color: var(--tm-text); background: var(--tm-surface); }
    .reasons { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .reasons li { display: grid; grid-template-columns: minmax(0, 1fr) 165px 64px 52px; gap: 10px; align-items: center; }
    .reasons li .rr-input { min-width: 0; }
    .reasons li.is-off .rr-input { opacity: .55; }
    .rr-used { font-size: 12px; color: var(--tm-text-muted); min-width: 72px; }
    .words { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
    .words li { display: inline-flex; align-items: center; gap: 8px; padding: 4px 6px 4px 12px; border: 1px solid var(--tm-line-2); border-radius: 999px; font-size: 13px; color: var(--tm-text); }
    .words li span { white-space: nowrap; }
    .words li.is-off span { text-decoration: line-through; color: var(--tm-text-muted); }
    .mini { font-size: 12px; color: var(--tm-text-muted); display: inline-flex; align-items: center; gap: 4px; }
    .x { border: 0; background: var(--tm-canvas-2); border-radius: 50%; width: 22px; height: 22px; cursor: pointer; color: var(--tm-text-muted); }
    .x:hover { color: var(--tm-text); }

    .savebar { position: sticky; bottom: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; background: var(--tm-surface); border: 1px solid var(--tm-line); border-radius: var(--tm-radius-lg, 14px); box-shadow: var(--tm-shadow-pop); }
    .savebar__hint { font-size: 13px; color: var(--tm-text-muted); }
    .savebar__hint.is-dirty { color: var(--tm-text); font-weight: 700; }
    .savebar__actions { display: inline-flex; gap: 8px; }
  `],
})
export class CarpoolSettingsComponent implements OnInit, OnDestroy {
  s: Settings | null = null;
  /** What the admin has typed; `s` is what the server holds. */
  f: Values = {} as Values;
  word = '';
  newReason = '';
  newApplies: 'person' | 'message' | 'both' = 'both';
  addingReason = false;

  get reasons(): Reason[] { return this.s?.report_reasons ?? []; }
  adding = false;
  wordFilter = '';
  /** What the last Add words did, in plain words. */
  result: { text: string; warn: boolean } | null = null;
  busy = false;
  askOff = false;
  askApply = false;
  readonly tips = TIPS;

  readonly groups: Group[] = [
    {
      id: 'finding',
      title: 'Finding a carpool',
      desc: 'What riders can search for and how far ahead drivers can plan.',
      rows: [
        { key: 'search_distance_km', label: 'Search distance', help: "How far from a rider's pickup a carpool's route may pass." },
        { key: 'publish_horizon_days', label: 'Publish horizon', help: 'How many days ahead a driver can publish and a rider can search.' },
      ],
    },
    {
      id: 'on-the-day',
      title: 'On the day',
      desc: 'When a ride can start, when waiting requests close and what happens to a carpool nobody started.',
      rows: [
        { key: 'start_early_minutes', label: 'Start ride opens', help: 'How long before departure the driver can press Start ride.' },
        { key: 'pending_expire_minutes', label: 'Waiting request closes', help: 'A request still waiting once the car is on the road closes this long after its planned pickup.' },
        { key: 'auto_complete_hours', label: 'Auto-complete after', help: 'A started carpool nobody completes closes itself after this long.' },
        { key: 'missed_departure_days', label: 'Cancel a carpool nobody started', help: 'When a carpool the driver never started is cancelled. Riders and the driver are told.' },
      ],
    },
    {
      id: 'drivers-chats',
      title: 'Plans, chats and reports',
      desc: 'When drivers are warned about a plan ending, what happens after it ends, and how long chats and report text are kept.',
      rows: [
        { key: 'plan_warning_days', label: 'Plan ending warning', help: 'How many days before a plan ends the driver app starts warning the driver.' },
        { key: 'plan_grace_days', label: 'Plan grace', help: "Days after a plan's last day on which the driver's carpools still run. Later ones are cancelled." },
        { key: 'chat_retention_days', label: 'Chat retention', help: 'Chats of finished carpools are deleted after this many days.' },
        { key: 'report_retention_days', label: 'Report text kept for', help: 'Closed reports keep the reported message and details this long, then the text is cleared.' },
      ],
    },
  ];

  readonly nav = [
    { id: 'jobs', label: 'Job status' },
    { id: 'availability', label: 'Availability' },
    { id: 'finding', label: 'Finding a carpool' },
    { id: 'on-the-day', label: 'On the day' },
    { id: 'drivers-chats', label: 'Plans, chats and reports' },
    { id: 'banned-words', label: 'Banned words' },
    { id: 'report-reasons', label: 'Report reasons' },
    { id: 'history', label: 'History' },
  ];
  active = 'jobs';

  constructor(private api: ApiService, private toast: ToastService) {}

  /** Scrolls to a section and marks it in the rail. */
  goTo(id: string): void {
    this.active = id;
    this.lockUntil = Date.now() + 900;
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  isChanged(k: Key): boolean {
    const s = this.s;
    if (!s) return false;
    return this.f[k] !== s[k];
  }

  ngOnInit(): void {
    document.addEventListener('scroll', this.onScroll, true); // capture: the page scrolls inside the admin shell
    this.load();
  }

  ngOnDestroy(): void {
    document.removeEventListener('scroll', this.onScroll, true);
  }

  /** While a rail click scrolls the page, the scroll listener leaves the highlight alone. */
  private lockUntil = 0;

  /**
   * Marks the last section whose top has scrolled up to the top of the screen. At the very bottom of the
   * page the last sections can never reach the top, so the last one is marked there.
   */
  private onScroll = (ev: Event): void => {
    if (Date.now() < this.lockUntil) return;
    const box = ev.target instanceof HTMLElement ? ev.target : document.documentElement;
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 4 && box.scrollTop > 0) {
      this.active = this.nav[this.nav.length - 1].id;
      return;
    }
    let current = this.nav[0].id;
    for (const n of this.nav) {
      const el = document.getElementById(n.id);
      if (el && el.getBoundingClientRect().top <= 160) current = n.id;
    }
    this.active = current;
  };

  private load(): void {
    this.api.get<{ data: Settings }>('/admin/carpool/settings').subscribe({
      next: (r) => this.adopt(r.data),
      error: (e) => this.toast.error(e?.error?.message || 'Could not load settings.'),
    });
  }

  /** Takes the server's settings. Fields named in `keep` keep what the admin typed. */
  private adopt(data: Settings, keep: Key[] = []): void {
    this.s = data;
    const typed = this.f;
    this.f = {} as Values;
    for (const k of KEYS) {
      (this.f as any)[k] = keep.includes(k) ? (typed as any)[k] : (data as any)[k];
    }
  }

  // ---- what the screen shows ----

  /** Limits come from the server; these are only used if an older server does not send them. */
  lim(k: Key): Limit {
    return this.s?.limits?.[k] ?? { min: 0, max: 9999, default: null, unit: '', nullable: false };
  }

  hint(k: Key): string {
    const l = this.lim(k);
    if (k === 'missed_departure_days') return 'Default: end of the departure day.';
    return `${l.min} to ${l.max}. Default ${l.default}.`;
  }

  when(iso: string | null): string {
    return inTime(iso, true);
  }

  tip(k: Key): string {
    return TIPS[k];
  }

  err(k: Key): string | null {
    const v = this.f[k];
    const l = this.lim(k);
    if (v === null || v === undefined || (v as any) === '' || !Number.isInteger(Number(v))) return `Enter a whole number from ${l.min} to ${l.max}.`;
    return Number(v) < l.min || Number(v) > l.max ? `Enter a value from ${l.min} to ${l.max}.` : null;
  }

  get invalid(): boolean {
    return KEYS.some((k) => !!this.err(k));
  }

  get changedKeys(): Key[] {
    return this.s ? KEYS.filter((k) => this.isChanged(k)) : [];
  }

  get dirty(): boolean {
    return this.changedKeys.length > 0;
  }

  discard(): void {
    if (this.s) this.adopt(this.s);
  }

  // ---- saving ----

  toggle(ev: Event): void {
    const on = (ev.target as HTMLInputElement).checked;
    if (!on) {
      (ev.target as HTMLInputElement).checked = true; // stays on until confirmed
      this.askOff = true;
      return;
    }
    this.patch({ enabled: true }, 'Carpool turned on.', []);
  }

  turnOff(): void {
    this.patch({ enabled: false }, 'Carpool turned off.', [], () => (this.askOff = false));
  }

  save(): void {
    if (!this.s || this.invalid || !this.dirty) return;
    const reaches = (this.s.upcoming_carpools + this.s.carpools_on_the_road + this.s.waiting_requests) > 0;
    if (reaches && this.changedKeys.some((k) => TIMING.includes(k))) {
      this.askApply = true;
      return;
    }
    this.apply();
  }

  apply(): void {
    const keys = this.changedKeys;
    const body: Record<string, unknown> = {};
    for (const k of keys) body[k] = this.f[k] === null || this.f[k] === undefined ? null : Number(this.f[k]);
    this.patch(body, 'Settings saved.', keys, () => (this.askApply = false));
  }

  /** Sends only what changed, plus the version this page was loaded with. */
  private patch(body: object, ok: string, sent: Key[], done?: () => void): void {
    if (!this.s) return;
    this.busy = true;
    const keep = KEYS.filter((k) => !sent.includes(k) && this.f[k] !== this.s![k]);
    this.api.patch<{ data: Settings }>('/admin/carpool/settings', { ...body, version: this.s.version }).subscribe({
      next: (r) => { this.busy = false; this.adopt(r.data, keep); this.toast.success(ok); done?.(); },
      error: (e) => {
        this.busy = false;
        done?.();
        if (e?.status === 409 && e?.error?.data) {
          // Someone else saved first: show their values, and ask for the change to be made again.
          this.adopt(e.error.data);
          this.toast.error('Settings were changed by someone else. The page now shows the current values. Check them and save again.');
          return;
        }
        const first = e?.error?.errors ? (Object.values(e.error.errors)[0] as string[])[0] : null;
        this.toast.error(first || e?.error?.message || 'Could not save.');
      },
    });
  }

  // ---- banned words ----

  /** New words in the box: valid, not repeated, and not on the list already. */
  get wordCount(): number {
    const have = new Set((this.s?.banned_words ?? []).map((w) => w.word));
    return parseWords(this.word).filter((w) => !have.has(w)).length;
  }

  get shownWords(): Word[] {
    const q = this.wordFilter.trim().toLowerCase();
    const all = this.s?.banned_words ?? [];
    return q ? all.filter((w) => w.word.includes(q)) : all;
  }

  addWords(): void {
    if (!this.s || this.adding || this.wordCount === 0) return;
    this.adding = true;
    this.api.post<{ data: BulkResult }>('/admin/carpool/banned-words/bulk', { words: this.word }).subscribe({
      next: (r) => {
        this.adding = false;
        if (this.s) {
          const known = new Set(this.s.banned_words.map((w) => w.id));
          this.s.banned_words = [...this.s.banned_words, ...r.data.added.filter((w) => !known.has(w.id))].sort((a, b) => a.word.localeCompare(b.word));
        }
        this.word = '';
        this.result = this.summary(r.data);
      },
      error: (e) => {
        this.adding = false;
        const first = e?.error?.errors ? (Object.values(e.error.errors)[0] as string[])[0] : null;
        this.toast.error(first || e?.error?.message || 'Could not add.');
      },
    });
  }

  /** "Added 3 words. 1 was already on the list." in plain words. */
  private summary(d: BulkResult): { text: string; warn: boolean } {
    const n = d.added.length;
    const parts: string[] = [];
    if (n) parts.push(`Added ${n} ${n === 1 ? 'word' : 'words'}.`);
    if (d.already_there) parts.push(`${d.already_there} ${d.already_there === 1 ? 'was' : 'were'} already on the list.`);
    if (d.skipped_count) parts.push(`Skipped ${d.skipped_count} (words must be 2 to 60 letters): ${d.skipped.join(', ')}${d.skipped_count > d.skipped.length ? ', ...' : ''}.`);
    if (d.over_limit) parts.push(`${d.over_limit} not added because the list is full (${d.max} words).`);
    if (!parts.length) parts.push('Nothing new to add.');
    return { text: parts.join(' '), warn: !!(d.skipped_count || d.over_limit) };
  }

  copyWords(): void {
    const text = (this.s?.banned_words ?? []).map((w) => w.word).join(', ');
    const done = () => this.toast.success('Words copied.');
    const fail = () => this.toast.error('Could not copy.');
    if (!navigator.clipboard) { fail(); return; }
    navigator.clipboard.writeText(text).then(done, fail);
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

  addReason(): void {
    const label = this.newReason.trim();
    if (label.length < 3 || this.addingReason) return;
    this.addingReason = true;
    this.api.post<{ data: Reason }>('/admin/carpool/report-reasons', { label, applies_to: this.newApplies }).subscribe({
      next: (r) => {
        this.addingReason = false;
        this.newReason = '';
        if (this.s) this.s.report_reasons = [...this.reasons, r.data];
        this.toast.success('Reason added.');
      },
      error: (e) => { this.addingReason = false; this.toast.error(e?.error?.message || 'Could not add the reason.'); },
    });
  }

  private saveReason(r: Reason, body: Partial<Reason>, undo: () => void): void {
    this.api.patch<{ data: Reason }>(`/admin/carpool/report-reasons/${r.id}`, body).subscribe({
      next: (res) => Object.assign(r, res.data),
      error: (e) => { undo(); this.toast.error(e?.error?.message || 'Could not change the reason.'); },
    });
  }

  renameReason(r: Reason, el: HTMLInputElement): void {
    const label = el.value.trim();
    if (label === r.label) return;
    if (label.length < 3) { this.toast.error('A reason needs at least 3 letters.'); el.value = r.label; return; }
    const before = r.label;
    r.label = label;
    this.saveReason(r, { label }, () => (r.label = before));
  }

  changeApplies(r: Reason, value: 'person' | 'message' | 'both'): void {
    const before = r.applies_to;
    r.applies_to = value;
    this.saveReason(r, { applies_to: value }, () => (r.applies_to = before));
  }

  toggleReason(r: Reason, ev: Event): void {
    const box = ev.target as HTMLInputElement;
    const active = box.checked;
    const before = r.active;
    r.active = active;
    this.saveReason(r, { active }, () => { r.active = before; box.checked = before; });
  }
}
