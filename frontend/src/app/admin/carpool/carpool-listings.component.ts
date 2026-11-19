import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import {
  ButtonComponent, ColumnComponent, DataTableComponent, DrawerComponent, InputComponent, ModalComponent, StatusPillComponent,
} from '../../ui';
import type { StatusTone } from '../../ui';
import { CARPOOL_ADMIN_STYLES } from './carpool-admin.styles';


type Tab = 'upcoming' | 'today' | 'in_progress' | 'past';

interface Row {
  id: number;
  departs_at: string;
  route: string;
  driver: string | null;
  driver_phone: string | null;
  car: string | null;
  plate: string | null;
  city: string | null;
  seats_taken: number;
  seats_total: number;
  price_per_seat: number | null;
  is_free: boolean;
  status: string;
  cancel_reason: string | null;
  requests_count: number | null;
}

interface Detail extends Row {
  cancel_note: string | null;
  distance_km: number;
  can_cancel: boolean;
  requests: { id: number; rider: string | null; rider_phone: string | null; seats: number; pickup: string; drop: string; status: string; closed_reason: string | null }[];
  reports: { id: number; reason: string; status: string }[];
}

const REASONS: Record<string, string> = {
  driver: 'Driver', plan_ended: 'Plan ended', missed_departure: 'Missed departure', admin: 'Admin',
};

