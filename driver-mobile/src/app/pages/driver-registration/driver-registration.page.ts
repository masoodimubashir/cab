import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { forkJoin, interval, of, Subscription } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ApprovedDriverGuard } from '../../core/approved-driver.guard';
import { Gesture, GestureController, NavController, Platform } from '@ionic/angular';

type DocStatus = 'idle' | 'uploading' | 'done' | 'error';
type ServiceScope = 'local' | 'outstation';
type ServiceMode = 'private' | 'fixed' | 'shuttle';
type LabelType = 'text' | 'number' | 'date' | 'url';

interface CityOpt { id: number; name: string; country_code: string | null; }
interface VehicleTypeOpt { id: number; name: string; description: string | null; image_url: string | null; }
interface FleetOpt { id: number; name: string; city_id: number | null; }
interface DocumentLabelDef { id: number; label: string; label_type: LabelType; mandatory: boolean; sort_order: number; }
interface RideModeOption { id: number; scope: ServiceScope; mode: ServiceMode; name: string; image_url: string | null; sort_order: number; }
interface RideScopeOption { id: number; scope: ServiceScope; name: string; sort_order: number; modes: RideModeOption[]; }
interface CatalogDoc {
  id: number;
  name: string;
  no_of_images: number;
  category: string;
  required: string | null;
  gallery_restricted: boolean;
  instructions: string | null;
  labels: DocumentLabelDef[];
}
interface ExistingUpload {
  id: number;
  document_id: number | null;
  image_index: number | null;
  status: 'uploaded' | 'approved' | 'rejected';
  rejection_reason: string | null;
  file_url: string;
  uploaded_at: string | null;
}
interface DocImageSlot {
  index: number;
  file: File | null;
  status: DocStatus;
  error?: string;
  existing: ExistingUpload | null;
}
interface DocUploadState {
  doc: CatalogDoc;
  uploads: DocImageSlot[];
  labelValues: Record<string, string>;
}

