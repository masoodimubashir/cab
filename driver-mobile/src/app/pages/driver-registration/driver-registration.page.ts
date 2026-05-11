import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

type DocStatus = 'idle' | 'uploading' | 'done' | 'error';
type LabelType = 'text' | 'number' | 'date' | 'url';

interface RideTypeOpt {
  id: number;
  name: string;
  description: string | null;
}
interface VehicleTypeOpt {
  id: number;
  name: string;
  description: string | null;
  image_url: string | null;
}
interface DocumentLabelDef {
  id: number;
  label: string;
  label_type: LabelType;
  mandatory: boolean;
  sort_order: number;
}
interface CatalogDoc {
  id: number;
  name: string;
  no_of_images: number;
  category: string;
  required: string | null;
  instructions: string | null;
  labels: DocumentLabelDef[];
}

interface ExistingUpload {
  id: number;
  document_id: number | null;
  status: 'uploaded' | 'approved' | 'rejected';
  rejection_reason: string | null;
  file_url: string;
  uploaded_at: string | null;
}

interface DocUploadState {
  doc: CatalogDoc;
  file: File | null;
  status: DocStatus;
  error?: string;
  labelValues: Record<string, string>;
  existing: ExistingUpload | null; // already uploaded server-side
}

@Component({
  selector: 'app-driver-registration',
  templateUrl: './driver-registration.page.html',
  styleUrls: ['./driver-registration.page.scss'],
  standalone: false,
})
export class DriverRegistrationPage implements OnInit {
  step: 1 | 2 | 3 = 1;

  // Catalog data
  rideTypes: RideTypeOpt[] = [];
  vehicleTypes: VehicleTypeOpt[] = [];
  docs: DocUploadState[] = [];

  // Step 1 selection
  ride_type_id: number | null = null;

  // Step 2 selection + free-text fallback fields. vehicle_reg_no is no longer
  // collected here — admin sets it from the approvals details page.
  vehicle_type_id: number | null = null;
  vehicle_brand = '';
  vehicle_model = '';
  vehicle_color = '';

  // Locked when the operator has approved the driver. Ride type and vehicle
  // type cannot be changed after that; documents are also fully locked.
  driverApproved = false;

