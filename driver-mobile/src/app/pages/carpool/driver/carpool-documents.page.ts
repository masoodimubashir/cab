import { Component, OnDestroy, OnInit } from '@angular/core';
import { NavController } from '@ionic/angular';
import { CarpoolApiService } from '../carpool-api.service';
import { CarpoolDocumentItem, CarpoolDocumentsSummary } from '../carpool.models';

/**
 * S11 (choice A1, mockup "Renew insurance"): the driver's dated documents. The driver sends a photo of the new
 * copy and its expiry date; Dream Cabs checks it, and until then the old copy keeps working up to its own date.
 */
@Component({
  selector: 'app-carpool-documents',
  standalone: false,
  template: `
    <ion-content class="cp">
      <div class="cp-wrap hm">
        <div class="d-head"><button class="icon-btn" aria-label="Back" (click)="back()"><ion-icon name="chevron-back-outline"></ion-icon></button><h1>Documents</h1></div>
        <div class="center" *ngIf="!s && !loadError"><ion-spinner name="crescent"></ion-spinner></div>
        <div class="errbar" role="alert" *ngIf="loadError">
          <ion-icon name="alert-circle-outline"></ion-icon>
          <span class="grow"><b>Couldn't load your documents</b><small>Check your connection.</small></span>
          <button class="d-btn line mini" (click)="load()">Try again</button>
        </div>

        <ng-container *ngIf="s">
          <p class="t13 muted" *ngIf="!s.items.length">None of your documents has an expiry date.</p>
          <div class="d-card dc-item" *ngFor="let d of s.items">
            <div class="dc-row">
              <span class="grow"><span class="d-title">{{ d.name }}</span><br>
                <span class="t13" [class.dc-bad]="d.expired" [class.muted]="!d.expired">{{ validText(d) }}</span></span>
              <span class="dc-tag" [class.bad]="d.expired" *ngIf="d.expired">Expired</span>
            </div>
            <p class="dc-note" *ngIf="d.renewal?.status === 'pending'"><ion-icon name="time-outline"></ion-icon>New copy sent, valid until {{ day(d.renewal!.expiry_date) }}. Dream Cabs is checking it.</p>
            <p class="dc-note bad" *ngIf="d.renewal?.status === 'rejected'"><ion-icon name="alert-circle-outline"></ion-icon>Your new copy was not accepted: {{ d.renewal!.reason }}. Please send it again.</p>
            <button class="d-btn line" *ngIf="renewing !== d.document_id" (click)="start(d)">{{ d.renewal?.status === 'pending' ? 'Send a different copy' : 'Renew' }}</button>

            <div class="dc-form" *ngIf="renewing === d.document_id">
              <label class="dc-photo" [class.has]="preview">
                <img *ngIf="preview" [src]="preview" alt="Photo of the new document" />
                <span *ngIf="!preview"><ion-icon name="camera-outline"></ion-icon> Photo of the new {{ d.name }}</span>
                <input type="file" accept="image/*" hidden (change)="onPhoto($event)" />
              </label>
              <label class="fld">
                <span class="grow"><span class="label">New expiry date</span>
                  <input type="date" [min]="tomorrow" [value]="expiry" (change)="expiry = $any($event.target).value" aria-label="New expiry date"></span>
              </label>
              <p class="t12 muted">You can keep publishing up to your current date while we check it.</p>
              <p class="dc-err" role="alert" *ngIf="error">{{ error }}</p>
              <div class="dc-actions">
                <button class="d-btn line" (click)="cancel()">Cancel</button>
                <button class="d-btn" [disabled]="!file || !expiry || busy" (click)="send(d)">{{ busy ? 'Sending…' : 'Send for checking' }}</button>
              </div>
            </div>
          </div>
        </ng-container>
      </div>
    </ion-content>
  `,
  styleUrls: ['./carpool-driver.scss'],
  styles: [`
    .dc-item + .dc-item { margin-top: 12px; }
    .dc-item > .d-btn { width: 100%; }
    .dc-row { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 12px; }
    .dc-bad { color: var(--cp-red); font-weight: 700; }
    .dc-tag { flex: none; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 800; background: #fde8ea; color: var(--cp-red); }
    .dc-note { display: flex; gap: 8px; align-items: flex-start; margin: 0 0 12px; padding: 10px 12px; border-radius: 12px; background: #fff8e6; font-size: 13px; }
    .dc-note.bad { background: #fde8ea; }
    .dc-note ion-icon { flex: none; font-size: 18px; margin-top: 1px; }
    .dc-form { display: flex; flex-direction: column; gap: 10px; }
    .dc-photo { display: grid; place-items: center; min-height: 140px; overflow: hidden; border: 1px dashed var(--cp-line); border-radius: 14px; background: #f6f8fa; color: var(--cp-muted); font-size: 13px; font-weight: 600; cursor: pointer; }
    .dc-photo.has { border-style: solid; }
    .dc-photo img { width: 100%; max-height: 220px; object-fit: cover; }
    .dc-photo span { display: flex; align-items: center; gap: 6px; }
    .dc-err { margin: 0; color: var(--cp-red); font-size: 13px; font-weight: 600; }
    .dc-actions { display: flex; gap: 10px; }
  `],
})
export class CarpoolDocumentsPage implements OnInit, OnDestroy {
  s: CarpoolDocumentsSummary | null = null;
  loadError = false;
  renewing: number | null = null;
  file: File | null = null;
  preview: string | null = null;
  expiry = '';
  busy = false;
  error: string | null = null;
  readonly tomorrow = indiaDay(1);

