import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ButtonComponent, IconComponent } from '../../../ui';

import { DriverDocumentRow } from './driver-detail.types';

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
          <span class="muted small">{{ documents.length }} document(s)</span>
          <tm-button variant="outline" size="sm" icon="upload" (clicked)="openUpload.emit()">
            Upload on behalf
          </tm-button>
        </div>
      </header>

      <ng-container *ngIf="documents.length; else emptyDocs">
        <div class="docs">
          <article class="doc" *ngFor="let d of documents">
            <header class="doc__head">
              <div class="doc__title">
                <strong>{{ d.document_name || d.document_type || 'Document' }}</strong>
                <span class="muted small" *ngIf="d.uploaded_at">
                  Uploaded {{ d.uploaded_at | date:'short' }}
                </span>
              </div>
              <span class="status-pill"
                    [class.is-approved]="d.status === 'approved'"
                    [class.is-rejected]="d.status === 'rejected'"
                    [class.is-uploaded]="d.status === 'uploaded'">
                {{ d.status }}
              </span>
            </header>

            <div class="doc__meta" *ngIf="d.vehicle_type_name || hasLabels(d)">
              <div class="meta-row" *ngIf="d.vehicle_type_name">
                <span class="meta-row__lbl">Vehicle</span>
                <span>{{ d.vehicle_type_name }}</span>
              </div>
              <div class="meta-row" *ngFor="let k of labelKeys(d)">
                <span class="meta-row__lbl">{{ k }}</span>
                <span class="mono">{{ d.label_values?.[k] || '—' }}</span>
              </div>
            </div>

            <p class="doc__rejection" *ngIf="d.status === 'rejected' && d.rejection_reason">
              <tm-icon name="x" [size]="12" />
              {{ d.rejection_reason }}
            </p>

            <footer class="doc__actions">
              <tm-button variant="outline" size="sm" icon="eye" (clicked)="viewFile.emit(d)">View</tm-button>
              <tm-button variant="ghost" size="sm" icon="download" (clicked)="downloadFile.emit(d)">Download</tm-button>
              <span class="spacer"></span>
              <tm-button
                variant="green"
                size="sm"
                icon="check"
                [disabled]="d.status === 'approved'"
                (clicked)="approveDocument.emit(d)"
              >Approve</tm-button>
              <tm-button
                variant="danger"
                size="sm"
                icon="x"
                [disabled]="d.status === 'rejected'"
                (clicked)="rejectDocument.emit(d)"
              >Reject</tm-button>
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

    .doc__actions {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
    }
    .spacer { flex: 1; }

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
      .doc__actions .spacer { display: none; flex-basis: 100%; height: 0; }
    }
  `],
})
export class DriverDocumentsPaneComponent {
  @Input() documents: DriverDocumentRow[] = [];

  @Output() openUpload = new EventEmitter<void>();
  @Output() viewFile = new EventEmitter<DriverDocumentRow>();
  @Output() downloadFile = new EventEmitter<DriverDocumentRow>();
  @Output() approveDocument = new EventEmitter<DriverDocumentRow>();
  @Output() rejectDocument = new EventEmitter<DriverDocumentRow>();

  hasLabels(d: DriverDocumentRow): boolean {
    return !!d.label_values && Object.keys(d.label_values).length > 0;
  }
  labelKeys(d: DriverDocumentRow): string[] {
    return d.label_values ? Object.keys(d.label_values) : [];
  }
}
