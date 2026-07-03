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
import { ApiService } from '../../../core/api.service';
import { ToastService } from '../../../core/toast.service';
import {
  ButtonComponent,
  ColumnComponent,
  DataTableComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectComponent,
  SelectOption,
} from '../../../ui';

type Category = 'driver_document' | 'car_rental_document';
type RequiredMode = 'mandatory_register' | 'optional';
type DocumentTypeKey = 'normal' | 'gallery_restricted' | 'gallery_with_label';
type LabelType = 'text' | 'number' | 'date' | 'url';

interface DocumentLabel {
  id?: number;
  label: string;
  label_type: LabelType;
  mandatory: boolean;
  sort_order?: number;
}

interface DocumentRow {
  id: number;
  name: string;
  no_of_images: number;
  category: Category;
  required: RequiredMode | null;
  document_type: DocumentTypeKey;
  gallery_restricted: boolean;
  instructions: string | null;
  status: string | null;
  labels: DocumentLabel[];
}

interface CreateForm {
  name: string;
  no_of_images: number;
  category: Category;
  required: RequiredMode;
  document_type: DocumentTypeKey;
  gallery_restricted: boolean;
  instructions: string;
  add_labels: boolean;
  labels: DocumentLabel[];
}

const CATEGORY_OPTIONS: SelectOption<Category>[] = [
  { label: 'Driver Document', value: 'driver_document' },
  { label: 'Car Rental Document', value: 'car_rental_document' },
];
const REQUIRED_OPTIONS: SelectOption<RequiredMode>[] = [
  { label: 'Mandatory Register', value: 'mandatory_register' },
  { label: 'Optional', value: 'optional' },
];
const DOC_TYPE_OPTIONS: SelectOption<DocumentTypeKey>[] = [
  { label: 'Normal', value: 'normal' },
];
const LABEL_TYPE_OPTIONS: SelectOption<LabelType>[] = [
  { label: 'Text', value: 'text' },
  { label: 'Number', value: 'number' },
  { label: 'Date', value: 'date' },
  { label: 'URL', value: 'url' },
];
const STATUS_OPTIONS: SelectOption<string>[] = [
  { label: 'Mandatory Register', value: 'mandatory_register' },
  { label: 'Mandatory Drive', value: 'mandatory_drive' },
];

