import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import {
  ButtonComponent, ColumnComponent, DataTableComponent, DrawerComponent, FilterSelectComponent, InputComponent, ModalComponent, StatusPillComponent,
} from '../../ui';
import type { FilterOption, StatusTone } from '../../ui';
import { CarpoolHistoryComponent, HistoryEntry } from './carpool-history.component';
import {
  CARPOOL_ADMIN_STYLES, inTime, listingStatusLabel, listingStatusTone, reasonLabel, requestStatusLabel,
} from './carpool-admin.styles';

type Tab = 'upcoming' | 'not_started' | 'today' | 'in_progress' | 'past';

interface Row {
  id: number;
  departs_at: string;
  route: string;
  driver: string | null;
  driver_phone: string | null;
  driver_id: number;
  driver_user_id: number | null;
  car: string | null;
  plate: string | null;
  car_now: string | null;
  plate_now: string | null;
  city: string | null;
  seats_taken: number;
  seats_total: number;
  price_per_seat: number | null;
  is_free: boolean;
  status: string;
  cancel_reason: string | null;
  is_past_departure: boolean;
  requests_count: number | null;
}

interface Req {
  id: number; rider_id: number; rider: string | null; rider_phone: string | null; seats: number; pickup: string; drop: string;
  status: string; closed_reason: string | null; price_per_seat: number | null; is_free: boolean; paid_marked: boolean;
  asked_at: string | null; answered_at: string | null; picked_up_at: string | null; dropped_at: string | null; no_show_at: string | null;
  can_remove: boolean; can_correct: boolean;
}

interface Detail extends Row {
  cancel_note: string | null;
  distance_km: number;
  can_cancel: boolean;
  can_end: boolean;
  requests: Req[];
  reports: { id: number; reason: string; reason_label?: string | null; status: string; created_at: string }[];
  timeline: { at: string; label: string }[];
  history: HistoryEntry[];
  /** L1.5: when the driver's phone first shared its location on this ride; null when it never did. */
  location_shared_at?: string | null;
}

interface Strip { upcoming: number; past_departure: number; in_progress: number; open_reports: number }

type Ask = null | { kind: 'cancel' } | { kind: 'end' } | { kind: 'remove'; req: Req } | { kind: 'outcome'; req: Req };

/**
 * Carpool > Listings (Carpool.md section 10, Admin-Audit.md S-04, S-05). Read-only apart from the
 * admin fixes: cancel a published carpool, end one stuck on the road, remove a rider, correct a
 * rider's outcome. Each needs a note and is logged.
 */
