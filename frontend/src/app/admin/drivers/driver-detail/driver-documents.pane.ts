import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  inject,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ApiService } from '../../../core/api.service';
import { ButtonComponent, IconComponent } from '../../../ui';

import { DriverDocumentRow, DocumentRequirement } from './driver-detail.types';

interface DocumentGroupView {
  key: string;
  title: string;
  rows: DriverDocumentRow[];
  status: DriverDocumentRow['status'];
  primary: DriverDocumentRow;
}

@Component({
  selector: 'app-driver-documents-pane',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, DatePipe, ButtonComponent, IconComponent],
  template: `
    <section class="card">
      <header class="card__head">
        <h3 class="card__title">
          <tm-icon name="id-card" [size]="16" />
          Documents
        </h3>
        <div class="card__head-right">
          <span class="muted small">{{ documents.length }} upload(s)</span>
          <tm-button variant="outline" size="sm" icon="upload" (clicked)="openUpload.emit()">
            Upload on behalf
          </tm-button>
        </div>
      </header>

      <div class="requirements" *ngIf="requirements.length">
        <div class="requirements__intro">
          <strong>Required documents</strong>
          <span class="muted small">Current requirements to go online, including documents not yet uploaded.</span>
        </div>
        <div class="requirement" *ngFor="let doc of requirements">
          <div><strong>{{ doc.name }}</strong><small class="muted">{{ doc.approved_images }} of {{ doc.required_images }} images approved · {{ doc.required === 'mandatory_drive' ? 'Required to drive' : 'Required at registration' }}</small></div>
          <span class="status-pill" [class.is-approved]="doc.status === 'approved'" [class.is-rejected]="doc.status === 'rejected'" [class.is-uploaded]="doc.status === 'pending'" [class.is-missing]="doc.status === 'missing'">
            {{ doc.status === 'missing' ? 'Upload needed' : doc.status === 'pending' ? 'Awaiting review' : doc.status === 'rejected' ? 'Re-upload needed' : 'Approved' }}
          </span>
        </div>
      </div>

      <ng-container *ngIf="groups.length; else emptyDocs">
        <div class="docs">
          <article class="doc" *ngFor="let group of groups">
            <header class="doc__head">
              <div class="doc__title">
                <strong>{{ group.title }}</strong>
                <span class="muted small">{{ group.rows.length }} image{{ group.rows.length === 1 ? '' : 's' }}</span>
                <span class="muted small" *ngIf="group.rows[0].uploaded_at">
                  Uploaded {{ group.rows[0].uploaded_at | date:'short' }}
                </span>
              </div>
              <span class="status-pill"
                    [class.is-approved]="group.status === 'approved'"
                    [class.is-rejected]="group.status === 'rejected'"
                    [class.is-uploaded]="group.status === 'uploaded'">
                {{ group.status }}
              </span>
            </header>

            <div class="doc__meta" *ngIf="group.rows[0].vehicle_type_name || hasLabels(group.rows[0])">
              <div class="meta-row" *ngIf="group.rows[0].vehicle_type_name">
                <span class="meta-row__lbl">Vehicle</span>
                <span>{{ group.rows[0].vehicle_type_name }}</span>
              </div>
              <div class="meta-row" *ngFor="let k of labelKeys(group.rows[0])">
                <span class="meta-row__lbl">{{ k }}</span>
                <span class="mono">{{ group.rows[0].label_values?.[k] || '—' }}</span>
              </div>
            </div>

            <p class="doc__rejection" *ngIf="group.status === 'rejected' && group.rows[0].rejection_reason">
              <tm-icon name="x" [size]="12" />
              {{ group.rows[0].rejection_reason }}
            </p>

            <div class="thumbs">
              <div class="thumb" *ngFor="let row of group.rows; let i = index">
                <button
                  type="button"
                  class="thumb__preview"
                  (click)="viewFile.emit(row)"
                  [title]="'Open image ' + (row.image_index || (i + 1))"
                >
                  <span class="thumb__image" *ngIf="previewUrl(row) as url; else fallbackThumb">
                    <img [src]="url" [alt]="group.title + ' image ' + (row.image_index || (i + 1))" />
                  </span>
                  <ng-template #fallbackThumb>
                    <span class="thumb__fallback">
                      <tm-icon name="id-card" [size]="18" />
                    </span>
                  </ng-template>
                  <span class="thumb__badge">#{{ row.image_index || (i + 1) }}</span>
                </button>

                <div class="thumb__toolbar">
                  <span class="thumb__status" [class.is-approved]="row.status === 'approved'"
                        [class.is-rejected]="row.status === 'rejected'"
                        [class.is-uploaded]="row.status === 'uploaded'">
                    {{ row.status }}
                  </span>
                  <button type="button" class="thumb__icon-btn" (click)="viewFile.emit(row)" title="View" aria-label="View">
                    <tm-icon name="eye" [size]="14" />
                  </button>
                  <button type="button" class="thumb__icon-btn" (click)="downloadFile.emit(row)" title="Download" aria-label="Download">
                    <tm-icon name="download" [size]="14" />
                  </button>
                </div>
              </div>
            </div>

            <footer class="doc__actions">
              <tm-button
                variant="green"
                size="sm"
                icon="check"
                [disabled]="group.status === 'approved'"
                (clicked)="approveDocument.emit(group.primary)"
              >Approve group</tm-button>
              <tm-button
                variant="danger"
                size="sm"
                icon="x"
                [disabled]="group.status === 'rejected'"
                (clicked)="rejectDocument.emit(group.primary)"
              >Reject group</tm-button>
            </footer>
          </article>
        </div>
      </ng-container>

      <ng-template #emptyDocs>
        <div class="empty">
          <tm-icon name="id-card" [size]="22" />
          <p>No documents uploaded yet.</p>
          <p class="muted small">Use <strong>Upload on behalf</strong> to add documents for this driver.</p>
        </div>
      </ng-template>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .requirements { margin-bottom: 20px; border: 1px solid var(--tm-line); border-radius: 12px; overflow: hidden; }
    .requirements__intro { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; background: var(--tm-canvas); }
    .requirement { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border-top: 1px solid var(--tm-line); flex-wrap: wrap; }
    .requirement strong { font-size: 13px; }
    .requirement small { display: block; margin-top: 4px; font-size: 12px; }
    .status-pill.is-missing { background: #fff7ed; color: #9a3412; border-color: #fed7aa; }

    .card {
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-md);
      padding: var(--tm-space-4);
      margin-bottom: var(--tm-space-3);
    }
    .card__head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--tm-space-3);
      margin-bottom: var(--tm-space-3);
      flex-wrap: wrap;
    }
    .card__title {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--tm-text);
    }
    .card__title tm-icon { color: var(--tm-green-deep); }
    .card__head-right { display: inline-flex; align-items: center; gap: 12px; }

    .muted { color: var(--tm-text-muted); }
    .small { font-size: 12px; }

    .docs { display: flex; flex-direction: column; gap: var(--tm-space-3); }

    .doc {
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-sm);
      padding: var(--tm-space-3) var(--tm-space-4);
      background: var(--tm-canvas);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .doc__head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
    }
    .doc__title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .doc__title strong { font-size: 14px; color: var(--tm-text); }

    .status-pill {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border-radius: var(--tm-radius-pill);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border: 1px solid transparent;
      flex-shrink: 0;
    }
    .status-pill.is-approved { background: var(--tm-green-tint); color: var(--tm-green-deep); border-color: var(--tm-green-soft); }
    .status-pill.is-rejected { background: #fef2f2;              color: #dc2626;              border-color: #fecaca; }
    .status-pill.is-uploaded { background: #eff6ff;              color: #1d4ed8;              border-color: #dbeafe; }

    .doc__meta {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 4px 12px;
      font-size: 12px;
    }
    .meta-row { display: contents; }
    .meta-row__lbl {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--tm-text-muted);
    }
    .mono { font-family: var(--tm-font-mono); }

    .doc__rejection {
      margin: 0;
      padding: 8px 10px;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: var(--tm-radius-sm);
      font-size: 12px;
      color: #991b1b;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .thumbs {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(116px, 1fr));
      gap: 10px;
    }

    .thumb {
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-sm);
      background: var(--tm-canvas-2);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      gap: 8px;
      text-align: left;
      min-width: 0;
      padding: 6px;
    }
    .thumb:hover { border-color: var(--tm-green-soft); box-shadow: 0 1px 6px rgba(15,20,25,0.08); }

    .thumb__preview {
      position: relative;
      width: 100%;
      border: 0;
      background: transparent;
      padding: 0;
      cursor: pointer;
      display: block;
      text-align: left;
    }

    .thumb__image,
    .thumb__fallback {
      width: 100%;
      aspect-ratio: 1 / 1;
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #fff;
    }
    .thumb__image img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .thumb__fallback { color: var(--tm-text-muted); }

    .thumb__badge {
      position: absolute;
      top: 10px;
      left: 10px;
      padding: 2px 6px;
      border-radius: var(--tm-radius-pill);
      background: rgba(15,20,25,0.78);
      color: #fff;
      font-size: 10px;
      font-weight: 700;
    }

    .thumb__toolbar {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: space-between;
    }

    .thumb__status {
      display: inline-flex;
      align-items: center;
      padding: 2px 7px;
      border-radius: var(--tm-radius-pill);
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border: 1px solid transparent;
    }
    .thumb__status.is-approved { background: var(--tm-green-tint); color: var(--tm-green-deep); border-color: var(--tm-green-soft); }
    .thumb__status.is-rejected { background: #fef2f2; color: #dc2626; border-color: #fecaca; }
    .thumb__status.is-uploaded { background: #eff6ff; color: #1d4ed8; border-color: #dbeafe; }

    .thumb__icon-btn {
      width: 28px;
      height: 28px;
      border: 1px solid var(--tm-line);
      border-radius: 8px;
      background: var(--tm-surface);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--tm-text-muted);
      cursor: pointer;
      flex-shrink: 0;
    }
    .thumb__icon-btn:hover { color: var(--tm-text); border-color: var(--tm-green-soft); }

    .doc__actions {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
    }

    .empty {
      text-align: center;
      padding: var(--tm-space-5);
      color: var(--tm-text-muted);
    }
    .empty tm-icon { color: var(--tm-text-soft); }
    .empty p { margin: 6px 0 0; font-size: 13px; }
    .empty strong { color: var(--tm-text); font-weight: 700; }

    @media (max-width: 540px) {
      .doc__actions { gap: 4px; }
    }
  `],
})
export class DriverDocumentsPaneComponent implements OnChanges, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly previewUrls = new Map<number, string>();
  private readonly loadingIds = new Set<number>();

  @Input() documents: DriverDocumentRow[] = [];
  @Input() requirements: DocumentRequirement[] = [];

  @Output() openUpload = new EventEmitter<void>();
  @Output() viewFile = new EventEmitter<DriverDocumentRow>();
  @Output() downloadFile = new EventEmitter<DriverDocumentRow>();
  @Output() approveDocument = new EventEmitter<DriverDocumentRow>();
  @Output() rejectDocument = new EventEmitter<DriverDocumentRow>();

  groups: DocumentGroupView[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['documents']) {
      this.rebuildGroups();
      this.syncPreviews();
    }
  }

  ngOnDestroy(): void {
    for (const url of this.previewUrls.values()) {
      if (url) URL.revokeObjectURL(url);
    }
    this.previewUrls.clear();
  }

  previewUrl(row: DriverDocumentRow): string | null {
    return this.previewUrls.get(row.id) || null;
  }

  hasLabels(d: DriverDocumentRow): boolean {
    return !!d.label_values && Object.keys(d.label_values).length > 0;
  }

  labelKeys(d: DriverDocumentRow): string[] {
    return d.label_values ? Object.keys(d.label_values) : [];
  }

  private rebuildGroups(): void {
    const bucket = new Map<string, DriverDocumentRow[]>();
    for (const row of this.documents) {
      const key = row.document_id != null
        ? `doc:${row.document_id}:${row.vehicle_type_id ?? 'any'}`
        : `legacy:${row.id}`;
      const list = bucket.get(key) ?? [];
      list.push(row);
      bucket.set(key, list);
    }

    this.groups = Array.from(bucket.entries()).map(([key, rows]) => {
      rows.sort((a, b) => {
        const ai = a.image_index ?? 999;
        const bi = b.image_index ?? 999;
        return ai - bi || a.id - b.id;
      });
      return {
        key,
        title: rows[0].document_name || rows[0].document_type || 'Document',
        rows,
        status: this.groupStatus(rows),
        primary: rows[0],
      };
    });

    this.groups.sort((a, b) => b.primary.id - a.primary.id);
  }

  private groupStatus(rows: DriverDocumentRow[]): DriverDocumentRow['status'] {
    if (rows.some((r) => r.status === 'rejected')) return 'rejected';
    if (rows.every((r) => r.status === 'approved')) return 'approved';
    return 'uploaded';
  }

  private syncPreviews(): void {
    const activeIds = new Set(this.documents.map((d) => d.id));
    for (const [id, url] of this.previewUrls.entries()) {
      if (!activeIds.has(id)) {
        if (url) URL.revokeObjectURL(url);
        this.previewUrls.delete(id);
      }
    }

    for (const row of this.documents) {
      if (this.previewUrls.has(row.id) || this.loadingIds.has(row.id)) continue;
      this.loadingIds.add(row.id);
      const apiPath = this.toApiPath(row.file_url);
      if (!apiPath) {
        this.loadingIds.delete(row.id);
        continue;
      }
      this.api.getBlob(apiPath).subscribe({
        next: (blob) => {
          const isImage = (blob.type || '').startsWith('image/');
          const url = isImage ? URL.createObjectURL(blob) : '';
          this.previewUrls.set(row.id, url);
          this.loadingIds.delete(row.id);
        },
        error: () => {
          this.loadingIds.delete(row.id);
          this.previewUrls.set(row.id, '');
        },
      });
    }
  }

  private toApiPath(absoluteUrl: string): string | null {
    try {
      const parsed = new URL(absoluteUrl);
      let p = parsed.pathname + parsed.search;
      while (p === '/api' || p.startsWith('/api/')) p = p.slice(4) || '/';
      return p || null;
    } catch {
      return null;
    }
  }
}
