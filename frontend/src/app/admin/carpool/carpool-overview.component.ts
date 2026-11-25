import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, FilterSelectComponent } from '../../ui';
import type { FilterOption } from '../../ui';
import { CARPOOL_ADMIN_STYLES, indiaToday } from './carpool-admin.styles';

interface Day { day: string; carpools: number; completed: number; cancelled: number; riders: number; seats_offered: number }

interface Overview {
  from: string; to: string;
  carpools: {
    departing: number; completed: number; with_riders: number; auto_completed: number; ended_by_admin: number; cancelled: number;
    cancelled_by: { driver: number; missed_departure: number; plan_ended: number; admin: number }; still_open: number; published_in_period: number;
  };
  seats: { offered: number; filled: number };
  riders: { requests: number; accepted: number; carried: number; unique_riders: number; no_shows: number; not_confirmed: number };
  safety: { reports_opened: number; reports_open_now: number; bans: number; banned_now: number };
  drivers: { signed_up: number; waiting_approval: number; approved: number; with_plan_now: number };
  days: Day[];
  jobs_late: number;
}

type Preset = '7' | '30' | '90' | 'custom';

/**
 * Carpool > Overview (Admin-Audit.md S-14, G-01): what happened in a period, by India day.
 * Counts only; no money (payments are on hold).
 */
