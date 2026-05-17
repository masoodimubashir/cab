import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { CalendarModule } from 'primeng/calendar';
import { ApiService } from '../../core/api.service';

interface ReportColumn {
  key: string;
  label: string;
}
interface ReportDef {
  key: string;
  name: string;
  type: string;
  tags: string[];
  columns: ReportColumn[];
}
interface ReportRunResponse {
  report: ReportDef;
  from: string;
  to: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
}

@Component({
  selector: 'app-analytics-reports',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    TableModule,
    TagModule,
    CalendarModule,
  ],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <div class="muted small">Analytics</div>
          <h2>Reports</h2>
        </div>
      </header>

      <div *ngIf="!opened" class="catalogue">
        <div class="catalogue__head">
          <span class="p-input-icon-left search">
            <i class="pi pi-search"></i>
            <input
              pInputText
              [(ngModel)]="search"
              (ngModelChange)="onSearch()"
              placeholder="Search reports…"
            />
          </span>
        </div>

        <p-table
          [value]="reports"
          [paginator]="reports.length > 20"
          [rows]="20"
          [globalFilterFields]="['name', 'tags']"
          [tableStyle]="{ 'min-width': '60rem' }"
          stripedRows
        >
          <ng-template pTemplate="header">
            <tr>
              <th style="width: 90px">Key</th>
              <th>Name</th>
              <th style="width: 120px">Type</th>
              <th>Tags</th>
              <th style="width: 80px"></th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-r>
            <tr class="row" (click)="open(r)">
              <td><code>{{ r.key }}</code></td>
              <td><strong>{{ r.name }}</strong></td>
              <td>{{ r.type }}</td>
              <td>
                <p-tag *ngFor="let t of r.tags" [value]="t" severity="info" styleClass="tag"></p-tag>
              </td>
              <td>
                <button pButton type="button" icon="pi pi-arrow-right" class="p-button-text" (click)="open(r); $event.stopPropagation()"></button>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr><td colspan="5" class="empty">No reports match your search.</td></tr>
          </ng-template>
        </p-table>
      </div>

      <div *ngIf="opened" class="drilldown">
        <div class="drilldown__head">
          <button pButton type="button" icon="pi pi-arrow-left" label="Back" class="p-button-text" (click)="close()"></button>
          <div class="drilldown__title">
            <h3>{{ opened.name }}</h3>
            <p-tag [value]="opened.type"></p-tag>
            <p-tag *ngFor="let t of opened.tags" [value]="t" severity="info"></p-tag>
          </div>
          <div class="drilldown__actions">
            <p-calendar
              [(ngModel)]="from"
              dateFormat="dd-mm-yy"
              [showIcon]="true"
              appendTo="body"
              styleClass="cal"
            ></p-calendar>
            <p-calendar
              [(ngModel)]="to"
              dateFormat="dd-mm-yy"
              [showIcon]="true"
              appendTo="body"
              styleClass="cal"
            ></p-calendar>
            <button pButton type="button" icon="pi pi-send" label="Run" (click)="run()"></button>
            <button pButton type="button" icon="pi pi-download" label="CSV" class="p-button-secondary" (click)="exportCsv()"></button>
          </div>
        </div>

        <div *ngIf="error" class="error">{{ error }}</div>

        <p-table
          *ngIf="result"
          [value]="result.rows"
          [paginator]="result.rows.length > 25"
          [rows]="25"
          [tableStyle]="{ 'min-width': '60rem' }"
          stripedRows
        >
          <ng-template pTemplate="header">
            <tr>
              <th *ngFor="let c of result.columns">{{ c.label }}</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td *ngFor="let c of result!.columns">{{ row[c.key] ?? '—' }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr><td [attr.colspan]="result.columns.length" class="empty">No rows for this date range.</td></tr>
          </ng-template>
        </p-table>
      </div>
    </div>
  `,
  styles: [
    `
      .page {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .page__head h2 {
        margin: 0;
        font-size: 22px;
        font-weight: 800;
      }
      .catalogue__head {
        display: flex;
        gap: 12px;
        margin-bottom: 12px;
      }
      .search {
        flex: 1;
        max-width: 360px;
      }
      .row {
        cursor: pointer;
      }
      :host ::ng-deep .tag {
        margin-right: 4px;
      }
      .drilldown__head {
        display: flex;
        gap: 12px;
        align-items: center;
        flex-wrap: wrap;
        background: rgba(248, 250, 252, 0.7);
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 12px;
        padding: 12px;
      }
      .drilldown__title {
        display: flex;
        gap: 8px;
        align-items: center;
        flex: 1;
        flex-wrap: wrap;
      }
      .drilldown__title h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 800;
      }
      .drilldown__actions {
        display: flex;
        gap: 6px;
        align-items: center;
        flex-wrap: wrap;
      }
      :host ::ng-deep .cal {
        width: 160px;
      }
      .empty {
        text-align: center;
        color: rgba(15, 23, 42, 0.55);
        padding: 24px;
      }
      .error {
        color: #b00020;
        font-weight: 700;
      }
      .muted {
        color: rgba(15, 23, 42, 0.55);
      }
      .small {
        font-size: 12px;
      }
    `,
  ],
})
export class AnalyticsReportsComponent implements OnInit {
  reports: ReportDef[] = [];
  search = '';

  opened: ReportDef | null = null;
  from: Date = new Date(Date.now() - 30 * 86400_000);
  to: Date = new Date();

  result: ReportRunResponse | null = null;
  error: string | null = null;
  loading = false;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.fetch();
  }

  onSearch(): void {
    // Server-side search keeps the catalogue authoritative if it grows.
    this.fetch();
  }

  fetch(): void {
    const qs = this.search ? `?search=${encodeURIComponent(this.search)}` : '';
    this.api.get<{ data: ReportDef[] }>(`/admin/analytics/reports${qs}`).subscribe({
      next: (r) => (this.reports = r?.data || []),
    });
  }

  open(r: ReportDef): void {
    this.opened = r;
    this.result = null;
    this.error = null;
    this.run();
  }

  close(): void {
    this.opened = null;
    this.result = null;
  }

  run(): void {
    if (!this.opened) return;
    const qs = `?from=${this.iso(this.from)}&to=${this.iso(this.to)}`;
    this.loading = true;
    this.error = null;
    this.api.get<ReportRunResponse>(`/admin/analytics/reports/${this.opened.key}${qs}`).subscribe({
      next: (r) => (this.result = r),
      error: (err) => (this.error = err?.error?.message || 'Failed to run report'),
      complete: () => (this.loading = false),
    });
  }

  exportCsv(): void {
    if (!this.opened) return;
    const qs = `?from=${this.iso(this.from)}&to=${this.iso(this.to)}`;
    this.api
      .getBlob(`/admin/analytics/reports/${this.opened.key}/export${qs}`)
      .subscribe((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.opened!.key}_${this.iso(new Date())}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      });
  }

  private iso(d: Date): string {
    return d.toISOString().slice(0, 10);
  }
}
