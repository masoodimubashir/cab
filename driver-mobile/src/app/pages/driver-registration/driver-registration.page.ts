import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ApprovedDriverGuard } from '../../core/approved-driver.guard';

type DocStatus = 'idle' | 'uploading' | 'done' | 'error';
type LabelType = 'text' | 'number' | 'date' | 'url';

interface CityOpt { id: number; name: string; country_code: string | null; }
interface VehicleTypeOpt { id: number; name: string; description: string | null; image_url: string | null; }
interface FleetOpt { id: number; name: string; city_id: number | null; }
interface DocumentLabelDef { id: number; label: string; label_type: LabelType; mandatory: boolean; sort_order: number; }
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
  existing: ExistingUpload | null;
}

/**
 * Driver onboarding wizard (after phone OTP signup).
 *
 *   Step 1 — Profile + Vehicle: photo, name, email (optional), city, vehicle type, fleet.
 *            Saves profile (POST /me/profile) and driver row (POST /drivers/register).
 *   Step 2 — Documents: catalog of required docs, each with an upload button.
 *            Driver cannot reach the dashboard until at least the mandatory
 *            docs are uploaded (status: uploaded/approved counts).
 *
 * Both steps are auth-gated by AuthGuard on the route; this component itself
 * enforces document-completion before allowing exit to /tabs/dashboard.
 */
@Component({
  selector: 'app-driver-registration',
  templateUrl: './driver-registration.page.html',
  styleUrls: ['./driver-registration.page.scss'],
  standalone: false,
})
export class DriverRegistrationPage implements OnInit {
  step: 1 | 2 = 1;

  // Catalog data
  cities: CityOpt[] = [];
  vehicleTypes: VehicleTypeOpt[] = [];
  fleets: FleetOpt[] = [];
  docs: DocUploadState[] = [];

  // Step 1 fields — Driver info
  city_id: number | null = null;
  vehicle_type_id: number | null = null;
  vehicle_brand = '';
  vehicle_model = '';
  vehicle_color = '';
  fleet_id: number | null = null; // null = "None"