@Component({
  selector: 'app-carpool-overview',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ButtonComponent, FilterSelectComponent],
  template: `
    <div class="page">
      <div class="page__head">
        <header>
          <h1 class="page__title">Carpool overview</h1>
          <p class="page__sub">Carpools by departure day in India time{{ cityName() ? ', ' + cityName() : '' }}. Counts only.</p>
        </header>
        <tm-button variant="outline" size="sm" icon="download" [disabled]="!data" (clicked)="csv()">Download days (CSV)</tm-button>
      </div>

      <div class="bar">
        <div class="tabs" role="tablist" aria-label="Period">
          <button *ngFor="let p of presets" type="button" role="tab" [attr.aria-selected]="preset === p.key" [class.is-on]="preset === p.key" (click)="setPreset(p.key)">{{ p.label }}</button>
        </div>
        <div class="dates" *ngIf="preset === 'custom'">
          <label for="of">From</label><input id="of" type="date" [(ngModel)]="from" [max]="to" (change)="load()" />
          <label for="ot">to</label><input id="ot" type="date" [(ngModel)]="to" [min]="from" (change)="load()" />
        </div>
        <tm-filter-select icon="map-marker" ariaLabel="City" allLabel="All cities" allValue="" [options]="cityOptions" [value]="cityId" (valueChange)="cityId = $event; load()" />
      </div>

      <div class="notice" *ngIf="data?.jobs_late">Some carpool jobs have not run on time, so recent numbers may be out of date. <a class="linkish" routerLink="/carpool/settings" fragment="jobs">See job status</a></div>

      <ng-container *ngIf="data as d">
        <section class="lead" aria-label="The period at a glance">
          <div class="lead__item">
            <span class="lead__n">{{ d.carpools.completed }}</span>
            <span class="lead__l">carpools completed</span>
            <span class="lead__s">of {{ d.carpools.departing }} departing in the period</span>
          </div>
          <div class="lead__item">
            <span class="lead__n">{{ d.riders.carried }}</span>
            <span class="lead__l">rides given to riders</span>
            <span class="lead__s">{{ d.riders.unique_riders }} different riders</span>
          </div>
          <div class="lead__item">
            <span class="lead__n">{{ pct(d.seats.filled, d.seats.offered) }}</span>
            <span class="lead__l">of seats filled</span>
            <span class="lead__s">{{ d.seats.filled }} of {{ d.seats.offered }} seats on finished carpools</span>
          </div>
          <div class="lead__item">
            <span class="lead__n">{{ d.carpools.cancelled }}</span>
            <span class="lead__l">carpools cancelled</span>
            <span class="lead__s">{{ pct(d.carpools.cancelled, d.carpools.departing) }} of departing</span>
          </div>
          <div class="lead__item">
            <span class="lead__n">{{ d.safety.reports_opened }}</span>
            <span class="lead__l">reports received</span>
            <span class="lead__s">{{ d.safety.reports_open_now }} open now</span>
          </div>
        </section>

        <section class="days" aria-label="Carpools by day">
          <div class="days__head">
            <h2 class="h2">Carpools by day</h2>
            <div class="legend"><span class="key key--done"></span>completed <span class="key key--can"></span>cancelled <span class="key key--other"></span>not finished</div>
          </div>
          <div class="days__plot" role="img" [attr.aria-label]="'Carpools per day from ' + d.from + ' to ' + d.to">
            <div class="col" *ngFor="let x of d.days; let i = index" [title]="dayTitle(x)">
              <div class="col__stack" [style.height.%]="height(x.carpools)">
                <span class="seg seg--other" [style.flex-grow]="x.carpools - x.completed - x.cancelled"></span>
                <span class="seg seg--can" [style.flex-grow]="x.cancelled"></span>
                <span class="seg seg--done" [style.flex-grow]="x.completed"></span>
              </div>
              <span class="col__x" *ngIf="showLabel(i, d.days.length)">{{ short(x.day) }}</span>
            </div>
          </div>
          <p class="muted" *ngIf="max() === 0">No carpools departed in this period.</p>
        </section>

        <div class="grid">
          <section class="panel">
            <h2 class="h2">Why carpools were cancelled</h2>
            <div class="split" *ngIf="d.carpools.cancelled; else noCancel" aria-hidden="true">
              <span *ngFor="let c of cancelParts(d)" [style.flex-grow]="c.n" [class]="'split__p split__p--' + c.key"></span>
            </div>
            <ng-template #noCancel><p class="muted">No cancellations.</p></ng-template>
            <dl class="rows">
              <ng-container *ngFor="let c of cancelParts(d)"><dt><span [class]="'dot split__p--' + c.key"></span>{{ c.label }}</dt><dd>{{ c.n }}</dd></ng-container>
            </dl>
            <p class="foot">{{ d.carpools.auto_completed }} finished automatically and {{ d.carpools.ended_by_admin }} ended by Dream Cabs. {{ d.carpools.still_open }} still published or on the road.</p>
          </section>

          <section class="panel">
            <h2 class="h2">Riders</h2>
            <dl class="rows">
              <dt>Asked to join</dt><dd>{{ d.riders.requests }}</dd>
              <dt>Got a seat</dt><dd>{{ d.riders.accepted }}</dd>
              <dt>Rode</dt><dd>{{ d.riders.carried }}</dd>
              <dt>No-shows marked by drivers</dt><dd>{{ d.riders.no_shows }}</dd>
              <dt>Not confirmed (ride closed without a pickup tap)</dt><dd>{{ d.riders.not_confirmed }}</dd>
            </dl>
          </section>

          <section class="panel">
            <h2 class="h2">Drivers</h2>
            <dl class="rows">
              <dt>Signed up in the period</dt><dd>{{ d.drivers.signed_up }}</dd>
              <dt>Waiting for approval now</dt><dd><a class="linkish" routerLink="/drivers" [queryParams]="{ tab: 'approvals' }">{{ d.drivers.waiting_approval }}</a></dd>
              <dt>Approved and active</dt><dd>{{ d.drivers.approved }}</dd>
              <dt>With a running plan now</dt><dd>{{ d.drivers.with_plan_now }}</dd>
              <dt>Carpools published in the period</dt><dd>{{ d.carpools.published_in_period }}</dd>
            </dl>
          </section>

          <section class="panel">
            <h2 class="h2">Safety</h2>
            <dl class="rows">
              <dt>Reports received</dt><dd>{{ d.safety.reports_opened }}</dd>
              <dt>Reports open now</dt><dd><a class="linkish" routerLink="/carpool/reports">{{ d.safety.reports_open_now }}</a></dd>
              <dt>Access paused in the period</dt><dd>{{ d.safety.bans }}</dd>
              <dt>People paused now</dt><dd><a class="linkish" routerLink="/carpool/people" [queryParams]="{ kind: 'banned' }">{{ d.safety.banned_now }}</a></dd>
            </dl>
          </section>
        </div>
      </ng-container>
      <p class="muted" *ngIf="!data && !loading">No figures to show.</p>
    </div>
  `,
  styles: [CARPOOL_ADMIN_STYLES, `
    .h2 { margin: 0; font-size: 15px; font-weight: 700; color: var(--tm-text); }
    .lead { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); background: var(--tm-surface); border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-lg); }
    .lead__item { display: flex; flex-direction: column; padding: 18px 20px; }
    .lead__item + .lead__item { border-left: 1px solid var(--tm-line-2); }
    .lead__n { font-size: 30px; line-height: 1.1; font-weight: 800; color: var(--tm-text); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
    .lead__l { margin-top: 4px; font-size: 13px; font-weight: 600; color: var(--tm-text); }
    .lead__s { margin-top: 2px; font-size: 12px; color: var(--tm-text-muted); }

    .days { background: var(--tm-surface); border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-lg); padding: 18px 20px 12px; }
    .days__head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
    .legend { display: flex; align-items: center; gap: 6px 10px; font-size: 12px; color: var(--tm-text-muted); flex-wrap: wrap; }
    .key { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-left: 6px; }
    .key--done, .seg--done, .split__p--done { background: var(--tm-green-deep); }
    .key--can, .seg--can { background: var(--tm-danger); opacity: .75; }
    .key--other, .seg--other { background: var(--tm-line-2); }
    .days__plot { display: flex; align-items: flex-end; gap: 3px; height: 170px; border-bottom: 1px solid var(--tm-line-2); }
    .col { flex: 1 1 0; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; position: relative; }
    .col__stack { display: flex; flex-direction: column; min-height: 0; border-radius: 3px 3px 0 0; overflow: hidden; }
    .col__stack .seg { display: block; flex-basis: 0; min-height: 0; }
    .col:hover .col__stack { outline: 2px solid var(--tm-ink-3, #98a2b3); outline-offset: 1px; }
    .col__x { position: absolute; top: calc(100% + 6px); left: 50%; transform: translateX(-50%); font-size: 11px; color: var(--tm-text-muted); white-space: nowrap; }
    .days__plot { margin-bottom: 26px; }

    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--tm-space-4); }
    .panel { background: var(--tm-surface); border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-lg); padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
    .rows { display: grid; grid-template-columns: 1fr auto; gap: 8px 12px; margin: 0; font-size: 13px; }
    .rows dt { color: var(--tm-text-muted); display: flex; align-items: center; gap: 8px; }
    .rows dd { margin: 0; font-weight: 700; color: var(--tm-text); font-variant-numeric: tabular-nums; text-align: right; }
    .split { display: flex; height: 10px; border-radius: 999px; overflow: hidden; background: var(--tm-canvas-2); }
    .split__p { display: block; flex-basis: 0; }
    .split__p--driver { background: #6b7280; }
    .split__p--missed { background: var(--tm-warning, #d97706); }
    .split__p--plan { background: var(--tm-info, #2563eb); }
    .split__p--admin { background: var(--tm-danger); }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex: none; }
    .foot { margin: 0; font-size: 12px; color: var(--tm-text-muted); line-height: 1.45; }
    @media (max-width: 1280px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  `],
})
export class CarpoolOverviewComponent implements OnInit {
  presets: { key: Preset; label: string }[] = [
    { key: '7', label: 'Last 7 days' }, { key: '30', label: 'Last 30 days' }, { key: '90', label: 'Last 90 days' }, { key: 'custom', label: 'Choose dates' },
  ];
  preset: Preset = '30';
  from = indiaToday(-29);
  to = indiaToday();
  cityId = '';
  cityOptions: FilterOption[] = [];
  data: Overview | null = null;
  loading = false;