@Component({
  selector: 'app-carpool-listings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ButtonComponent, ColumnComponent, DataTableComponent, DrawerComponent, FilterSelectComponent, InputComponent, ModalComponent, StatusPillComponent, CarpoolHistoryComponent],
  template: `
    <div class="page">
      <header>
        <h1 class="page__title">Carpool listings</h1>
        <p class="page__sub">Carpools drivers have published. Times are India time.</p>
      </header>

      <div class="summary" aria-label="Carpool totals">
        <div><b>{{ strip.upcoming }}</b><span>upcoming</span></div>
        <div [class.is-warn]="strip.past_departure > 0" title="Published carpools whose departure time has passed. The hourly job cancels them at the end of the day."><b>{{ strip.past_departure }}</b><span>not started, departure passed</span></div>
        <div><b>{{ strip.in_progress }}</b><span>on the road</span></div>
        <div><b>{{ strip.open_reports }}</b><span>open reports</span></div>
      </div>

      <div class="bar">
        <div class="tabs" role="tablist" aria-label="Which carpools">
          <button *ngFor="let t of tabs" type="button" role="tab" [attr.aria-selected]="tab === t.key" [class.is-on]="tab === t.key" (click)="setTab(t.key)">{{ t.label }}</button>
        </div>
        <div class="dates">
          <label for="lf">Departs from</label><input id="lf" type="date" [(ngModel)]="dateFrom" (change)="reload()" />
          <label for="lt">to</label><input id="lt" type="date" [(ngModel)]="dateTo" (change)="reload()" />
          <button *ngIf="dateFrom || dateTo" type="button" class="linkish" (click)="dateFrom = ''; dateTo = ''; reload()">Clear dates</button>
        </div>
      </div>

      <tm-data-table [rows]="rows" [total]="total" [page]="page" [pageSize]="25" [pageSizes]="[25]" [loading]="loading"
        emptyTitle="No carpools here" emptyHint="Nothing matches this tab, search and filters." (pageChange)="goto($event)" (rowClick)="open($event.id)">
        <tm-input slot="search" icon="search" placeholder="Name, phone, plate or #28" [(ngModel)]="search" (ngModelChange)="onSearch()" />
        <ng-container slot="filters">
          <tm-filter-select icon="map-marker" ariaLabel="City" allLabel="All cities" allValue="" [options]="cityOptions" [value]="cityId" (valueChange)="cityId = $event; reload()" />
        </ng-container>

        <tm-column key="id" label="#" width="64px"><ng-template let-row><span class="num">#{{ row.id }}</span></ng-template></tm-column>
        <tm-column key="departs_at" label="Departs" width="132px">
          <ng-template let-row>{{ when(row.departs_at) }}<span class="tag tag--warn" *ngIf="row.is_past_departure">past</span></ng-template>
        </tm-column>
        <tm-column key="route" label="Route" [wrap]="true"><ng-template let-row>{{ row.route }}</ng-template></tm-column>
        <tm-column key="driver" label="Driver" width="170px" [wrap]="true">
          <ng-template let-row>{{ row.driver || '—' }}<span class="sub">{{ row.plate || '' }}</span></ng-template>
        </tm-column>
        <tm-column key="city" label="City" width="110px"><ng-template let-row>{{ row.city || '—' }}</ng-template></tm-column>
        <tm-column key="seats" label="Seats" width="72px" align="right"><ng-template let-row>{{ row.seats_taken }}/{{ row.seats_total }}</ng-template></tm-column>
        <tm-column key="price" label="Per seat" width="84px" align="right"><ng-template let-row>{{ row.is_free ? 'Free' : '₹' + row.price_per_seat }}</ng-template></tm-column>
        <tm-column key="status" label="Status" width="200px">
          <ng-template let-row><tm-status-pill [tone]="tone(row)">{{ label(row) }}</tm-status-pill></ng-template>
        </tm-column>
        <tm-column key="requests" label="Riders" width="72px" align="right"><ng-template let-row>{{ row.requests_count ?? 0 }}</ng-template></tm-column>
      </tm-data-table>
    </div>

    <tm-drawer [open]="!!detail" [width]="640" [title]="detail ? '#' + detail.id + ' · ' + detail.route : ''" [subtitle]="detail ? when(detail.departs_at) : ''" (closed)="close()">
      <ng-container slot="body" *ngIf="detail as d">
        <div class="notice" *ngIf="d.is_past_departure">This carpool was never started and its departure time has passed. The hourly job cancels it at the end of the day ("missed departure"). If it stays here, check the job status on Carpool settings.</div>

        <dl class="kv">
          <dt>Status</dt><dd><tm-status-pill [tone]="tone(d)">{{ label(d) }}</tm-status-pill></dd>
          <dt>Driver</dt>
          <dd>
            <a class="linkish" *ngIf="d.driver_user_id; else noDriver" [routerLink]="['/carpool/people']" [queryParams]="{ open: d.driver_user_id }">{{ d.driver }}</a>
            <ng-template #noDriver>{{ d.driver || '—' }}</ng-template>
            <span class="muted-inline"> · {{ d.driver_phone || 'no phone' }}</span>
          </dd>
          <dt>Car when published</dt><dd>{{ d.car || '—' }} · {{ d.plate || '—' }}</dd>
          <ng-container *ngIf="d.plate_now && d.plate_now !== d.plate"><dt>Car now</dt><dd>{{ d.car_now }} · {{ d.plate_now }} <span class="tag tag--warn">changed</span></dd></ng-container>
          <dt>City</dt><dd>{{ d.city || '—' }}</dd>
          <dt>Distance</dt><dd>{{ d.distance_km }} km</dd>
          <ng-container *ngIf="locationLine(d) as loc"><dt>Driver location</dt><dd>{{ loc }}</dd></ng-container>
          <dt>Seats</dt><dd>{{ d.seats_taken }} of {{ d.seats_total }} taken</dd>
          <dt>Price</dt><dd>{{ d.is_free ? 'Free' : '₹' + d.price_per_seat + ' per seat, paid to the driver' }}</dd>
          <ng-container *ngIf="d.cancel_note"><dt>Cancel note</dt><dd>{{ d.cancel_note }}</dd></ng-container>
        </dl>

        <h3 class="sect">Riders <small>{{ d.requests.length }} request{{ d.requests.length === 1 ? '' : 's' }}</small></h3>
        <p class="muted" *ngIf="!d.requests.length">Nobody asked to join.</p>
        <table class="mini" *ngIf="d.requests.length">
          <tr><th>Rider</th><th>Seats</th><th>Pickup to drop</th><th>Price</th><th>Status</th><th></th></tr>
          <tr *ngFor="let r of d.requests">
            <td>
              <a class="linkish" [routerLink]="['/carpool/people']" [queryParams]="{ open: r.rider_id }">{{ r.rider || 'Rider' }}</a>
              <span class="sub">{{ r.rider_phone || '' }}</span>
            </td>
            <td>{{ r.seats }}</td>
            <td>{{ r.pickup }} to {{ r.drop }}<span class="sub">{{ times(r) }}</span></td>
            <td>{{ r.is_free ? 'Free' : '₹' + r.price_per_seat }}<span class="sub" *ngIf="!r.is_free">{{ r.paid_marked ? 'Marked paid' : 'Not marked paid' }}</span></td>
            <td>{{ reqLabel(r) }}</td>
            <td class="act">
              <button *ngIf="r.can_remove" type="button" class="linkish" (click)="openAsk({ kind: 'remove', req: r })">Remove</button>
              <button *ngIf="r.can_correct" type="button" class="linkish" (click)="openAsk({ kind: 'outcome', req: r })">Correct</button>
            </td>
          </tr>
        </table>
        <p class="muted small" *ngIf="hasPaidColumn(d)">"Marked paid" is the driver's own tick. Riders pay the driver directly; Dream Cabs doesn't handle this money.</p>

        <h3 class="sect">What happened</h3>
        <ol class="timeline"><li *ngFor="let e of d.timeline">{{ e.label }}<time>{{ when(e.at) }}</time></li></ol>

        <h3 class="sect">Reports</h3>
        <p class="muted" *ngIf="!d.reports.length">No reports on this carpool.</p>
        <ul class="plain" *ngIf="d.reports.length">
          <li *ngFor="let r of d.reports">
            <a class="linkish" [routerLink]="['/carpool/reports']" [queryParams]="{ open: r.id }">Report #{{ r.id }}</a>, {{ reason(r.reason, r.reason_label) }} ({{ r.status }})
          </li>
        </ul>

        <h3 class="sect">History</h3>
        <app-carpool-history [entries]="d.history" empty="No admin actions on this carpool." />
      </ng-container>
      <ng-container slot="footer">
        <tm-button *ngIf="detail?.can_cancel" variant="danger" (clicked)="openAsk({ kind: 'cancel' })">Cancel carpool</tm-button>
        <tm-button *ngIf="detail?.can_end" variant="danger" (clicked)="openAsk({ kind: 'end' })">End this ride</tm-button>
      </ng-container>
    </tm-drawer>

    <tm-modal [open]="!!ask" [title]="askTitle()" (closed)="ask = null">
      <ng-container slot="body" *ngIf="shown">
        <ng-container [ngSwitch]="shown.kind">
          <p *ngSwitchCase="'cancel'">Riders and the driver are told "Cancelled by Dream Cabs". The carpool leaves search. This can't be undone.</p>
          <p *ngSwitchCase="'end'">Riders in the car are marked dropped. Riders the driver never picked up are closed as "Not confirmed". Everyone is told the ride has ended. Use this when the driver can't finish the ride in the app.</p>
          <p *ngSwitchCase="'remove'">{{ $any(shown).req.rider || 'The rider' }} loses their place and is told Dream Cabs removed them. The driver is told too. The seat opens again.</p>
          <ng-container *ngSwitchCase="'outcome'">
            <p>{{ $any(shown).req.rider || 'This rider' }} is now "{{ reqLabel($any(shown).req) }}". Choose what really happened.</p>
            <div class="choice" role="radiogroup" aria-label="Outcome">
              <label><input type="radio" name="oc" value="completed" [(ngModel)]="outcome" /> Rode the carpool (completed)</label>
              <label><input type="radio" name="oc" value="no_show" [(ngModel)]="outcome" /> Didn't turn up (no-show)</label>
            </div>
          </ng-container>
        </ng-container>
        <label class="field">
          <span>{{ shown.kind === 'cancel' ? 'Internal note (optional)' : 'Reason, kept in the history' }}</span>
          <textarea rows="3" maxlength="500" [(ngModel)]="note"></textarea>
          <span class="hint" *ngIf="shown.kind !== 'cancel'">At least 3 characters. Riders and drivers don't see it.</span>
        </label>
      </ng-container>
      <ng-container slot="footer">
        <tm-button variant="ghost" (clicked)="ask = null">Back</tm-button>
        <tm-button [variant]="shown?.kind === 'outcome' ? 'ink' : 'danger'" [loading]="busy" [disabled]="!canConfirm()" (clicked)="confirm()">{{ confirmLabel() }}</tm-button>
      </ng-container>
    </tm-modal>
  `,
  styles: [CARPOOL_ADMIN_STYLES, `
    .num { font-variant-numeric: tabular-nums; color: var(--tm-text-muted); }
    .sub { display: block; color: var(--tm-text-muted); font-size: 12px; }
    .muted-inline { color: var(--tm-text-muted); }
    .small { font-size: 12px; margin-top: 8px; }
    .notice { margin-bottom: 16px; }
    .choice { display: grid; gap: 8px; margin: 4px 0 16px; font-size: 14px; }
    .choice label { display: flex; gap: 8px; align-items: center; cursor: pointer; }
  `],
})
export class CarpoolListingsComponent implements OnInit {
  tabs: { key: Tab; label: string }[] = [
    { key: 'upcoming', label: 'Upcoming' }, { key: 'not_started', label: 'Not started' }, { key: 'today', label: 'Today' },
    { key: 'in_progress', label: 'On the road' }, { key: 'past', label: 'Past' },
  ];
  tab: Tab = 'upcoming';
  search = '';
  cityId = '';
  dateFrom = '';
  dateTo = '';
  cityOptions: FilterOption[] = [];
  rows: Row[] = [];
  total = 0;
  page = 1;
  loading = false;
  strip: Strip = { upcoming: 0, past_departure: 0, in_progress: 0, open_reports: 0 };
  detail: Detail | null = null;
  ask: Ask = null;
  /** What the dialog shows; kept after closing so the closing animation doesn't flash an empty box. */
  shown: Ask = null;
  note = '';
  outcome: 'completed' | 'no_show' = 'completed';
  busy = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private api: ApiService, private toast: ToastService, private route: ActivatedRoute, private router: Router) {}

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParamMap;
    if (qp.get('search')) this.search = qp.get('search')!;
    if (qp.get('tab') && this.tabs.some((t) => t.key === qp.get('tab'))) this.tab = qp.get('tab') as Tab;
    this.api.get<{ data: { id: number; name: string }[] }>('/admin/cities').subscribe({
      next: (r) => (this.cityOptions = (r.data ?? []).map((c) => ({ label: c.name, value: String(c.id) }))),
      error: () => (this.cityOptions = []),
    });
    this.load();
    const open = Number(qp.get('open'));
    if (open) this.open(open);
  }

  setTab(t: Tab): void { this.tab = t; this.reload(); }
  reload(): void { this.page = 1; this.load(); }
  goto(p: number): void { this.page = p; this.load(); }

  onSearch(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.reload(), 300);
  }

  load(): void {
    this.loading = true;
    const p = new URLSearchParams({ tab: this.tab, page: String(this.page) });
    if (this.search.trim()) p.set('search', this.search.trim());
    if (this.cityId) p.set('city_id', this.cityId);
    if (this.dateFrom) p.set('date_from', this.dateFrom);
    if (this.dateTo) p.set('date_to', this.dateTo);
    this.api.get<{ data: Row[]; meta: { total: number }; strip: Strip }>(`/admin/carpool/listings?${p}`).subscribe({
      next: (r) => { this.rows = r.data; this.total = r.meta.total; this.strip = r.strip; this.loading = false; },
      error: (e) => { this.loading = false; this.toast.error(e?.error?.message || 'Could not load carpools.'); },
    });
  }

  open(id: number): void {
    this.api.get<{ data: Detail }>(`/admin/carpool/listings/${id}`).subscribe({
      next: (r) => (this.detail = r.data),
      error: (e) => this.toast.error(e?.status === 404 ? 'That carpool is not in your cities or no longer exists.' : (e?.error?.message || 'Could not open this carpool.')),
    });
  }

  close(): void {
    this.detail = null;
    if (this.route.snapshot.queryParamMap.get('open')) {
      this.router.navigate([], { queryParams: { open: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  openAsk(a: Ask): void {
    this.note = '';
    this.outcome = a?.kind === 'outcome' && a.req.status === 'completed' ? 'no_show' : 'completed';
    this.ask = a;
    this.shown = a;
  }

  askTitle(): string {
    switch (this.shown?.kind) {
      case 'cancel': return 'Cancel this carpool?';
      case 'end': return 'End this ride now?';
      case 'remove': return 'Remove this rider?';
      case 'outcome': return 'Correct the outcome';
      default: return '';
    }
  }

  confirmLabel(): string {
    return ({ cancel: 'Cancel carpool', end: 'End ride', remove: 'Remove rider', outcome: 'Save outcome' } as Record<string, string>)[this.ask?.kind ?? ''] ?? 'Confirm';
  }

  canConfirm(): boolean {
    return this.shown?.kind === 'cancel' || this.note.trim().length >= 3;
  }

  confirm(): void {
    if (!this.detail || !this.ask) return;
    const id = this.detail.id;
    const note = this.note.trim();
    let call: Observable<unknown>;
    switch (this.ask.kind) {
      case 'cancel': call = this.api.post(`/admin/carpool/listings/${id}/cancel`, { note: note || null }); break;
      case 'end': call = this.api.post(`/admin/carpool/listings/${id}/end`, { note }); break;
      case 'remove': call = this.api.post(`/admin/carpool/requests/${this.ask.req.id}/remove`, { note }); break;
      case 'outcome': call = this.api.post(`/admin/carpool/requests/${this.ask.req.id}/outcome`, { note, outcome: this.outcome }); break;
      default: return;
    }
    const done = ({ cancel: 'Carpool cancelled.', end: 'Ride ended.', remove: 'Rider removed.', outcome: 'Outcome saved.' } as Record<string, string>)[this.ask.kind];
    this.busy = true;
    call.subscribe({
      next: () => { this.busy = false; this.ask = null; this.toast.success(done); this.open(id); this.load(); },
      error: (e: any) => { this.busy = false; this.toast.error(this.err(e)); },
    });
  }

  private err(e: any): string {
    const errs = e?.error?.errors;
    if (errs) { const first = Object.values(errs)[0] as string[]; if (first?.length) return first[0]; }
    return e?.error?.message || 'That did not work. Try again.';
  }

  when(iso: string | null): string { return inTime(iso); }

  /** L1.5: whether the driver's phone shared its location; only for rides that were started. */
  locationLine(d: Detail): string | null {
    if (!['in_progress', 'completed', 'auto_completed', 'ended_by_admin'].includes(d.status)) return null;
    return d.location_shared_at ? `Shared, from ${this.when(d.location_shared_at)}` : 'No location shared';
  }
  label(r: Row): string { return listingStatusLabel(r.status, r.cancel_reason); }
  tone(r: Row): StatusTone { return listingStatusTone(r.status); }
  reqLabel(r: Req): string { return requestStatusLabel(r); }
  reason(k: string, label?: string | null): string { return label || reasonLabel(k); }
  hasPaidColumn(d: Detail): boolean { return d.requests.some((r) => !r.is_free); }

  times(r: Req): string {
    const t = (iso: string | null) => inTime(iso);
    const parts: string[] = [];
    if (r.picked_up_at) parts.push('picked up ' + t(r.picked_up_at));
    if (r.dropped_at) parts.push('dropped ' + t(r.dropped_at));
    if (r.no_show_at) parts.push((r.closed_reason === 'not_confirmed' ? 'closed ' : 'no-show ') + t(r.no_show_at));
    if (!parts.length && r.answered_at) parts.push('answered ' + inTime(r.answered_at));
    if (!parts.length && r.asked_at) parts.push('asked ' + inTime(r.asked_at));
    return parts.join(' · ');
  }
}