  // Approved drivers cannot change ride/vehicle. Documents still listed read-only.
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
    forkJoin({
      cities: this.api.get<{ data: CityOpt[] }>('/catalog/cities').pipe(
        catchError(() => of({ data: [] as CityOpt[] })),
      ),
      vehicleTypes: this.api.get<{ data: VehicleTypeOpt[] }>('/catalog/vehicle-types').pipe(
        catchError(() => of({ data: [] as VehicleTypeOpt[] })),
      ),
      fleets: this.api.get<{ data: FleetOpt[] }>('/catalog/fleets').pipe(
        catchError(() => of({ data: [] as FleetOpt[] })),
      ),
      docs: this.api.get<{ data: CatalogDoc[] }>('/catalog/documents').pipe(
        catchError(() => of({ data: [] as CatalogDoc[] })),
      ),
      driver: this.api
        .get<{ driver: Record<string, unknown> | null; documents: ExistingUpload[] }>('/drivers/me')
        .pipe(catchError(() => of({ driver: null, documents: [] }))),
    }).subscribe({
      next: ({ cities, vehicleTypes, fleets, docs, driver }) => {
        this.cities = cities.data ?? [];
        this.vehicleTypes = vehicleTypes.data ?? [];
        this.fleets = fleets.data ?? [];

        const existingByDocId = new Map<number, ExistingUpload>();
        for (const u of (driver as { documents?: ExistingUpload[] }).documents ?? []) {
          if (u.document_id != null) existingByDocId.set(u.document_id, u);
        }
        this.docs = (docs.data ?? []).map((d) => ({
          doc: d,
          file: null,
          status: 'idle' as DocStatus,
          labelValues: this.blankLabelValues(d),
          existing: existingByDocId.get(d.id) ?? null,
        }));

        const d = driver.driver as Record<string, string | number | null> | null;
        if (d) {
          this.vehicle_type_id = (d['vehicle_type_id'] as number | null) ?? null;
          this.city_id = (d['city_id'] as number | null) ?? null;
          this.fleet_id = (d['fleet_id'] as number | null) ?? null;
          this.vehicle_brand = (d['vehicle_brand'] as string | null) ?? '';
          this.vehicle_model = (d['vehicle_model'] as string | null) ?? '';
          this.vehicle_color = (d['vehicle_color'] as string | null) ?? '';
          this.driverApproved = (d['approval_status'] as string | null) === 'approved';

          // Keep the guard cache fresh so /tabs navigation stays snappy, but
          // do NOT auto-redirect — an approved driver who lands here on
          // purpose (e.g. from More → Registration & documents) wants to
          // view/download their documents. The "Go to Dashboard" button at
          // the bottom of the page is enabled for approved drivers, so there
          // is always a visible way out.
          if (this.driverApproved) {
            ApprovedDriverGuard.setStateApproved();
          }

          // Always land on Step 1 (vehicle). The driver can Continue to docs
          // from there. Skipping ahead surprised users who came in to edit
          // their vehicle and immediately saw the docs view instead.
        }
        this.initLoading = false;
      },
    });
  }

  private blankLabelValues(d: CatalogDoc): Record<string, string> {
    const out: Record<string, string> = {};
    for (const l of d.labels) out[l.label] = '';
    return out;
  }

  // Fleets are filtered to the chosen city so the dropdown stays small.
  get fleetsForCurrentCity(): FleetOpt[] {
    if (!this.city_id) return this.fleets;
    return this.fleets.filter((f) => !f.city_id || f.city_id === this.city_id);
  }

  /** Selects a vehicle-type card (no-op once the driver is approved/locked). */
  pickVehicleType(v: VehicleTypeOpt): void {
    if (this.busy || this.driverApproved) return;
    this.vehicle_type_id = v.id;
  }

  // ── Step 1: vehicle + city + fleet ───────────────────────────────

  submitStep1(): void {
    this.error = null;
    if (!this.city_id) { this.error = 'Please pick your city.'; return; }
    if (!this.vehicle_type_id) { this.error = 'Please pick your vehicle type.'; return; }
    // Brand / model / color and fleet are all optional ("None" for fleet).

    this.busy = true;
    this.api.post<{ user?: { roles?: string[] }; driver?: unknown }>('/drivers/register', {
      vehicle_type_id: this.vehicle_type_id,
      city_id: this.city_id,
      fleet_id: this.fleet_id,
      vehicle_brand: this.vehicle_brand.trim() || null,
      vehicle_model: this.vehicle_model.trim() || null,
      vehicle_color: this.vehicle_color.trim() || null,
    }).subscribe({
      next: (regRes) => {
        const roles = regRes?.user?.roles;
        if (roles?.length) this.auth.updateUser({ roles });
        this.message = 'Vehicle saved. Now upload your documents.';
        this.step = 2;
        this.busy = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not save vehicle details.';
        this.busy = false;
      },
    });
  }

  // ── Step 2: documents ────────────────────────────────────────────

  onDocFileChange(slot: DocUploadState, ev: Event): void {
    const input = ev.target as HTMLInputElement;
    slot.file = input.files?.[0] ?? null;
    slot.status = 'idle';
    slot.error = undefined;
  }

  hasSelection(): boolean {
    return this.docs.some((d) => !!d.file && !this.isLocked(d));
  }

  isLocked(slot: DocUploadState): boolean {
    if (this.driverApproved) return true;
    if (!slot.existing) return false;
    return slot.existing.status !== 'rejected';
  }

  // ── Document view / download ─────────────────────────────────────

  /**
   * Open the document in a new tab. window.open would skip the Bearer token,
   * so we fetch the file authenticated → object URL → open.
   */
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
          const safeName = (slot.doc.name || `doc-${slot.existing!.id}`)
            .replace(/[^a-z0-9._-]+/gi, '_');
          a.download = safeName.includes('.')
            ? safeName
            : `${safeName}.${(blob.type || 'application/octet-stream').split('/')[1] || 'bin'}`;
          document.body.appendChild(a);
          a.click();
          a.remove();
        } else {
          window.open(objectUrl, '_blank');
        }
        // Don't leak the object URL — release it after a generous window.
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      },
      error: (err) => {
        this.error = err?.status === 401
          ? 'Session expired — sign in again.'
          : 'Could not load the file. Please try again.';
      },
    });
  }

  /**
   * Server returns an absolute URL pointing at /api/.../file. Strip the host
   * and /api prefix so it can be re-issued through ApiService.getBlob (which
   * adds the host + auth header itself).
   */
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

  /**
   * The dashboard is unlocked once every mandatory doc is uploaded (status
   * uploaded/approved) — or unconditionally if the operator has already
   * approved this driver. Without the approved-shortcut an approved driver
   * who hits this page would stare at a perpetually-disabled button.
   */
  get canGoToDashboard(): boolean {
    if (this.driverApproved) return true;
    const mandatory = this.docs.filter((d) => d.doc.required === 'mandatory' || !d.doc.required);
    if (mandatory.length === 0) return false; // nothing in catalog → still block
    return mandatory.every((d) => d.existing && d.existing.status !== 'rejected');
  }

  uploadSelected(): void {
    const pending = this.docs.filter((d) => !!d.file && !this.isLocked(d));
    if (pending.length === 0) {
      this.error = 'Pick at least one document file to upload.';
      return;
    }

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
    pending.forEach((d) => { d.status = 'uploading'; d.error = undefined; });

    const uploads = pending.map((slot) => {
      const fd = new FormData();
      fd.append('document_id', String(slot.doc.id));
      if (this.vehicle_type_id) fd.append('vehicle_type_id', String(this.vehicle_type_id));
      if (slot.doc.labels.length) fd.append('label_values', JSON.stringify(slot.labelValues));
      fd.append('file', slot.file as File, (slot.file as File).name);
      return this.api.postForm<{ document?: ExistingUpload }>('/drivers/documents', fd).pipe(
        map((res) => {
          slot.status = 'done';
          slot.file = null;
          if (res?.document) slot.existing = res.document;
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
          this.message = `${okCount} document${okCount === 1 ? '' : 's'} uploaded.`;
          // All mandatory docs now in → hand off to the locked under-review screen.
          if (this.canGoToDashboard) {
            ApprovedDriverGuard.setStatePending();
            this.router.navigateByUrl('/driver-pending-review', { replaceUrl: true });
            return;
          }
        } else if (okCount === 0) {
          this.error = 'All uploads failed. Check each document and try again.';
        } else {
          this.message = `${okCount} uploaded, ${failCount} failed. Retry the failed ones.`;
        }
      },
      complete: () => { this.uploadBusy = false; },
    });
  }

  /**
   * Used by the docs step's "Go to Dashboard" button when an already-approved
   * driver re-opens the page. Pending drivers are pushed to the locked
   * under-review screen instead.
   */
  goToDashboard(): void {
    if (this.driverApproved) {
      ApprovedDriverGuard.setStateApproved();
      this.router.navigateByUrl('/tabs/dashboard', { replaceUrl: true });
    } else {
      ApprovedDriverGuard.setStatePending();
      this.router.navigateByUrl('/driver-pending-review', { replaceUrl: true });
    }
  }

  goToStep(s: 1 | 2): void {
    this.step = s;
    this.error = null;
    this.message = null;
  }
}
