import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import {
  ButtonComponent, ColumnComponent, DataTableComponent, DrawerComponent, IconComponent, ModalComponent, StatusPillComponent,
} from '../../ui';
import { CarpoolAccessComponent } from './carpool-access.component';
import { CARPOOL_ADMIN_STYLES } from './carpool-admin.styles';


interface Row {
  id: number;
  created_at: string;
  type: 'message' | 'person';
  reported_by: string | null;
  reported_person: string | null;
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
  reported_user_id: number;
  reported_banned: boolean;
  earlier_reports: number;
  impact: { is_driver: boolean; upcoming_carpools: number } | null;
}

/** Carpool > Reports (Carpool.md section 10). Neither side is told the outcome. */
@Component({
  selector: 'app-carpool-reports',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, ColumnComponent, DataTableComponent, DrawerComponent, IconComponent, ModalComponent, StatusPillComponent, CarpoolAccessComponent],
  template: `
    <div class="page">
      <header>
        <h1 class="page__title">Carpool reports</h1>
        <p class="page__sub">Messages and people reported by riders and drivers. Nobody is told the outcome.</p>
      </header>

      <div class="tabs">
        <button type="button" [class.is-on]="tab === 'open'" (click)="setTab('open')">Open</button>
        <button type="button" [class.is-on]="tab === 'closed'" (click)="setTab('closed')">Closed</button>
      </div>

      <tm-data-table [rows]="rows" [total]="total" [page]="page" [pageSize]="25" [pageSizes]="[25]" [loading]="loading"
        [emptyTitle]="tab === 'open' ? 'No open reports' : 'Nothing closed yet'" emptyHint="" (pageChange)="goto($event)" (rowClick)="open($event)">
        <tm-column key="created_at" label="When" width="140"><ng-template let-row>{{ when(row.created_at) }}</ng-template></tm-column>
        <tm-column key="type" label="Type" width="90"><ng-template let-row>{{ row.type === 'message' ? 'Message' : 'Person' }}</ng-template></tm-column>
        <tm-column key="reported_by" label="Reported by"><ng-template let-row>{{ row.reported_by || '—' }}</ng-template></tm-column>
        <tm-column key="reported_person" label="Reported person"><ng-template let-row>{{ row.reported_person || '—' }}</ng-template></tm-column>
        <tm-column key="reason" label="Reason" width="130"><ng-template let-row>{{ row.reason }}</ng-template></tm-column>
        <tm-column key="listing_id" label="Carpool" width="90"><ng-template let-row>{{ row.listing_id ? '#' + row.listing_id : '—' }}</ng-template></tm-column>
        <tm-column key="status" label="Status" width="120">
          <ng-template let-row><tm-status-pill [tone]="row.status === 'open' ? 'warning' : row.status === 'actioned' ? 'success' : 'neutral'">{{ row.status }}</tm-status-pill></ng-template>
        </tm-column>
      </tm-data-table>
    </div>

    <tm-drawer [open]="!!detail" [title]="detail ? (detail.type === 'message' ? 'Message report' : 'Person report') : ''" [subtitle]="detail ? '#' + detail.id : ''" (closed)="detail = null">
      <ng-container slot="body" *ngIf="detail as d">
        <dl class="kv">
          <dt>Reason</dt><dd>{{ d.reason }}</dd>
          <dt>Details</dt><dd>{{ d.details || '—' }}</dd>
          <dt>Reported by</dt><dd>{{ d.reported_by }}</dd>
          <dt>Reported person</dt><dd>{{ d.reported_person }}</dd>
          <dt>Earlier reports</dt><dd>{{ d.earlier_reports }}</dd>
          <dt>Carpool</dt><dd>{{ d.listing_id ? '#' + d.listing_id : '—' }}</dd>
          <ng-container *ngIf="d.note"><dt>Note</dt><dd>{{ d.note }}</dd></ng-container>
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
          <blockquote>{{ showOriginal && d.original_text ? d.original_text : d.message_text }}</blockquote>
          <p class="muted" *ngIf="showOriginal && d.original_text">Showing what was typed. Only admins see this.</p>
          <p class="muted" *ngIf="showOriginal && !d.original_text">Nothing was hidden in this message, or it was sent before the original was kept.</p>
          <p class="muted" *ngIf="d.message_removed">Removed from the chat by Dream Cabs.</p>
        </ng-container>
        <app-carpool-access [userId]="d.reported_user_id" [banned]="d.reported_banned" (changed)="d.reported_banned = $event"></app-carpool-access>
      </ng-container>
      <ng-container slot="footer">
        <ng-container *ngIf="detail?.status === 'open'">
          <tm-button *ngIf="detail?.type === 'message' && !detail?.message_removed" variant="danger" [loading]="busy" (clicked)="removeMessage()">Remove message</tm-button>
          <tm-button variant="ink" (clicked)="askClose = true">Close report</tm-button>
        </ng-container>
      </ng-container>
    </tm-drawer>

    <tm-modal [open]="askClose" title="Close this report" (closed)="askClose = false">
      <ng-container slot="body">
        <p>It is recorded as Actioned if you removed the message or paused the person's access, otherwise Dismissed.</p>
        <label class="field"><span>Note (optional)</span><textarea rows="3" maxlength="1000" [(ngModel)]="note"></textarea></label>
      </ng-container>
      <ng-container slot="footer">
        <tm-button variant="ghost" (clicked)="askClose = false">Back</tm-button>
        <tm-button variant="ink" [loading]="busy" (clicked)="close()">Close report</tm-button>
      </ng-container>
    </tm-modal>
  `,
  styles: [CARPOOL_ADMIN_STYLES, `
    .eye { border: 0; background: var(--tm-canvas-2); width: 26px; height: 26px; border-radius: 50%; cursor: pointer; color: var(--tm-text-muted); display: inline-flex; align-items: center; justify-content: center; }
    .eye:hover { color: var(--tm-text); }
    .eye.is-on { background: var(--tm-ink); color: #fff; }
    .eye:focus-visible { outline: 2px solid var(--tm-green-deep); outline-offset: 2px; }
    blockquote { margin: 0 0 8px; padding: 12px 14px; background: var(--tm-canvas-2); border-radius: var(--tm-radius-md); font-size: 14px; line-height: 1.5; color: var(--tm-text); white-space: pre-wrap; overflow-wrap: anywhere; }
  `],
})
export class CarpoolReportsComponent implements OnInit {
  tab: 'open' | 'closed' = 'open';
  rows: Row[] = [];
  total = 0;
  page = 1;
  loading = false;
  detail: Detail | null = null;
  askClose = false;
  showOriginal = false;
  note = '';
  busy = false;

