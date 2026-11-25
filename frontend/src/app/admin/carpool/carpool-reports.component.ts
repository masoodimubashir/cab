import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import {
  ButtonComponent, ColumnComponent, DataTableComponent, DrawerComponent, FilterSelectComponent, IconComponent, InputComponent, ModalComponent, StatusPillComponent,
} from '../../ui';
import type { FilterOption } from '../../ui';
import { CarpoolAccessComponent } from './carpool-access.component';
import { CarpoolHistoryComponent, HistoryEntry } from './carpool-history.component';
import { CARPOOL_ADMIN_STYLES, inTime, REPORT_REASONS, reasonLabel } from './carpool-admin.styles';

interface Row {
  id: number;
  created_at: string;
  type: 'message' | 'person';
  reported_by: string | null;
  reported_by_phone: string | null;
  reporter_user_id: number;
  reported_person: string | null;
  reported_person_phone: string | null;
  reported_user_id: number;
  reason: string;
  listing_id: number | null;
  status: string;
}

interface Detail extends Row {
  details: string | null;
  message_text: string | null;
  original_text: string | null;
  note: string | null;
  message_removed: boolean;
  message_in_chat: boolean;
  reported_banned: boolean;
  reported_ban_reason: string | null;
  earlier_reports: number;
  earlier: { id: number; created_at: string; reason: string; status: string; listing_id: number | null }[];
  listing: { id: number; route: string; departs_at: string } | null;
  suggested_outcome: 'actioned' | 'dismissed' | null;
  history: HistoryEntry[];
}

