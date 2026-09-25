import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import {
  ButtonComponent,
  ColumnComponent,
  DataTableComponent,
  DrawerComponent,
  FilterPillComponent,
  FilterSelectComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
} from '../../ui';

export interface BannerRow {
  id: number;
  title: string;
  image_path: string;
  image_url: string;
  url_link: string | null;
  target_app: 'customer' | 'driver' | 'both';
  position: 'full_screen' | 'half';
  is_active: boolean;
  is_currently_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
}

const TARGET_APP_OPTIONS = [
  { label: 'Customer App', value: 'customer' },
  { label: 'Driver App', value: 'driver' },
  { label: 'Both Apps (Customer & Driver)', value: 'both' },
];

const POSITION_OPTIONS = [
  { label: 'Half (Floating Card)', value: 'half' },
  { label: 'Full Screen (Modal)', value: 'full_screen' },
];

const STATUS_FILTER_OPTIONS = [
  { label: 'Active only', value: 'active' },
  { label: 'Inactive only', value: 'inactive' },
];

const APP_FILTER_OPTIONS = [
  { label: 'Customer app', value: 'customer' },
  { label: 'Driver app', value: 'driver' },
  { label: 'Both apps', value: 'both' },
];

const POSITION_FILTER_OPTIONS = [
  { label: 'Half screen', value: 'half' },
  { label: 'Full screen', value: 'full_screen' },
];