  busy = false;
  uploadBusy = false;
  initLoading = true;
  message: string | null = null;
  error: string | null = null;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    // Load catalog + any existing driver row in parallel. We capture API
    // failures as a typed marker instead of silently falling back to an empty
    // array — empty results from a real API call vs. a 401/500 are very
    // different UX states and must not look identical.
    forkJoin({
      rideTypes: this.api.get<{ data: RideTypeOpt[] }>('/catalog/ride-types').pipe(
        catchError((err) => of({ data: [] as RideTypeOpt[], _error: this.formatHttpError(err, 'ride types') })),
      ),
      vehicleTypes: this.api.get<{ data: VehicleTypeOpt[] }>('/catalog/vehicle-types').pipe(
        catchError((err) => of({ data: [] as VehicleTypeOpt[], _error: this.formatHttpError(err, 'vehicle types') })),
      ),
      docs: this.api.get<{ data: CatalogDoc[] }>('/catalog/documents').pipe(
        catchError((err) => of({ data: [] as CatalogDoc[], _error: this.formatHttpError(err, 'documents') })),
      ),
      driver: this.api
        .get<{ driver: Record<string, unknown> | null; documents: ExistingUpload[] }>('/drivers/me')
        .pipe(catchError(() => of({ driver: null as Record<string, unknown> | null, documents: [] as ExistingUpload[] }))),
    }).subscribe({
      next: ({ rideTypes, vehicleTypes, docs, driver }) => {
        const errs: string[] = [];
        if ((rideTypes as { _error?: string })._error) errs.push((rideTypes as { _error: string })._error);
        if ((vehicleTypes as { _error?: string })._error) errs.push((vehicleTypes as { _error: string })._error);
        if ((docs as { _error?: string })._error) errs.push((docs as { _error: string })._error);
        if (errs.length) this.error = errs.join(' · ');

        // Map document_id → existing upload so Step 3 can lock those rows.
        const existingByDocId = new Map<number, ExistingUpload>();
        for (const u of (driver as { documents?: ExistingUpload[] }).documents ?? []) {
          if (u.document_id != null) existingByDocId.set(u.document_id, u);
        }
        this.rideTypes = rideTypes.data ?? [];
        this.vehicleTypes = vehicleTypes.data ?? [];
        this.docs = (docs.data ?? []).map((d) => ({
          doc: d,
          file: null,
          status: ('idle' as DocStatus),
          labelValues: this.blankLabelValues(d),
          existing: existingByDocId.get(d.id) ?? null,
        }));

        const d = driver.driver as Record<string, string | number | null> | null;
        if (d) {
          this.ride_type_id = (d['ride_type_id'] as number | null) ?? null;
          this.vehicle_type_id = (d['vehicle_type_id'] as number | null) ?? null;
          this.vehicle_brand = (d['vehicle_brand'] as string) ?? '';
          this.vehicle_model = (d['vehicle_model'] as string) ?? '';
          this.vehicle_color = (d['vehicle_color'] as string) ?? '';
          this.driverApproved = (d['approval_status'] as string | null) === 'approved';
        }
        // Always land on Step 1. Pre-filled selections are kept, but the
        // driver retraces the flow each time they open the page.
        this.step = 1;
        this.initLoading = false;
      },
    });
  }

  private blankLabelValues(d: CatalogDoc): Record<string, string> {
    const out: Record<string, string> = {};
    for (const l of d.labels) out[l.label] = '';
    return out;
  }

  private formatHttpError(err: unknown, what: string): string {
    const e = err as { status?: number; error?: { message?: string } } | undefined;
    if (e?.status === 401) return `Couldn't load ${what} — please sign in again.`;
    if (e?.status === 0) return `Couldn't reach the server while loading ${what}.`;
    if (e?.error?.message) return `${what}: ${e.error.message}`;
    return `Couldn't load ${what} (HTTP ${e?.status ?? 'unknown'}).`;
  }

  // ───── Step 1: Ride Type ─────
  selectRideType(id: number): void {
    if (this.driverApproved) return; // locked
    this.ride_type_id = id;
    this.error = null;
  }
  goToStep2(): void {
    if (!this.ride_type_id) {
      this.error = 'Pick a ride type to continue.';
      return;
    }
    this.error = null;
    this.message = null;
    this.step = 2;
  }

  // ───── Step 2: Vehicle Registration ─────
  selectVehicleType(id: number): void {
    if (this.driverApproved) return; // locked
    this.vehicle_type_id = id;
    this.error = null;
  }
  submitRegistration(): void {
    if (!this.ride_type_id) {
      this.step = 1;
      this.error = 'Ride type is required.';
      return;
    }
    if (!this.vehicle_type_id) {
      this.error = 'Pick a vehicle type.';
      return;
    }
    this.busy = true;
    this.error = null;
    this.message = null;

    this.api
      .post<{ user?: { roles?: string[] }; driver?: unknown }>('/drivers/register', {
        ride_type_id: this.ride_type_id,
        vehicle_type_id: this.vehicle_type_id,
        vehicle_brand: this.vehicle_brand.trim() || null,
        vehicle_model: this.vehicle_model.trim() || null,
        vehicle_color: this.vehicle_color.trim() || null,
      })
      .subscribe({
        next: (res) => {
          const roles = res?.user?.roles;
          if (roles?.length) this.auth.updateUser({ roles });
          this.message = 'Vehicle saved. Now upload your documents.';
          this.step = 3;
        },
        error: (err) => {
          this.error = err?.error?.message || 'Registration failed';
        },
        complete: () => {
          this.busy = false;
        },
      });
  }

  // ───── Step 3: Document uploads ─────
  onDocFileChange(slot: DocUploadState, ev: Event): void {
    const input = ev.target as HTMLInputElement;
    slot.file = input.files?.[0] ?? null;
    slot.status = 'idle';
    slot.error = undefined;
  }

  hasSelection(): boolean {
    return this.docs.some((d) => !!d.file && !this.isLocked(d));
  }

  /**
   * A slot is locked (no re-upload) when either:
   *  - the driver has been approved overall (everything frozen), or
   *  - the existing row is still pending review or already approved.
   * Rejected rows are NOT locked — the driver can replace them.
   */
  isLocked(slot: DocUploadState): boolean {
    if (this.driverApproved) return true;
    if (!slot.existing) return false;
    return slot.existing.status !== 'rejected';
  }

  // window.open does not send the Bearer token, so the streaming endpoint
  // would 401. We fetch the file authenticated, build an object URL, and
  // open that.
  viewDoc(slot: DocUploadState): void {
    this.fetchDoc(slot, false);
  }
  downloadDoc(slot: DocUploadState): void {
    this.fetchDoc(slot, true);
  }

  private fetchDoc(slot: DocUploadState, asDownload: boolean): void {
    if (!slot.existing?.file_url) return;
    let apiPath = this.toApiPath(slot.existing.file_url);
    if (!apiPath) return;
    if (asDownload) {
      apiPath += apiPath.includes('?') ? '&download=1' : '?download=1';
    }
    this.api.getBlob(apiPath).subscribe({
      next: (blob) => {
        const objectUrl = URL.createObjectURL(blob);
        if (asDownload) {
          const a = document.createElement('a');
          a.href = objectUrl;
          const name = (slot.doc.name || `doc-${slot.existing!.id}`).replace(/[^a-z0-9._-]+/gi, '_');
          a.download = name.includes('.') ? name : `${name}.${(blob.type || 'application/octet-stream').split('/')[1] || 'bin'}`;
          document.body.appendChild(a);
          a.click();
          a.remove();
        } else {
          window.open(objectUrl, '_blank');
        }
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      },
      error: (err) => {
        console.warn('view/download failed', err?.status, err);
        this.error = err?.status === 401
          ? 'Session expired — sign in again.'
          : 'Could not load the file. Please try again.';
      },
    });
  }

  private toApiPath(absoluteUrl: string): string | null {
    try {
      const parsed = new URL(absoluteUrl);
      let p = parsed.pathname + parsed.search;
      if (p.startsWith('/api/')) p = p.slice(4);
      else if (p.startsWith('/api')) p = p.slice(4);
      return p || null;
    } catch {
      return null;
    }
  }

  inputTypeFor(t: LabelType): string {
    if (t === 'number') return 'number';
    if (t === 'date') return 'date';
    if (t === 'url') return 'url';
    return 'text';
  }

  uploadSelected(): void {
    // Only un-locked rows are eligible. Rejected-and-replaced rows go through
    // here too; the backend will overwrite the previous file.
    const pending = this.docs.filter((d) => !!d.file && !this.isLocked(d));
    if (pending.length === 0) {
      this.error = 'Pick at least one document file to upload.';
      return;
    }

    // Enforce mandatory labels on the ones being uploaded.
    for (const slot of pending) {
      for (const lbl of slot.doc.labels) {
        if (lbl.mandatory && !slot.labelValues[lbl.label]?.trim()) {
          this.error = `"${lbl.label}" is required for ${slot.doc.name}.`;
          return;
        }
      }
    }

    this.uploadBusy = true;
    this.error = null;
    this.message = null;
    pending.forEach((d) => {
      d.status = 'uploading';
      d.error = undefined;
    });

    const uploads = pending.map((slot) => {
      const fd = new FormData();
      fd.append('document_id', String(slot.doc.id));
      if (this.vehicle_type_id) fd.append('vehicle_type_id', String(this.vehicle_type_id));
      if (slot.doc.labels.length) fd.append('label_values', JSON.stringify(slot.labelValues));
      fd.append('file', slot.file as File, (slot.file as File).name);
      return this.api.postForm<{ document?: unknown }>('/drivers/documents', fd).pipe(
        map(() => {
          slot.status = 'done';
          slot.file = null;
          return { id: slot.doc.id, ok: true };
        }),
        catchError((err) => {
          slot.status = 'error';
          slot.error = err?.error?.message || 'Upload failed';
          return of({ id: slot.doc.id, ok: false });
        }),
      );
    });

    forkJoin(uploads).subscribe({
      next: (results) => {
        const okCount = results.filter((r) => r.ok).length;
        const failCount = results.length - okCount;
        if (failCount === 0) {
          this.message = `${okCount} document${okCount === 1 ? '' : 's'} uploaded. Wait for admin approval before going online.`;
        } else if (okCount === 0) {
          this.error = 'All uploads failed. Check each document and try again.';
        } else {
          this.message = `${okCount} uploaded, ${failCount} failed. Retry the failed ones.`;
        }
      },
      complete: () => {
        this.uploadBusy = false;
      },
    });
  }

  goToStep(s: 1 | 2 | 3): void {
    this.step = s;
    this.error = null;
    this.message = null;
  }

  back(): void {
    this.router.navigateByUrl('/tabs/more');
  }
}
