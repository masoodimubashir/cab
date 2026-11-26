import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ColumnComponent, DataTableComponent, DrawerComponent, InputComponent, StatusPillComponent, ButtonComponent } from '../../ui';
import { CarpoolAccessComponent } from './carpool-access.component';
import { CarpoolCarEditComponent, CarpoolCar } from './carpool-car-edit.component';
import { CarpoolDocItem, CarpoolDocumentsComponent } from './carpool-documents.component';
import { CarpoolHistoryComponent, HistoryEntry } from './carpool-history.component';
import {
  CARPOOL_ADMIN_STYLES, inDate, inTime, listingStatusLabel, listingStatusTone, reasonLabel, requestStatusLabel,
} from './carpool-admin.styles';

type Kind = 'all' | 'drivers' | 'riders' | 'banned';

interface Row {
  id: number; name: string | null; phone: string | null; is_driver: boolean; driver_id: number | null; approval: string | null;
  city: string | null; plate: string | null; rides_as_rider: number; reports_against: number; banned: boolean;
}

interface Person {
  id: number; name: string | null; phone: string | null; email: string | null; joined_at: string | null; photo_url: string | null;
  is_customer: boolean; banned: boolean; banned_at: string | null; ban_reason: string | null;
  as_rider_total?: number; as_driver_total?: number;
  driver: null | {
    id: number; approval: string; deactivated: boolean; city: string | null; city_id: number | null;
    car: (CarpoolCar & { front_photo_url: string | null }) | null;
    plan: { active_until: string | null; waiting: boolean; waiting_starts: string | null } | null;
    rating_avg: number | null; rating_count: number; comments: { score: number; comment: string; created_at: string }[];
    documents?: CarpoolDocItem[];
  };
  counts: Record<string, number>;
  as_rider: { request_id: number; listing_id: number; route: string | null; departs_at: string | null; driver: string | null; seats: number; price_per_seat: number | null; paid_marked: boolean; status: string; closed_reason: string | null }[];
  as_driver: { listing_id: number; route: string; departs_at: string; seats_taken: number; seats_total: number; status: string; cancel_reason: string | null }[];
  reports_against: { id: number; created_at: string; reason: string; reason_label?: string | null; status: string; listing_id: number | null; other: string | null }[];
  reports_by: { id: number; created_at: string; reason: string; reason_label?: string | null; status: string; listing_id: number | null; other: string | null }[];
  history: HistoryEntry[];
}

type Section = 'rider' | 'driver' | 'reports' | 'history';

/**
 * Carpool > People (Admin-Audit.md S-08, S-09): one place to find a rider or carpool driver by name,
 * phone, plate or carpool number, and to see their carpools, outcomes, reports, access and history.
 */
