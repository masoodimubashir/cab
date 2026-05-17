import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { RadioButtonModule } from 'primeng/radiobutton';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MessageService } from 'primeng/api';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';

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

const CATEGORY_OPTIONS = [
  { label: 'Driver Document', value: 'driver_document' as Category },
  { label: 'Car Rental Document', value: 'car_rental_document' as Category },
];
const REQUIRED_OPTIONS = [
  { label: 'Mandatory Register', value: 'mandatory_register' as RequiredMode },
  { label: 'Optional', value: 'optional' as RequiredMode },
];
const DOC_TYPE_OPTIONS = [
  { label: 'Normal', value: 'normal' as DocumentTypeKey },
];
const LABEL_TYPE_OPTIONS = [
  { label: 'Text', value: 'text' as LabelType },
  { label: 'Number', value: 'number' as LabelType },
  { label: 'Date', value: 'date' as LabelType },
  { label: 'URL', value: 'url' as LabelType },
];
const STATUS_OPTIONS = [
  { label: 'Mandatory Register', value: 'mandatory_register' },
  { label: 'Mandatory Drive', value: 'mandatory_drive' },
];

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

@Component({
  selector: 'app-driver-documents',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    TableModule,
    DialogModule,
    DropdownModule,
    InputTextModule,
    InputTextareaModule,
    InputNumberModule,
    InputSwitchModule,
    RadioButtonModule,
    ToastModule,
    ConfirmDialogModule,
  ],
  providers: [MessageService, ConfirmationService],
  template: `
    <p-toast />
    <p-confirmDialog />

    <h2 class="page-title">Driver Documents</h2>

    <div class="tabs">
      <button class="tab" [class.active]="tab === 'city'" (click)="tab = 'city'">
        City Documents
      </button>
      <button class="tab" [class.active]="tab === 'all'" (click)="tab = 'all'">
        All Documents
      </button>
    </div>

    <div *ngIf="tab === 'city'" class="placeholder">
      Per-city filtering coming soon. Browse the global catalog under <strong>All Documents</strong>.
    </div>

    <ng-container *ngIf="tab === 'all'">
      <div class="filter-bar">
        <div class="filter">
          <label class="lbl">Vehicle Type</label>
          <select disabled title="Per-vehicle scoping is coming in a later phase.">
            <option>Auto</option>
          </select>
        </div>
        <div class="filter grow">
          <label class="lbl">Search</label>
          <input pInputText [(ngModel)]="search" (ngModelChange)="onSearchChange()" placeholder="Search by name…" />
        </div>
        <button pButton type="button" label="Create Document" icon="pi pi-plus"
                class="p-button-sm" (click)="openCreate()"></button>
      </div>

      <p-table
        [value]="documents"
        [paginator]="true"
        [rows]="50"
        [rowHover]="true"
        styleClass="p-datatable-sm"
      >
        <ng-template pTemplate="header">
          <tr>
            <th>Document Id</th>
            <th>Document Name</th>
            <th>Document Status</th>
            <th>Document Category</th>
            <th class="num">No. of Images</th>
            <th>Gallery Restricted</th>
            <th>Instructions</th>
            <th style="width: 130px;">Action</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-d>
          <tr>
            <td>{{ d.id }}</td>
            <td><strong>{{ d.name }}</strong></td>
            <td>
              <span *ngIf="d.status" class="pill on">{{ statusLabel(d.status) }}</span>
              <span *ngIf="!d.status" class="muted">—</span>
            </td>
            <td>{{ categoryLabel(d.category) }}</td>
            <td class="num">{{ d.no_of_images }}</td>
            <td>{{ d.gallery_restricted ? 'True' : 'False' }}</td>
            <td class="instr">{{ d.instructions || '—' }}</td>
            <td class="action-col">
              <button pButton type="button" label="Edit" class="p-button-sm" (click)="openEdit(d)"></button>
              <button pButton type="button" label="Add" class="p-button-sm p-button-warning" (click)="openAssign(d)"></button>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td colspan="8" class="empty">No documents yet. Click "Create Document" to add one.</td></tr>
        </ng-template>
      </p-table>
    </ng-container>

    <!-- Create / Edit dialog (same form, with mode flag) -->
    <p-dialog
      [header]="editing ? 'Edit Document' : 'Create Document'"
      [(visible)]="formOpen"
      [modal]="true"
      [style]="{ width: '640px' }"
      [draggable]="false"
    >
      <p *ngIf="editing" class="muted small" style="margin: 0 0 12px;">
        Changes will be reflected for all cities.
      </p>

      <div class="form">
        <label class="lbl">Document Name *</label>
        <input pInputText [(ngModel)]="form.name" placeholder="Driver License" />

        <label class="lbl">No. of Images Required *</label>
        <p-inputNumber [(ngModel)]="form.no_of_images" [min]="1" [max]="20"></p-inputNumber>

        <label class="lbl">Document Category *</label>
        <p-dropdown
          [options]="categoryOptions"
          [(ngModel)]="form.category"
          optionLabel="label"
          optionValue="value"
          appendTo="body"
          [style]="{ width: '100%' }"
        ></p-dropdown>

        <label class="lbl">Required *</label>
        <p-dropdown
          [options]="requiredOptions"
          [(ngModel)]="form.required"
          optionLabel="label"
          optionValue="value"
          appendTo="body"
          [style]="{ width: '100%' }"
        ></p-dropdown>

        <label class="lbl">Document Type *</label>
        <p-dropdown
          [options]="documentTypeOptions"
          [(ngModel)]="form.document_type"
          optionLabel="label"
          optionValue="value"
          placeholder="Select Document Type"
          appendTo="body"
          [style]="{ width: '100%' }"
        ></p-dropdown>

        <div class="switch-row">
          <span class="lbl">Gallery Restricted</span>
          <p-inputSwitch [(ngModel)]="form.gallery_restricted"></p-inputSwitch>
        </div>

        <label class="lbl">Instructions</label>
        <textarea pInputTextarea rows="2" [(ngModel)]="form.instructions"
                  placeholder="Please Enter Instructions here"></textarea>

        <div class="switch-row">
          <span class="lbl">Add Labels</span>
          <div class="row-gap">
            <p-inputSwitch [(ngModel)]="form.add_labels" (ngModelChange)="onToggleLabels($event)"></p-inputSwitch>
            <span class="muted small">Total Label Added: {{ form.labels.length }}</span>
          </div>
        </div>

        <div *ngIf="form.add_labels" class="labels-block">
          <div *ngFor="let lbl of form.labels; let i = index; trackBy: trackByIndex" class="label-card">
            <div class="label-card__head">
              <strong>Label {{ i + 1 }}</strong>
              <button pButton type="button" label="Remove" class="p-button-sm p-button-text p-button-danger"
                      (click)="removeLabel(i)"></button>
            </div>
            <label class="lbl">Label *</label>
            <input pInputText [(ngModel)]="lbl.label" placeholder="Please Enter Document Label" />

            <label class="lbl">Label Type *</label>
            <p-dropdown
              [options]="labelTypeOptions"
              [(ngModel)]="lbl.label_type"
              optionLabel="label"
              optionValue="value"
              placeholder="Select Label Type"
              appendTo="body"
              [style]="{ width: '100%' }"
            ></p-dropdown>

            <div class="mandatory-row">
              <span class="lbl">Mandatory</span>
              <label class="radio-inline">
                <p-radioButton [name]="'lbl-mand-' + i" [value]="true" [(ngModel)]="lbl.mandatory"></p-radioButton>
                YES
              </label>
              <label class="radio-inline">
                <p-radioButton [name]="'lbl-mand-' + i" [value]="false" [(ngModel)]="lbl.mandatory"></p-radioButton>
                NO
              </label>
            </div>
          </div>

          <button pButton type="button" label="Add Another Label" icon="pi pi-plus"
                  class="p-button-sm" (click)="addLabel()"></button>
        </div>
      </div>

      <ng-template pTemplate="footer">
        <button pButton type="button" label="Cancel" class="p-button-secondary" (click)="formOpen = false"></button>
        <button pButton
                type="button"
                [label]="editing ? 'Update' : 'Create'"
                (click)="submitForm()"
                [loading]="saving"></button>
      </ng-template>
    </p-dialog>

    <!-- Assign (Add) status dialog -->
    <p-dialog
      header="Add Document"
      [(visible)]="assignOpen"
      [modal]="true"
      [style]="{ width: '460px' }"
      [draggable]="false"
    >
      <div class="form">
        <label class="lbl">Document Id</label>
        <input pInputText [value]="assignTarget?.id || ''" disabled />

        <label class="lbl">Document Name</label>
        <input pInputText [value]="assignTarget?.name || ''" disabled />

        <label class="lbl">Document Status *</label>
        <p-dropdown
          [options]="statusOptions"
          [(ngModel)]="assignStatus"
          optionLabel="label"
          optionValue="value"
          placeholder="Select status"
          appendTo="body"
          [style]="{ width: '100%' }"
        ></p-dropdown>

        <p class="muted small" style="margin: 8px 0 0;">
          Status applies globally for now. Per-vehicle scoping comes in a later phase.
        </p>
      </div>

      <ng-template pTemplate="footer">
        <button pButton type="button" label="Cancel" class="p-button-secondary" (click)="assignOpen = false"></button>
        <button pButton type="button" label="Add" (click)="submitAssign()" [loading]="assignSaving"></button>
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .page-title { margin: 0 0 16px; font-size: 22px; font-weight: 800; color: #0f172a; text-align: center; }

      .tabs {
        display: flex;
        gap: 0;
        background: #f1f5f9;
        border-radius: 10px;
        padding: 4px;
        margin: 0 auto 20px;
        max-width: 720px;
      }
      .tab {
        flex: 1;
        padding: 10px 16px;
        background: transparent;
        border: 0;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 700;
        font-size: 13px;
        color: #475569;
      }
      .tab.active { background: #06b6d4; color: #fff; }

      .placeholder {
        padding: 28px;
        text-align: center;
        color: #64748b;
        background: #fff;
        border: 1px dashed #cbd5e1;
        border-radius: 12px;
      }

      .filter-bar {
        display: flex;
        align-items: flex-end;
        gap: 12px;
        margin-bottom: 14px;
        flex-wrap: wrap;
      }
      .filter { display: flex; flex-direction: column; gap: 4px; }
      .filter.grow { flex: 1; min-width: 220px; }
      .lbl { font-size: 12px; font-weight: 700; color: #475569; }
      .filter select {
        padding: 7px 10px;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        font-size: 13px;
        background: #fff;
        min-width: 160px;
      }
      .filter input[pInputText] { min-width: 220px; }

      .num { text-align: right; }
      .instr { max-width: 280px; }
      .pill {
        display: inline-block;
        padding: 2px 10px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.4px;
      }
      .pill.on { background: #dcfce7; color: #166534; }
      .muted { color: #64748b; }
      .small { font-size: 12px; }
      .empty { padding: 28px; text-align: center; color: #64748b; }

      .action-col { display: flex; gap: 6px; }
      :host ::ng-deep .action-col .p-button-sm { padding: 4px 10px; font-size: 12px; }

      .form { display: flex; flex-direction: column; gap: 6px; }
      .form .lbl { margin-top: 6px; }
      input[pInputText], textarea {
        width: 100%;
      }
      :host ::ng-deep .form .p-dropdown, :host ::ng-deep .form .p-inputnumber { width: 100%; }

      .switch-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 10px;
        padding: 8px 10px;
        background: #f8fafc;
        border-radius: 8px;
      }
      .switch-row .lbl { margin: 0; }
      .row-gap { display: inline-flex; gap: 10px; align-items: center; }

      .labels-block {
        margin-top: 10px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 10px;
        background: #f8fafc;
        border-radius: 10px;
      }
      .label-card {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 10px;
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
      .mandatory-row {
        display: flex;
        align-items: center;
        gap: 18px;
        margin-top: 6px;
      }
      .radio-inline {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 600;
      }
    `,
  ],
})
export class DriverDocumentsComponent implements OnInit, OnDestroy {
  tab: 'city' | 'all' = 'all';
  documents: DocumentRow[] = [];
  search = '';

