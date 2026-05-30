import { Component, HostListener, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { ApiService } from '../../core/api.service';
import {
  ButtonComponent,
  ColumnComponent,
  DataTableComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
} from '../../ui';

type MessageType = 'push' | 'sms' | 'both';
type AudienceKey =
  | 'active'
  | 'free'
  | 'engaged'
  | 'live'
  | 'offline'
  | 'deactivated'
  | 'custom_csv';

interface AudienceRow {
  driver_id: number;
  name: string | null;
  phone: string | null;
  vehicle_type: string | null;
  is_online: boolean;
}

interface SendResult {
  recipients: number;
  sent_push: number;
  sent_sms: number;
  skipped: number;
}

/**
 * Contact Drivers — drivers-list style.
 *
 * The page is a Drivers table with search, Audience + Vehicle dropdowns and
 * filter pills above (identical pattern to /drivers and /rides). Each row has
 * a checkbox; selecting one or more pops up a floating action bar with
 * "Message N drivers", which opens a small modal (channel + body + send).
 * If nothing is selected, the bar offers to message the whole filtered
 * audience instead.
 */
@Component({
  selector: 'app-contact-drivers',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonComponent, ColumnComponent, DataTableComponent,
    IconComponent, InputComponent, ModalComponent,
  ],
  template: `
    <div class="page">
      <header class="page__hero">
        <div>
          <h1 class="page__title">Contact Drivers</h1>
          <p class="page__sub">Pick an audience, optionally select rows, then send a push or SMS.</p>
        </div>
      </header>

      <tm-data-table
        [rows]="filteredRows"
        [total]="filteredRows.length"
        [loading]="loading"
        emptyTitle="No drivers"
        emptyHint="Pick a different audience, or upload a CSV."
      >
        <!-- Toolbar: search left -->
        <tm-input
          slot="search"
          icon="search"
          placeholder="Search id, name, phone…"
          [(ngModel)]="search"
        />

        <!-- Toolbar: filters right -->
        <ng-container slot="filters">
          <!-- Audience -->
          <div class="state-select" [class.has-value]="audience !== 'active'" [class.is-open]="audienceOpen">
            <button
              type="button"
              class="state-select__trigger"
              (click)="toggleAudienceMenu($event)"
              [attr.aria-expanded]="audienceOpen"
              aria-haspopup="listbox"
              aria-label="Audience filter"
            >
              <span class="state-select__icon" aria-hidden="true"><tm-icon name="users" [size]="14" /></span>
              <span class="state-select__value">{{ audienceLabel() }}</span>
              <tm-icon name="chevron-down" [size]="12" class="state-select__caret" />
            </button>
            <ul class="state-select__menu" *ngIf="audienceOpen" role="listbox" (click)="$event.stopPropagation()">
              <li
                *ngFor="let opt of audienceOptions"
                class="state-select__option"
                [class.is-selected]="audience === opt.value"
                role="option"
                [attr.aria-selected]="audience === opt.value"
                (click)="selectAudience(opt.value)"
              >
                <tm-icon *ngIf="audience === opt.value" name="check" [size]="12" class="state-select__option-check" />
                <span class="state-select__option-label">{{ opt.label }}</span>
              </li>
            </ul>
          </div>

          <!-- Vehicle -->
          <div
            class="state-select"
            [class.has-value]="vehicleType !== null"
            [class.is-open]="vehicleOpen"
            *ngIf="audience !== 'custom_csv'"
          >
            <button
              type="button"
              class="state-select__trigger"
              (click)="toggleVehicleMenu($event)"
              [attr.aria-expanded]="vehicleOpen"
              aria-haspopup="listbox"
              aria-label="Vehicle filter"
            >
              <span class="state-select__icon" aria-hidden="true"><tm-icon name="car" [size]="14" /></span>
              <span class="state-select__value">{{ vehicleLabel() }}</span>
              <tm-icon name="chevron-down" [size]="12" class="state-select__caret" />
            </button>
            <ul class="state-select__menu" *ngIf="vehicleOpen" role="listbox" (click)="$event.stopPropagation()">
              <li
                class="state-select__option"
                [class.is-selected]="vehicleType === null"
                role="option"
                [attr.aria-selected]="vehicleType === null"
                (click)="selectVehicle(null)"
              >
                <tm-icon *ngIf="vehicleType === null" name="check" [size]="12" class="state-select__option-check" />
                <span class="state-select__option-label">All vehicle types</span>
              </li>
              <li
                *ngFor="let opt of vehicleOptions"
                class="state-select__option"
                [class.is-selected]="vehicleType === opt"
                role="option"
                [attr.aria-selected]="vehicleType === opt"
                (click)="selectVehicle(opt)"
              >
                <tm-icon *ngIf="vehicleType === opt" name="check" [size]="12" class="state-select__option-check" />
                <span class="state-select__option-label">{{ opt }}</span>
              </li>
            </ul>
          </div>

          <!-- CSV upload (when custom_csv audience) -->
          <div *ngIf="audience === 'custom_csv'" class="csv-trigger">
            <input
              type="file"
              accept=".csv,text/csv"
              #csvInput
              (change)="onCsvSelected($event)"
              hidden
            />
            <tm-button variant="outline" icon="upload" (clicked)="csvInput.click()">
              {{ csvFileName ? 'Replace CSV' : 'Upload CSV' }}
            </tm-button>
            <a [href]="sampleCsvUrl" download class="csv-trigger__sample">
              <tm-icon name="download" [size]="12" /> Sample
            </a>
          </div>
        </ng-container>

        <!-- Active filter pills below the toolbar -->
        <ng-container slot="banner">
          <span class="filter-pill" *ngIf="audience !== 'active'">
            <span class="filter-pill__icon"><tm-icon name="users" [size]="11" /></span>
            <span class="filter-pill__label">Audience</span>
            <span class="filter-pill__value">{{ audienceLabel() }}</span>
            <button type="button" class="filter-pill__close" (click)="selectAudience('active')" aria-label="Reset audience">
              <tm-icon name="x" [size]="12" />
            </button>
          </span>
          <span class="filter-pill" *ngIf="vehicleType !== null">
            <span class="filter-pill__icon"><tm-icon name="car" [size]="11" /></span>
            <span class="filter-pill__label">Vehicle</span>
            <span class="filter-pill__value">{{ vehicleType }}</span>
            <button type="button" class="filter-pill__close" (click)="selectVehicle(null)" aria-label="Clear vehicle filter">
              <tm-icon name="x" [size]="12" />
            </button>
          </span>
          <span class="filter-pill" *ngIf="audience === 'custom_csv' && csvFileName">
            <span class="filter-pill__icon"><tm-icon name="upload" [size]="11" /></span>
            <span class="filter-pill__label">CSV</span>
            <span class="filter-pill__value">{{ csvFileName }}</span>
            <button type="button" class="filter-pill__close" (click)="selectAudience('active')" aria-label="Clear CSV">
              <tm-icon name="x" [size]="12" />
            </button>
          </span>
          <span class="filter-pill filter-pill--err" *ngIf="csvError">
            <tm-icon name="x" [size]="11" />
            {{ csvError }}
          </span>
        </ng-container>

        <!-- Select-all checkbox column -->
        <tm-column key="select" label="" width="44">
          <ng-template let-row>
            <input
              type="checkbox"
              class="cell-check"
              [checked]="isSelected(row.driver_id)"
              (change)="toggleRow(row.driver_id, $event)"
              [attr.aria-label]="'Select driver ' + row.driver_id"
            />
          </ng-template>
        </tm-column>

        <tm-column key="driver_id" label="Driver" width="120">
          <ng-template let-row>
            <span class="cell-id">#{{ row.driver_id }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="name" label="Name">
          <ng-template let-row>
            <span *ngIf="row.name">{{ row.name }}</span>
            <span *ngIf="!row.name" class="muted">—</span>
          </ng-template>
        </tm-column>

        <tm-column key="phone" label="Phone" width="170">
          <ng-template let-row>
            <span *ngIf="row.phone" class="mono">{{ row.phone }}</span>
            <span *ngIf="!row.phone" class="muted">—</span>
          </ng-template>
        </tm-column>

        <tm-column key="vehicle_type" label="Vehicle" width="120">
          <ng-template let-row>
            <span *ngIf="row.vehicle_type">{{ row.vehicle_type }}</span>
            <span *ngIf="!row.vehicle_type" class="muted">—</span>
          </ng-template>
        </tm-column>

        <tm-column key="is_online" label="" width="100" align="right">
          <ng-template let-row>
            <span class="dot" [class.dot--on]="row.is_online">
              {{ row.is_online ? 'Online' : 'Offline' }}
            </span>
          </ng-template>
        </tm-column>
      </tm-data-table>

      <!-- ============ Floating action bar ============ -->
      <div class="bar" *ngIf="rows.length">
        <div class="bar__inner">
          <div class="bar__left">
            <span *ngIf="selectedIds.size; else countAll" class="bar__count">
              <strong>{{ selectedIds.size }}</strong> selected
            </span>
            <ng-template #countAll>
              <span class="bar__count">
                <strong>{{ rows.length }}</strong> in audience
              </span>
            </ng-template>
            <button
              *ngIf="selectedIds.size"
              type="button"
              class="bar__link"
              (click)="clearSelection()"
            >
              Clear
            </button>
          </div>
          <div class="bar__right">
            <tm-button variant="green" icon="send" (clicked)="openComposer()">
              {{ selectedIds.size
                  ? 'Message ' + selectedIds.size + ' selected'
                  : 'Message all in audience' }}
            </tm-button>
          </div>
        </div>
      </div>

      <!-- Result toast (inline) -->
      <p *ngIf="sendResult" class="msg msg--ok">
        <tm-icon name="check" [size]="12" />
        Sent to {{ sendResult.recipients }} drivers · push {{ sendResult.sent_push }}, sms {{ sendResult.sent_sms }}, skipped {{ sendResult.skipped }}
      </p>
      <p *ngIf="sendError" class="msg msg--err">{{ sendError }}</p>

      <!-- ============ Composer modal ============ -->
      <tm-modal
        [open]="composerOpen"
        [title]="composerOpen ? composerTitle() : ''"
        (closed)="composerOpen = false"
      >
        <div slot="body" class="composer">
          <div class="composer__row">
            <span class="composer__label">Channel</span>
            <div class="seg" role="radiogroup" aria-label="Channel">
              <button
                type="button"
                class="seg__btn"
                role="radio"
                [class.is-on]="messageType === 'push'"
                [attr.aria-checked]="messageType === 'push'"
                (click)="messageType = 'push'"
              >
                <tm-icon name="bell" [size]="13" /> Push
              </button>
              <button
                type="button"
                class="seg__btn"
                role="radio"
                [class.is-on]="messageType === 'sms'"
                [attr.aria-checked]="messageType === 'sms'"
                (click)="messageType = 'sms'"
              >
                <tm-icon name="envelope" [size]="13" /> SMS
              </button>
              <button
                type="button"
                class="seg__btn"
                role="radio"
                [class.is-on]="messageType === 'both'"
                [attr.aria-checked]="messageType === 'both'"
                (click)="messageType = 'both'"
              >
                <tm-icon name="send" [size]="13" /> Both
              </button>
            </div>
          </div>

          <div class="composer__row composer__row--block">
            <span class="composer__label">
              Message
              <small class="composer__count">{{ message.length }} / 1000</small>
            </span>
            <textarea
              class="textarea"
              [(ngModel)]="message"
              rows="6"
              placeholder="Type the message…"
              maxlength="1000"
            ></textarea>
          </div>
        </div>
        <div slot="footer">
          <tm-button variant="ghost" (clicked)="composerOpen = false">Cancel</tm-button>
          <tm-button
            variant="green"
            icon="send"
            [disabled]="!message.trim() || sending"
            (clicked)="send()"
          >
            {{ sending ? 'Sending…' : sendButtonLabel }}
          </tm-button>
        </div>
      </tm-modal>
    </div>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 16px; padding-bottom: 96px; }
    .page__hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .page__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .page__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); }

    /* ---------- state-select dropdown ---------- */
    .state-select { position: relative; display: inline-block; }
    .state-select__trigger {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 9px 14px;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      background: transparent;
      font-family: var(--tm-font-body);
      font-size: 13px; font-weight: 700;
      color: var(--tm-text);
      cursor: pointer; line-height: 1.2;
      transition: border-color var(--tm-duration-fast) var(--tm-ease),
                  background var(--tm-duration-fast) var(--tm-ease);
    }
    .state-select__trigger:hover { border-color: var(--tm-ink); }
    .state-select.is-open .state-select__trigger { border-color: var(--tm-ink); }
    .state-select.has-value .state-select__trigger {
      background: var(--tm-green-tint);
      border-color: var(--tm-green-deep);
    }
    .state-select__icon { color: var(--tm-text-muted); display: inline-flex; }
    .state-select.has-value .state-select__icon { color: var(--tm-green-deep); }
    .state-select__value { min-width: 130px; text-align: left; }
    .state-select__caret {
      color: var(--tm-text-soft);
      transition: transform var(--tm-duration-fast) var(--tm-ease);
    }
    .state-select.is-open .state-select__caret { transform: rotate(180deg); }
    .state-select.has-value .state-select__caret { color: var(--tm-green-deep); }
    .state-select__menu {
      position: absolute; top: calc(100% + 6px); left: 0; right: 0;
      min-width: 200px; margin: 0; padding: 6px;
      list-style: none;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      box-shadow: var(--tm-shadow-pop);
      z-index: 1100;
      max-height: 320px; overflow-y: auto;
    }
    .state-select__option {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; border-radius: var(--tm-radius-sm);
      font-size: 12px; font-weight: 600; color: var(--tm-text);
      cursor: pointer;
    }
    .state-select__option:hover { background: var(--tm-canvas-2); }
    .state-select__option.is-selected {
      background: var(--tm-green-tint);
      color: var(--tm-green-deep);
      font-weight: 700;
    }
    .state-select__option-check { color: var(--tm-green-deep); flex-shrink: 0; }
    .state-select__option-label { flex: 1; }

    /* ---------- CSV inline trigger ---------- */
    .csv-trigger {
      display: inline-flex; align-items: center; gap: 10px;
      padding: 4px 10px 4px 4px;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
    }
    .csv-trigger__sample {
      display: inline-flex; align-items: center; gap: 4px;
      color: var(--tm-green-deep);
      font-size: 12px; font-weight: 700;
      text-decoration: none;
    }
    .csv-trigger__sample:hover { text-decoration: underline; }

    /* ---------- Filter pills ---------- */
    .filter-pill {
      display: inline-flex; align-items: center; gap: 8px;
      margin-right: 8px;
      padding: 6px 6px 6px 12px;
      border-radius: var(--tm-radius-pill);
      background: var(--tm-surface);
      border: 1px solid var(--tm-line-2);
      font-size: 12px; font-weight: 700;
      color: var(--tm-text);
    }
    .filter-pill__icon { display: inline-flex; color: var(--tm-text-muted); }
    .filter-pill__label {
      font-size: 10px; font-weight: 800;
      letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--tm-text-muted);
    }
    .filter-pill__value { font-family: var(--tm-font-mono); font-weight: 700; color: var(--tm-text); }
    .filter-pill__close {
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px; border-radius: 50%;
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
    }
    .filter-pill__close:hover { background: var(--tm-ink); color: #fff; }
    .filter-pill--err {
      background: var(--tm-danger-bg, #fee2e2);
      border-color: var(--tm-danger-fg, #b91c1c);
      color: var(--tm-danger-fg, #b91c1c);
    }

    /* ---------- Table cells ---------- */
    .cell-check {
      width: 16px; height: 16px;
      accent-color: var(--tm-green-deep);
      cursor: pointer;
    }
    .cell-id {
      display: inline-flex; align-items: center;
      padding: 3px 10px;
      border-radius: var(--tm-radius-pill);
      background: var(--tm-green-tint); color: var(--tm-green-deep);
      font-family: var(--tm-font-mono);
      font-size: 11px; font-weight: 800;
    }
    .mono { font-family: var(--tm-font-mono); font-size: 12px; }
    .muted { color: var(--tm-text-muted); font-size: 12px; }
    .dot {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 11px; font-weight: 800; letter-spacing: 0.3px;
      color: var(--tm-text-muted);
    }
    .dot::before {
      content: ''; width: 7px; height: 7px; border-radius: 50%;
      background: var(--tm-text-soft);
    }
    .dot--on::before { background: var(--tm-success-fg, #2dd36f); box-shadow: 0 0 0 3px var(--tm-success-bg); }
    .dot--on { color: var(--tm-success-fg); }

    /* ---------- Floating action bar ---------- */
    .bar {
      position: fixed;
      left: 50%; bottom: 18px; transform: translateX(-50%);
      z-index: 900;
      width: min(680px, calc(100% - 32px));
      animation: bar-up 220ms var(--tm-ease) both;
    }
    @keyframes bar-up {
      from { opacity: 0; transform: translate(-50%, 14px); }
      to { opacity: 1; transform: translate(-50%, 0); }
    }
    .bar__inner {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 10px 14px 10px 18px;
      background: var(--tm-ink, #111);
      color: #fff;
      border-radius: 999px;
      box-shadow: 0 18px 40px -10px rgba(0,0,0,0.45),
                  0 0 0 1px rgba(255,255,255,0.06);
    }
    .bar__left { display: flex; align-items: center; gap: 14px; }
    .bar__count { font-size: 13px; color: rgba(255,255,255,0.85); }
    .bar__count strong {
      color: #fff;
      font-family: var(--tm-font-mono);
      font-weight: 800;
      margin-right: 4px;
    }
    .bar__link {
      background: transparent; border: 0;
      color: rgba(255,255,255,0.7);
      font-family: var(--tm-font-body);
      font-size: 12px; font-weight: 700;
      cursor: pointer;
      text-decoration: underline;
    }
    .bar__link:hover { color: #fff; }
    .bar__right { display: flex; align-items: center; gap: 8px; }

    /* ---------- Composer modal ---------- */
    .composer { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
    .composer__row {
      display: grid;
      grid-template-columns: 84px 1fr;
      align-items: center;
      gap: 12px;
    }
    .composer__row--block { grid-template-columns: 1fr; gap: 6px; align-items: stretch; }
    .composer__row--block .composer__label {
      display: flex; justify-content: space-between; align-items: center;
    }
    .composer__label {
      font-size: 10px; font-weight: 800;
      text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--tm-text-muted);
    }
    .composer__count {
      font-family: var(--tm-font-mono);
      font-size: 11px; font-weight: 700;
      color: var(--tm-text-muted);
      text-transform: none; letter-spacing: 0;
    }

    .seg { display: inline-flex; gap: 4px; padding: 4px; background: var(--tm-canvas-2); border-radius: var(--tm-radius-md, 10px); }
    .seg__btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      padding: 7px 14px;
      border: 0; border-radius: 8px;
      background: transparent;
      font-family: var(--tm-font-body);
      font-size: 12px; font-weight: 700;
      color: var(--tm-text-muted);
      cursor: pointer;
    }
    .seg__btn:hover { color: var(--tm-text); }
    .seg__btn.is-on {
      background: var(--tm-surface);
      color: var(--tm-text);
      box-shadow: var(--tm-shadow-sm);
    }

    .textarea {
      width: 100%; padding: 11px 13px;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      background: var(--tm-surface);
      color: var(--tm-text);
      font: 13px var(--tm-font-body);
      line-height: 1.5;
      resize: vertical;
      min-height: 120px;
      outline: 0;
    }
    .textarea:focus { border-color: var(--tm-ink); }
    .textarea::placeholder { color: var(--tm-text-soft); }

    /* ---------- Inline messages ---------- */
    .msg {
      margin: 0;
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 12px;
      border-radius: var(--tm-radius-md);
      font-size: 12px; font-weight: 700;
    }
    .msg--ok { background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .msg--err { background: var(--tm-danger-bg, #fee2e2); color: var(--tm-danger-fg, #b91c1c); }
  `],
})
export class ContactDriversComponent implements OnInit {
  // Audience + filters
  audience: AudienceKey = 'active';
  vehicleType: string | null = null;
  search = '';

