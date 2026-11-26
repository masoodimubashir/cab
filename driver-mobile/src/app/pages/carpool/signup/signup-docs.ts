import { forkJoin } from 'rxjs';
import { ApiService } from '../../../core/api.service';
import { CatalogDocument, DocumentRequirement, DriverMe } from './carpool-signup.models';

export interface DocSlotUi {
  index: number;
  status: string;
  rejection_reason: string | null;
  uploading: boolean;
  error: string | null;
}

export interface DocUi {
  id: number;
  name: string;
  instructions: string | null;
  labels: CatalogDocument['labels'];
  labelValues: Record<string, string>;
  slots: DocSlotUi[];
}

/**
 * The carpool documents list and its uploads, shared by the sign-up wizard (step 5)
 * and the Fix documents screen. The list comes from GET /drivers/me (what is needed,
 * per slot) and /catalog/documents (instructions, date labels); each image uploads
 * through the existing POST /drivers/documents.
 */
export class SignupDocs {
  docs: DocUi[] = [];
  loaded = false;

  constructor(private api: ApiService) {}

  load(onError?: (message: string) => void): void {
    forkJoin({
      me: this.api.get<DriverMe>('/drivers/me'),
      catalog: this.api.get<{ data: CatalogDocument[] }>('/catalog/documents'),
    }).subscribe({
      next: ({ me, catalog }) => {
        this.build(me.document_requirements ?? [], catalog.data ?? []);
        this.loaded = true;
      },
      error: (err) => onError?.(messageFrom(err)),
    });
  }

  private build(reqs: DocumentRequirement[], catalog: CatalogDocument[]): void {
    const previous = new Map(this.docs.map((d) => [d.id, d.labelValues]));
    this.docs = reqs.filter((r) => r.document_id !== null).map((r) => {
      const cat = catalog.find((c) => c.id === r.document_id);
      const labels = cat?.labels ?? [];
      const values: Record<string, string> = {};
      labels.forEach((l) => (values[l.label] = previous.get(r.document_id!)?.[l.label] ?? ''));
      return {
        id: r.document_id!,
        name: r.name,
        instructions: cat?.instructions ?? null,
        labels,
        labelValues: values,
        slots: r.slots.map((s) => ({ ...s, uploading: false, error: null })),
      };
    });
  }

  labelsMissing(doc: DocUi): boolean {
    return doc.labels.some((l) => l.mandatory && !doc.labelValues[l.label]?.trim());
  }

  upload(doc: DocUi, slot: DocSlotUi, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (this.labelsMissing(doc)) {
      slot.error = `Fill in ${doc.labels.filter((l) => l.mandatory).map((l) => l.label.toLowerCase()).join(', ')} first.`;
      return;
    }
    const fd = new FormData();
    fd.append('document_id', String(doc.id));
    fd.append('image_index', String(slot.index));
    fd.append('file', file);
    if (doc.labels.length) fd.append('label_values', JSON.stringify(doc.labelValues));

    slot.uploading = true;
    slot.error = null;
    this.api.postForm('/drivers/documents', fd).subscribe({
      next: () => {
        slot.uploading = false;
        slot.status = 'uploaded';
        slot.rejection_reason = null;
      },
      error: (err) => {
        slot.uploading = false;
        slot.error = messageFrom(err);
      },
    });
  }

  slotDone(slot: DocSlotUi): boolean {
    return ['uploaded', 'pending', 'approved'].includes(slot.status);
  }

  /** A document with a slot still to send (missing or rejected). */
  needsWork(doc: DocUi): boolean {
    return doc.slots.some((s) => !this.slotDone(s));
  }

  get allUploaded(): boolean {
    return this.docs.length > 0 && this.docs.every((d) => d.slots.every((s) => this.slotDone(s)));
  }
}

export function messageFrom(err: any): string {
  const errors = err?.error?.errors as Record<string, string[]> | undefined;
  const first = errors ? Object.values(errors)[0]?.[0] : null;
  return first || err?.error?.message || 'Something went wrong. Check your connection and try again.';
}