@Component({
  selector: 'app-documents-catalog-tab',
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
    ModalComponent,
    SelectComponent,
  ],
  template: `
    <div class="page">
      <header class="page__hero">
        <div class="page__hero-left">
          <span class="page__eyebrow">
            <span class="page__eyebrow-dot" aria-hidden="true"></span> Documents Catalog
          </span>
          <p class="page__subtitle">
            Define the document types drivers must upload. Set status, attach labels, and these flow
            into every driver's onboarding checklist.
          </p>
        </div>
        <div class="page__hero-right">
          <tm-button variant="ink" icon="plus" (clicked)="openCreate()">
            Create Document
          </tm-button>
        </div>
      </header>

      <tm-data-table
        [rows]="pagedRows"
        [total]="filteredRows.length"
        [page]="page"
        [pageSize]="pageSize"
        [pageSizes]="[10, 25, 50, 100]"
        [loading]="loading"
        emptyTitle="No documents yet"
        emptyHint='Click "Create Document" to add one.'
        (pageChange)="onPageChange($event)"
        (pageSizeChange)="onPageSizeChange($event)"
      >
        <tm-input
          slot="search"
          icon="search"
          placeholder="Search by name…"
          [(ngModel)]="search"
          (ngModelChange)="onSearchChange()"
        />

        <tm-column key="id" label="ID" width="80">
          <ng-template let-row>
            <span class="cell-id">#{{ row.id }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="name" label="Document">
          <ng-template let-row>
            <div class="cell-doc">
              <strong>{{ row.name }}</strong>
              <span class="cell-doc__sub muted small">
                {{ categoryLabel(row.category) }} · {{ row.no_of_images }} image{{ row.no_of_images === 1 ? '' : 's' }}
              </span>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="status" label="Status" width="180">
          <ng-template let-row>
            <span *ngIf="row.status" class="status-pill is-on">{{ statusLabel(row.status) }}</span>
            <span *ngIf="!row.status" class="muted small">—</span>
          </ng-template>
        </tm-column>

        <tm-column key="gallery" label="Gallery" width="100" align="center">
          <ng-template let-row>
            <tm-icon
              [name]="row.gallery_restricted ? 'check' : 'x'"
              [size]="14"
              [class.is-on]="row.gallery_restricted"
              [class.is-off]="!row.gallery_restricted"
              class="gallery-flag"
            />
          </ng-template>
        </tm-column>

        <tm-column key="action" label="" width="220" align="right">
          <ng-template let-row>
            <div class="row-actions">
              <tm-button variant="outline" size="sm" icon="edit" (clicked)="openEdit(row)">Edit</tm-button>
              <tm-button variant="ghost" size="sm" icon="check" (clicked)="openAssign(row)">Assign</tm-button>
            </div>
          </ng-template>
        </tm-column>
      </tm-data-table>

      <!-- Create / Edit modal -->
      <tm-modal
        [open]="formOpen"
        [title]="editing ? 'Edit Document' : 'Create Document'"
        [dismissible]="!saving"
        (closed)="formOpen = false"
      >
        <ng-container slot="body">
          <p *ngIf="editing" class="muted small" style="margin: 0 0 12px;">
            Changes will be reflected for all cities.
          </p>

          <div class="form">
            <label class="lbl">Document Name *</label>
            <input class="input" type="text" [(ngModel)]="form.name" placeholder="Driver License" />

            <label class="lbl">No. of Images Required *</label>
            <input class="input" type="number" min="1" max="20"
                   [(ngModel)]="form.no_of_images" />

            <label class="lbl">Document Category *</label>
            <tm-select [options]="categoryOptions" [(ngModel)]="form.category" />

            <label class="lbl">Required *</label>
            <tm-select [options]="requiredOptions" [(ngModel)]="form.required" />

            <label class="lbl">Document Type *</label>
            <tm-select [options]="documentTypeOptions" [(ngModel)]="form.document_type"
                       placeholder="Select Document Type" />

            <div class="switch-row">
              <span class="lbl no-mt">Gallery Restricted</span>
              <label class="switch">
                <input type="checkbox" [(ngModel)]="form.gallery_restricted" />
                <span class="switch__slider"></span>
              </label>
            </div>

            <label class="lbl">Instructions</label>
            <textarea class="textarea" rows="2" [(ngModel)]="form.instructions"
                      placeholder="Please enter instructions here"></textarea>

            <div class="switch-row">
              <span class="lbl no-mt">Add Labels</span>
              <div class="row-gap">
                <label class="switch">
                  <input type="checkbox"
                         [ngModel]="form.add_labels"
                         (ngModelChange)="onToggleLabels($event)" />
                  <span class="switch__slider"></span>
                </label>
                <span class="muted small">Total: {{ form.labels.length }}</span>
              </div>
            </div>

            <div *ngIf="form.add_labels" class="labels-block">
              <div *ngFor="let lbl of form.labels; let i = index; trackBy: trackByIndex"
                   class="label-card">
                <div class="label-card__head">
                  <strong>Label {{ i + 1 }}</strong>
                  <button type="button" class="link-danger" (click)="removeLabel(i)">Remove</button>
                </div>
                <label class="lbl">Label *</label>
                <input class="input" type="text" [(ngModel)]="lbl.label"
                       placeholder="e.g. License number" />

                <label class="lbl">Label Type *</label>
                <tm-select [options]="labelTypeOptions" [(ngModel)]="lbl.label_type"
                           placeholder="Select Label Type" />

                <div class="mandatory-row">
                  <span class="lbl no-mt">Mandatory</span>
                  <label class="radio-inline">
                    <input type="radio" [name]="'lbl-mand-' + i"
                           [value]="true" [(ngModel)]="lbl.mandatory" />
                    Yes
                  </label>
                  <label class="radio-inline">
                    <input type="radio" [name]="'lbl-mand-' + i"
                           [value]="false" [(ngModel)]="lbl.mandatory" />
                    No
                  </label>
                </div>
              </div>

              <tm-button variant="outline" size="sm" icon="plus" (clicked)="addLabel()">
                Add Another Label
              </tm-button>
            </div>
          </div>
        </ng-container>

        <ng-container slot="footer">
          <tm-button variant="ghost" (clicked)="formOpen = false" [disabled]="saving">Cancel</tm-button>
          <tm-button variant="ink"
                     [loading]="saving"
                     icon="check"
                     (clicked)="submitForm()">
            {{ editing ? 'Update' : 'Create' }}
          </tm-button>
        </ng-container>
      </tm-modal>

      <!-- Assign status modal -->
      <tm-modal
        [open]="assignOpen"
        title="Assign Document Status"
        [dismissible]="!assignSaving"
        (closed)="assignOpen = false"
      >
        <ng-container slot="body">
          <div class="form">
            <label class="lbl">Document Id</label>
            <input class="input" type="text" [value]="assignTarget?.id || ''" disabled />
            <label class="lbl">Document Name</label>
            <input class="input" type="text" [value]="assignTarget?.name || ''" disabled />
            <label class="lbl">Document Status *</label>
            <tm-select [options]="statusOptions" [(ngModel)]="assignStatus"
                       placeholder="Select status" />
            <p class="muted small" style="margin: 8px 0 0;">
              Status applies globally for now. Per-vehicle scoping comes in a later phase.
            </p>
          </div>
        </ng-container>

        <ng-container slot="footer">
          <tm-button variant="ghost" (clicked)="assignOpen = false" [disabled]="assignSaving">Cancel</tm-button>
          <tm-button variant="ink" icon="check"
                     [loading]="assignSaving"
                     (clicked)="submitAssign()">
            Assign
          </tm-button>
        </ng-container>
      </tm-modal>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .page { display: flex; flex-direction: column; gap: var(--tm-space-5); }
    .page__hero {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--tm-space-4);
      flex-wrap: wrap;
    }
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
    .cell-doc { display: flex; flex-direction: column; gap: 2px; }
    .cell-doc strong { font-size: 13px; color: var(--tm-text); }
    .cell-doc__sub { font-size: 11px; }

    .status-pill {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border-radius: var(--tm-radius-pill);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      background: var(--tm-green-tint);
      color: var(--tm-green-deep);
      border: 1px solid var(--tm-green-soft);
    }
    .gallery-flag.is-on  { color: var(--tm-green-deep); }
    .gallery-flag.is-off { color: var(--tm-text-soft); }

    .muted { color: var(--tm-text-muted); }
    .small { font-size: 12px; }

    .row-actions {
      display: inline-flex;
      gap: 6px;
      align-items: center;
      justify-content: flex-end;
    }

    /* Form (inside modal) */
    .form { display: flex; flex-direction: column; gap: 6px; }
    .lbl {
      margin-top: 10px;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--tm-text-muted);
    }
    .lbl.no-mt { margin-top: 0; }
    .input, .textarea {
      width: 100%;
      padding: 9px 12px;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-sm);
      font-family: var(--tm-font-body);
      font-size: 13px;
      color: var(--tm-text);
      outline: 0;
      transition: border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .input:focus, .textarea:focus { border-color: var(--tm-ink); }
    .input:disabled {
      background: var(--tm-canvas-2);
      color: var(--tm-text-soft);
      cursor: not-allowed;
    }
    .textarea { resize: vertical; min-height: 60px; }

    /* Toggle switch */
    .switch-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-top: 10px;
      padding: 10px 12px;
      background: var(--tm-canvas);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-sm);
    }
    .row-gap { display: inline-flex; align-items: center; gap: 10px; }
    .switch {
      position: relative;
      display: inline-block;
      width: 36px;
      height: 20px;
      flex-shrink: 0;
    }
    .switch input { opacity: 0; width: 0; height: 0; position: absolute; }
    .switch__slider {
      position: absolute;
      cursor: pointer;
      inset: 0;
      background: var(--tm-canvas-2);
      border-radius: 999px;
      transition: background var(--tm-duration-fast) var(--tm-ease);
    }
    .switch__slider::before {
      content: '';
      position: absolute;
      width: 14px;
      height: 14px;
      left: 3px;
      top: 3px;
      background: #fff;
      border-radius: 50%;
      transition: transform var(--tm-duration-fast) var(--tm-ease);
      box-shadow: 0 1px 2px rgba(15,20,25,0.18);
    }
    .switch input:checked + .switch__slider { background: var(--tm-green); }
    .switch input:checked + .switch__slider::before { transform: translateX(16px); }

    /* Labels block */
    .labels-block {
      margin-top: 10px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px;
      background: var(--tm-canvas);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-sm);
    }
    .label-card {
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-sm);
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .label-card__head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .link-danger {
      background: transparent;
      border: 0;
      color: #dc2626;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: var(--tm-radius-sm);
      transition: background var(--tm-duration-fast) var(--tm-ease);
    }
    .link-danger:hover { background: #fef2f2; }

    .mandatory-row {
      display: flex;
      align-items: center;
      gap: 18px;
      margin-top: 8px;
    }
    .radio-inline {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      color: var(--tm-text);
    }
    .radio-inline input[type='radio'] {
      width: 16px;
      height: 16px;
      accent-color: var(--tm-green);
    }

    /* Match toolbar input height with the rest */
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
export class DocumentsCatalogTabComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly categoryOptions   = CATEGORY_OPTIONS;
  readonly requiredOptions   = REQUIRED_OPTIONS;
  readonly documentTypeOptions = DOC_TYPE_OPTIONS;
  readonly labelTypeOptions  = LABEL_TYPE_OPTIONS;
  readonly statusOptions     = STATUS_OPTIONS;

  documents: DocumentRow[] = [];
  loading = false;

  search = '';
  page = 1;
  pageSize = 25;

  // Create / edit modal
  formOpen = false;
  editing = false;
  editingId: number | null = null;
  saving = false;
  form: CreateForm = this.blankForm();

  // Assign modal
  assignOpen = false;
  assignSaving = false;
  assignTarget: DocumentRow | null = null;
  assignStatus: string | null = null;

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private refreshInFlight = false;

  ngOnInit(): void {
    this.fetch();
    this.startLiveRefresh();
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  private startLiveRefresh(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => {
      if (this.refreshInFlight || this.formOpen || this.assignOpen || this.saving || this.assignSaving) return;
      this.fetch(true);
    }, 5000);
  }

  // ------------ Listing ------------
  fetch(silent = false): void {
    if (this.refreshInFlight) return;
    this.refreshInFlight = true;
    if (!silent) this.loading = true;
    this.api.get<{ data: DocumentRow[] }>('/admin/documents').subscribe({
      next: (res) => {
        this.documents = res?.data ?? [];
        this.loading = false;
        this.refreshInFlight = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.refreshInFlight = false;
        if (!silent) this.toast.error('Failed to load documents', { title: 'Load failed' });
        this.cdr.markForCheck();
      },
    });
  }

  onSearchChange(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => { this.page = 1; this.cdr.markForCheck(); }, 200);
  }

  get filteredRows(): DocumentRow[] {
    const term = this.search.trim().toLowerCase();
    if (!term) return this.documents;
    return this.documents.filter((d) => d.name.toLowerCase().includes(term));
  }

  get pagedRows(): DocumentRow[] {
    const start = (this.page - 1) * this.pageSize;
    return this.filteredRows.slice(start, start + this.pageSize);
  }

  onPageChange(p: number): void { this.page = p; }
  onPageSizeChange(s: number): void { this.pageSize = s; this.page = 1; }

  // ------------ Helpers ------------
  trackByIndex(i: number): number { return i; }
  categoryLabel(c: Category | string): string {
    return CATEGORY_OPTIONS.find((x) => x.value === c)?.label ?? c;
  }
  statusLabel(s: string): string {
    return STATUS_OPTIONS.find((x) => x.value === s)?.label ?? s;
  }

  // ------------ Form open / edit ------------
  blankForm(): CreateForm {
    return {
      name: '',
      no_of_images: 1,
      category: 'driver_document',
      required: 'mandatory_register',
      document_type: 'normal',
      gallery_restricted: false,
      instructions: '',
      add_labels: false,
      labels: [],
    };
  }

  openCreate(): void {
    this.editing = false;
    this.editingId = null;
    this.form = this.blankForm();
    this.formOpen = true;
  }

  openEdit(d: DocumentRow): void {
    this.editing = true;
    this.editingId = d.id;
    this.form = {
      name: d.name,
      no_of_images: d.no_of_images,
      category: d.category,
      required: (d.required as RequiredMode) || 'mandatory_register',
      document_type: d.document_type,
      gallery_restricted: d.gallery_restricted,
      instructions: d.instructions || '',
      add_labels: d.labels.length > 0,
      labels: d.labels.map((l) => ({
        label: l.label,
        label_type: l.label_type,
        mandatory: l.mandatory,
        sort_order: l.sort_order,
      })),
    };
    this.formOpen = true;
  }

  onToggleLabels(on: boolean): void {
    this.form.add_labels = on;
    if (on && this.form.labels.length === 0) this.addLabel();
    if (!on) this.form.labels = [];
  }

  addLabel(): void {
    this.form.labels = [
      ...this.form.labels,
      { label: '', label_type: 'text', mandatory: true },
    ];
  }
  removeLabel(i: number): void {
    this.form.labels = this.form.labels.filter((_, idx) => idx !== i);
    if (this.form.labels.length === 0) this.form.add_labels = false;
  }

  submitForm(): void {
    const f = this.form;
    if (!f.name.trim()) {
      this.toast.warning('Document name is required');
      return;
    }
    if (f.add_labels) {
      for (const l of f.labels) {
        if (!l.label.trim() || !l.label_type) {
          this.toast.warning('Each label needs a name and a type');
          return;
        }
      }
    }

    const payload = {
      name: f.name.trim(),
      no_of_images: f.no_of_images,
      category: f.category,
      required: f.required,
      document_type: f.document_type,
      gallery_restricted: f.gallery_restricted,
      instructions: f.instructions.trim() || null,
      labels: f.add_labels
        ? f.labels.map((l, idx) => ({
            label: l.label.trim(),
            label_type: l.label_type,
            mandatory: l.mandatory,
            sort_order: idx,
          }))
        : [],
    };

    this.saving = true;
    const req = this.editing && this.editingId != null
      ? this.api.patch<{ document: DocumentRow }>(`/admin/documents/${this.editingId}`, payload)
      : this.api.post<{ document: DocumentRow }>('/admin/documents', payload);

    req.subscribe({
      next: (res) => {
        this.saving = false;
        this.formOpen = false;
        if (this.editing) {
          this.documents = this.documents.map((d) =>
            d.id === res.document.id ? res.document : d,
          );
          this.toast.success('Document updated');
        } else {
          this.documents = [...this.documents, res.document];
          this.toast.success('Document created');
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Failed to save', { title: 'Save failed' });
        this.cdr.markForCheck();
      },
    });
  }

  // ------------ Assign ------------
  openAssign(d: DocumentRow): void {
    this.assignTarget = d;
    this.assignStatus = d.status || null;
    this.assignOpen = true;
  }

  submitAssign(): void {
    if (!this.assignTarget || !this.assignStatus) {
      this.toast.warning('Pick a status');
      return;
    }
    this.assignSaving = true;
    this.api
      .post<{ document: DocumentRow }>(
        `/admin/documents/${this.assignTarget.id}/assign`,
        { status: this.assignStatus },
      )
      .subscribe({
        next: (res) => {
          this.assignSaving = false;
          this.assignOpen = false;
          this.documents = this.documents.map((d) =>
            d.id === res.document.id ? res.document : d,
          );
          this.toast.success('Status updated');
          this.cdr.markForCheck();
        },
        error: () => {
          this.assignSaving = false;
          this.toast.error('Failed to update status');
          this.cdr.markForCheck();
        },
      });
  }
}