@Component({
  selector: 'app-banners',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    ColumnComponent,
    DataTableComponent,
    DrawerComponent,
    FilterPillComponent,
    FilterSelectComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
  ],
  template: `
    <div class="bp">
      <header class="bp__head">
        <div>
          <h1 class="bp__title">App Banners</h1>
          <p class="bp__sub">Promotional and announcement banners for customer and driver mobile apps.</p>
        </div>
        <tm-button variant="green" icon="plus" (clicked)="openCreate()">
          Add banner
        </tm-button>
      </header>

      <tm-data-table
        [rows]="filteredRows"
        [total]="filteredRows.length"
        [page]="1"
        [pageSize]="100"
        [loading]="loading"
        emptyTitle="No banners found"
        emptyHint="Create promotional banners to display on passenger and driver mobile apps."
      >
        <tm-input
          slot="search"
          icon="search"
          placeholder="Search by banner title"
          [ngModel]="searchQuery"
          (ngModelChange)="searchQuery = $event"
        />

        <ng-container slot="filters">
          <tm-filter-select
            icon="bolt"
            ariaLabel="Status filter"
            allLabel="All status"
            allValue="all"
            [options]="statusOptions"
            [value]="filterStatus"
            (valueChange)="filterStatus = $event"
          />
          <tm-filter-select
            icon="users"
            ariaLabel="Target app filter"
            allLabel="All apps"
            allValue="all"
            [options]="appFilterOptions"
            [value]="filterApp"
            (valueChange)="filterApp = $event"
          />
          <tm-filter-select
            icon="filter"
            ariaLabel="Position filter"
            allLabel="All positions"
            allValue="all"
            [options]="positionFilterOptions"
            [value]="filterPosition"
            (valueChange)="filterPosition = $event"
          />
        </ng-container>

        <ng-container slot="banner">
          <tm-filter-pill *ngIf="searchQuery.trim()" icon="search" label="Search" [value]="searchQuery" (clear)="searchQuery = ''" />
          <tm-filter-pill *ngIf="filterStatus !== 'all'" icon="bolt" label="Status" [value]="filterStatus" (clear)="filterStatus = 'all'" />
          <tm-filter-pill *ngIf="filterApp !== 'all'" icon="users" label="App" [value]="filterApp" (clear)="filterApp = 'all'" />
          <tm-filter-pill *ngIf="filterPosition !== 'all'" icon="filter" label="Position" [value]="filterPosition" (clear)="filterPosition = 'all'" />
        </ng-container>

        <tm-column key="image" label="Banner" width="110">
          <ng-template let-row>
            <div class="cell-thumb-wrap" (click)="previewImage = row.image_url" title="Click to enlarge">
              <img [src]="row.image_url" [alt]="row.title" class="cell-thumb" loading="lazy" />
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="title" label="Title & Destination">
          <ng-template let-row>
            <div class="cell-main">
              <span class="cell-title">{{ row.title }}</span>
              <a *ngIf="row.url_link" [href]="row.url_link" target="_blank" rel="noopener" class="cell-link" (click)="$event.stopPropagation()">
                <tm-icon name="external-link" [size]="11" /> {{ row.url_link }}
              </a>
              <span *ngIf="!row.url_link" class="cell-nolink">No external link</span>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="target_app" label="Target App" width="140">
          <ng-template let-row>
            <span class="tagx" [ngClass]="'tagx--' + row.target_app">
              {{ formatApp(row.target_app) }}
            </span>
          </ng-template>
        </tm-column>

        <tm-column key="position" label="Display Type" width="150">
          <ng-template let-row>
            <span class="tagx">
              {{ row.position === 'full_screen' ? 'Full Screen' : 'Half (Floating)' }}
            </span>
          </ng-template>
        </tm-column>

        <tm-column key="schedule" label="Schedule" width="190">
          <ng-template let-row>
            <div class="cell-main">
              <span *ngIf="!row.starts_at && !row.ends_at" class="cell-title" style="font-weight: 500;">Always active</span>
              <ng-container *ngIf="row.starts_at || row.ends_at">
                <span class="cell-nolink">
                  {{ formatDate(row.starts_at) }} — {{ formatDate(row.ends_at) }}
                </span>
                <span class="tagx" [ngClass]="getScheduleTone(row)">
                  {{ getScheduleLabel(row) }}
                </span>
              </ng-container>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="status" label="Status" width="120">
          <ng-template let-row>
            <button
              type="button"
              class="switch-btn"
              [class.is-active]="row.is_active"
              (click)="toggleStatus(row)"
              [title]="row.is_active ? 'Click to deactivate' : 'Click to activate'"
            >
              <span class="switch-track">
                <span class="switch-thumb"></span>
              </span>
              <span class="switch-lbl">{{ row.is_active ? 'Active' : 'Inactive' }}</span>
            </button>
          </ng-template>
        </tm-column>

        <tm-column key="actions" label="" width="90" align="right">
          <ng-template let-row>
            <div class="cell-actions">
              <button class="icon-btn" (click)="openEdit(row)" aria-label="Edit banner" title="Edit banner">
                <tm-icon name="edit" [size]="13" />
              </button>
              <button class="icon-btn icon-btn--danger" (click)="deleteTarget = row" aria-label="Delete banner" title="Delete banner">
                <tm-icon name="trash" [size]="13" />
              </button>
            </div>
          </ng-template>
        </tm-column>
      </tm-data-table>
    </div>

    <!-- Create / Edit Drawer -->
    <tm-drawer
      [open]="drawerOpen"
      [title]="editingId ? 'Edit banner' : 'Add banner'"
      [width]="560"
      (closed)="drawerOpen = false"
    >
      <div slot="body" class="form">
        <label class="field">
          <span class="field__lbl">Banner Title <i>*</i></span>
          <input
            type="text"
            [(ngModel)]="formTitle"
            (ngModelChange)="touched = true"
            placeholder="e.g. 20% Off Weekend Special"
          />
          <span class="field__err" *ngIf="touched && !formTitle.trim()">Banner title is required.</span>
        </label>

        <div class="row">
          <label class="field">
            <span class="field__lbl">Target App <i>*</i></span>
            <select [(ngModel)]="formTargetApp">
              <option *ngFor="let opt of targetAppOptions" [value]="opt.value">{{ opt.label }}</option>
            </select>
          </label>

          <label class="field">
            <span class="field__lbl">Display Position <i>*</i></span>
            <select [(ngModel)]="formPosition">
              <option *ngFor="let opt of positionOptions" [value]="opt.value">{{ opt.label }}</option>
            </select>
          </label>
        </div>

        <label class="field">
          <span class="field__lbl">Action Link URL</span>
          <input
            type="url"
            [(ngModel)]="formUrlLink"
            placeholder="https://example.com/promo or offer page"
          />
          <span class="field__hint">When users tap the banner, they are prompted to visit this link.</span>
        </label>

        <div class="row">
          <label class="field">
            <span class="field__lbl">
              Starts At
              <button *ngIf="formStartsAt" type="button" class="clear-date-btn" (click)="formStartsAt = ''">Clear</button>
            </span>
            <input type="datetime-local" [(ngModel)]="formStartsAt" />
            <span class="field__hint">Leave blank for always active</span>
          </label>

          <label class="field">
            <span class="field__lbl">
              Ends At
              <button *ngIf="formEndsAt" type="button" class="clear-date-btn" (click)="formEndsAt = ''">Clear</button>
            </span>
            <input type="datetime-local" [(ngModel)]="formEndsAt" />
            <span class="field__hint">Leave blank for no end date</span>
          </label>
        </div>

        <div class="field">
          <span class="field__lbl">Banner Image <i *ngIf="!editingId">*</i></span>
          <div class="drop-zone" (click)="fileInput.click()">
            <input
              #fileInput
              type="file"
              accept="image/png,image/jpeg,image/webp,image/jpg"
              (change)="onFileSelected($event)"
              style="display: none"
            />
            <div *ngIf="previewUrl || existingImageUrl" class="drop-preview">
              <img [src]="previewUrl || existingImageUrl" alt="Preview" class="drop-img" />
              <div class="drop-overlay">
                <tm-icon name="upload" [size]="16" />
                <span>Change image</span>
              </div>
            </div>
            <div *ngIf="!previewUrl && !existingImageUrl" class="drop-prompt">
              <tm-icon name="image" [size]="24" />
              <span class="drop-text">Click to choose banner image</span>
              <span class="field__hint">PNG, JPG, or WEBP up to 8MB</span>
            </div>
          </div>
          <span class="field__err" *ngIf="touched && !editingId && !selectedFile">Banner image is required.</span>
        </div>

        <label class="toggle">
          <input type="checkbox" [(ngModel)]="formIsActive" />
          <span>Active immediately</span>
        </label>
      </div>

      <div slot="footer">
        <tm-button variant="ghost" (clicked)="drawerOpen = false">Cancel</tm-button>
        <tm-button variant="green" [disabled]="!isFormValid || saving" (clicked)="saveBanner()">
          {{ saving ? 'Saving…' : editingId ? 'Save changes' : 'Create Banner' }}
        </tm-button>
      </div>
    </tm-drawer>

    <!-- Delete Modal -->
    <tm-modal
      [open]="deleteTarget != null"
      title="Delete banner"
      (closed)="deleteTarget = null"
    >
      <div slot="body">
        <p>Are you sure you want to delete the banner <strong>"{{ deleteTarget?.title }}"</strong>? This cannot be undone.</p>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="deleteTarget = null">Cancel</tm-button>
        <tm-button variant="danger" [disabled]="deleting" (clicked)="confirmDelete()">Delete</tm-button>
      </div>
    </tm-modal>

    <!-- Lightbox Image Preview Modal -->
    <tm-modal
      [open]="previewImage != null"
      title="Banner Preview"
      (closed)="previewImage = null"
    >
      <div slot="body" style="display: flex; justify-content: center; padding: 8px 0;">
        <img [src]="previewImage" alt="Preview" class="lightbox-img" />
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="previewImage = null">Close</tm-button>
      </div>
    </tm-modal>
  `,
  styles: [`
    .bp { display: flex; flex-direction: column; gap: 16px; }
    .bp__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .bp__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .bp__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); }

    /* table cell renderers */
    .cell-thumb-wrap {
      width: 80px; height: 44px;
      border-radius: 6px; overflow: hidden;
      background: var(--tm-canvas-2); border: 1px solid var(--tm-line);
      cursor: pointer; display: flex; align-items: center; justify-content: center;
    }
    .cell-thumb { width: 100%; height: 100%; object-fit: cover; }

    .cell-main { display: flex; flex-direction: column; gap: 2px; }
    .cell-title { font-weight: 700; color: var(--tm-text); font-size: 13px; }
    .cell-link {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 11px; color: var(--tm-green, #10b981); text-decoration: none; word-break: break-all;
    }
    .cell-link:hover { text-decoration: underline; }
    .cell-nolink { font-size: 11px; color: var(--tm-text-muted); }

    .cell-actions { display: inline-flex; gap: 6px; }
    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 7px;
      background: var(--tm-canvas-2); color: var(--tm-text-muted); cursor: pointer; border: 0;
    }
    .icon-btn:hover { background: var(--tm-ink); color: #fff; }
    .icon-btn--danger:hover { background: var(--tm-danger, #ef4444); color: #fff; }

    .tagx {
      display: inline-flex; align-items: center; gap: 3px;
      font-size: 11px; font-weight: 700;
      padding: 3px 8px; border-radius: 6px;
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
    }
    .tagx--customer { background: #eff6ff; color: #1d4ed8; }
    .tagx--driver   { background: #f0fdf4; color: #15803d; }
    .tagx--both     { background: #faf5ff; color: #7e22ce; }
    .tagx--active   { color: #16a34a; }
    .tagx--upcoming { color: #d97706; }
    .tagx--expired  { color: #dc2626; }

    /* switch toggle */
    .switch-btn {
      display: inline-flex; align-items: center; gap: 8px;
      background: none; border: none; cursor: pointer; padding: 4px 0;
    }
    .switch-track {
      width: 34px; height: 18px; border-radius: 999px;
      background: var(--tm-line); position: relative;
      transition: background-color var(--tm-duration-fast) var(--tm-ease);
    }
    .switch-btn.is-active .switch-track { background: var(--tm-green); }
    .switch-thumb {
      width: 14px; height: 14px; border-radius: 50%; background: #fff;
      position: absolute; top: 2px; left: 2px;
      transition: transform var(--tm-duration-fast) var(--tm-ease);
      box-shadow: 0 1px 2px rgba(0,0,0,0.15);
    }
    .switch-btn.is-active .switch-thumb { transform: translateX(16px); }
    .switch-lbl { font-size: 12px; font-weight: 600; color: var(--tm-text-muted); }
    .switch-btn.is-active .switch-lbl { color: var(--tm-text); }

    /* Drawer Form matching design system */
    .form { display: flex; flex-direction: column; gap: 13px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .field__lbl { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .field__lbl i { color: var(--tm-danger, #ef4444); font-style: normal; }
    .field input, .field select, .field textarea {
      width: 100%; padding: 9px 11px;
      border: 1px solid var(--tm-line); border-radius: 9px;
      background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13px; outline: none; font-family: inherit;
    }
    .field input:focus, .field select:focus, .field textarea:focus { border-color: var(--tm-green); }
    .field__err { font-size: 11px; font-weight: 600; color: var(--tm-danger, #ef4444); }
    .field__hint { font-size: 11px; color: var(--tm-text-muted); }

    .toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--tm-text); cursor: pointer; }
    .toggle input { width: 16px; height: 16px; cursor: pointer; }

    /* Drag & drop upload */
    .drop-zone {
      border: 1px dashed var(--tm-line); border-radius: 10px;
      background: var(--tm-canvas); padding: 16px;
      text-align: center; cursor: pointer;
      transition: border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .drop-zone:hover { border-color: var(--tm-green); }
    .drop-prompt {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      color: var(--tm-text-muted);
    }
    .drop-text { font-size: 13px; font-weight: 700; color: var(--tm-text); }
    .drop-preview {
      position: relative; max-height: 180px;
      display: flex; justify-content: center; align-items: center;
    }
    .drop-img { max-height: 160px; max-width: 100%; border-radius: 7px; object-fit: contain; }
    .drop-overlay {
      position: absolute; inset: 0; background: rgba(0,0,0,0.5); color: #fff;
      display: flex; align-items: center; justify-content: center; gap: 6px;
      opacity: 0; border-radius: 7px; font-size: 12px; font-weight: 700;
      transition: opacity var(--tm-duration-fast) var(--tm-ease);
    }
    .drop-preview:hover .drop-overlay { opacity: 1; }

    .lightbox-img { max-width: 100%; max-height: 70vh; border-radius: 8px; }
    .clear-date-btn {
      background: none; border: none; padding: 0 4px;
      font-size: 11px; font-weight: 600; color: var(--tm-danger, #ef4444);
      cursor: pointer; text-decoration: underline; margin-left: auto;
    }
  `],
})
export class BannersComponent implements OnInit {
  rows: BannerRow[] = [];
  loading = false;
  saving = false;
  deleting = false;
  touched = false;

