import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, ModalComponent } from '../../ui';
import { CARPOOL_ADMIN_STYLES, indiaToday } from './carpool-admin.styles';

export interface CarpoolDocItem {
  document_id: number; name: string; uploaded: boolean; approved: boolean; has_date: boolean;
  expires_on: string | null; allow_until: string | null; allow_note: string | null; valid_until: string | null; expired: boolean;
  renewal: null | { id: number; status: 'pending' | 'rejected'; expiry_date: string; reason: string | null; sent_at: string | null };
}

type Ask = null | { kind: 'expiry' | 'allow' | 'upload'; doc: CarpoolDocItem } | { kind: 'approve' | 'reject'; doc: CarpoolDocItem };

/**
 * S11 (choice C): a carpool driver's dated documents in Carpool > People. The admin corrects the expiry date,
 * lets the driver keep going until a day, and approves or rejects a renewed copy sent from the app.
 */
@Component({
  selector: 'app-carpool-documents',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, ModalComponent],
  template: `
    <h3 class="sect">Documents with an expiry date</h3>
    <p class="muted" *ngIf="!items?.length">No carpool document has an expiry date.</p>
    <table class="mini" *ngIf="items?.length">
      <tr><th>Document</th><th>Expires</th><th>Can publish up to</th><th></th></tr>
      <tr *ngFor="let d of items">
        <td>{{ d.name }}<span class="sub" *ngIf="!d.uploaded">Not uploaded</span></td>
        <td>
          {{ d.expires_on ? day(d.expires_on) : 'No expiry date' }}
          <span class="tag tag--bad" *ngIf="d.expires_on && d.expires_on < today">expired</span>
          <span class="tag tag--warn" *ngIf="!d.expires_on && d.uploaded">date missing</span>
        </td>
        <td>
          {{ d.valid_until ? day(d.valid_until) : 'No limit' }}
          <span class="sub" *ngIf="d.allow_until">Allowed until {{ day(d.allow_until) }}: {{ d.allow_note }}</span>
        </td>
        <td class="act">
          <button *ngIf="d.uploaded" type="button" class="linkish" (click)="openAsk({ kind: 'expiry', doc: d })">Edit date</button>
          <button type="button" class="linkish" (click)="openAsk({ kind: 'allow', doc: d })">Allow until</button>
          <button type="button" class="linkish" (click)="openAsk({ kind: 'upload', doc: d })">Upload on behalf</button>
        </td>
      </tr>
    </table>

    <ng-container *ngFor="let d of items">
      <div class="renewal" *ngIf="d.renewal?.status === 'pending'">
        <span><b>New {{ d.name }} sent by the driver</b>, valid until {{ day(d.renewal!.expiry_date) }}. Check the photo before approving.</span>
        <span class="renewal__act">
          <button type="button" class="linkish" (click)="view(d)">View photo</button>
          <tm-button variant="ghost" size="sm" (clicked)="openAsk({ kind: 'reject', doc: d })">Reject</tm-button>
          <tm-button variant="ink" size="sm" (clicked)="openAsk({ kind: 'approve', doc: d })">Approve</tm-button>
        </span>
      </div>
    </ng-container>

    <tm-modal [open]="!!ask" [title]="title()" (closed)="ask = null">
      <ng-container slot="body" *ngIf="shown">
        <ng-container [ngSwitch]="shown.kind">
          <p *ngSwitchCase="'expiry'">Use this when the date on the paper is different from the one stored. The driver can publish up to this day.</p>
          <p *ngSwitchCase="'allow'">The driver can publish and keep carpools up to this day even if {{ shown.doc.name }} has run out. Leave the date empty to go back to the document date.</p>
          <p *ngSwitchCase="'approve'">The new copy replaces the old one, valid until {{ day(shown.doc.renewal?.expiry_date ?? null) }}. The driver is told. Their sign-up stays approved.</p>
          <p *ngSwitchCase="'reject'">The photo is deleted and the driver is told your reason, so they can send it again.</p>
          <p *ngSwitchCase="'upload'">For a copy the driver sent another way (for example WhatsApp). It replaces the stored {{ shown.doc.name }} at once as approved, and any copy the driver sent from the app. The driver is told and stays approved.</p>
        </ng-container>
        <label class="field" *ngIf="shown.kind === 'upload'">
          <span>Photo of the new copy</span>
          <input type="file" accept="image/*" (change)="onFile($event)" />
        </label>
        <label class="field" *ngIf="shown.kind === 'expiry' || shown.kind === 'allow' || shown.kind === 'upload'">
          <span>{{ shown.kind === 'allow' ? 'Allow until (optional)' : shown.kind === 'upload' ? 'Expiry date on the new copy' : 'Expiry date' }}</span>
          <input type="date" [(ngModel)]="date" [min]="shown.kind === 'allow' ? today : ''" />
        </label>
        <label class="field" *ngIf="shown.kind !== 'approve'">
          <span>{{ shown.kind === 'reject' ? 'Reason, shown to the driver' : 'Reason, kept in the history' }}</span>
          <textarea rows="3" maxlength="255" [(ngModel)]="note"></textarea>
          <span class="hint">At least 3 characters.</span>
        </label>
        <p class="err" *ngIf="error" role="alert">{{ error }}</p>
      </ng-container>
      <ng-container slot="footer">
        <tm-button variant="ghost" (clicked)="ask = null">Back</tm-button>
        <tm-button [variant]="shown?.kind === 'reject' ? 'danger' : 'ink'" [loading]="busy" [disabled]="!canSave()" (clicked)="save()">{{ saveLabel() }}</tm-button>
      </ng-container>
    </tm-modal>
  `,
  styles: [CARPOOL_ADMIN_STYLES, `
    .renewal { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 10px; padding: 12px 14px; border-radius: var(--tm-radius-md); background: var(--tm-warning-bg, #fef3c7); color: var(--tm-text); font-size: 13px; }
    .renewal__act { display: inline-flex; align-items: center; gap: 8px; flex: none; }
    .err { margin: 10px 0 0; color: var(--tm-danger); font-size: 13px; }
    .act .linkish + .linkish { margin-left: 14px; }
    .field + .field { margin-top: 12px; }
    :host { margin-bottom: 16px; }
  `],
})
export class CarpoolDocumentsComponent {
  @Input({ required: true }) driverId!: number;
  @Input() items: CarpoolDocItem[] | null = [];
  @Output() changed = new EventEmitter<CarpoolDocItem[]>();