  audienceOpen = false;
  vehicleOpen = false;

  audienceOptions: { value: AudienceKey; label: string }[] = [
    { value: 'active',       label: 'Active drivers' },
    { value: 'free',         label: 'Free (online & idle)' },
    { value: 'engaged',      label: 'Engaged (on a trip)' },
    { value: 'live',         label: 'Live (online)' },
    { value: 'offline',      label: 'Offline' },
    { value: 'deactivated',  label: 'Deactivated' },
    { value: 'custom_csv',   label: 'Custom CSV' },
  ];
  vehicleOptions: string[] = [];

  // CSV
  csvFileName: string | null = null;
  csvDriverIds: number[] = [];
  csvError: string | null = null;

  // Recipients
  rows: AudienceRow[] = [];
  loading = false;

  // Selection
  selectedIds = new Set<number>();

  // Composer modal
  composerOpen = false;
  messageType: MessageType = 'both';
  message = '';
  sending = false;
  sendResult: SendResult | null = null;
  sendError: string | null = null;

  constructor(private api: ApiService, private http: HttpClient) {}

  ngOnInit(): void {
    this.loadVehicleTypes();
    this.refreshAudience();
  }

  // ── Derived ─────────────────────────────────────────────────────
  get sampleCsvUrl(): string {
    const apiBase = localStorage.getItem('dreamcabs_api_base')?.trim() || 'http://localhost:8000/api';
    return apiBase.replace(/\/api\/?$/, '') + '/samples/contact_drivers_sample.csv';
  }
  get filteredRows(): AudienceRow[] {
    const term = this.search.trim().toLowerCase();
    if (!term) return this.rows;
    return this.rows.filter(
      (r) =>
        String(r.driver_id).includes(term) ||
        (r.name || '').toLowerCase().includes(term) ||
        (r.phone || '').toLowerCase().includes(term),
    );
  }
  get sendButtonLabel(): string {
    if (this.messageType === 'push') return 'Send push';
    if (this.messageType === 'sms') return 'Send SMS';
    return 'Send both';
  }
  audienceLabel(): string {
    return this.audienceOptions.find((o) => o.value === this.audience)?.label ?? '';
  }
  vehicleLabel(): string {
    return this.vehicleType ?? 'All vehicle types';
  }
  composerTitle(): string {
    return this.selectedIds.size
      ? `Message ${this.selectedIds.size} selected`
      : `Message all in "${this.audienceLabel()}"`;
  }