  searchQuery = '';
  filterStatus = 'all';
  filterApp = 'all';
  filterPosition = 'all';

  statusOptions = STATUS_FILTER_OPTIONS;
  appFilterOptions = APP_FILTER_OPTIONS;
  positionFilterOptions = POSITION_FILTER_OPTIONS;
  targetAppOptions = TARGET_APP_OPTIONS;
  positionOptions = POSITION_OPTIONS;

  drawerOpen = false;
  editingId: number | null = null;
  deleteTarget: BannerRow | null = null;
  previewImage: string | null = null;

  // Form fields
  formTitle = '';
  formTargetApp: 'customer' | 'driver' | 'both' = 'customer';
  formPosition: 'full_screen' | 'half' = 'half';
  formUrlLink = '';
  formStartsAt = '';
  formEndsAt = '';
  formIsActive = true;
  selectedFile: File | null = null;
  previewUrl: string | null = null;
  existingImageUrl: string | null = null;

  constructor(
    private api: ApiService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.loadBanners();
  }

  get filteredRows(): BannerRow[] {
    return this.rows.filter((row) => {
      if (this.searchQuery.trim()) {
        const q = this.searchQuery.toLowerCase();
        if (!row.title.toLowerCase().includes(q)) return false;
      }
      if (this.filterStatus === 'active' && !row.is_active) return false;
      if (this.filterStatus === 'inactive' && row.is_active) return false;
      if (this.filterApp !== 'all' && row.target_app !== this.filterApp && row.target_app !== 'both') return false;
      if (this.filterPosition !== 'all' && row.position !== this.filterPosition) return false;
      return true;
    });
  }