  constructor(private api: ApiService, private toast: ToastService) {}

  ngOnInit(): void {
    this.load();
  }

  setTab(t: 'open' | 'closed'): void {
    this.tab = t;
    this.page = 1;
    this.load();
  }

  goto(p: number): void {
    this.page = p;
    this.load();
  }

  load(): void {
    this.loading = true;
    this.api.get<{ data: Row[]; meta: { total: number } }>(`/admin/carpool/reports?tab=${this.tab}&page=${this.page}`).subscribe({
      next: (r) => { this.rows = r.data; this.total = r.meta.total; this.loading = false; },
      error: (e) => { this.loading = false; this.toast.error(e?.error?.message || 'Could not load reports.'); },
    });
  }

  open(row: Row): void {
    this.api.get<{ data: Detail }>(`/admin/carpool/reports/${row.id}`).subscribe({
      next: (r) => { this.showOriginal = false; this.detail = r.data; },
      error: (e) => this.toast.error(e?.error?.message || 'Could not open this report.'),
    });
  }

  removeMessage(): void {
    if (!this.detail) return;
    this.busy = true;
    this.api.post(`/admin/carpool/reports/${this.detail.id}/remove-message`, {}).subscribe({
      next: () => { this.busy = false; if (this.detail) this.detail.message_removed = true; this.toast.success('Message removed.'); },
      error: (e) => { this.busy = false; this.toast.error(e?.error?.errors?.carpool?.[0] || e?.error?.message || 'Could not remove.'); },
    });
  }

  close(): void {
    if (!this.detail) return;
    this.busy = true;
    this.api.post(`/admin/carpool/reports/${this.detail.id}/close`, { note: this.note.trim() || null }).subscribe({
      next: () => { this.busy = false; this.askClose = false; this.detail = null; this.note = ''; this.toast.success('Report closed.'); this.load(); },
      error: (e) => { this.busy = false; this.toast.error(e?.error?.errors?.carpool?.[0] || e?.error?.message || 'Could not close.'); },
    });
  }

  when(iso: string): string {
    return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  }
}
