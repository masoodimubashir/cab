import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/api.service';
import { ToastService } from '../../../core/toast.service';
import {
  ButtonComponent,
  ColumnComponent,
  DataTableComponent,
  IconComponent,
  InputComponent,
} from '../../../ui';

type DocsFilter = 'all' | 'uploaded' | 'not_uploaded';

interface DriverRow {
  id: number;
  approval_status: 'pending' | 'approved' | 'rejected';
  vehicle_type: string | null;
  vehicle_reg_no: string | null;
  is_online: boolean;
  user: {
    id: number;
    name: string;
    phone: string | null;
    email: string | null;
    avatar_path?: string | null;
    avatar_url?: string | null;
  } | null;
}

const FILTER_OPTIONS: { value: DocsFilter; label: string }[] = [
  { value: 'all',          label: 'All' },
  { value: 'uploaded',     label: 'Docs uploaded' },
  { value: 'not_uploaded', label: 'No docs yet' },
];

/**
 * Approvals tab: lists drivers filtered by document-upload status. Row click
 * opens the detail drawer via `?driverId=…` (the shell mounts the drawer).
 */
@Component({
  selector: 'app-drivers-approvals-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    ColumnComponent,
    DataTableComponent,
    IconComponent,
    InputComponent,
  ],
  template: `
    <div class="page">
      <header class="page__hero">
        <div class="page__hero-left">
          <span class="page__eyebrow">
            <span class="page__eyebrow-dot" aria-hidden="true"></span> Approvals
          </span>
          <p class="page__subtitle">
            Review drivers' uploaded documents, set their vehicle registration, and approve or reject them.
          </p>
        </div>
      </header>

      <tm-data-table
        [rows]="rows"
        [total]="total"
        [page]="page"
        [pageSize]="pageSize"
        [pageSizes]="[10, 25, 50, 100]"
        [loading]="loading"
        emptyTitle="No drivers"
        emptyHint="Try a different search or filter."
        (pageChange)="onPageChange($event)"
        (pageSizeChange)="onPageSizeChange($event)"
        (rowClick)="openDrawer($event.id)"
      >
        <tm-input
          slot="search"
          icon="search"
          placeholder="Search by name, phone or email…"
          [(ngModel)]="search"
          (ngModelChange)="onSearchChange()"
        />

        <ng-container slot="filters">
          <div class="segmented" role="group" aria-label="Document filter">
            <button
              *ngFor="let opt of filterOptions"
              type="button"
              class="segmented__btn"
              [class.is-active]="docsFilter === opt.value"
              (click)="setDocsFilter(opt.value)"
            >{{ opt.label }}</button>
          </div>
        </ng-container>

        <tm-column key="id" label="Driver ID" width="110">
          <ng-template let-row>
            <span class="cell-id">#{{ row.id }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="name" label="Driver">
          <ng-template let-row>
            <div class="cell-user">
              <span
                class="cell-avatar"
                [class.cell-avatar--photo]="row.user?.avatar_url || row.user?.avatar_path"
                [style.backgroundImage]="(row.user?.avatar_url || row.user?.avatar_path) ? 'url(' + (row.user?.avatar_url || row.user?.avatar_path) + ')' : null"
              >
                <ng-container *ngIf="!(row.user?.avatar_url || row.user?.avatar_path)">{{ initials(row.user?.name) }}</ng-container>
              </span>
              <div class="cell-user__meta">
                <span class="cell-user__name">{{ row.user?.name || 'Unnamed' }}</span>
                <span class="cell-user__sub" *ngIf="row.vehicle_type || row.vehicle_reg_no">
                  {{ row.vehicle_type || '—' }}
                  <span *ngIf="row.vehicle_reg_no" class="mono"> · {{ row.vehicle_reg_no }}</span>
                </span>
              </div>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="contact" label="Contact" width="240">
          <ng-template let-row>
            <div class="cell-contact">
              <span class="cell-contact__email" [class.muted]="!row.user?.email">
                {{ row.user?.email || '—' }}
              </span>
              <span class="cell-contact__phone mono">{{ row.user?.phone || '—' }}</span>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="approval" label="Approval" width="140">
          <ng-template let-row>
            <span class="status-pill"
                  [class.is-approved]="row.approval_status === 'approved'"
                  [class.is-rejected]="row.approval_status === 'rejected'"
                  [class.is-pending]="row.approval_status === 'pending'">
              <span class="status-dot"></span>
              {{ row.approval_status }}
            </span>
          </ng-template>
        </tm-column>

        <tm-column key="online" label="Activity" width="110">
          <ng-template let-row>
            <span class="status-pill"
                  [class.is-online]="row.is_online"
                  [class.is-offline]="!row.is_online">
              <span class="status-dot"></span>
              {{ row.is_online ? 'Online' : 'Offline' }}
            </span>
          </ng-template>
        </tm-column>

        <tm-column key="action" label="" width="120" align="right">
          <ng-template let-row>
            <tm-button variant="outline" size="sm" (clicked)="openDrawer(row.id, $event)">
              Details
            </tm-button>
          </ng-template>
        </tm-column>
      </tm-data-table>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .page { display: flex; flex-direction: column; gap: var(--tm-space-5); }
    .page__hero-left { min-width: 0; }
    .page__eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      margin-bottom: var(--tm-space-2);
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: var(--tm-text);
      line-height: 1.2;
    }
    .page__eyebrow-dot {
      width: 9px; height: 9px;
      border-radius: 50%;
      background: var(--tm-green);
      box-shadow: 0 0 0 4px var(--tm-green-soft);
    }
    .page__subtitle {
      font-size: 14px;
      color: var(--tm-text-muted);
      font-weight: 500;
      margin: 0;
      max-width: 60ch;
    }

    /* Segmented filter — same shape as the table/graph toggle elsewhere */
    .segmented {
      display: inline-flex;
      padding: 3px;
      background: var(--tm-canvas-2);
      border-radius: var(--tm-radius-md);
      gap: 2px;
    }
    .segmented__btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 12px;
      border: 0;
      background: transparent;
      color: var(--tm-text-muted);
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      border-radius: calc(var(--tm-radius-md) - 3px);
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .segmented__btn:hover:not(.is-active) { color: var(--tm-text); }
    .segmented__btn.is-active {
      background: var(--tm-surface);
      color: var(--tm-text);
      box-shadow: 0 1px 3px rgba(15,20,25,0.08);
    }

    /* Cells */
    .cell-id {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border-radius: var(--tm-radius-pill);
      background: var(--tm-green-tint);
      color: var(--tm-green-deep);
      font-family: var(--tm-font-mono);
      font-size: 11px;
      font-weight: 800;
    }
    .cell-user {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .cell-avatar {
      width: 32px; height: 32px;
      border-radius: 50%;
      display: grid; place-items: center;
      background: linear-gradient(135deg, var(--tm-ink), var(--tm-ink-3));
      color: #fff;
      font-size: 11px;
      font-weight: 800;
      flex-shrink: 0;
    }
    /* --photo must come AFTER .cell-avatar — same specificity, later wins, and
       .cell-avatar uses the background shorthand which resets background-image. */
    .cell-avatar--photo {
      background: var(--tm-canvas-2);
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
    }
    .cell-user__meta { display: flex; flex-direction: column; min-width: 0; }
    .cell-user__name {
      font-weight: 700;
      font-size: 13px;
      color: var(--tm-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cell-user__sub {
      font-size: 11px;
      font-weight: 600;
      color: var(--tm-text-muted);
    }
    .cell-contact { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .cell-contact__email {
      font-size: 13px;
      font-weight: 600;
      color: var(--tm-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cell-contact__email.muted { color: var(--tm-text-soft); }
    .cell-contact__phone { font-size: 12px; color: var(--tm-text-muted); }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: var(--tm-radius-pill);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border: 1px solid transparent;
    }
    .status-pill .status-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: currentColor;
      flex-shrink: 0;
    }
    .status-pill.is-online      { background: var(--tm-green-tint); color: var(--tm-green-deep); border-color: var(--tm-green-soft); }
    .status-pill.is-offline     { background: var(--tm-surface);    color: var(--tm-text-muted); border-color: var(--tm-line-2); }
    .status-pill.is-approved    { background: var(--tm-green-tint); color: var(--tm-green-deep); border-color: var(--tm-green-soft); }
    .status-pill.is-rejected    { background: #fef2f2;              color: #dc2626;              border-color: #fecaca; }
    .status-pill.is-pending     { background: #fffbeb;              color: #b45309;              border-color: #fde68a; }

    .mono { font-family: var(--tm-font-mono); font-weight: 600; font-size: 12px; }

    /* Search input matches the height of the segmented control */
    :host ::ng-deep tm-data-table .tm-dt__toolbar tm-input .field {
      background: transparent;
      border-color: var(--tm-line-2);
      padding: 9px 14px;
      gap: 8px;
    }
    :host ::ng-deep tm-data-table .tm-dt__toolbar tm-input .field:focus-within {
      border-color: var(--tm-ink);
      background: var(--tm-surface);
    }
    :host ::ng-deep tm-data-table .tm-dt__toolbar tm-input input {
      font-size: 13px;
      line-height: 1.2;
    }
  `],
})
export class DriversApprovalsTabComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly filterOptions = FILTER_OPTIONS;

  rows: DriverRow[] = [];
  total = 0;
  loading = false;

  search = '';
  docsFilter: DocsFilter = 'all';
  page = 1;
  pageSize = 25;

  private searchDebounce: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private refreshInFlight = false;

  ngOnInit(): void {
    this.reload();
    this.startLiveRefresh();
  }

  ngOnDestroy(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  private startLiveRefresh(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => {
      if (this.refreshInFlight) return;
      this.reload(true);
    }, 5000);
  }

  reload(silent = false): void {
    if (this.refreshInFlight) return;
    this.refreshInFlight = true;
    if (!silent) this.loading = true;
    const params = new URLSearchParams({
      page: String(this.page),
      per_page: String(this.pageSize),
    });
    if (this.docsFilter === 'uploaded') params.set('has_documents', '1');
    else if (this.docsFilter === 'not_uploaded') params.set('has_documents', '0');
    if (this.search.trim()) params.set('q', this.search.trim());

    this.api
      .get<{ data: { data: DriverRow[]; total: number } }>(`/admin/drivers?${params.toString()}`)
      .subscribe({
        next: (res) => {
          this.rows = res?.data?.data ?? [];
          this.total = res?.data?.total ?? 0;
          this.loading = false;
          this.refreshInFlight = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.loading = false;
          this.refreshInFlight = false;
          if (!silent) this.toast.error(err?.error?.message || 'Could not load drivers', { title: 'Load failed' });
          this.cdr.markForCheck();
        },
      });
  }

  onSearchChange(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => {
      this.page = 1;
      this.reload();
    }, 300);
  }

  setDocsFilter(f: DocsFilter): void {
    if (this.docsFilter === f) return;
    this.docsFilter = f;
    this.page = 1;
    this.reload();
  }

  onPageChange(p: number): void { this.page = p; this.reload(); }
  onPageSizeChange(s: number): void { this.pageSize = s; this.page = 1; this.reload(); }

  openDrawer(id: number, event?: Event): void {
    event?.stopPropagation();
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { driverId: id },
      queryParamsHandling: 'merge',
    });
  }

  initials(name: string | null | undefined): string {
    if (!name) return '—';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '—';
    const a = parts[0][0] || '';
    const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (a + b).toUpperCase();
  }
}