  // ── Audience / vehicle filter handlers ──────────────────────────
  toggleAudienceMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.vehicleOpen = false;
    this.audienceOpen = !this.audienceOpen;
  }
  toggleVehicleMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.audienceOpen = false;
    this.vehicleOpen = !this.vehicleOpen;
  }
  selectAudience(value: AudienceKey): void {
    this.audienceOpen = false;
    this.audience = value;
    this.csvFileName = null;
    this.csvDriverIds = [];
    this.csvError = null;
    this.rows = [];
    this.selectedIds.clear();
    if (value !== 'custom_csv') {
      this.refreshAudience();
    }
  }
  selectVehicle(value: string | null): void {
    this.vehicleOpen = false;
    if (this.vehicleType === value) return;
    this.vehicleType = value;
    this.selectedIds.clear();
    this.refreshAudience();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.audienceOpen) this.audienceOpen = false;
    if (this.vehicleOpen) this.vehicleOpen = false;
  }
  @HostListener('document:keydown.escape')
  onDocumentEscape(): void {
    if (this.audienceOpen) this.audienceOpen = false;
    if (this.vehicleOpen) this.vehicleOpen = false;
  }

  // ── Selection ───────────────────────────────────────────────────
  isSelected(id: number): boolean {
    return this.selectedIds.has(id);
  }
  toggleRow(id: number, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const next = new Set(this.selectedIds);
    if (checked) next.add(id); else next.delete(id);
    this.selectedIds = next;
  }
  clearSelection(): void {
    this.selectedIds = new Set();
  }

  // ── Fetch ───────────────────────────────────────────────────────
  refreshAudience(): void {
    if (this.audience === 'custom_csv') return;
    this.loading = true;
    const params: string[] = [`to=${this.audience}`];
    if (this.vehicleType) params.push(`vehicle_type=${encodeURIComponent(this.vehicleType)}`);
    this.api.get<{ data: AudienceRow[] }>(`/admin/contact-drivers/audience?${params.join('&')}`).subscribe({
      next: (res) => {
        this.rows = res?.data ?? [];
        this.loading = false;
      },
      error: () => {
        this.rows = [];
        this.loading = false;
      },
    });
  }

  onCsvSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.csvError = null;
    this.csvFileName = file.name;
    this.loading = true;
    this.selectedIds.clear();

    const form = new FormData();
    form.append('file', file);

    const apiBase = localStorage.getItem('dreamcabs_api_base')?.trim() || 'http://localhost:8000/api';
    const token = localStorage.getItem('dreamcabs_token');
    const headers = new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});

    this.http
      .post<{ data: AudienceRow[]; driver_ids: number[]; message?: string }>(
        `${apiBase}/admin/contact-drivers/upload-csv`,
        form,
        { headers },
      )
      .subscribe({
        next: (res) => {
          this.rows = res?.data ?? [];
          this.csvDriverIds = res?.driver_ids ?? [];
          if (res?.message) this.csvError = res.message;
          this.loading = false;
        },
        error: (err) => {
          this.csvError = err?.error?.message || 'CSV upload failed';
          this.rows = [];
          this.csvDriverIds = [];
          this.loading = false;
        },
      });

    input.value = '';
  }

  // ── Composer ────────────────────────────────────────────────────
  openComposer(): void {
    this.message = '';
    this.messageType = 'both';
    this.sendResult = null;
    this.sendError = null;
    this.composerOpen = true;
  }

  send(): void {
    this.sending = true;
    this.sendError = null;
    this.sendResult = null;

    const body: Record<string, unknown> = {
      message_type: this.messageType,
      message: this.message,
    };

    // Hand-picked subset → send driver_ids. Otherwise use the audience.
    if (this.selectedIds.size) {
      body['to'] = 'custom_csv';
      body['driver_ids'] = Array.from(this.selectedIds);
    } else if (this.audience === 'custom_csv') {
      body['to'] = 'custom_csv';
      body['driver_ids'] = this.csvDriverIds;
    } else {
      body['to'] = this.audience;
      if (this.vehicleType) body['vehicle_type'] = this.vehicleType;
    }

    this.api
      .post<SendResult>('/admin/contact-drivers/send', body)
      .subscribe({
        next: (res) => {
          this.sendResult = res;
          this.composerOpen = false;
          this.message = '';
          this.selectedIds.clear();
        },
        error: (err) => {
          this.sendError = err?.error?.message || 'Send failed';
        },
        complete: () => (this.sending = false),
      });
  }

  // ── Bootstrap ───────────────────────────────────────────────────
  private loadVehicleTypes(): void {
    this.api.get<{ data: { name: string }[] }>('/admin/ride-types').subscribe({
      next: (res) => {
        this.vehicleOptions = (res?.data || []).map((rt) => rt.name);
      },
      error: () => { this.vehicleOptions = []; },
    });
  }
}
