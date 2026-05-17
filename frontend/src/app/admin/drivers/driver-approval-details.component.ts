import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MessageService } from 'primeng/api';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';

interface DriverProfile {
  id: number;
  user_id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  ride_type_id: number | null;
  ride_type_name: string | null;
  vehicle_type_id: number | null;
  vehicle_type_name: string | null;
  vehicle_reg_no: string | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  approval_status: 'pending' | 'approved' | 'rejected';
  deactivated_at: string | null;
  is_online: boolean;
  created_at: string | null;
}

interface DocLabelMeta {
  label: string;
  label_type: 'text' | 'number' | 'date' | 'url';
  mandatory: boolean;
}

interface DriverDocumentRow {
  id: number;
  document_id: number | null;
  document_name: string | null;
  document_type: string | null;
  vehicle_type_id: number | null;
  vehicle_type_name: string | null;
  file_path: string;
  file_url: string;
  label_values: Record<string, string> | null;
  labels_meta: DocLabelMeta[];
  status: 'uploaded' | 'approved' | 'rejected';
  rejection_reason: string | null;
  uploaded_at: string | null;
}

interface CatalogDoc {
  id: number;
  name: string;
  no_of_images: number;
}

@Component({
  selector: 'app-driver-approval-details',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CardModule,
    TableModule,
    DialogModule,
    InputTextModule,
    InputTextareaModule,
    TagModule,
    ToastModule,
    ConfirmDialogModule,
  ],
  providers: [MessageService, ConfirmationService],
  template: `
    <p-toast />
    <p-confirmDialog />

    <div *ngIf="loading" class="empty">Loading…</div>

    <ng-container *ngIf="!loading && driver">
      <!-- Header -->
      <header class="page-head">
        <button pButton type="button" icon="pi pi-arrow-left" class="p-button-text" (click)="back()" label="Back"></button>
        <div class="title">
          <div class="title__name">{{ driver.name || 'Unnamed driver' }} <span class="muted small">#{{ driver.id }}</span></div>
          <div class="title__meta">
            <span class="chip-mute">{{ driver.phone || '—' }}</span>
            <span class="chip-mute" *ngIf="driver.ride_type_name">{{ driver.ride_type_name }}</span>
            <span class="chip-mute" *ngIf="driver.vehicle_type_name">{{ driver.vehicle_type_name }}</span>
            <p-tag [value]="driver.approval_status" [severity]="approvalSeverity(driver.approval_status)"></p-tag>
            <span class="muted small">Online: {{ driver.is_online ? 'yes' : 'no' }}</span>
          </div>
        </div>
      </header>

      <!-- Vehicle (admin-editable: only Reg No) -->
      <p-card header="Vehicle" styleClass="card">
        <p class="muted small">
          The driver app does not collect the registration number — set it here.
          Brand / model / colour are read-only here; the driver edits those during onboarding.
        </p>
        <div class="grid two">
          <div class="field">
            <label class="lbl">Registration No</label>
            <input pInputText [(ngModel)]="vehicleForm.vehicle_reg_no" placeholder="e.g. KA01AB1234" />
          </div>
          <div class="field">
            <label class="lbl">Brand</label>
            <div class="ro-value">{{ driver.vehicle_brand || '—' }}</div>
          </div>
          <div class="field">
            <label class="lbl">Model</label>
            <div class="ro-value">{{ driver.vehicle_model || '—' }}</div>
          </div>
          <div class="field">
            <label class="lbl">Color</label>
            <div class="ro-value">{{ driver.vehicle_color || '—' }}</div>
          </div>
        </div>
        <div class="actions">
          <button pButton type="button" label="Save Reg No" icon="pi pi-save" (click)="saveVehicle()" [loading]="savingVehicle"></button>
        </div>
      </p-card>

      <!-- Documents -->
      <p-card header="Documents" styleClass="card">
        <div class="bar">
          <span class="muted small">{{ documents.length }} document(s)</span>
          <button pButton type="button" label="Upload on behalf" icon="pi pi-upload"
                  class="p-button-sm" (click)="openAdminUpload()"></button>
        </div>

        <p-table [value]="documents" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th>Document</th>
              <th>Vehicle</th>
              <th>Labels</th>
              <th>Status</th>
              <th>Rejection</th>
              <th style="width: 280px;">Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-d>
            <tr>
              <td>
                <strong>{{ d.document_name || d.document_type || 'Document' }}</strong>
                <div class="muted small" *ngIf="d.uploaded_at">
                  Uploaded {{ d.uploaded_at | date:'short' }}
                </div>
              </td>
              <td>{{ d.vehicle_type_name || '—' }}</td>
              <td>
                <div *ngIf="d.label_values && hasLabels(d)" class="kv">
                  <div *ngFor="let k of labelKeys(d)"><strong>{{ k }}:</strong> {{ d.label_values?.[k] || '—' }}</div>
                </div>
                <span class="muted small" *ngIf="!hasLabels(d)">—</span>
              </td>
              <td>
                <p-tag [value]="d.status" [severity]="docSeverity(d.status)"></p-tag>
              </td>
              <td class="muted small">{{ d.rejection_reason || '—' }}</td>
              <td class="actions-col">
                <button pButton type="button" label="View" class="p-button-sm" (click)="viewFile(d)"></button>
                <button pButton type="button" label="Download" class="p-button-sm p-button-secondary" (click)="downloadFile(d)"></button>
                <button pButton type="button" label="Approve" class="p-button-sm p-button-success"
                        [disabled]="d.status === 'approved'" (click)="setStatus(d, 'approved')"></button>
                <button pButton type="button" label="Reject" class="p-button-sm p-button-danger p-button-outlined"
                        [disabled]="d.status === 'rejected'" (click)="openReject(d)"></button>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr><td colspan="6" class="empty">No documents uploaded yet.</td></tr>
          </ng-template>
        </p-table>
      </p-card>

      <!-- Overall approval -->
      <p-card header="Driver Approval" styleClass="card">
        <p class="muted small">
          Approve when every required document is approved; reject to keep the driver out of dispatch.
        </p>
        <div class="actions">
          <button pButton type="button" label="Approve driver" icon="pi pi-check" class="p-button-success"
                  [disabled]="driver.approval_status === 'approved'" (click)="setApproval('approved')"></button>
          <button pButton type="button" label="Reject driver" icon="pi pi-times" class="p-button-danger p-button-outlined"
                  [disabled]="driver.approval_status === 'rejected'" (click)="setApproval('rejected')"></button>
        </div>
      </p-card>
    </ng-container>

    <!-- Reject document dialog -->
    <p-dialog header="Reject document" [(visible)]="rejectOpen" [modal]="true" [style]="{ width: '440px' }" [draggable]="false">
      <div class="form">
        <p class="muted small">A reason is required so the driver knows why and can re-upload.</p>
        <label class="lbl">Reason *</label>
        <textarea pInputTextarea rows="3" [(ngModel)]="rejectReason"
                  placeholder="e.g. Image is blurry — please re-upload."></textarea>
      </div>
      <ng-template pTemplate="footer">
        <button pButton type="button" label="Cancel" class="p-button-secondary" (click)="rejectOpen = false"></button>
        <button pButton type="button" label="Reject" class="p-button-danger" (click)="submitReject()" [loading]="rejectSaving"></button>
      </ng-template>
    </p-dialog>

    <!-- Upload-on-behalf dialog (multi-doc picker) -->
    <p-dialog header="Upload documents on behalf" [(visible)]="uploadOpen" [modal]="true" [style]="{ width: '560px' }" [draggable]="false">
      <p class="muted small" style="margin: 0 0 10px;">
        Pick a file for any or all of the catalog documents below, then upload them in one go.
      </p>

      <div class="picker-list">
        <div class="picker-row" *ngFor="let p of pickers">
          <div class="picker-row__head">
            <strong>{{ p.doc.name }}</strong>
            <span class="muted small" *ngIf="p.file">{{ p.file.name }}</span>
          </div>
          <input
            type="file"
            accept="image/*,application/pdf"
            (change)="onPickerFile(p, $event)"
            [disabled]="uploadSaving"
          />
        </div>
        <div *ngIf="!pickers.length" class="empty">
          No documents in the catalog yet. Create some under <strong>Drivers → Documents Catalog</strong>.
        </div>
      </div>

      <ng-template pTemplate="footer">
        <button pButton type="button" label="Cancel" class="p-button-secondary"
                (click)="uploadOpen = false" [disabled]="uploadSaving"></button>
        <button pButton type="button" [label]="uploadButtonLabel()"
                (click)="submitAdminUpload()" [loading]="uploadSaving" [disabled]="!anyPicked()"></button>
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .empty { padding: 30px; text-align: center; color: #64748b; }
      .page-head {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 18px;
      }
      .title__name { font-size: 20px; font-weight: 800; color: #0f172a; }
      .title__meta {
        display: inline-flex;
        gap: 6px;
        margin-top: 4px;
        align-items: center;
        flex-wrap: wrap;
      }
      .chip-mute {
        font-size: 11px;
        font-weight: 700;
        background: #f1f5f9;
        color: #475569;
        padding: 2px 10px;
        border-radius: 999px;
        text-transform: uppercase;
        letter-spacing: 0.4px;
      }
      .muted { color: #64748b; }
      .small { font-size: 12px; }
      :host ::ng-deep .card { margin-bottom: 14px; }
      .grid { display: grid; gap: 14px; }
      .grid.two { grid-template-columns: 1fr 1fr; }
      .field { display: flex; flex-direction: column; gap: 4px; }
      .lbl { font-size: 12px; font-weight: 700; color: #475569; }
      .ro-value {
        padding: 7px 10px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        font-size: 13px;
        color: #475569;
      }
      input[pInputText], textarea { width: 100%; }
      .bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin: 4px 0 10px;
      }
      .actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        margin-top: 12px;
      }
      .actions-col { display: flex; gap: 4px; flex-wrap: wrap; }
      :host ::ng-deep .actions-col .p-button-sm { padding: 4px 10px; font-size: 12px; }
      .kv { font-size: 12px; display: flex; flex-direction: column; gap: 2px; }
      .form { display: flex; flex-direction: column; gap: 6px; }
      .form .lbl { margin-top: 6px; }
      .picker-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-height: 60vh;
        overflow: auto;
      }
      .picker-row {
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 10px 12px;
        background: #fafbfc;
      }
      .picker-row__head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 6px;
        font-size: 13px;
      }
      .picker-row input[type='file'] {
        width: 100%;
        font-size: 13px;
      }

      @media (max-width: 720px) {
        .grid.two { grid-template-columns: 1fr; }
      }
    `,
  ],
})
export class DriverApprovalDetailsComponent implements OnInit, OnDestroy {
  driverId: number | null = null;
  driver: DriverProfile | null = null;
  documents: DriverDocumentRow[] = [];