/** Carpool > Listings (Carpool.md section 10). Read-only except Cancel carpool on Published ones. */
@Component({
  selector: 'app-carpool-listings',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, ColumnComponent, DataTableComponent, DrawerComponent, InputComponent, ModalComponent, StatusPillComponent],
  template: `
    <div class="page">
      <header>
        <h1 class="page__title">Carpool listings</h1>
        <p class="page__sub">Carpools drivers have published, in India time.</p>
      </header>

      <div class="summary" aria-label="Carpool totals">
        <div><b>{{ strip.upcoming }}</b><span>upcoming</span></div>
        <div><b>{{ strip.in_progress }}</b><span>in progress</span></div>
        <div><b>{{ strip.open_reports }}</b><span>open reports</span></div>
      </div>

      <div class="tabs">
        <button *ngFor="let t of tabs" type="button" [class.is-on]="tab === t.key" (click)="setTab(t.key)">{{ t.label }}</button>
      </div>

      <tm-data-table [rows]="rows" [total]="total" [page]="page" [pageSize]="25" [pageSizes]="[25]" [loading]="loading"
        emptyTitle="No carpools here" emptyHint="Nothing matches this tab and search." (pageChange)="goto($event)" (rowClick)="open($event)">
        <tm-input slot="search" icon="search" placeholder="Driver, phone or plate" [(ngModel)]="search" (ngModelChange)="onSearch()" />

        <tm-column key="departs_at" label="Departs" width="116">
          <ng-template let-row>{{ when(row.departs_at) }}</ng-template>
        </tm-column>
        <tm-column key="route" label="Route" [wrap]="true"><ng-template let-row>{{ row.route }}</ng-template></tm-column>
        <tm-column key="driver" label="Driver" width="128" [wrap]="true"><ng-template let-row>{{ row.driver || '—' }}</ng-template></tm-column>
        <tm-column key="city" label="City" width="90"><ng-template let-row>{{ row.city || '—' }}</ng-template></tm-column>
        <tm-column key="seats" label="Seats" width="64"><ng-template let-row>{{ row.seats_taken }}/{{ row.seats_total }}</ng-template></tm-column>
        <tm-column key="price" label="Per seat" width="76"><ng-template let-row>{{ row.is_free ? 'Free' : '₹' + row.price_per_seat }}</ng-template></tm-column>
        <tm-column key="status" label="Status" width="158">
          <ng-template let-row><tm-status-pill [tone]="tone(row)">{{ label(row) }}</tm-status-pill></ng-template>
        </tm-column>
        <tm-column key="requests" label="Requests" width="76" align="right"><ng-template let-row>{{ row.requests_count ?? 0 }}</ng-template></tm-column>
      </tm-data-table>
    </div>

    <tm-drawer [open]="!!detail" [title]="detail?.route || ''" [subtitle]="detail ? when(detail.departs_at) : ''" (closed)="detail = null">
      <ng-container slot="body" *ngIf="detail as d">
        <dl class="kv">
          <dt>Status</dt><dd>{{ label(d) }}</dd>
          <dt>Driver</dt><dd>{{ d.driver }}</dd>
          <dt>Phone</dt><dd>{{ d.driver_phone }}</dd>
          <dt>Car</dt><dd>{{ d.car || '—' }}</dd>
          <dt>Number plate</dt><dd>{{ d.plate || '—' }}</dd>
          <dt>City</dt><dd>{{ d.city || '—' }}</dd>
          <dt>Distance</dt><dd>{{ d.distance_km }} km</dd>
          <dt>Seats</dt><dd>{{ d.seats_taken }} of {{ d.seats_total }} taken</dd>
          <dt>Price</dt><dd>{{ d.is_free ? 'Free' : '₹' + d.price_per_seat + ' per seat' }}</dd>
          <ng-container *ngIf="d.cancel_note"><dt>Note</dt><dd>{{ d.cancel_note }}</dd></ng-container>
        </dl>

        <h3 class="sect">Requests</h3>
        <p class="muted" *ngIf="!d.requests.length">No requests.</p>
        <table class="mini" *ngIf="d.requests.length">
          <tr><th>Rider</th><th>Seats</th><th>Pickup to drop</th><th>Status</th></tr>
          <tr *ngFor="let r of d.requests">
            <td>{{ r.rider || '—' }}</td><td>{{ r.seats }}</td><td>{{ r.pickup }} to {{ r.drop }}</td><td>{{ requestStatus(r) }}</td>
          </tr>
        </table>

        <h3 class="sect">Reports</h3>
        <p class="muted" *ngIf="!d.reports.length">No reports on this carpool.</p>
        <ul class="plain" *ngIf="d.reports.length"><li *ngFor="let r of d.reports">Report #{{ r.id }}, {{ r.reason }} ({{ r.status }})</li></ul>
      </ng-container>
      <ng-container slot="footer">
        <tm-button *ngIf="detail?.can_cancel" variant="danger" (clicked)="askCancel = true">Cancel carpool</tm-button>
        <span class="muted" *ngIf="detail && !detail.can_cancel && detail.status === 'in_progress'">A carpool on the road can't be cancelled here.</span>
      </ng-container>
    </tm-drawer>

    <tm-modal [open]="askCancel" title="Cancel this carpool?" (closed)="askCancel = false">
      <ng-container slot="body">
        <p>Riders and the driver are told "Cancelled by Dream Cabs". The carpool leaves search. This cannot be undone.</p>
        <label class="field"><span>Internal note (optional)</span><textarea rows="3" maxlength="500" [(ngModel)]="note"></textarea></label>
      </ng-container>
      <ng-container slot="footer">
        <tm-button variant="ghost" (clicked)="askCancel = false">Keep it</tm-button>
        <tm-button variant="danger" [loading]="busy" (clicked)="cancel()">Cancel carpool</tm-button>
      </ng-container>
    </tm-modal>
  `,
  styles: [CARPOOL_ADMIN_STYLES],
})
export class CarpoolListingsComponent implements OnInit {
  tabs: { key: Tab; label: string }[] = [
    { key: 'upcoming', label: 'Upcoming' }, { key: 'today', label: 'Today' },
    { key: 'in_progress', label: 'In progress' }, { key: 'past', label: 'Past' },
  ];
  tab: Tab = 'upcoming';
  search = '';
  rows: Row[] = [];
  total = 0;
  page = 1;
  loading = false;
  strip = { upcoming: 0, in_progress: 0, open_reports: 0 };
  detail: Detail | null = null;
  askCancel = false;
  note = '';
  busy = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private api: ApiService, private toast: ToastService) {}

  ngOnInit(): void {
    this.load();
  }

  setTab(t: Tab): void {
    this.tab = t;
    this.page = 1;
    this.load();
  }

  onSearch(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.page = 1; this.load(); }, 300);
  }

  goto(p: number): void {
    this.page = p;
    this.load();
  }

  load(): void {
    this.loading = true;
    const q = `tab=${this.tab}&page=${this.page}` + (this.search.trim() ? `&search=${encodeURIComponent(this.search.trim())}` : '');
    this.api.get<{ data: Row[]; meta: { total: number }; strip: { upcoming: number; in_progress: number; open_reports: number } }>(`/admin/carpool/listings?${q}`).subscribe({
      next: (r) => { this.rows = r.data; this.total = r.meta.total; this.strip = r.strip; this.loading = false; },
      error: (e) => { this.loading = false; this.toast.error(e?.error?.message || 'Could not load carpools.'); },
    });
  }

  open(row: Row): void {
    this.api.get<{ data: Detail }>(`/admin/carpool/listings/${row.id}`).subscribe({
      next: (r) => (this.detail = r.data),
      error: (e) => this.toast.error(e?.error?.message || 'Could not open this carpool.'),
    });
  }

  cancel(): void {
    if (!this.detail) return;
    this.busy = true;
    this.api.post(`/admin/carpool/listings/${this.detail.id}/cancel`, { note: this.note.trim() || null }).subscribe({
      next: () => {
        this.busy = false; this.askCancel = false; this.detail = null; this.note = '';
        this.toast.success('Carpool cancelled.');
        this.load();
      },
      error: (e) => { this.busy = false; this.toast.error(e?.error?.message || e?.error?.errors?.carpool?.[0] || 'Could not cancel.'); },
    });
  }

  when(iso: string): string {
    return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  }

  label(r: Row): string {
    switch (r.status) {
      case 'published': return 'Published';
      case 'in_progress': return 'In progress';
      case 'completed': return 'Completed';
      case 'auto_completed': return 'Auto-completed';
      case 'cancelled': return 'Cancelled · ' + (REASONS[r.cancel_reason ?? ''] ?? 'Driver');
      default: return r.status;
    }
  }

  tone(r: Row): StatusTone {
    return ({ published: 'info', in_progress: 'warning', completed: 'success', auto_completed: 'success', cancelled: 'danger' } as Record<string, StatusTone>)[r.status] ?? 'neutral';
  }

  requestStatus(r: { status: string; closed_reason: string | null }): string {
    const s: Record<string, string> = {
      pending: 'Waiting', accepted: 'Accepted', declined: 'Declined', withdrawn: 'Withdrawn', closed: r.closed_reason === 'filled' ? 'Filled up' : 'Ended',
      cancelled_by_rider: 'Left', removed: 'Removed', no_show: 'No-show', completed: 'Completed',
    };
    return s[r.status] ?? r.status;
  }
}