  get isFormValid(): boolean {
    if (!this.formTitle.trim()) return false;
    if (!this.editingId && !this.selectedFile) return false;
    return true;
  }

  loadBanners(): void {
    this.loading = true;
    this.api.get<{ data: BannerRow[] }>('/admin/app-banners').subscribe({
      next: (res) => {
        this.rows = res.data ?? [];
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.toast.error(err?.error?.message || 'Failed to load banners');
      },
    });
  }

  openCreate(): void {
    this.editingId = null;
    this.formTitle = '';
    this.formTargetApp = 'customer';
    this.formPosition = 'half';
    this.formUrlLink = '';
    this.formStartsAt = '';
    this.formEndsAt = '';
    this.formIsActive = true;
    this.selectedFile = null;
    this.previewUrl = null;
    this.existingImageUrl = null;
    this.touched = false;
    this.drawerOpen = true;
  }

  toLocalInput(dateStr: string | null): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  openEdit(banner: BannerRow): void {
    this.editingId = banner.id;
    this.formTitle = banner.title;
    this.formTargetApp = banner.target_app;
    this.formPosition = banner.position;
    this.formUrlLink = banner.url_link || '';
    this.formStartsAt = this.toLocalInput(banner.starts_at);
    this.formEndsAt = this.toLocalInput(banner.ends_at);
    this.formIsActive = banner.is_active;
    this.selectedFile = null;
    this.previewUrl = null;
    this.existingImageUrl = banner.image_url;
    this.touched = false;
    this.drawerOpen = true;
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.selectedFile = input.files[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        this.previewUrl = e.target?.result as string;
      };
      reader.readAsDataURL(this.selectedFile);
    }
  }

  saveBanner(): void {
    this.touched = true;
    if (!this.isFormValid) return;

    this.saving = true;
    const formData = new FormData();
    formData.append('title', this.formTitle.trim());
    formData.append('target_app', this.formTargetApp);
    formData.append('position', this.formPosition);
    formData.append('is_active', this.formIsActive ? '1' : '0');
    if (this.formUrlLink.trim()) {
      formData.append('url_link', this.formUrlLink.trim());
    } else {
      formData.append('url_link', '');
    }
    if (this.formStartsAt) {
      const d = new Date(this.formStartsAt);
      formData.append('starts_at', isNaN(d.getTime()) ? this.formStartsAt : d.toISOString());
    } else {
      formData.append('starts_at', '');
    }
    if (this.formEndsAt) {
      const d = new Date(this.formEndsAt);
      formData.append('ends_at', isNaN(d.getTime()) ? this.formEndsAt : d.toISOString());
    } else {
      formData.append('ends_at', '');
    }
    if (this.selectedFile) {
      formData.append('image', this.selectedFile);
    }

    const req$ = this.editingId
      ? this.api.postMultipart<{ data: BannerRow }>(`/admin/app-banners/${this.editingId}`, formData)
      : this.api.postMultipart<{ data: BannerRow }>('/admin/app-banners', formData);

    req$.subscribe({
      next: () => {
        this.saving = false;
        this.drawerOpen = false;
        this.toast.success(this.editingId ? 'Banner updated successfully' : 'Banner created successfully');
        this.loadBanners();
      },
      error: (err) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Failed to save banner');
      },
    });
  }

  toggleStatus(banner: BannerRow): void {
    const previous = banner.is_active;
    banner.is_active = !previous;
    this.api.patch<{ data: BannerRow }>(`/admin/app-banners/${banner.id}/toggle`, {}).subscribe({
      next: (res) => {
        banner.is_active = res.data.is_active;
        banner.is_currently_active = res.data.is_currently_active;
        this.toast.success(`Banner "${banner.title}" ${banner.is_active ? 'activated' : 'deactivated'}`);
      },
      error: (err) => {
        banner.is_active = previous;
        this.toast.error(err?.error?.message || 'Failed to update status');
      },
    });
  }

  confirmDelete(): void {
    if (!this.deleteTarget) return;
    this.deleting = true;
    this.api.delete(`/admin/app-banners/${this.deleteTarget.id}`).subscribe({
      next: () => {
        this.deleting = false;
        this.toast.success('Banner deleted');
        this.deleteTarget = null;
        this.loadBanners();
      },
      error: (err) => {
        this.deleting = false;
        this.toast.error(err?.error?.message || 'Failed to delete banner');
      },
    });
  }

  formatApp(app: string): string {
    switch (app) {
      case 'customer': return 'Customer App';
      case 'driver': return 'Driver App';
      case 'both': return 'Customer & Driver';
      default: return app;
    }
  }

  formatDate(dtStr: string | null): string {
    if (!dtStr) return '—';
    try {
      const d = new Date(dtStr);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return dtStr;
    }
  }

  getScheduleTone(banner: BannerRow): string {
    const now = new Date().getTime();
    if (banner.starts_at && new Date(banner.starts_at).getTime() > now) {
      return 'tagx--upcoming';
    }
    if (banner.ends_at && new Date(banner.ends_at).getTime() < now) {
      return 'tagx--expired';
    }
    return 'tagx--active';
  }

  getScheduleLabel(banner: BannerRow): string {
    const now = new Date().getTime();
    if (banner.starts_at && new Date(banner.starts_at).getTime() > now) {
      return 'Starts soon';
    }
    if (banner.ends_at && new Date(banner.ends_at).getTime() < now) {
      return 'Expired';
    }
    return 'Active in window';
  }
}