  categoryOptions = CATEGORY_OPTIONS;
  requiredOptions = REQUIRED_OPTIONS;
  documentTypeOptions = DOC_TYPE_OPTIONS;
  labelTypeOptions = LABEL_TYPE_OPTIONS;
  statusOptions = STATUS_OPTIONS;

  // Create / Edit
  formOpen = false;
  editing = false;
  editingId: number | null = null;
  saving = false;
  form: CreateForm = this.blankForm();

  // Assign / Add
  assignOpen = false;
  assignSaving = false;
  assignTarget: DocumentRow | null = null;
  assignStatus: string | null = null;

  private searchTimer: number | null = null;
  private subs: Subscription[] = [];

  constructor(
    private api: ApiService,
    private msg: MessageService,
    private confirm: ConfirmationService,
  ) {}

  ngOnInit(): void {
    this.fetch();
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    if (this.searchTimer) window.clearTimeout(this.searchTimer);
  }

  // ---- Listing ----
  fetch(): void {
    const params = new URLSearchParams();
    if (this.search.trim()) params.set('search', this.search.trim());
    const qs = params.toString() ? `?${params.toString()}` : '';
    this.api.get<{ data: DocumentRow[] }>(`/admin/documents${qs}`).subscribe({
      next: (res) => (this.documents = res.data ?? []),
      error: () => this.msg.add({ severity: 'error', summary: 'Failed to load documents' }),
    });
  }