/** Carpool > Reports (Carpool.md section 10, Admin-Audit.md S-06). Neither side is told the outcome. */
@Component({
  selector: 'app-carpool-reports',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ButtonComponent, ColumnComponent, DataTableComponent, DrawerComponent, FilterSelectComponent, IconComponent, InputComponent, ModalComponent, StatusPillComponent, CarpoolAccessComponent, CarpoolHistoryComponent],
  template: `
    <div class="page">
      <header>
        <h1 class="page__title">Carpool reports</h1>
        <p class="page__sub">Messages and people reported by riders and drivers. Nobody is told the outcome, and the reported person never learns who reported them.</p>
      </header>

      <div class="bar">
        <div class="tabs" role="tablist" aria-label="Open or closed">
          <button type="button" role="tab" [attr.aria-selected]="tab === 'open'" [class.is-on]="tab === 'open'" (click)="setTab('open')">Open</button>
          <button type="button" role="tab" [attr.aria-selected]="tab === 'closed'" [class.is-on]="tab === 'closed'" (click)="setTab('closed')">Closed</button>
        </div>
        <div class="dates">
          <label for="rf">Sent from</label><input id="rf" type="date" [(ngModel)]="dateFrom" (change)="reload()" />
          <label for="rt">to</label><input id="rt" type="date" [(ngModel)]="dateTo" (change)="reload()" />
          <button *ngIf="dateFrom || dateTo" type="button" class="linkish" (click)="dateFrom = ''; dateTo = ''; reload()">Clear dates</button>
        </div>
      </div>

      <tm-data-table [rows]="rows" [total]="total" [page]="page" [pageSize]="25" [pageSizes]="[25]" [loading]="loading"
        [emptyTitle]="tab === 'open' ? 'No open reports' : 'Nothing closed yet'" emptyHint="Nothing matches these filters." (pageChange)="goto($event)" (rowClick)="open($event.id)">
        <tm-input slot="search" icon="search" placeholder="Name, phone or #number" [(ngModel)]="search" (ngModelChange)="onSearch()" />
        <ng-container slot="filters">
          <tm-filter-select icon="alert-triangle" ariaLabel="Reason" allLabel="Any reason" allValue="" [options]="reasonOptions" [value]="reasonFilter" (valueChange)="reasonFilter = $event; reload()" />
          <tm-filter-select icon="map-marker" ariaLabel="City" allLabel="All cities" allValue="" [options]="cityOptions" [value]="cityId" (valueChange)="cityId = $event; reload()" />
        </ng-container>
        <tm-column key="id" label="#" width="64px"><ng-template let-row><span class="num">#{{ row.id }}</span></ng-template></tm-column>
        <tm-column key="created_at" label="Sent" width="140px"><ng-template let-row>{{ when(row.created_at) }}</ng-template></tm-column>
        <tm-column key="type" label="Type" width="90px"><ng-template let-row>{{ row.type === 'message' ? 'Message' : 'Person' }}</ng-template></tm-column>
        <tm-column key="reported_by" label="Reported by" [wrap]="true"><ng-template let-row>{{ row.reported_by || '—' }}<span class="sub">{{ row.reported_by_phone }}</span></ng-template></tm-column>
        <tm-column key="reported_person" label="Reported person" [wrap]="true"><ng-template let-row>{{ row.reported_person || '—' }}<span class="sub">{{ row.reported_person_phone }}</span></ng-template></tm-column>
        <tm-column key="reason" label="Reason" width="160px"><ng-template let-row>{{ reason(row.reason) }}</ng-template></tm-column>
        <tm-column key="listing_id" label="Carpool" width="90px"><ng-template let-row>{{ row.listing_id ? '#' + row.listing_id : '—' }}</ng-template></tm-column>
        <tm-column key="status" label="Status" width="120px">
          <ng-template let-row><tm-status-pill [tone]="row.status === 'open' ? 'warning' : row.status === 'actioned' ? 'success' : 'neutral'">{{ statusLabel(row.status) }}</tm-status-pill></ng-template>
        </tm-column>
      </tm-data-table>
    </div>

    <tm-drawer [open]="!!detail" [width]="600" [title]="detail ? (detail.type === 'message' ? 'Message report' : 'Person report') + ' #' + detail.id : ''" [subtitle]="detail ? 'Sent ' + when(detail.created_at) : ''" (closed)="closeDrawer()">
      <ng-container slot="body" *ngIf="detail as d">
        <dl class="kv">
          <dt>Status</dt><dd>{{ statusLabel(d.status) }}</dd>
          <dt>Reason</dt><dd>{{ reason(d.reason) }}</dd>
          <dt>Details</dt><dd>{{ d.details || '—' }}</dd>
          <dt>Reported by</dt>
          <dd><a class="linkish" [routerLink]="['/carpool/people']" [queryParams]="{ open: d.reporter_user_id }">{{ d.reported_by || 'Deleted user' }}</a> <span class="muted-inline">{{ d.reported_by_phone }}</span></dd>
          <dt>Reported person</dt>
          <dd><a class="linkish" [routerLink]="['/carpool/people']" [queryParams]="{ open: d.reported_user_id }">{{ d.reported_person || 'Deleted user' }}</a> <span class="muted-inline">{{ d.reported_person_phone }}</span></dd>
          <dt>Carpool</dt>
          <dd>
            <a *ngIf="d.listing; else noL" class="linkish" [routerLink]="['/carpool/listings']" [queryParams]="{ open: d.listing.id, tab: 'past' }">#{{ d.listing.id }}, {{ d.listing.route }}</a>
            <ng-template #noL>—</ng-template>
          </dd>
          <ng-container *ngIf="d.note"><dt>Closing note</dt><dd>{{ d.note }}</dd></ng-container>
        </dl>

        <ng-container *ngIf="d.type === 'message'">
          <h3 class="sect">
            Message as reported
            <button type="button" class="eye" [class.is-on]="showOriginal" (click)="showOriginal = !showOriginal"
              [attr.aria-pressed]="showOriginal" [attr.aria-label]="showOriginal ? 'Hide what was typed' : 'Show what was typed'"
              [title]="showOriginal ? 'Hide what was typed' : 'Show what was typed before words were hidden'">
              <tm-icon name="eye" [size]="14" />
            </button>
          </h3>
          <blockquote *ngIf="d.message_text !== null || d.original_text; else cleared">{{ showOriginal && d.original_text ? d.original_text : d.message_text }}</blockquote>
          <ng-template #cleared><p class="muted">The text was cleared by the report retention rule.</p></ng-template>
          <p class="muted" *ngIf="showOriginal && d.original_text">Showing what was typed. Only admins see this.</p>
          <p class="muted" *ngIf="showOriginal && !d.original_text">Nothing was hidden in this message, or it was sent before the original was kept.</p>
          <p class="muted" *ngIf="d.message_removed">Removed from the chat by Dream Cabs.</p>
          <p class="muted" *ngIf="!d.message_removed && !d.message_in_chat">The chat itself was already deleted by the chat retention rule, so there is nothing to remove. The copy above was kept with the report.</p>
        </ng-container>

        <h3 class="sect">Earlier reports about this person <small>{{ d.earlier_reports }}</small></h3>
        <p class="muted" *ngIf="!d.earlier.length">None.</p>
        <table class="mini" *ngIf="d.earlier.length">
          <tr><th>#</th><th>Sent</th><th>Reason</th><th>Status</th></tr>
          <tr *ngFor="let e of d.earlier">
            <td><button type="button" class="linkish" (click)="open(e.id)">#{{ e.id }}</button></td>
            <td>{{ when(e.created_at) }}</td><td>{{ reason(e.reason) }}</td><td>{{ statusLabel(e.status) }}</td>
          </tr>
        </table>

        <app-carpool-access [userId]="d.reported_user_id" [banned]="d.reported_banned" [reason]="d.reported_ban_reason" (changed)="d.reported_banned = $event; refreshSuggestion()"></app-carpool-access>

        <h3 class="sect">History</h3>
        <app-carpool-history [entries]="d.history" empty="No admin actions on this report." />
      </ng-container>
      <ng-container slot="footer">
        <ng-container *ngIf="detail?.status === 'open'">
          <tm-button *ngIf="detail?.type === 'message' && !detail?.message_removed && detail?.message_in_chat" variant="danger" (clicked)="askRemove = true">Remove message</tm-button>
          <tm-button variant="ink" (clicked)="openClose()">Close report</tm-button>
        </ng-container>
      </ng-container>
    </tm-drawer>

    <tm-modal [open]="askRemove" title="Remove this message?" (closed)="askRemove = false">
      <ng-container slot="body">
        <p>The message is replaced in the chat by "removed by Dream Cabs". This can't be undone. The report stays open until you close it.</p>
      </ng-container>
      <ng-container slot="footer">
        <tm-button variant="ghost" (clicked)="askRemove = false">Back</tm-button>
        <tm-button variant="danger" [loading]="busy" (clicked)="removeMessage()">Remove message</tm-button>
      </ng-container>
    </tm-modal>

    <tm-modal [open]="askClose" title="Close this report" (closed)="askClose = false">
      <ng-container slot="body">
        <div class="choice" role="radiogroup" aria-label="Outcome">
          <label><input type="radio" name="outc" value="actioned" [(ngModel)]="outcome" /> <span><b>Actioned</b>: you removed the message, paused access or acted another way.</span></label>
          <label><input type="radio" name="outc" value="dismissed" [(ngModel)]="outcome" /> <span><b>Dismissed</b>: nothing needed doing.</span></label>
        </div>
        <p class="muted small" *ngIf="detail?.suggested_outcome">Suggested from what was done on this report: {{ statusLabel(detail!.suggested_outcome!) }}.</p>
        <label class="field"><span>Note (optional, kept in the history)</span><textarea rows="3" maxlength="1000" [(ngModel)]="note"></textarea></label>
      </ng-container>
      <ng-container slot="footer">
        <tm-button variant="ghost" (clicked)="askClose = false">Back</tm-button>
        <tm-button variant="ink" [loading]="busy" (clicked)="close()">Close report</tm-button>
      </ng-container>
    </tm-modal>
  `,
  styles: [CARPOOL_ADMIN_STYLES, `
    .num { font-variant-numeric: tabular-nums; color: var(--tm-text-muted); }
    .sub { display: block; color: var(--tm-text-muted); font-size: 12px; }
    .muted-inline { color: var(--tm-text-muted); margin-left: 8px; }
    .small { font-size: 12px; margin-top: 8px; }
    .eye { border: 0; background: var(--tm-canvas-2); width: 26px; height: 26px; border-radius: 50%; cursor: pointer; color: var(--tm-text-muted); display: inline-flex; align-items: center; justify-content: center; }
    .eye:hover { color: var(--tm-text); }
    .eye.is-on { background: var(--tm-ink); color: #fff; }
    .eye:focus-visible { outline: 2px solid var(--tm-green-deep); outline-offset: 2px; }
    blockquote { margin: 0 0 8px; padding: 12px 14px; background: var(--tm-canvas-2); border-radius: var(--tm-radius-md); font-size: 14px; line-height: 1.5; color: var(--tm-text); white-space: pre-wrap; overflow-wrap: anywhere; }
    .choice { display: grid; gap: 10px; margin: 0 0 12px; font-size: 14px; line-height: 1.4; }
    .choice label { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; }
    .choice input { margin-top: 3px; }
    app-carpool-access { margin-top: 8px; }
  `],
})
export class CarpoolReportsComponent implements OnInit {
  tab: 'open' | 'closed' = 'open';
  rows: Row[] = [];
  total = 0;
  page = 1;
  loading = false;
  search = '';
  reasonFilter = '';
  cityId = '';
  dateFrom = '';
  dateTo = '';
  reasonOptions: FilterOption[] = Object.entries(REPORT_REASONS).map(([value, label]) => ({ value, label }));
  cityOptions: FilterOption[] = [];
  detail: Detail | null = null;
  askClose = false;
  askRemove = false;
  showOriginal = false;
  note = '';
  outcome: 'actioned' | 'dismissed' = 'dismissed';
  busy = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private api: ApiService, private toast: ToastService, private route: ActivatedRoute, private router: Router) {}

  ngOnInit(): void {
    this.api.get<{ data: { id: number; name: string }[] }>('/admin/cities').subscribe({
      next: (r) => (this.cityOptions = (r.data ?? []).map((c) => ({ label: c.name, value: String(c.id) }))),
      error: () => (this.cityOptions = []),
    });
    this.load();
    const open = Number(this.route.snapshot.queryParamMap.get('open'));
    if (open) this.open(open);
  }

  setTab(t: 'open' | 'closed'): void { this.tab = t; this.reload(); }
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
    if (this.reasonFilter) p.set('reason', this.reasonFilter);
    if (this.cityId) p.set('city_id', this.cityId);
    if (this.dateFrom) p.set('date_from', this.dateFrom);
    if (this.dateTo) p.set('date_to', this.dateTo);
    this.api.get<{ data: Row[]; meta: { total: number } }>(`/admin/carpool/reports?${p}`).subscribe({
      next: (r) => { this.rows = r.data; this.total = r.meta.total; this.loading = false; },
      error: (e) => { this.loading = false; this.toast.error(e?.error?.message || 'Could not load reports.'); },
    });
  }

  open(id: number): void {
    this.api.get<{ data: Detail }>(`/admin/carpool/reports/${id}`).subscribe({
      next: (r) => { this.showOriginal = false; this.detail = r.data; },
      error: (e) => this.toast.error(e?.status === 404 ? 'That report is not in your cities or no longer exists.' : (e?.error?.message || 'Could not open this report.')),
    });
  }

  closeDrawer(): void {
    this.detail = null;
    if (this.route.snapshot.queryParamMap.get('open')) {
      this.router.navigate([], { queryParams: { open: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  refreshSuggestion(): void {
    if (this.detail) this.open(this.detail.id);
  }

  openClose(): void {
    this.note = '';
    this.outcome = this.detail?.suggested_outcome ?? 'dismissed';
    this.askClose = true;
  }

  removeMessage(): void {
    if (!this.detail) return;
    const id = this.detail.id;
    this.busy = true;
    this.api.post(`/admin/carpool/reports/${id}/remove-message`, {}).subscribe({
      next: () => { this.busy = false; this.askRemove = false; this.toast.success('Message removed.'); this.open(id); },
      error: (e) => { this.busy = false; this.askRemove = false; this.toast.error(e?.error?.errors?.carpool?.[0] || e?.error?.message || 'Could not remove.'); },
    });
  }

  close(): void {
    if (!this.detail) return;
    this.busy = true;
    this.api.post(`/admin/carpool/reports/${this.detail.id}/close`, { note: this.note.trim() || null, outcome: this.outcome }).subscribe({
      next: () => { this.busy = false; this.askClose = false; this.note = ''; this.toast.success('Report closed.'); this.closeDrawer(); this.load(); },
      error: (e) => { this.busy = false; this.toast.error(e?.error?.errors?.carpool?.[0] || e?.error?.message || 'Could not close.'); },
    });
  }

  when(iso: string): string { return inTime(iso); }
  reason(k: string): string { return reasonLabel(k); }
  statusLabel(s: string): string { return ({ open: 'Open', actioned: 'Actioned', dismissed: 'Dismissed' } as Record<string, string>)[s] ?? s; }
}