/**
 * Driver onboarding wizard (after phone OTP signup).
 *
 *   Step 1 — Scope: city + permanent Local/Outstation choice.
 *   Step 2 — Mode: Private/Fixed/Shuttle under the selected scope.
 *   Step 3 — Profile + Vehicle: vehicle type, fleet, vehicle details.
 *            Saves the locked service and driver row (POST /drivers/register).
 *   Step 4 — Documents: catalog of required docs, each with an upload button.
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
export class DriverRegistrationPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('content', { read: ElementRef }) content?: ElementRef<HTMLElement>;

  step: 1 | 2 | 3 | 4 = 1;

  // Catalog data
  cities: CityOpt[] = [];
  vehicleTypes: VehicleTypeOpt[] = [];
  fleets: FleetOpt[] = [];
  docs: DocUploadState[] = [];
  rideScopes: RideScopeOption[] = [];
  loadingRideProducts = false;

  service_scope: ServiceScope | null = null;
  service_mode: ServiceMode | null = null;

  // Step 2 fields — Driver info
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
  private edgeBackGesture?: Gesture;
  private hardwareBackSub?: Subscription;
  private documentsPollSub?: Subscription;
  private documentsRefreshInFlight = false;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private router: Router,
    private nav: NavController,
    private location: Location,
    private gestures: GestureController,
    private platform: Platform,
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

        this.mergeDocumentStep(docs.data ?? [], (driver as { documents?: ExistingUpload[] }).documents ?? []);

        const d = driver.driver as Record<string, string | number | null> | null;
        if (d) {
          this.vehicle_type_id = (d['vehicle_type_id'] as number | null) ?? null;
          this.city_id = (d['city_id'] as number | null) ?? null;
          this.fleet_id = (d['fleet_id'] as number | null) ?? null;
          this.vehicle_brand = (d['vehicle_brand'] as string | null) ?? '';
          this.vehicle_model = (d['vehicle_model'] as string | null) ?? '';
          this.vehicle_color = (d['vehicle_color'] as string | null) ?? '';
          this.service_scope = (d['service_scope'] as ServiceScope | null) ?? null;
          this.service_mode = (d['service_mode'] as ServiceMode | null) ?? null;
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

          if (this.city_id) this.loadRideProducts();

          // Always land on Step 1 so approved drivers can review their locked service.
        }
        if (!d && this.cities.length === 1) {
          this.city_id = this.cities[0].id;
          this.loadRideProducts();
        }
        this.initLoading = false;
        this.startDocumentsLiveRefresh();
      },
    });
  }


  ngAfterViewInit(): void {
    queueMicrotask(() => this.attachEdgeBackGesture());
    this.hardwareBackSub = this.platform.backButton.subscribeWithPriority(20, () => {
      this.handleBack();
    });
  }

  ngOnDestroy(): void {
    this.edgeBackGesture?.destroy();
    this.hardwareBackSub?.unsubscribe();
    this.documentsPollSub?.unsubscribe();
  }

  private attachEdgeBackGesture(): void {
    const el = this.content?.nativeElement;
    if (!el) return;

    this.edgeBackGesture = this.gestures.create({
      el,
      gestureName: 'driver-registration-edge-back',
      threshold: 12,
      canStart: (detail) => detail.startX <= 36,
      onEnd: (detail) => {
        if (detail.deltaX > 72 && Math.abs(detail.deltaY) < 60 && detail.velocityX > 0.15) {
          this.handleBack();
        }
      },
    });
    this.edgeBackGesture.enable(true);
  }

  get canNavigateBack(): boolean {
    return this.step > 1 || this.driverApproved;
  }

  handleBack(): void {
    this.error = null;
    this.message = null;

    if (this.step > 1) {
      this.step = (this.step - 1) as 1 | 2 | 3 | 4;
      return;
    }

    if (this.driverApproved) {
      this.router.navigateByUrl('/tabs/dashboard');
      return;
    }

    if (window.history.length > 1) {
      this.location.back();
      return;
    }

    this.nav.navigateBack('/auth/login');
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

  // ── Step 1: city + permanent scope ──────────────────────────────

  onCityChange(): void {
    if (this.driverApproved) return;
    this.service_scope = null;
    this.service_mode = null;
    this.rideScopes = [];
    this.loadRideProducts();
  }

  loadRideProducts(): void {
    if (!this.city_id) return;
    this.loadingRideProducts = true;
    this.api.get<{ scopes: RideScopeOption[] }>(`/catalog/cities/${this.city_id}/driver-ride-products`).pipe(
      catchError(() => of({ scopes: [] as RideScopeOption[] })),
    ).subscribe({
      next: (res) => {
        this.rideScopes = (res.scopes ?? []).map((scope) => ({
          ...scope,
          modes: scope.modes ?? [],
        }));
      },
      complete: () => { this.loadingRideProducts = false; },
    });
  }

  pickScope(scope: RideScopeOption): void {
    if (this.busy || this.driverApproved) return;
    this.service_scope = scope.scope;
    this.service_mode = null;
  }

  get selectedScope(): RideScopeOption | undefined {
    return this.rideScopes.find((scope) => scope.scope === this.service_scope);
  }

  get modeOptions(): RideModeOption[] {
    return this.selectedScope?.modes ?? [];
  }

  pickMode(option: RideModeOption): void {
    if (this.busy || this.driverApproved) return;
    this.service_mode = option.mode;
  }

  iconForMode(mode: ServiceMode): string {
    if (mode === 'fixed') return 'git-branch-outline';
    if (mode === 'shuttle') return 'bus-outline';
    return 'car-outline';
  }

  get selectedServiceLabel(): string {
    const scope = this.rideScopes.find((row) => row.scope === this.service_scope);
    const mode = scope?.modes.find((row) => row.mode === this.service_mode);
    if (scope && mode) return `${scope.name} ${mode.name}`;
    if (scope) return scope.name;
    return 'Not selected';
  }

  continueToMode(): void {
    this.error = null;
    if (!this.city_id) { this.error = 'Please pick your city.'; return; }
    if (!this.service_scope) { this.error = 'Please choose Local or Outstation.'; return; }
    if (!this.modeOptions.length) { this.error = 'No service types are active for this selection.'; return; }
    this.step = 2;
  }

  continueToVehicle(): void {
    this.error = null;
    if (!this.service_scope) { this.error = 'Please choose Local or Outstation.'; this.step = 1; return; }
    if (!this.service_mode) { this.error = 'Please choose the service type you will provide.'; return; }
    this.step = 3;
  }

  // ── Step 3: vehicle + fleet ──────────────────────────────────────

  submitStep1(): void {
    this.error = null;
    if (!this.service_scope) { this.error = 'Please choose Local or Outstation.'; this.step = 1; return; }
    if (!this.service_mode) { this.error = 'Please choose the service type you will provide.'; this.step = 2; return; }
    if (!this.city_id) { this.error = 'Please pick your city.'; return; }
    if (!this.vehicle_type_id) { this.error = 'Please pick your vehicle type.'; return; }
    // Brand / model / color and fleet are all optional ("None" for fleet).

    this.busy = true;
    this.api.post<{ user?: { roles?: string[] }; driver?: unknown }>('/drivers/register', {
      service_scope: this.service_scope,
      service_mode: this.service_mode,
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
        this.step = 4;
        this.busy = false;
        this.refreshDocumentStep(true);
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not save vehicle details.';
        this.busy = false;
      },
    });
  }

  // ── Step 4: documents ────────────────────────────────────────────

  private startDocumentsLiveRefresh(): void {
    this.documentsPollSub?.unsubscribe();
    this.documentsPollSub = interval(5000).subscribe(() => {
      if (this.step !== 4 || this.uploadBusy || this.documentsRefreshInFlight) return;
      this.refreshDocumentStep(false);
    });
  }

  private refreshDocumentStep(showErrors: boolean): void {
    if (this.documentsRefreshInFlight) return;
    this.documentsRefreshInFlight = true;

    forkJoin({
      docs: this.api.get<{ data: CatalogDoc[] }>('/catalog/documents').pipe(
        catchError((err) => {
          if (showErrors) this.error = err?.error?.message || 'Could not refresh required documents.';
          return of({ data: this.docs.map((slot) => slot.doc) });
        }),
      ),
      driver: this.api
        .get<{ driver: Record<string, unknown> | null; documents: ExistingUpload[] }>('/drivers/me')
        .pipe(catchError((err) => {
          if (showErrors) this.error = err?.error?.message || 'Could not refresh your verification status.';
          const fallbackDocs: ExistingUpload[] = [];
          for (const slot of this.docs) {
            for (const upload of slot.uploads) {
              if (upload.existing) fallbackDocs.push(upload.existing);
            }
          }
          return of({ driver: null, documents: fallbackDocs });
        })),
    }).subscribe({
      next: ({ docs, driver }) => {
        this.mergeDocumentStep(docs.data ?? [], driver.documents ?? []);
        this.applyDriverApprovalRefresh(driver.driver);
      },
      complete: () => { this.documentsRefreshInFlight = false; },
    });
  }

  private mergeDocumentStep(catalogDocs: CatalogDoc[], uploads: ExistingUpload[]): void {
    const previousByDocId = new Map<number, DocUploadState>();
    for (const slot of this.docs) previousByDocId.set(slot.doc.id, slot);

    const existingByDocId = new Map<number, ExistingUpload[]>();
    for (const upload of uploads) {
      if (upload.document_id == null) continue;
      const list = existingByDocId.get(upload.document_id) ?? [];
      list.push(upload);
      existingByDocId.set(upload.document_id, list);
    }
    existingByDocId.forEach((list) => {
      list.sort((a, b) => (a.image_index ?? 999) - (b.image_index ?? 999) || a.id - b.id);
    });

    this.docs = catalogDocs.map((doc) => {
      const previous = previousByDocId.get(doc.id);
      const existingList = [...(existingByDocId.get(doc.id) ?? [])];
      const slotCount = Math.max(1, doc.no_of_images || 1);
      const uploadsState: DocImageSlot[] = Array.from({ length: slotCount }, (_, idx) => {
        const imageIndex = idx + 1;
        const exact = existingList.find((row) => (row.image_index ?? imageIndex) === imageIndex) ?? null;
        const fallback = !exact && existingList[idx] ? existingList[idx] : null;
        return {
          index: imageIndex,
          file: previous?.uploads[idx]?.file ?? null,
          status: previous?.uploads[idx]?.status ?? 'idle',
          error: previous?.uploads[idx]?.error,
          existing: exact ?? fallback,
        };
      });

      return {
        doc,
        uploads: uploadsState,
        labelValues: this.mergeLabelValues(doc, previous?.labelValues),
      };
    });
  }

  private mergeLabelValues(doc: CatalogDoc, current: Record<string, string> | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const label of doc.labels) out[label.label] = current?.[label.label] ?? '';
    return out;
  }

  private applyDriverApprovalRefresh(driver: Record<string, unknown> | null): void {
    if (!driver) return;
    const status = driver?.['approval_status'] as string | null | undefined;

    if (status === 'approved') {
      this.driverApproved = true;
      ApprovedDriverGuard.setStateApproved();
      this.router.navigateByUrl('/tabs/dashboard', { replaceUrl: true });
      return;
    }

    this.driverApproved = false;
    if (status === 'rejected') {
      ApprovedDriverGuard.setStatePending();
      this.error = 'Your verification was rejected. Check the rejected document below and upload it again.';
      return;
    }

    if (status === 'pending' && this.error?.startsWith('Your verification was rejected.')) {
      this.error = null;
    }
  }

  onDocFileChange(upload: DocImageSlot, ev: Event): void {
    const input = ev.target as HTMLInputElement;
    upload.file = input.files?.[0] ?? null;
    upload.status = 'idle';
    upload.error = undefined;
  }

  hasSelection(): boolean {
    return this.docs.some((d) => d.uploads.some((u) => !!u.file && !this.isLocked(u)));
  }

  isLocked(upload: DocImageSlot): boolean {
    if (this.driverApproved) return true;
    if (!upload.existing) return false;
    return upload.existing.status !== 'rejected';
  }

  isDocLocked(doc: DocUploadState): boolean {
    if (this.driverApproved) return true;
    return doc.uploads.some((upload) => !!upload.existing && upload.existing.status !== 'rejected');
  }

  // ── Document view / download ─────────────────────────────────────

  /**
   * Open the document in a new tab. window.open would skip the Bearer token,
   * so we fetch the file authenticated → object URL → open.
   */
  viewDoc(upload: DocImageSlot): void {
    this.fetchDoc(upload, false);
  }

  downloadDoc(upload: DocImageSlot): void {
    this.fetchDoc(upload, true);
  }

  private fetchDoc(upload: DocImageSlot, asDownload: boolean): void {
    if (!upload.existing?.file_url) return;
    let apiPath = this.toApiPath(upload.existing.file_url);
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
          const safeName = `doc-${upload.existing!.id}-image-${upload.index}`
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

  fileAccept(doc: CatalogDoc): string {
    return doc.gallery_restricted ? 'image/*' : 'image/*,application/pdf';
  }

  fileCapture(doc: CatalogDoc): string | null {
    return doc.gallery_restricted ? 'environment' : null;
  }

  /**
   * The dashboard is unlocked once every mandatory doc is uploaded (status
   * uploaded/approved) — or unconditionally if the operator has already
   * approved this driver. Without the approved-shortcut an approved driver
   * who hits this page would stare at a perpetually-disabled button.
   */
  get canGoToDashboard(): boolean {
    if (this.driverApproved) return true;
    const mandatory = this.docs.filter((d) => d.doc.required !== 'optional');
    if (mandatory.length === 0) return false; // nothing in catalog → still block
    return mandatory.every((d) => d.uploads.every((u) => u.existing && u.existing.status !== 'rejected'));
  }

  uploadSelected(): void {
    const pending: Array<{ doc: DocUploadState; upload: DocImageSlot }> = [];
    for (const doc of this.docs) {
      for (const upload of doc.uploads) {
        if (upload.file && !this.isLocked(upload)) pending.push({ doc, upload });
      }
    }
    if (pending.length === 0) {
      this.error = 'Pick at least one document file to upload.';
      return;
    }

    for (const item of pending) {
      for (const lbl of item.doc.doc.labels) {
        if (lbl.mandatory && !item.doc.labelValues[lbl.label]?.trim()) {
          this.error = `"${lbl.label}" is required for ${item.doc.doc.name}.`;
          return;
        }
      }
    }

    this.uploadBusy = true;
    this.error = null;
    this.message = null;
    pending.forEach(({ upload }) => { upload.status = 'uploading'; upload.error = undefined; });

    const uploads = pending.map(({ doc, upload }) => {
      const fd = new FormData();
      fd.append('document_id', String(doc.doc.id));
      fd.append('image_index', String(upload.index));
      if (this.vehicle_type_id) fd.append('vehicle_type_id', String(this.vehicle_type_id));
      if (doc.doc.labels.length) fd.append('label_values', JSON.stringify(doc.labelValues));
      fd.append('file', upload.file as File, (upload.file as File).name);
      return this.api.postForm<{ document?: ExistingUpload }>('/drivers/documents', fd).pipe(
        map((res) => {
          upload.status = 'done';
          upload.file = null;
          if (res?.document) upload.existing = res.document;
          return { id: doc.doc.id, ok: true };
        }),
        catchError((err) => {
          upload.status = 'error';
          upload.error = err?.error?.message || 'Upload failed';
          return of({ id: doc.doc.id, ok: false });
        }),
      );
    });

    forkJoin(uploads).subscribe({
      next: (results) => {
        const okCount = results.filter((r) => r.ok).length;
        const failCount = results.length - okCount;
        if (failCount === 0) {
          this.message = `${okCount} document${okCount === 1 ? '' : 's'} uploaded.`;
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
      complete: () => {
        this.uploadBusy = false;
        this.refreshDocumentStep(false);
      },
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

  goToStep(s: 1 | 2 | 3 | 4): void {
    if (s > 1 && !this.service_scope) {
      this.error = 'Please choose Local or Outstation.';
      this.step = 1;
      return;
    }
    if (s > 2 && !this.service_mode) {
      this.error = 'Please choose the service type you will provide.';
      this.step = 2;
      return;
    }
    this.step = s;
    this.error = null;
    this.message = null;
  }
}