  onSearchChange(): void {
    if (this.searchTimer) window.clearTimeout(this.searchTimer);
    this.searchTimer = window.setTimeout(() => this.fetch(), 300);
  }

  trackByIndex(i: number): number { return i; }

  categoryLabel(c: Category | string): string {
    return CATEGORY_OPTIONS.find((x) => x.value === c)?.label ?? c;
  }
  statusLabel(s: string): string {
    return STATUS_OPTIONS.find((x) => x.value === s)?.label ?? s;
  }

  // ---- Create / Edit ----
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
      this.msg.add({ severity: 'warn', summary: 'Document name is required' });
      return;
    }
    if (f.add_labels) {
      for (const l of f.labels) {
        if (!l.label.trim() || !l.label_type) {
          this.msg.add({ severity: 'warn', summary: 'Each label needs a name and a type' });
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
      : this.api.post<{ document: DocumentRow }>(`/admin/documents`, payload);

    req.subscribe({
      next: (res) => {
        this.saving = false;
        this.formOpen = false;
        if (this.editing) {
          const idx = this.documents.findIndex((d) => d.id === res.document.id);
          if (idx >= 0) this.documents[idx] = res.document;
        } else {
          this.documents = [...this.documents, res.document];
        }
        this.msg.add({ severity: 'success', summary: this.editing ? 'Document updated' : 'Document created' });
      },
      error: (err) => {
        this.saving = false;
        this.msg.add({ severity: 'error', summary: err?.error?.message || 'Failed to save' });
      },
    });
  }

  // ---- Assign ----
  openAssign(d: DocumentRow): void {
    this.assignTarget = d;
    this.assignStatus = d.status || null;
    this.assignOpen = true;
  }

  submitAssign(): void {
    if (!this.assignTarget || !this.assignStatus) {
      this.msg.add({ severity: 'warn', summary: 'Pick a status' });
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
          const idx = this.documents.findIndex((d) => d.id === res.document.id);
          if (idx >= 0) this.documents[idx] = res.document;
          this.msg.add({ severity: 'success', summary: 'Status updated' });
        },
        error: () => {
          this.assignSaving = false;
          this.msg.add({ severity: 'error', summary: 'Failed to update status' });
        },
      });
  }
}