  ask: Ask = null;
  /** Kept after closing so the closing animation doesn't flash an empty box. */
  shown: Ask = null;
  date = '';
  note = '';
  file: File | null = null;
  busy = false;
  error = '';
  readonly today = indiaToday();

  constructor(private api: ApiService, private toast: ToastService) {}

  openAsk(a: Ask): void {
    this.ask = a;
    this.shown = a;
    this.note = '';
    this.error = '';
    this.file = null;
    this.date = a?.kind === 'expiry' ? (a.doc.expires_on ?? '') : a?.kind === 'allow' ? (a.doc.allow_until ?? '') : '';
  }

  title(): string {
    return ({ expiry: 'Edit the expiry date', allow: 'Allow until a day', approve: 'Approve the new copy?', reject: 'Reject the new copy', upload: 'Upload on behalf of the driver' } as Record<string, string>)[this.shown?.kind ?? ''] ?? '';
  }

  saveLabel(): string {
    return ({ expiry: 'Save date', allow: this.date ? 'Allow' : 'Clear', approve: 'Approve', reject: 'Reject', upload: 'Upload' } as Record<string, string>)[this.shown?.kind ?? ''] ?? 'Save';
  }

  canSave(): boolean {
    const k = this.shown?.kind;
    if (k === 'approve') return true;
    if (this.note.trim().length < 3) return false;
    if (k === 'upload') return !!this.date && !!this.file;
    return k === 'expiry' ? !!this.date : true;
  }

  save(): void {
    const a = this.ask;
    if (!a) return;
    const base = `/admin/carpool/drivers/${this.driverId}/documents/${a.doc.document_id}`;
    const note = this.note.trim();
    const form = new FormData();
    if (a.kind === 'upload' && this.file) {
      form.append('file', this.file, this.file.name);
      form.append('date', this.date);
      form.append('note', note);
    }
    const call = a.kind === 'upload' ? this.api.postMultipart<{ data: CarpoolDocItem[]; message: string }>(`${base}/expiry`, form)
      : a.kind === 'expiry' ? this.api.post<{ data: CarpoolDocItem[]; message: string }>(`${base}/expiry`, { date: this.date, note })
      : a.kind === 'allow' ? this.api.post<{ data: CarpoolDocItem[]; message: string }>(`${base}/allow-until`, { date: this.date || null, note })
      : a.kind === 'approve' ? this.api.post<{ data: CarpoolDocItem[]; message: string }>(`/admin/carpool/document-renewals/${a.doc.renewal!.id}/approve`, {})
      : this.api.post<{ data: CarpoolDocItem[]; message: string }>(`/admin/carpool/document-renewals/${a.doc.renewal!.id}/reject`, { reason: note });
    this.busy = true;
    this.error = '';
    call.subscribe({
      next: (r) => { this.busy = false; this.ask = null; this.items = r.data; this.toast.success(r.message); this.changed.emit(r.data); },
      error: (e) => {
        this.busy = false;
        const errs = e?.error?.errors;
        this.error = (errs && (Object.values(errs)[0] as string[])?.[0]) || e?.error?.message || 'That did not work. Try again.';
      },
    });
  }

  onFile(event: Event): void {
    const f = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.error = f && !f.type.startsWith('image/') ? 'Choose a photo (JPG or PNG).' : '';
    this.file = f && f.type.startsWith('image/') ? f : null;
  }

  view(d: CarpoolDocItem): void {
    if (!d.renewal) return;
    this.api.getBlob(`/admin/carpool/document-renewals/${d.renewal.id}/file`).subscribe({
      next: (b) => {
        const url = URL.createObjectURL(b);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      },
      error: () => this.toast.error('Could not open the photo.'),
    });
  }

  day(d: string | null): string {
    if (!d) return '—';
    return new Date(d + 'T12:00:00+05:30').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  }
}