  constructor(private api: ApiService, private toast: ToastService) {}

  ngOnInit(): void {
    this.api.get<{ data: { id: number; name: string }[] }>('/admin/cities').subscribe({
      next: (r) => (this.cityOptions = (r.data ?? []).map((c) => ({ label: c.name, value: String(c.id) }))),
      error: () => (this.cityOptions = []),
    });
    this.load();
  }

  setPreset(p: Preset): void {
    this.preset = p;
    if (p !== 'custom') {
      this.from = indiaToday(-(Number(p) - 1));
      this.to = indiaToday();
      this.load();
    }
  }

  load(): void {
    if (!this.from || !this.to || this.from > this.to) return;
    this.loading = true;
    const p = new URLSearchParams({ from: this.from, to: this.to });
    if (this.cityId) p.set('city_id', this.cityId);
    this.api.get<{ data: Overview }>(`/admin/carpool/overview?${p}`).subscribe({
      next: (r) => { this.data = r.data; this.loading = false; },
      error: (e) => { this.loading = false; this.toast.error(e?.error?.message || 'Could not load the overview.'); },
    });
  }

  cityName(): string {
    return this.cityOptions.find((c) => c.value === this.cityId)?.label ?? '';
  }

  max(): number {
    return Math.max(0, ...(this.data?.days ?? []).map((d) => d.carpools));
  }

  height(n: number): number {
    const m = this.max();
    return m ? Math.max(n ? 4 : 0, (n / m) * 100) : 0;
  }

  showLabel(i: number, len: number): boolean {
    const step = len <= 10 ? 1 : len <= 31 ? 5 : len <= 92 ? 14 : 30;
    return i % step === 0 || i === len - 1 && (len - 1) % step > step / 2;
  }

  short(day: string): string {
    return new Date(day + 'T12:00:00+05:30').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  }

  dayTitle(x: Day): string {
    return `${this.short(x.day)}: ${x.carpools} carpools, ${x.completed} completed, ${x.cancelled} cancelled, ${x.riders} riders`;
  }

  pct(a: number, b: number): string {
    return b ? Math.round((a / b) * 100) + '%' : '—';
  }

  cancelParts(d: Overview): { key: string; label: string; n: number }[] {
    const c = d.carpools.cancelled_by;
    return [
      { key: 'driver', label: 'By the driver', n: c.driver },
      { key: 'missed', label: 'Missed departure', n: c.missed_departure },
      { key: 'plan', label: 'Plan ended', n: c.plan_ended },
      { key: 'admin', label: 'By Dream Cabs', n: c.admin },
    ];
  }

  csv(): void {
    if (!this.data) return;
    const lines = ['day,carpools_departing,completed,cancelled,riders,seats_offered', ...this.data.days.map((d) => [d.day, d.carpools, d.completed, d.cancelled, d.riders, d.seats_offered].join(','))];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `carpool-days-${this.data.from}-to-${this.data.to}${this.cityId ? '-city' + this.cityId : ''}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000); // revoking at once can cancel the download in some browsers
  }
}
