import { ApplicationRef, Component, EnvironmentInjector, OnDestroy, OnInit, createComponent } from '@angular/core';
import { CommonModule } from '@angular/common';
import { environment } from '../../environments/environment';
import { DEV_HUB_CONFIG } from './dev-hub.config';
import { clearScreen, fillScreen } from './dev-hub.autofill';

interface Person { key: string; label: string; role: string; phone: string }
interface Scenario { key: string; role: string; label: string; hint: string }
type Tab = 'screen' | 'people' | 'scenarios' | 'tools';

const POS_KEY = 'dev_hub_dock';

/**
 * Developer hub (carpool test builds only): a small floating dock that tucks into the
 * screen edge, and a sheet with test people, scenarios, form filling and tools.
 * Talks to /api/dev on the laptop, which only exists in a local environment.
 */
@Component({
  selector: 'app-dev-hub',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div data-dev-hub class="dh">
      <button type="button" class="dh-dock" aria-label="Open the developer hub"
        [class.is-tucked]="tucked" [class.is-left]="side === 'left'" [class.is-drag]="dragging"
        [style.top.px]="y" [style.left.px]="x"
        (pointerdown)="down($event)" (pointermove)="move($event)" (pointerup)="up($event)" (pointercancel)="up($event)">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>
      </button>

      <div class="dh-back" *ngIf="open" (click)="open = false"></div>
      <section class="dh-sheet" *ngIf="open" role="dialog" aria-modal="true" aria-label="Developer hub">
        <header class="dh-head">
          <div>
            <h2>Developer hub</h2>
            <p>{{ cfg.title }} · {{ person ? person : 'nobody signed in' }}</p>
          </div>
          <button type="button" class="dh-x" (click)="open = false" aria-label="Close">×</button>
        </header>

        <nav class="dh-tabs" role="tablist">
          <button *ngFor="let t of tabs" type="button" [class.is-on]="tab === t.key" (click)="setTab(t.key)">{{ t.label }}</button>
        </nav>

        <div class="dh-note" *ngIf="note" [class.is-err]="noteErr" role="status">{{ note }}</div>

        <div class="dh-body">
          <!-- This screen -->
          <ng-container *ngIf="tab === 'screen'">
            <p class="dh-meta">Screen: <b>{{ route }}</b></p>
            <div class="dh-group">
              <h3>Fill this screen</h3>
              <div class="dh-row">
                <button type="button" class="dh-btn dark" (click)="fill(false)">Fill empty fields</button>
                <button type="button" class="dh-btn" (click)="fill(true)">Fill all fields</button>
                <button type="button" class="dh-btn" (click)="clear()">Clear fields</button>
              </div>
              <div class="dh-row">
                <button type="button" class="dh-btn" (click)="freshNumber()">New unused phone number</button>
              </div>
              <p class="dh-hint" *ngIf="phone">Test number <b>{{ phone }}</b>, code <b>123456</b>. It is filled into phone fields.</p>
            </div>
            <div class="dh-group" *ngIf="suggestions.length">
              <h3>Useful here</h3>
              <button *ngFor="let s of suggestions" type="button" class="dh-item" (click)="runScenario(s)">
                <span class="t">{{ s.label }}</span><span>{{ s.hint }}</span>
              </button>
            </div>
            <div class="dh-group">
              <button type="button" class="dh-btn" (click)="reload()">Reload this screen</button>
            </div>
          </ng-container>

          <!-- People -->
          <ng-container *ngIf="tab === 'people'">
            <p class="dh-hint">Pick a ready-made person. It signs you in and puts them in that state. Normal sign-in still works with code 123456 on 99900… numbers.</p>
            <button *ngFor="let p of mine" type="button" class="dh-item" (click)="signIn(p)">
              <span class="t">{{ p.label }}</span><span>{{ p.phone }}</span>
            </button>
            <div class="dh-group">
              <button type="button" class="dh-btn" (click)="signOut()">Sign out</button>
            </div>
          </ng-container>

          <!-- Scenarios -->
          <ng-container *ngIf="tab === 'scenarios'">
            <p class="dh-hint" *ngIf="!signedIn">Sign in as a person first (People tab). Scenarios are built around the signed-in person.</p>
            <button *ngFor="let s of scenarios" type="button" class="dh-item" [disabled]="!signedIn" (click)="runScenario(s)">
              <span class="t">{{ s.label }}</span><span>{{ s.hint }}</span>
            </button>
          </ng-container>

          <!-- Tools -->
          <ng-container *ngIf="tab === 'tools'">
            <div class="dh-group">
              <h3>Time <span class="dh-tag">{{ offset ? '+' + offset + ' min' : 'normal' }}</span></h3>
              <div class="dh-row">
                <button type="button" class="dh-btn" (click)="shift(30)">+30 min</button>
                <button type="button" class="dh-btn" (click)="shift(60)">+1 hour</button>
                <button type="button" class="dh-btn" (click)="shift(1440)">+1 day</button>
                <button type="button" class="dh-btn" (click)="shift(0, false)">Back to normal</button>
              </div>
            </div>
            <div class="dh-group">
              <h3>Background jobs now</h3>
              <div class="dh-row">
                <button type="button" class="dh-btn" (click)="job('lifecycle')">Lifecycle</button>
                <button type="button" class="dh-btn" (click)="job('expire-requests')">Expire requests</button>
                <button type="button" class="dh-btn" (click)="job('prune-chats')">Delete old chats</button>
              </div>
            </div>
            <div class="dh-group">
              <h3>Carpool switch <span class="dh-tag">{{ carpoolOn === null ? '?' : carpoolOn ? 'on' : 'off' }}</span></h3>
              <div class="dh-row">
                <button type="button" class="dh-btn" (click)="carpool(true)">Turn on</button>
                <button type="button" class="dh-btn" (click)="carpool(false)">Turn off</button>
              </div>
            </div>
            <div class="dh-group">
              <h3>Clean up</h3>
              <div class="dh-row">
                <button type="button" class="dh-btn" [disabled]="!signedIn" (click)="resetMe(false)">Clear my carpool data</button>
                <button type="button" class="dh-btn" [disabled]="!signedIn" (click)="resetMe(true)">Delete my account</button>
                <button type="button" class="dh-btn danger" (click)="wipeAll()">Clear every carpool</button>
                <button type="button" class="dh-btn" (click)="clearApp()">Clear this app's saved state</button>
              </div>
            </div>
            <p class="dh-hint">Server: {{ base }}<br>Phone, laptop and local database only. Nothing here touches the live server.</p>
          </ng-container>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .dh { font-family: Roboto, system-ui, sans-serif; color: #0b131e; }
    .dh-dock { position: fixed; z-index: 2147483646; width: 48px; height: 48px; border-radius: 50%; border: 0; padding: 0;
      background: #0b131e; color: #fff; display: flex; align-items: center; justify-content: center; touch-action: none;
      box-shadow: 0 6px 18px rgba(11,19,30,.35), 0 0 0 2px #12b35b; transition: transform .22s cubic-bezier(.2,.8,.2,1), opacity .2s; }
    .dh-dock.is-drag { transition: none; transform: scale(1.08); }
    .dh-dock.is-tucked { opacity: .78; transform: translateX(26px); }
    .dh-dock.is-tucked.is-left { transform: translateX(-26px); }
    .dh-back { position: fixed; inset: 0; z-index: 2147483645; background: rgba(11,19,30,.5); }
    .dh-sheet { position: fixed; z-index: 2147483647; left: 0; right: 0; bottom: 0; max-height: 88vh; display: flex; flex-direction: column;
      background: #fff; border-radius: 24px 24px 0 0; box-shadow: 0 -10px 40px rgba(0,0,0,.25); padding-bottom: env(safe-area-inset-bottom); }
    .dh-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 18px 20px 6px; }
    .dh-head h2 { margin: 0; font-size: 20px; font-weight: 800; }
    .dh-head p { margin: 2px 0 0; font-size: 13px; color: #5c6670; }
    .dh-x { border: 0; background: #eef1f4; width: 34px; height: 34px; border-radius: 50%; font-size: 22px; line-height: 1; cursor: pointer; }
    .dh-tabs { display: flex; gap: 4px; margin: 10px 16px 4px; padding: 4px; background: #eef1f4; border-radius: 14px; }
    .dh-tabs button { flex: 1; border: 0; background: transparent; padding: 9px 4px; border-radius: 10px; font: inherit; font-size: 13px; font-weight: 700; color: #5c6670; }
    .dh-tabs button.is-on { background: #fff; color: #0b131e; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
    .dh-note { margin: 8px 16px 0; padding: 10px 12px; border-radius: 12px; background: #e7f7ee; color: #0b6b36; font-size: 13px; }
    .dh-note.is-err { background: #fde8e8; color: #a31d1d; }
    .dh-body { overflow-y: auto; padding: 8px 16px 18px; -webkit-overflow-scrolling: touch; }
    .dh-meta, .dh-hint { margin: 8px 4px; font-size: 13px; color: #5c6670; overflow-wrap: anywhere; }
    .dh-group { margin: 14px 0; }
    .dh-group h3 { margin: 0 4px 8px; font-size: 14px; font-weight: 800; }
    .dh-tag { margin-left: 6px; padding: 2px 8px; border-radius: 999px; background: #eef1f4; font-size: 11px; font-weight: 700; color: #5c6670; }
    .dh-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
    .dh-btn { border: 1px solid #d8dee4; background: #fff; border-radius: 12px; padding: 11px 14px; font: inherit; font-size: 14px; font-weight: 700; color: #0b131e; }
    .dh-btn.dark { background: #0b131e; border-color: #0b131e; color: #fff; }
    .dh-btn.danger { color: #a31d1d; border-color: #f2c4c4; }
    .dh-btn:disabled, .dh-item:disabled { opacity: .45; }
    .dh-item { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; text-align: left; margin: 0 0 8px; padding: 12px 14px;
      border: 1px solid #e3e8ed; background: #fff; border-radius: 14px; font: inherit; }
    .dh-item .t { font-size: 14px; font-weight: 700; color: #0b131e; }
    .dh-item span { font-size: 12px; color: #5c6670; }
    .dh-item:active, .dh-btn:active { background: #eef1f4; }
  `],
})
export class DevHubComponent implements OnInit, OnDestroy {
  readonly cfg = DEV_HUB_CONFIG;
  readonly tabs: { key: Tab; label: string }[] = [
    { key: 'screen', label: 'This screen' }, { key: 'people', label: 'People' },
    { key: 'scenarios', label: 'Scenarios' }, { key: 'tools', label: 'Tools' },
  ];
  open = false;
  tab: Tab = 'screen';
  note = '';
  noteErr = false;
  route = '';
  phone = '';
  offset = 0;
  carpoolOn: boolean | null = null;
  people: Person[] = [];
  scenarios: Scenario[] = [];
  person = '';

  // dock
  x = 0;
  y = 200;
  side: 'left' | 'right' = 'right';
  tucked = true;
  dragging = false;
  private moved = false;
  private start = { x: 0, y: 0, px: 0, py: 0 };
  private retuck: ReturnType<typeof setTimeout> | null = null;
  private readonly size = 48;

  get base(): string { return environment.apiUrl.replace(/\/api\/?$/, ''); }
  get signedIn(): boolean { return !!localStorage.getItem(this.cfg.tokenKey); }
  get mine(): Person[] { return this.people.filter((p) => p.role === this.cfg.role); }
  get suggestions(): Scenario[] {
    const keys = this.cfg.suggest.find(([re]) => re.test(this.route))?.[1] ?? [];

    return this.scenarios.filter((s) => keys.includes(s.key));
  }

  ngOnInit(): void {
    this.route = location.pathname;
    this.restore();
    addEventListener('resize', this.onResize);
    this.refresh();
    this.routeTimer = setInterval(() => { this.route = location.pathname; }, 700);
  }

  private routeTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onResize = (): void => this.snap(false);

  ngOnDestroy(): void {
    removeEventListener('resize', this.onResize);
    if (this.routeTimer) clearInterval(this.routeTimer);
  }

  // ---- dock ----

  private restore(): void {
    try {
      const s = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (s) { this.y = s.y; this.side = s.side; }
    } catch { /* default position */ }
    this.y = Math.min(Math.max(this.y, 80), innerHeight - 140);
    this.x = this.side === 'left' ? 0 : innerWidth - this.size;
    this.tucked = true;
  }

  private snap(tuck: boolean): void {
    this.side = this.x + this.size / 2 < innerWidth / 2 ? 'left' : 'right';
    this.x = this.side === 'left' ? 0 : innerWidth - this.size;
    this.y = Math.min(Math.max(this.y, 60), innerHeight - 120);
    this.tucked = tuck;
    try { localStorage.setItem(POS_KEY, JSON.stringify({ y: this.y, side: this.side })); } catch { /* ignore */ }
  }

  down(e: PointerEvent): void {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.dragging = true;
    this.moved = false;
    this.start = { x: e.clientX, y: e.clientY, px: this.x, py: this.y };
  }

  move(e: PointerEvent): void {
    if (!this.dragging) return;
    const dx = e.clientX - this.start.x;
    const dy = e.clientY - this.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) this.moved = true;
    if (!this.moved) return;
    this.tucked = false;
    this.x = Math.min(Math.max(this.start.px + dx, 0), innerWidth - this.size);
    this.y = Math.min(Math.max(this.start.py + dy, 40), innerHeight - 100);
  }

  up(_: PointerEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.moved) {
      this.snap(true); // let go near an edge and it tucks in
      return;
    }
    if (this.tucked) {
      this.tucked = false; // a tap on the tucked tab brings the circle out
      this.armRetuck();
    } else {
      this.open = true;
      this.refresh();
    }
  }

  private armRetuck(): void {
    if (this.retuck) clearTimeout(this.retuck);
    this.retuck = setTimeout(() => { if (!this.open) this.tucked = true; }, 4000);
  }

  // ---- calls ----

  private async call<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
    const t = localStorage.getItem(this.cfg.tokenKey);
    if (t) headers['Authorization'] = `Bearer ${t}`;
    const res = await fetch(`${this.base}/api/dev${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message || `Request failed (${res.status})`);

    return json as T;
  }

  private say(msg: string, err = false): void { this.note = msg; this.noteErr = err; }

  private async guard(fn: () => Promise<void>): Promise<void> {
    try { await fn(); } catch (e) { this.say((e as Error).message || 'Something went wrong', true); }
  }

  async refresh(): Promise<void> {
    await this.guard(async () => {
      const s = await this.call('/state');
      this.people = s.people;
      this.offset = s.time_offset_minutes;
      this.carpoolOn = s.carpool_enabled;
      this.person = (() => { try { return JSON.parse(localStorage.getItem(this.cfg.userKey) || 'null')?.name ?? ''; } catch { return ''; } })();
      if (this.signedIn) this.scenarios = (await this.call('/scenarios')).data.filter((x: Scenario) => x.role === this.cfg.role);
    });
  }

  setTab(t: Tab): void { this.tab = t; this.note = ''; }

  // ---- this screen ----

  async fill(overwrite: boolean): Promise<void> {
    await this.guard(async () => {
      if (!this.phone) this.phone = (await this.call('/fresh-number', 'POST')).phone;
      const n = fillScreen({ phone: this.phone.replace(/^\+91/, '') }, overwrite);
      this.say(n ? `Filled ${n} field${n === 1 ? '' : 's'}.` : 'No empty fields found on this screen.');
    });
  }

  clear(): void { const n = clearScreen(); this.say(n ? `Cleared ${n} field${n === 1 ? '' : 's'}.` : 'Nothing to clear.'); }

  async freshNumber(): Promise<void> {
    await this.guard(async () => {
      this.phone = (await this.call('/fresh-number', 'POST')).phone;
      this.say('New number ready. Use Fill to put it in the phone field.');
    });
  }

  reload(): void { location.reload(); }

  // ---- people ----

  async signIn(p: Person): Promise<void> {
    await this.guard(async () => {
      const r = await this.call('/sign-in', 'POST', { key: p.key });
      localStorage.setItem(this.cfg.tokenKey, r.token);
      localStorage.setItem(this.cfg.userKey, JSON.stringify(r.user));
      this.say(`Signed in as ${p.label}. Opening the app…`);
      setTimeout(() => { location.href = '/splash'; }, 500);
    });
  }

  signOut(): void {
    localStorage.removeItem(this.cfg.tokenKey);
    localStorage.removeItem(this.cfg.userKey);
    this.say('Signed out. Opening the app…');
    setTimeout(() => { location.href = '/splash'; }, 400);
  }

  // ---- scenarios ----

  async runScenario(s: Scenario): Promise<void> {
    await this.guard(async () => {
      const r = await this.call('/scenario', 'POST', { key: s.key });
      this.say(`${r.message} Reloading…`);
      setTimeout(() => location.reload(), 900);
    });
  }

  // ---- tools ----

  async shift(minutes: number, add = true): Promise<void> {
    await this.guard(async () => {
      const r = await this.call('/time', 'POST', { minutes, add });
      this.offset = r.time_offset_minutes;
      this.say(r.message);
    });
  }

  async job(name: string): Promise<void> { await this.guard(async () => this.say((await this.call('/job', 'POST', { name })).message)); }

  async carpool(on: boolean): Promise<void> {
    await this.guard(async () => { const r = await this.call('/switch', 'POST', { carpool_enabled: on }); this.carpoolOn = r.carpool_enabled; this.say(r.message); });
  }

  async resetMe(del: boolean): Promise<void> {
    if (del && !confirm('Delete this test account? You will be signed out.')) return;
    await this.guard(async () => {
      this.say((await this.call('/reset-me', 'POST', { delete_account: del })).message);
      if (del) this.signOut();
    });
  }

  async wipeAll(): Promise<void> {
    if (!confirm('Clear every carpool, request, chat, rating and report on the laptop database?')) return;
    await this.guard(async () => this.say((await this.call('/wipe-carpool', 'POST')).message));
  }

  clearApp(): void {
    const keep = localStorage.getItem(POS_KEY);
    localStorage.clear();
    sessionStorage.clear();
    if (keep) localStorage.setItem(POS_KEY, keep);
    this.say('Saved state cleared. Opening the app…');
    setTimeout(() => { location.href = '/splash'; }, 500);
  }
}

/** Adds the hub on top of the running app. Called from main.ts in carpool test builds only. */
export function attachDevHub(appRef: ApplicationRef, injector: EnvironmentInjector): void {
  const host = document.createElement('div');
  host.setAttribute('data-dev-hub', '');
  document.body.appendChild(host);
  const ref = createComponent(DevHubComponent, { environmentInjector: injector, hostElement: host });
  appRef.attachView(ref.hostView);
}