  constructor(private carpool: CarpoolApiService, private nav: NavController) {}

  ngOnInit(): void {
    this.load();
  }

  /** Coming back to the page (Ionic keeps it alive) refreshes it. */
  ionViewWillEnter(): void {
    if (this.s) this.load();
  }

  ngOnDestroy(): void {
    this.dropPreview();
  }

  load(): void {
    this.loadError = false;
    this.carpool.driverDocuments().subscribe({
      next: (s) => (this.s = s),
      error: () => (this.loadError = true),
    });
  }

  start(d: CarpoolDocumentItem): void {
    this.renewing = d.document_id;
    this.file = null;
    this.dropPreview();
    this.expiry = '';
    this.error = null;
  }

  cancel(): void {
    this.renewing = null;
    this.dropPreview();
  }

  onPhoto(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.error = 'Choose a photo (JPG or PNG).';
      return;
    }
    this.dropPreview();
    this.file = file;
    this.preview = URL.createObjectURL(file);
    this.error = null;
  }

  send(d: CarpoolDocumentItem): void {
    if (!this.file || !this.expiry) return;
    this.busy = true;
    this.error = null;
    this.carpool.renewDocument(d.document_id, this.file, this.expiry, this.file.name || 'document.jpg').subscribe({
      next: () => { this.busy = false; this.renewing = null; this.dropPreview(); this.load(); },
      error: (e) => {
        this.busy = false;
        const errs = e?.error?.errors;
        this.error = (errs && (Object.values(errs)[0] as string[])?.[0]) || e?.error?.message || "Couldn't send it. Try again.";
      },
    });
  }

  validText(d: CarpoolDocumentItem): string {
    if (!d.valid_until) return d.expires_on ? 'Valid until ' + this.day(d.expires_on) : 'No expiry date on file';
    return d.expired ? 'Expired on ' + this.day(d.valid_until) + '. You can’t publish carpools until a new copy is approved.'
      : 'You can publish carpools up to ' + this.day(d.valid_until);
  }

  day(d: string | null): string {
    if (!d) return '';
    return new Date(d + 'T12:00:00+05:30').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  }

  back(): void {
    this.nav.back();
  }

  private dropPreview(): void {
    if (this.preview) URL.revokeObjectURL(this.preview);
    this.preview = null;
  }
}

/** The India calendar day, offset by some days, as YYYY-MM-DD. */
export function indiaDay(offsetDays = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() + offsetDays * 86400000));
}