  vehicleForm = {
    vehicle_reg_no: '',
    vehicle_brand: '',
    vehicle_model: '',
    vehicle_color: '',
  };
  savingVehicle = false;

  // Reject dialog
  rejectOpen = false;
  rejectSaving = false;
  rejectTarget: DriverDocumentRow | null = null;
  rejectReason = '';

  // Upload-on-behalf dialog (multi-doc picker)
  uploadOpen = false;
  uploadSaving = false;
  catalogDocs: CatalogDoc[] = [];
  pickers: { doc: CatalogDoc; file: File | null }[] = [];

  loading = true;
  private subs: Subscription[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private msg: MessageService,
    private confirm: ConfirmationService,
  ) {}

  ngOnInit(): void {
    this.subs.push(
      this.route.paramMap.subscribe((p) => {
        const raw = p.get('driverId');
        this.driverId = raw ? Number(raw) : null;
        this.fetch();
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  fetch(): void {
    if (this.driverId == null) return;
    this.loading = true;
    this.api
      .get<{ driver: DriverProfile; documents: DriverDocumentRow[] }>(`/admin/drivers/${this.driverId}/full`)
      .subscribe({
        next: (res) => {
          this.driver = res.driver;
          this.documents = res.documents || [];
          this.vehicleForm = {
            vehicle_reg_no: res.driver.vehicle_reg_no || '',
            vehicle_brand: res.driver.vehicle_brand || '',
            vehicle_model: res.driver.vehicle_model || '',
            vehicle_color: res.driver.vehicle_color || '',
          };
          this.loading = false;
        },
        error: (err) => {
          this.loading = false;
          this.msg.add({ severity: 'error', summary: err?.error?.message || 'Failed to load driver' });
        },
      });

    // Catalog for the "upload on behalf" dialog.
    this.api.get<{ data: CatalogDoc[] }>('/admin/documents').subscribe({
      next: (res) => {
        const list = (res as { data?: CatalogDoc[] }).data ?? [];
        this.catalogDocs = list.map((d) => ({ id: d.id, name: d.name, no_of_images: d.no_of_images }));
      },
    });
    // (vehicle types no longer needed in the upload-on-behalf modal)
  }

  back(): void {
    this.router.navigateByUrl('/drivers/approvals');
  }

  approvalSeverity(s: string): 'success' | 'warning' | 'danger' | 'info' {
    if (s === 'approved') return 'success';
    if (s === 'rejected') return 'danger';
    return 'warning';
  }
  docSeverity(s: string): 'success' | 'warning' | 'danger' | 'info' {
    if (s === 'approved') return 'success';
    if (s === 'rejected') return 'danger';
    return 'info';
  }

  hasLabels(d: DriverDocumentRow): boolean {
    return !!d.label_values && Object.keys(d.label_values).length > 0;
  }
  labelKeys(d: DriverDocumentRow): string[] {
    return d.label_values ? Object.keys(d.label_values) : [];
  }

  // ---- Vehicle save ----
  saveVehicle(): void {
    if (this.driverId == null) return;
    this.savingVehicle = true;
    this.api
      .patch<{ driver: Record<string, unknown> }>(`/admin/drivers/${this.driverId}`, {
        vehicle_reg_no: this.vehicleForm.vehicle_reg_no.trim() || null,
      })
      .subscribe({
        next: () => {
          this.savingVehicle = false;
          this.msg.add({ severity: 'success', summary: 'Reg No saved' });
          if (this.driver) {
            this.driver.vehicle_reg_no = this.vehicleForm.vehicle_reg_no || null;
          }
        },
        error: (err) => {
          this.savingVehicle = false;
          this.msg.add({ severity: 'error', summary: err?.error?.message || 'Failed to save' });
        },
      });
  }

  // ---- Document actions ----
  // window.open does NOT send the Authorization header, so the streaming
  // endpoint (auth:sanctum + role:admin) 401s. We fetch the file with the
  // Bearer header, wrap the bytes in a blob URL, and open *that*.
  viewFile(d: DriverDocumentRow): void {
    this.fetchAndOpen(d, false, d.document_name || `doc-${d.id}`);
  }
  downloadFile(d: DriverDocumentRow): void {
    this.fetchAndOpen(d, true, d.document_name || `doc-${d.id}`);
  }

  private fetchAndOpen(d: DriverDocumentRow, asDownload: boolean, displayName: string): void {
    let apiPath = this.toApiPath(d.file_url);
    if (!apiPath) {
      this.msg.add({ severity: 'error', summary: 'Could not resolve file URL' });
      return;
    }
    if (asDownload) {
      apiPath += apiPath.includes('?') ? '&download=1' : '?download=1';
    }
    this.api.getBlob(apiPath).subscribe({
      next: (blob) => {
        const objectUrl = URL.createObjectURL(blob);
        if (asDownload) {
          // Force a download with a friendlier filename.
          const a = document.createElement('a');
          a.href = objectUrl;
          a.download = this.suggestFilename(displayName, blob.type);
          document.body.appendChild(a);
          a.click();
          a.remove();
        } else {
          window.open(objectUrl, '_blank');
        }
        // Free the blob after a delay — Chrome needs the URL alive while the
        // new tab loads, but we don't want a long-running memory leak either.
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      },
      error: (err) => {
        this.msg.add({
          severity: 'error',
          summary: err?.status === 401
            ? 'Session expired — sign in again.'
            : (err?.error?.message || `Couldn't fetch the file (HTTP ${err?.status ?? '?'})`),
        });
      },
    });
  }

  /**
   * The backend returns an absolute file URL (route()->absolute()). Strip the
   * scheme+host+`/api` prefix so we can hand the API-relative path to the
   * ApiService (which prepends getBaseUrl() itself).
   */
  private toApiPath(absoluteUrl: string): string | null {
    try {
      const parsed = new URL(absoluteUrl);
      // pathname starts with /api/... → strip the /api to get a path the
      // service can re-prefix with whatever baseUrl it knows.
      let p = parsed.pathname + parsed.search;
      if (p.startsWith('/api/')) p = p.slice(4);
      else if (p.startsWith('/api')) p = p.slice(4);
      return p || null;
    } catch {
      return null;
    }
  }

  private suggestFilename(name: string, mime: string): string {
    const safe = (name || 'document').replace(/[^a-z0-9._-]+/gi, '_');
    if (safe.includes('.')) return safe;
    const ext = mime?.split('/')?.[1] ?? 'bin';
    return `${safe}.${ext}`;
  }

  setStatus(d: DriverDocumentRow, status: 'approved' | 'rejected'): void {
    // Approving a document for a driver with no vehicle registration on file
    // leaves dispatch in an inconsistent state (the backend rejects this anyway
    // with the same message — we just surface it earlier without a round-trip).
    if (status === 'approved' && !this.driver?.vehicle_reg_no?.trim()) {
      this.msg.add({
        severity: 'error',
        summary: 'Cannot approve document',
        detail: 'Please register vehicle number first.',
      });
      return;
    }

    this.api
      .patch<{ document: DriverDocumentRow }>(`/admin/drivers/documents/${d.id}/status`, { status })
      .subscribe({
        next: (res) => {
          d.status = res.document.status;
          d.rejection_reason = res.document.rejection_reason ?? null;
          this.msg.add({ severity: 'success', summary: `Document ${status}` });
        },
        error: (err) => {
          this.msg.add({ severity: 'error', summary: err?.error?.message || 'Update failed' });
        },
      });
  }

  openReject(d: DriverDocumentRow): void {
    this.rejectTarget = d;
    this.rejectReason = d.rejection_reason || '';
    this.rejectOpen = true;
  }
  submitReject(): void {
    if (!this.rejectTarget) return;
    if (!this.rejectReason.trim()) {
      this.msg.add({ severity: 'warn', summary: 'A rejection reason is required.' });
      return;
    }
    this.rejectSaving = true;
    const d = this.rejectTarget;
    this.api
      .patch<{ document: DriverDocumentRow }>(`/admin/drivers/documents/${d.id}/status`, {
        status: 'rejected',
        rejection_reason: this.rejectReason.trim(),
      })
      .subscribe({
        next: (res) => {
          this.rejectSaving = false;
          this.rejectOpen = false;
          d.status = res.document.status;
          d.rejection_reason = res.document.rejection_reason ?? null;
          this.msg.add({ severity: 'success', summary: 'Document rejected' });
        },
        error: (err) => {
          this.rejectSaving = false;
          this.msg.add({ severity: 'error', summary: err?.error?.message || 'Failed to reject' });
        },
      });
  }

  // ---- Driver overall approval ----
  setApproval(status: 'approved' | 'rejected'): void {
    if (this.driverId == null || !this.driver) return;
    this.api
      .patch<{ driver: { approval_status: string } }>(`/admin/drivers/${this.driverId}/approval`, {
        approval_status: status,
      })
      .subscribe({
        next: (res) => {
          this.driver!.approval_status = (res.driver.approval_status as DriverProfile['approval_status']);
          this.msg.add({ severity: 'success', summary: `Driver ${status}` });
        },
        error: (err) => {
          this.msg.add({ severity: 'error', summary: err?.error?.message || 'Approval update failed' });
        },
      });
  }

  // ---- Admin upload on behalf (multi-doc picker) ----
  openAdminUpload(): void {
    // Build a fresh row per catalog document. The picker shows every doc;
    // the operator chooses which ones to upload by selecting files.
    this.pickers = this.catalogDocs.map((d) => ({ doc: d, file: null }));
    this.uploadOpen = true;
  }

  onPickerFile(p: { doc: CatalogDoc; file: File | null }, ev: Event): void {
    const f = (ev.target as HTMLInputElement).files?.[0];
    p.file = f ?? null;
  }

  anyPicked(): boolean {
    return this.pickers.some((p) => !!p.file);
  }

  uploadButtonLabel(): string {
    const n = this.pickers.filter((p) => !!p.file).length;
    if (n === 0) return 'Upload';
    return n === 1 ? 'Upload 1 document' : `Upload ${n} documents`;
  }

  submitAdminUpload(): void {
    if (this.driverId == null) return;
    const queued = this.pickers.filter((p) => !!p.file);
    if (queued.length === 0) {
      this.msg.add({ severity: 'warn', summary: 'Pick a file for at least one document.' });
      return;
    }
    this.uploadSaving = true;

    // Fire all uploads in parallel; collect results.
    let done = 0;
    let failed = 0;
    const total = queued.length;
    const inheritedVehicleTypeId = this.driver?.vehicle_type_id ?? null;

    queued.forEach((p) => {
      const fd = new FormData();
      fd.append('document_id', String(p.doc.id));
      if (inheritedVehicleTypeId) fd.append('vehicle_type_id', String(inheritedVehicleTypeId));
      fd.append('file', p.file as File);

      this.api
        .postMultipart<{ document: unknown }>(`/admin/drivers/${this.driverId}/documents`, fd)
        .subscribe({
          next: () => {
            done++;
            this.tickUpload(done, failed, total);
          },
          error: () => {
            failed++;
            this.tickUpload(done, failed, total);
          },
        });
    });
  }

  /** Called from each upload's completion to wrap up when all are settled. */
  private tickUpload(done: number, failed: number, total: number): void {
    if (done + failed < total) return;
    this.uploadSaving = false;
    this.uploadOpen = false;
    if (failed === 0) {
      this.msg.add({ severity: 'success', summary: `${done} uploaded` });
    } else if (done === 0) {
      this.msg.add({ severity: 'error', summary: `All ${failed} uploads failed.` });
    } else {
      this.msg.add({ severity: 'warn', summary: `${done} uploaded, ${failed} failed.` });
    }
    this.fetch(); // refresh the documents table with whatever did succeed
  }
}
