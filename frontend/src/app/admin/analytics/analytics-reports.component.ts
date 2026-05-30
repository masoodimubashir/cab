import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import $ from 'jquery';
import moment from 'moment';
import 'daterangepicker';
import { ApiService } from '../../core/api.service';
import {
  ButtonComponent,
  DrawerComponent,
  IconComponent,
  InputComponent,
} from '../../ui';

interface ReportColumn { key: string; label: string; }
interface ReportDef {
  key: string;
  name: string;
  type: string;
  tags: string[];
  columns: ReportColumn[];
  description?: string | null;
}
interface ReportRunResponse {
  report: ReportDef;
  from: string;
  to: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
}
interface RecentRun {
  key: string;
  name: string;
  ranAt: number;
  from: string;
  to: string;
  rows: number;
}

/**
 * Analytics → Reports.
 *
 * The catalogue is a searchable card grid (icon, name, description, tag pills,
 * Run button). Picking a report opens a side drawer with a date range,
 * Run/Export buttons, and a table of the result rows. Recent runs persist in
 * localStorage so re-running a report you opened yesterday is one click away.
 */
@Component({
  selector: 'app-analytics-reports',
  standalone: true,
  imports: [
    CommonModule, FormsModule, DatePipe, RouterLink, RouterLinkActive,
    ButtonComponent, DrawerComponent, IconComponent, InputComponent,
  ],
  template: `
    <div class="page">
      <!-- Hero + sub-nav -->
      <header class="hero">
        <div class="hero__left">
          <span class="hero__eyebrow">Analytics</span>
          <h1 class="hero__title">Reports</h1>
          <p class="hero__sub">Browse the catalogue, run a report, export to CSV.</p>
        </div>
        <nav class="subnav" aria-label="Analytics sections">
          <a class="subnav__btn" routerLink="/analytics/real-time" routerLinkActive="is-on">
            <tm-icon name="bolt" [size]="13" /> Real Time
          </a>
          <a class="subnav__btn" routerLink="/analytics/graphs" routerLinkActive="is-on">
            <tm-icon name="chart-bar" [size]="13" /> Graphs
          </a>
          <a class="subnav__btn" routerLink="/analytics/reports" routerLinkActive="is-on">
            <tm-icon name="chart-line" [size]="13" /> Reports
          </a>
        </nav>
      </header>

      <!-- Search -->
      <div class="search">
        <tm-input icon="search" placeholder="Search reports by name or tag…" [(ngModel)]="search" (ngModelChange)="onSearch()" />
      </div>

      <!-- Recent runs -->
      <section *ngIf="recent.length" class="recent">
        <h3 class="section__title">Recently run</h3>
        <div class="recent__row">
          <button
            *ngFor="let r of recent"
            type="button"
            class="recent__chip"
            (click)="openByKey(r.key, r.from, r.to)"
            [title]="'Last run ' + (r.ranAt | date:'dd MMM, HH:mm')"
          >
            <span class="recent__name">{{ r.name }}</span>
            <span class="recent__meta">{{ r.rows }} rows · {{ r.from }} → {{ r.to }}</span>
          </button>
        </div>
      </section>

      <!-- Catalogue grid -->
      <section class="catalogue">
        <h3 class="section__title">Catalogue</h3>

        <div *ngIf="filteredReports.length; else emptyState" class="catalogue__grid">
          <article
            *ngFor="let r of filteredReports"
            class="rcard"
            (click)="open(r)"
          >
            <div class="rcard__icon" [attr.data-type]="r.type">
              <tm-icon [name]="iconFor(r.type)" [size]="16" />
            </div>
            <div class="rcard__body">
              <h4 class="rcard__name">{{ r.name }}</h4>
              <p class="rcard__desc">{{ r.description || defaultDesc(r) }}</p>
              <div class="rcard__tags">
                <span class="rcard__type">{{ r.type }}</span>
                <span *ngFor="let t of r.tags" class="rcard__tag">{{ t }}</span>
              </div>
            </div>
            <span class="rcard__arrow" aria-hidden="true">
              <tm-icon name="chevron-right" [size]="14" />
            </span>
          </article>
        </div>

        <ng-template #emptyState>
          <div class="cue">
            <tm-icon name="chart-line" [size]="24" />
            <p class="cue__title">No reports match "{{ search }}"</p>
            <p class="cue__text">Clear the search or try a different keyword.</p>
          </div>
        </ng-template>
      </section>
    </div>

    <!-- Drilldown drawer -->
    <tm-drawer
      [open]="!!opened"
      [title]="opened?.name || ''"
      [subtitle]="opened?.type"
      [width]="720"
      (closed)="close()"
    >
      <div slot="body" *ngIf="opened" class="drawer">
        <div class="drawer__range">
          <span class="drawer__range-label">Date range</span>
          <div class="date-range" [class.has-value]="from && to">
            <span class="date-range__icon"><tm-icon name="calendar" [size]="13" /></span>
            <input
              #rangeInput
              type="text"
              readonly
              class="date-range__input"
              placeholder="Pick a range"
              [value]="rangeLabel"
              aria-label="Filter by date range"
            />
          </div>
          <tm-button variant="green" icon="send" [disabled]="loading" (clicked)="run()">
            {{ loading ? 'Running…' : 'Run' }}
          </tm-button>
          <tm-button variant="outline" icon="download" [disabled]="!result" (clicked)="exportCsv()">
            CSV
          </tm-button>
        </div>

        <p *ngIf="error" class="msg msg--err">{{ error }}</p>

        <div *ngIf="result" class="result">
          <div class="result__meta">
            <strong>{{ result.rows.length }}</strong> rows · {{ result.from }} → {{ result.to }}
          </div>
          <div class="result__scroll">
            <table class="tbl">
              <thead>
                <tr>
                  <th *ngFor="let c of result.columns">{{ c.label }}</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of result.rows.slice(0, 200)">
                  <td *ngFor="let c of result.columns">{{ formatCell(row[c.key]) }}</td>
                </tr>
                <tr *ngIf="!result.rows.length">
                  <td [attr.colspan]="result.columns.length" class="tbl__empty">No rows for this range.</td>
                </tr>
              </tbody>
            </table>
            <p *ngIf="result.rows.length > 200" class="muted small">
              Showing 200 of {{ result.rows.length }} rows · download CSV for the full set.
            </p>
          </div>
        </div>
      </div>
    </tm-drawer>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 18px; }

    /* hero + subnav */
    .hero { display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 14px; }
    .hero__eyebrow { font: 800 11px var(--tm-font-body); text-transform: uppercase; letter-spacing: 0.08em; color: var(--tm-text-muted); }
    .hero__title { margin: 4px 0 4px; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .hero__sub { margin: 0; font-size: 13px; color: var(--tm-text-muted); }
    .subnav { display: inline-flex; gap: 4px; padding: 4px; background: var(--tm-canvas-2); border-radius: var(--tm-radius-md, 10px); }
    .subnav__btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 7px 13px; border-radius: 8px;
      background: transparent; color: var(--tm-text-muted);
      text-decoration: none; font: 700 13px var(--tm-font-body);
    }
    .subnav__btn:hover { color: var(--tm-text); }
    .subnav__btn.is-on { background: var(--tm-surface); color: var(--tm-text); box-shadow: var(--tm-shadow-sm); }

    /* search */
    .search { max-width: 480px; }

    .section__title { margin: 0 0 10px; font: 800 11px var(--tm-font-body); text-transform: uppercase; letter-spacing: 0.08em; color: var(--tm-text-muted); }

    /* recent runs */
    .recent__row { display: flex; gap: 8px; flex-wrap: wrap; }
    .recent__chip {
      display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
      padding: 8px 14px;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      background: var(--tm-surface);
      color: var(--tm-text);
      text-align: left;
      cursor: pointer;
      transition: border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .recent__chip:hover { border-color: var(--tm-ink); }
    .recent__name { font: 800 12px var(--tm-font-body); }
    .recent__meta { font: 600 11px var(--tm-font-mono); color: var(--tm-text-muted); }

    /* catalogue */
    .catalogue__grid {
      display: grid; gap: 12px;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    }
    .rcard {
      display: flex; gap: 14px; align-items: flex-start;
      padding: 16px;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      cursor: pointer;
      transition: transform var(--tm-duration-fast) var(--tm-ease),
                  border-color var(--tm-duration-fast) var(--tm-ease),
                  box-shadow var(--tm-duration-fast) var(--tm-ease);
    }
    .rcard:hover {
      transform: translateY(-1px);
      border-color: var(--tm-ink);
      box-shadow: 0 8px 24px -12px rgba(15, 23, 42, 0.18);
    }
    .rcard__icon {
      display: inline-grid; place-items: center;
      width: 38px; height: 38px; flex: none;
      border-radius: 10px;
      background: var(--tm-green-tint);
      color: var(--tm-green-deep);
    }
    .rcard__icon[data-type="trips"] { background: rgba(15, 122, 63, 0.12); color: #0f7a3f; }
    .rcard__icon[data-type="drivers"] { background: rgba(124, 58, 237, 0.12); color: #7c3aed; }
    .rcard__icon[data-type="finance"], .rcard__icon[data-type="revenue"] { background: rgba(180, 83, 9, 0.12); color: #b45309; }
    .rcard__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    .rcard__name { margin: 0; font: 800 14px var(--tm-font-body); color: var(--tm-text); }
    .rcard__desc { margin: 0; font: 500 12px var(--tm-font-body); color: var(--tm-text-muted); line-height: 1.45; }
    .rcard__tags { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px; }
    .rcard__type, .rcard__tag {
      display: inline-flex; align-items: center;
      padding: 2px 8px; border-radius: var(--tm-radius-pill);
      font: 800 10px var(--tm-font-body);
      letter-spacing: 0.04em; text-transform: capitalize;
    }
    .rcard__type { background: var(--tm-info-bg, #dbeafe); color: var(--tm-info-fg, #1e40af); }
    .rcard__tag { background: var(--tm-canvas-2); color: var(--tm-text-muted); }
    .rcard__arrow {
      color: var(--tm-text-soft);
      transition: color var(--tm-duration-fast) var(--tm-ease),
                  transform var(--tm-duration-fast) var(--tm-ease);
    }
    .rcard:hover .rcard__arrow { color: var(--tm-ink); transform: translateX(2px); }

    /* empty state */
    .cue {
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      padding: 48px 24px; text-align: center;
      background: var(--tm-surface); border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg); color: var(--tm-text-muted);
    }
    .cue__title { margin: 4px 0 0; font: 800 14px var(--tm-font-body); color: var(--tm-text); }
    .cue__text { margin: 0; font-size: 13px; }

    /* drawer */
    .drawer { display: flex; flex-direction: column; gap: 14px; }
    .drawer__range {
      display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
    }
    .drawer__range-label {
      font: 800 11px var(--tm-font-body); text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--tm-text-muted); margin-right: 4px;
    }

    .date-range {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 12px;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      cursor: pointer;
    }
    .date-range:focus-within { border-color: var(--tm-ink); }
    .date-range.has-value { background: var(--tm-green-tint); border-color: var(--tm-green-deep); }
    .date-range.has-value .date-range__icon { color: var(--tm-green-deep); }
    .date-range__icon { color: var(--tm-text-muted); display: inline-flex; }
    .date-range__input {
      background: transparent; border: 0; outline: 0;
      font: 700 12px var(--tm-font-mono);
      color: var(--tm-text); min-width: 200px; padding: 0; cursor: pointer;
    }
    .date-range__input::placeholder { color: var(--tm-text-soft); }

    :host ::ng-deep .daterangepicker {
      font-family: var(--tm-font-body) !important;
      border-radius: var(--tm-radius-md);
      border: 1px solid var(--tm-line-2);
      box-shadow: var(--tm-shadow-pop);
    }
    :host ::ng-deep .daterangepicker .btn-primary,
    :host ::ng-deep .daterangepicker .btn-success {
      background: var(--tm-ink); border-color: var(--tm-ink);
      border-radius: var(--tm-radius-sm); font-weight: 700;
    }
    :host ::ng-deep .daterangepicker .ranges li.active,
    :host ::ng-deep .daterangepicker td.active,
    :host ::ng-deep .daterangepicker td.active:hover {
      background: var(--tm-ink); color: #fff;
    }
    :host ::ng-deep .daterangepicker td.in-range { background: var(--tm-green-tint); color: var(--tm-green-deep); }

    .msg { margin: 0; padding: 8px 12px; border-radius: var(--tm-radius-md); font: 700 12px var(--tm-font-body); }
    .msg--err { background: var(--tm-danger-bg, #fee2e2); color: var(--tm-danger-fg, #b91c1c); }

    /* result table */
    .result__meta { font: 700 12px var(--tm-font-body); color: var(--tm-text); }
    .result__meta strong { font-family: var(--tm-font-mono); color: var(--tm-text); }
    .result__scroll { overflow-x: auto; }
    .tbl {
      width: 100%; min-width: 600px;
      border-collapse: collapse;
      font: 13px var(--tm-font-body);
    }
    .tbl th, .tbl td {
      text-align: left; padding: 9px 10px;
      border-bottom: 1px solid var(--tm-line);
      white-space: nowrap;
    }
    .tbl th {
      font: 800 11px var(--tm-font-body);
      text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--tm-text-muted);
      background: var(--tm-canvas-2);
    }
    .tbl td { color: var(--tm-text); }
    .tbl tbody tr:hover { background: var(--tm-canvas-2); }
    .tbl__empty { text-align: center; color: var(--tm-text-muted); padding: 32px 0 !important; }

    .muted { color: var(--tm-text-muted); }
    .small { font-size: 11px; }
  `],
})
export class AnalyticsReportsComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('rangeInput', { static: false }) rangeInput!: ElementRef<HTMLInputElement>;

  reports: ReportDef[] = [];
  search = '';
  opened: ReportDef | null = null;

  from = moment().subtract(30, 'days').format('YYYY-MM-DD');
  to = moment().format('YYYY-MM-DD');

  result: ReportRunResponse | null = null;
  error: string | null = null;
  loading = false;

  recent: RecentRun[] = [];
  private storageKey = 'dreamcabs_recent_reports_v1';
  private searchDebounce: any = null;

  constructor(private api: ApiService, private zone: NgZone) {}

  ngOnInit(): void {
    this.fetch();
    this.recent = this.loadRecent();
  }

  ngAfterViewInit(): void {
    // The drawer mounts later — picker is initialised when opened.
  }

  ngOnDestroy(): void {
    this.destroyDateRangePicker();
  }

  // ── Search / catalogue ──────────────────────────────────────────
  onSearch(): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => this.fetch(), 250);
  }

  get filteredReports(): ReportDef[] {
    const term = this.search.trim().toLowerCase();
    if (!term) return this.reports;
    return this.reports.filter((r) =>
      r.name.toLowerCase().includes(term)
      || (r.tags || []).some((t) => t.toLowerCase().includes(term))
      || r.type.toLowerCase().includes(term),
    );
  }

  fetch(): void {
    const qs = this.search ? `?search=${encodeURIComponent(this.search)}` : '';
    this.api.get<{ data: ReportDef[] }>(`/admin/analytics/reports${qs}`).subscribe({
      next: (r) => (this.reports = r?.data || []),
    });
  }

  iconFor(type: string): 'chart-bar' | 'chart-line' | 'rupee' | 'user' | 'car' | 'shield' {
    const t = (type || '').toLowerCase();
    if (t.includes('finance') || t.includes('revenue') || t.includes('payment')) return 'rupee';
    if (t.includes('driver')) return 'user';
    if (t.includes('trip') || t.includes('ride')) return 'car';
    if (t.includes('compliance') || t.includes('safety')) return 'shield';
    if (t.includes('time')) return 'chart-line';
    return 'chart-bar';
  }

  defaultDesc(r: ReportDef): string {
    const cols = (r.columns || []).map((c) => c.label).slice(0, 4).join(', ');
    return cols ? `Columns include ${cols}${(r.columns?.length ?? 0) > 4 ? '…' : ''}.` : 'Tabular data export.';
  }

  // ── Drawer ──────────────────────────────────────────────────────
  open(r: ReportDef): void {
    this.opened = r;
    this.result = null;
    this.error = null;
    setTimeout(() => this.initDateRangePicker(), 30);
    this.run();
  }
  openByKey(key: string, from: string, to: string): void {
    const r = this.reports.find((x) => x.key === key);
    if (!r) return;
    this.from = from;
    this.to = to;
    this.open(r);
  }
  close(): void {
    this.opened = null;
    this.result = null;
    this.destroyDateRangePicker();
  }

  run(): void {
    if (!this.opened) return;
    const qs = `?from=${this.from}&to=${this.to}`;
    this.loading = true;
    this.error = null;
    this.api.get<ReportRunResponse>(`/admin/analytics/reports/${this.opened.key}${qs}`).subscribe({
      next: (r) => {
        this.result = r;
        this.loading = false;
        this.pushRecent({
          key: this.opened!.key,
          name: this.opened!.name,
          ranAt: Date.now(),
          from: this.from,
          to: this.to,
          rows: r.rows.length,
        });
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to run report';
        this.loading = false;
      },
    });
  }

  exportCsv(): void {
    if (!this.opened) return;
    const qs = `?from=${this.from}&to=${this.to}`;
    this.api.getBlob(`/admin/analytics/reports/${this.opened.key}/export${qs}`).subscribe((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.opened!.key}_${moment().format('YYYY-MM-DD')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  formatCell(v: unknown): string {
    if (v == null || v === '') return '—';
    return String(v);
  }

  // ── Date range picker (mounted lazily once the drawer opens) ────
  get rangeLabel(): string {
    if (!this.from || !this.to) return '';
    return `${this.from} → ${this.to}`;
  }

  private initDateRangePicker(): void {
    if (!this.rangeInput?.nativeElement) return;
    this.destroyDateRangePicker();
    const $el = $(this.rangeInput.nativeElement);
    $el.daterangepicker(
      {
        autoApply: true,
        autoUpdateInput: false,
        opens: 'left',
        maxDate: moment(),
        startDate: moment(this.from),
        endDate: moment(this.to),
        alwaysShowCalendars: true,
        locale: { format: 'YYYY-MM-DD', cancelLabel: 'Clear', applyLabel: 'Apply' },
        ranges: {
          Today:        [moment(), moment()],
          'Last 7 days':  [moment().subtract(6, 'days'), moment()],
          'Last 30 days': [moment().subtract(29, 'days'), moment()],
          'Last 90 days': [moment().subtract(89, 'days'), moment()],
          'This month':   [moment().startOf('month'), moment().endOf('month')],
          'Last month':   [moment().subtract(1, 'month').startOf('month'), moment().subtract(1, 'month').endOf('month')],
        },
      } as any,
      (start: moment.Moment, end: moment.Moment) => {
        this.zone.run(() => {
          this.from = start.format('YYYY-MM-DD');
          this.to = end.format('YYYY-MM-DD');
          this.run();
        });
      },
    );
  }
  private destroyDateRangePicker(): void {
    if (!this.rangeInput?.nativeElement) return;
    const picker = ($(this.rangeInput.nativeElement) as any).data('daterangepicker');
    if (picker) picker.remove();
  }

  // ── Recent runs (localStorage) ──────────────────────────────────
  private loadRecent(): RecentRun[] {
    try {
      const raw = localStorage.getItem(this.storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
    } catch {
      return [];
    }
  }
  private pushRecent(run: RecentRun): void {
    const next = [run, ...this.recent.filter((r) => r.key !== run.key)].slice(0, 5);
    this.recent = next;
    try { localStorage.setItem(this.storageKey, JSON.stringify(next)); } catch { /* ignore */ }
  }

  @HostListener('document:keydown.escape')
  onDocumentEscape(): void {
    if (this.opened) this.close();
  }
}