@Component({
  selector: 'app-carpool-people',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ButtonComponent, ColumnComponent, DataTableComponent, DrawerComponent, InputComponent, StatusPillComponent, CarpoolAccessComponent, CarpoolCarEditComponent, CarpoolDocumentsComponent, CarpoolHistoryComponent],
  template: `
    <div class="page">
      <header>
        <h1 class="page__title">Carpool people</h1>
        <p class="page__sub">Riders and carpool drivers. Search by name, phone, number plate or a carpool number like #28.</p>
      </header>

      <div class="tabs" role="tablist" aria-label="Who to show">
        <button *ngFor="let k of kinds" type="button" role="tab" [attr.aria-selected]="kind === k.key" [class.is-on]="kind === k.key" (click)="setKind(k.key)">{{ k.label }}</button>
      </div>

      <tm-data-table [rows]="rows" [total]="total" [page]="page" [pageSize]="25" [pageSizes]="[25]" [loading]="loading"
        emptyTitle="Nobody found" [emptyHint]="search ? 'Try a phone number, a plate, or a carpool number like #28.' : 'People appear here once they sign up to drive or ask to join a carpool.'"
        (pageChange)="goto($event)" (rowClick)="open($event.id)">
        <tm-input slot="search" icon="search" placeholder="Name, phone, plate or #carpool" [(ngModel)]="search" (ngModelChange)="onSearch()" />
        <tm-column key="name" label="Person" [wrap]="true">
          <ng-template let-row>{{ row.name || 'No name' }}<span class="sub">{{ row.phone }}</span></ng-template>
        </tm-column>
        <tm-column key="role" label="Carpool role" width="240px" [wrap]="true">
          <ng-template let-row>
            <ng-container *ngIf="row.is_driver">Driver<span class="tag" [class.tag--ok]="row.approval === 'approved'" [class.tag--warn]="row.approval === 'pending'" [class.tag--bad]="row.approval === 'rejected'">{{ approval(row.approval) }}</span><span class="sub">{{ row.city }} · {{ row.plate }}</span></ng-container>
            <ng-container *ngIf="!row.is_driver">Rider</ng-container>
          </ng-template>
        </tm-column>
        <tm-column key="rides" label="Rides as rider" width="120px" align="right"><ng-template let-row>{{ row.rides_as_rider }}</ng-template></tm-column>
        <tm-column key="reports" label="Reported" width="100px" align="right"><ng-template let-row>{{ row.reports_against }}</ng-template></tm-column>
        <tm-column key="access" label="Access" width="110px">
          <ng-template let-row><tm-status-pill [tone]="row.banned ? 'danger' : 'success'">{{ row.banned ? 'Paused' : 'Active' }}</tm-status-pill></ng-template>
        </tm-column>
      </tm-data-table>
    </div>

    <tm-drawer [open]="!!person" [width]="720" [title]="person?.name || 'Person'" [subtitle]="person ? subtitle(person) : ''" (closed)="close()">
      <ng-container slot="body" *ngIf="person as p">
        <div class="who">
          <img *ngIf="p.photo_url" [src]="p.photo_url" alt="" class="who__photo" />
          <div class="who__facts">
            <div><b>{{ p.counts['rides_as_rider'] }}</b> rides as rider</div>
            <div *ngIf="p.driver"><b>{{ p.counts['carpools_completed'] }}</b> of {{ p.counts['carpools_published'] }} carpools completed as driver</div>
            <div [class.warn]="p.counts['no_shows'] > 0"><b>{{ p.counts['no_shows'] }}</b> no-shows</div>
            <div [class.warn]="p.counts['reports_against'] > 0"><b>{{ p.counts['reports_against'] }}</b> {{ p.counts['reports_against'] === 1 ? 'report' : 'reports' }} about them</div>
          </div>
        </div>

        <dl class="kv">
          <dt>Phone</dt><dd>{{ p.phone || '—' }}</dd>
          <ng-container *ngIf="p.email"><dt>Email</dt><dd>{{ p.email }}</dd></ng-container>
          <dt>Joined</dt><dd>{{ date(p.joined_at) }}</dd>
          <dt>Open in</dt>
          <dd class="links">
            <a *ngIf="p.is_customer" class="linkish" [routerLink]="['/customers', p.id]">Customer page</a>
            <a *ngIf="p.driver" class="linkish" [routerLink]="['/drivers', p.driver.id]">Driver page</a>
            <span *ngIf="!p.is_customer && !p.driver" class="muted">—</span>
          </dd>
        </dl>

        <ng-container *ngIf="p.driver as d">
          <h3 class="sect">As a driver</h3>
          <dl class="kv">
            <dt>Sign-up</dt><dd>{{ approval(d.approval) }}<span class="tag tag--bad" *ngIf="d.deactivated">deactivated</span></dd>
            <dt>City</dt><dd>{{ d.city || '—' }}</dd>
            <dt>Car</dt>
            <dd>
              <ng-container *ngIf="d.car; else noCar">{{ d.car.make }} {{ d.car.model }}, {{ d.car.colour }} · <b>{{ d.car.plate }}</b> · {{ d.car.seats }} seats</ng-container>
              <ng-template #noCar>No car on record</ng-template>
              <button type="button" class="linkish edit" (click)="editCar = true">Edit car</button>
            </dd>
            <dt>Plan</dt><dd>{{ planText(d.plan) }}</dd>
            <dt>Rating</dt><dd>{{ d.rating_avg ? d.rating_avg + ' from ' + d.rating_count + ' rating' + (d.rating_count === 1 ? '' : 's') : 'No ratings yet' }}</dd>
          </dl>
          <img *ngIf="d.car?.front_photo_url" [src]="d.car!.front_photo_url" alt="Front of the car" class="carphoto" />
        </ng-container>

        <app-carpool-documents *ngIf="p.driver" [driverId]="p.driver.id" [items]="p.driver.documents ?? []" (changed)="reopen()"></app-carpool-documents>

        <app-carpool-access [userId]="p.id" [banned]="p.banned" [reason]="p.ban_reason" [showSummaryLink]="false" (changed)="reopen()"></app-carpool-access>

        <div class="tabs inner" role="tablist" aria-label="Details">
          <button type="button" role="tab" [attr.aria-selected]="section === 'rider'" [class.is-on]="section === 'rider'" (click)="section = 'rider'">As rider ({{ p.as_rider_total ?? p.as_rider.length }})</button>
          <button *ngIf="p.driver" type="button" role="tab" [attr.aria-selected]="section === 'driver'" [class.is-on]="section === 'driver'" (click)="section = 'driver'">As driver ({{ p.as_driver_total ?? p.as_driver.length }})</button>
          <button type="button" role="tab" [attr.aria-selected]="section === 'reports'" [class.is-on]="section === 'reports'" (click)="section = 'reports'">Reports ({{ p.reports_against.length + p.reports_by.length }})</button>
          <button type="button" role="tab" [attr.aria-selected]="section === 'history'" [class.is-on]="section === 'history'" (click)="section = 'history'">History ({{ p.history.length }})</button>
        </div>

        <ng-container [ngSwitch]="section">
          <ng-container *ngSwitchCase="'rider'">
            <p class="muted" *ngIf="!p.as_rider.length">Never asked to join a carpool.</p>
            <table class="mini" *ngIf="p.as_rider.length">
              <tr><th>Carpool</th><th>Departs</th><th>Driver</th><th>Seats</th><th>Status</th></tr>
              <tr *ngFor="let r of p.as_rider">
                <td><a class="linkish" [routerLink]="['/carpool/listings']" [queryParams]="{ open: r.listing_id, tab: 'past' }">#{{ r.listing_id }}</a><span class="sub">{{ r.route }}</span></td>
                <td>{{ time(r.departs_at) }}</td>
                <td>{{ r.driver || '—' }}</td>
                <td>{{ r.seats }}<span class="sub">{{ r.price_per_seat === null ? 'Free' : '₹' + r.price_per_seat + (r.paid_marked ? ', marked paid' : '') }}</span></td>
                <td>{{ reqLabel(r) }}</td>
              </tr>
            </table>
            <p class="muted" *ngIf="(p.as_rider_total ?? 0) > p.as_rider.length">Showing the latest {{ p.as_rider.length }} of {{ p.as_rider_total }}. <button type="button" class="linkbtn" (click)="showAll()">Show all</button></p>
          </ng-container>
          <ng-container *ngSwitchCase="'driver'">
            <p class="muted" *ngIf="!p.as_driver.length">No carpools published yet.</p>
            <table class="mini" *ngIf="p.as_driver.length">
              <tr><th>Carpool</th><th>Departs</th><th>Seats</th><th>Status</th></tr>
              <tr *ngFor="let l of p.as_driver">
                <td><a class="linkish" [routerLink]="['/carpool/listings']" [queryParams]="{ open: l.listing_id, tab: 'past' }">#{{ l.listing_id }}</a><span class="sub">{{ l.route }}</span></td>
                <td>{{ time(l.departs_at) }}</td>
                <td>{{ l.seats_taken }}/{{ l.seats_total }}</td>
                <td><tm-status-pill [tone]="tone(l.status)">{{ lLabel(l.status, l.cancel_reason) }}</tm-status-pill></td>
              </tr>
            </table>
            <p class="muted" *ngIf="(p.as_driver_total ?? 0) > p.as_driver.length">Showing the latest {{ p.as_driver.length }} of {{ p.as_driver_total }}. <button type="button" class="linkbtn" (click)="showAll()">Show all</button></p>
          </ng-container>
          <ng-container *ngSwitchCase="'reports'">
            <h4 class="sub-h">About them</h4>
            <p class="muted" *ngIf="!p.reports_against.length">None.</p>
            <ul class="plain" *ngIf="p.reports_against.length">
              <li *ngFor="let r of p.reports_against"><a class="linkish" [routerLink]="['/carpool/reports']" [queryParams]="{ open: r.id }">#{{ r.id }}</a> {{ reason(r.reason, r.reason_label) }}, from {{ r.other || 'a deleted user' }}, {{ date(r.created_at) }} ({{ r.status }})</li>
            </ul>
            <h4 class="sub-h">Sent by them</h4>
            <p class="muted" *ngIf="!p.reports_by.length">None.</p>
            <ul class="plain" *ngIf="p.reports_by.length">
              <li *ngFor="let r of p.reports_by"><a class="linkish" [routerLink]="['/carpool/reports']" [queryParams]="{ open: r.id }">#{{ r.id }}</a> {{ reason(r.reason, r.reason_label) }}, about {{ r.other || 'a deleted user' }}, {{ date(r.created_at) }} ({{ r.status }})</li>
            </ul>
          </ng-container>
          <ng-container *ngSwitchCase="'history'">
            <app-carpool-history [entries]="p.history" empty="No admin actions about this person." />
          </ng-container>
        </ng-container>

        <ng-container *ngIf="p.driver?.comments?.length">
          <h3 class="sect">Latest rating comments</h3>
          <ul class="plain"><li *ngFor="let c of p.driver!.comments">{{ c.score }}★ “{{ c.comment }}” <span class="muted-inline">{{ date(c.created_at) }}</span></li></ul>
        </ng-container>
      </ng-container>
    </tm-drawer>

    <app-carpool-car-edit *ngIf="person?.driver" [open]="editCar" [driverId]="person!.driver!.id" [car]="person!.driver!.car"
      (closed)="editCar = false" (saved)="editCar = false; reopen()"></app-carpool-car-edit>
  `,
  styles: [CARPOOL_ADMIN_STYLES, `
    .linkbtn { border: 0; background: none; padding: 0; font: inherit; font-weight: 600; color: var(--tm-green-deep); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
    .linkbtn:focus-visible { outline: 2px solid var(--tm-green-deep); outline-offset: 2px; }
    .sub { display: block; color: var(--tm-text-muted); font-size: 12px; }
    .muted-inline { color: var(--tm-text-muted); font-size: 12px; }
    .who { display: flex; gap: 16px; align-items: center; margin-bottom: 18px; }
    .who__photo { width: 64px; height: 64px; border-radius: 50%; object-fit: cover; background: var(--tm-canvas-2); flex: none; }
    .who__facts { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 20px; font-size: 13px; color: var(--tm-text-muted); }
    .who__facts b { color: var(--tm-text); font-size: 15px; font-variant-numeric: tabular-nums; margin-right: 2px; }
    .who__facts .warn b { color: var(--tm-danger-fg); }
    .links { display: flex; gap: 14px; }
    .edit { margin-left: 10px; }
    .carphoto { display: block; margin: 12px 0 0; max-width: 220px; border-radius: var(--tm-radius-md); border: 1px solid var(--tm-line-2); }
    .tabs.inner { margin: 18px 0 12px; }
    .sub-h { margin: 12px 0 6px; font-size: 13px; font-weight: 700; color: var(--tm-text); }
  `],
})
export class CarpoolPeopleComponent implements OnInit {
  kinds: { key: Kind; label: string }[] = [
    { key: 'all', label: 'Everyone' }, { key: 'drivers', label: 'Drivers' }, { key: 'riders', label: 'Riders' }, { key: 'banned', label: 'Access paused' },
  ];
  kind: Kind = 'all';
  search = '';
  rows: Row[] = [];
  total = 0;
  page = 1;
  loading = false;
  person: Person | null = null;
  section: Section = 'rider';
  editCar = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private api: ApiService, private toast: ToastService, private route: ActivatedRoute, private router: Router) {}

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParamMap;
    if (qp.get('search')) this.search = qp.get('search')!;
    const k = qp.get('kind') as Kind | null;
    if (k && this.kinds.some((x) => x.key === k)) this.kind = k;
    this.load();
    this.route.queryParamMap.subscribe((m) => {
      const id = Number(m.get('open'));
      if (id && id !== this.person?.id) this.open(id);
    });
  }

  setKind(k: Kind): void { this.kind = k; this.page = 1; this.load(); }
  goto(p: number): void { this.page = p; this.load(); }

  onSearch(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.page = 1; this.load(); }, 300);
  }

  load(): void {
    this.loading = true;
    const p = new URLSearchParams({ kind: this.kind, page: String(this.page) });
    if (this.search.trim()) p.set('search', this.search.trim());
    this.api.get<{ data: Row[]; meta: { total: number } }>(`/admin/carpool/people?${p}`).subscribe({
      next: (r) => { this.rows = r.data; this.total = r.meta.total; this.loading = false; },
      error: (e) => { this.loading = false; this.toast.error(e?.error?.message || 'Could not load people.'); },
    });
  }

  open(id: number, all = false): void {
    this.api.get<{ data: Person }>(`/admin/carpool/people/${id}${all ? '?all=1' : ''}`).subscribe({
      next: (r) => {
        const keep = this.person?.id === id;
        this.person = r.data;
        if (!keep) this.section = r.data.as_rider.length || !r.data.driver ? 'rider' : 'driver';
      },
      error: (e) => this.toast.error(e?.status === 404 ? 'This person is not in your cities, has no carpool record, or no longer exists.' : (e?.error?.message || 'Could not open this person.')),
    });
  }

  /** The summary lists the latest 50 carpools and trips; this loads all of them. */
  showAll(): void {
    if (this.person) this.open(this.person.id, true);
  }

  reopen(): void {
    if (this.person) this.open(this.person.id);
    this.load();
  }

  close(): void {
    this.person = null;
    this.editCar = false;
    if (this.route.snapshot.queryParamMap.get('open')) {
      this.router.navigate([], { queryParams: { open: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  subtitle(p: Person): string {
    const roles = [p.driver ? 'Carpool driver' : null, p.as_rider.length ? 'Rider' : null].filter(Boolean).join(' and ');
    return (roles || 'No carpools yet') + ' · user #' + p.id;
  }

  approval(a: string | null): string {
    return ({ approved: 'Approved', pending: 'Waiting for approval', rejected: 'Rejected' } as Record<string, string>)[a ?? ''] ?? '—';
  }

  planText(plan: { active_until: string | null; waiting: boolean; waiting_starts: string | null } | null): string {
    if (!plan) return '—';
    const parts: string[] = [];
    parts.push(plan.active_until ? 'Active until ' + inDate(plan.active_until) : 'No running plan');
    if (plan.waiting) parts.push('next plan waiting' + (plan.waiting_starts ? ', starts ' + inDate(plan.waiting_starts) : ''));
    return parts.join('; ');
  }

  time(iso: string | null): string { return inTime(iso, true); }
  date(iso: string | null): string { return inDate(iso); }
  reqLabel(r: { status: string; closed_reason: string | null }): string { return requestStatusLabel(r); }
  reason(k: string, label?: string | null): string { return label || reasonLabel(k); }
  lLabel(s: string, c: string | null): string { return listingStatusLabel(s, c); }
  tone(s: string) { return listingStatusTone(s); }
}
