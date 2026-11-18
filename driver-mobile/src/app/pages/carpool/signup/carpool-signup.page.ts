import { Component, OnDestroy, OnInit } from '@angular/core';
import { NavController } from '@ionic/angular';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ApiService } from '../../../core/api.service';
import { AuthService } from '../../../core/auth.service';
import { CatalogDocument, DocumentRequirement, DriverMe } from './carpool-signup.models';

interface CityOpt { id: number; name: string }

interface DocSlotUi {
  index: number;
  status: string;
  rejection_reason: string | null;
  uploading: boolean;
  error: string | null;
}

interface DocUi {
  id: number;
  name: string;
  instructions: string | null;
  labels: CatalogDocument['labels'];
  labelValues: Record<string, string>;
  slots: DocSlotUi[];
}

/** Standard Indian plates (JK01AB4521) and the BH series (22BH1234AA). Same check as the server. */
const PLATE_PATTERN = /^([A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}|\d{2}BH\d{4}[A-Z]{1,2})$/;

/**
 * Carpool sign-up, steps 2-5 (Carpool.md section 10): profile photo and name,
 * city, car, documents. The car step sends POST /carpool/driver/register; the
 * documents step uploads through the existing /drivers/documents endpoint.
 */
@Component({
  selector: 'app-carpool-signup',
  templateUrl: './carpool-signup.page.html',
  styleUrls: ['./carpool-signup.page.scss'],
  standalone: false,
})
export class CarpoolSignupPage implements OnInit, OnDestroy {
  readonly seatsMin = 1;
  readonly seatsMax = 6;

  step: 2 | 3 | 4 | 5 = 2;
  loading = true;
  busy = false;
  error: string | null = null;

  name = '';
  photoFile: File | null = null;
  photoPreview: string | null = null;

  cities: CityOpt[] = [];
  cityId: number | null = null;
  citySearch = '';

  get filteredCities(): CityOpt[] {
    const term = this.citySearch.trim().toLowerCase();
    return term ? this.cities.filter((c) => c.name.toLowerCase().includes(term)) : this.cities;
  }

  make = '';
  model = '';
  colour = '';
  plate = '';
  seats = 4;
  frontFile: File | null = null;
  frontPreview: string | null = null;
  interiorFile: File | null = null;
  interiorPreview: string | null = null;

  docs: DocUi[] = [];

  private objectUrls: string[] = [];

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private nav: NavController,
  ) {}

  ngOnInit(): void {
    forkJoin({
      me: this.api.get<DriverMe>('/drivers/me').pipe(catchError(() => of(null))),
      cities: this.api.get<{ data: CityOpt[] }>('/catalog/cities').pipe(catchError(() => of({ data: [] as CityOpt[] }))),
    }).subscribe(({ me, cities }) => {
      this.cities = cities.data ?? [];
      this.prefill(me);
      this.loading = false;
    });
  }

  ngOnDestroy(): void {
    this.objectUrls.forEach((u) => URL.revokeObjectURL(u));
  }

  // ── Step 2: profile ─────────────────────────────────────

  onPhoto(event: Event, target: 'photo' | 'front' | 'interior'): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.error = 'Choose a photo (JPG or PNG).';
      return;
    }
    const url = URL.createObjectURL(file);
    this.objectUrls.push(url);
    if (target === 'photo') { this.photoFile = file; this.photoPreview = url; }
    if (target === 'front') { this.frontFile = file; this.frontPreview = url; }
    if (target === 'interior') { this.interiorFile = file; this.interiorPreview = url; }
    this.error = null;
  }

  get profileReady(): boolean {
    return this.name.trim().length >= 2 && !!this.photoPreview;
  }

  // ── Step 4: car ─────────────────────────────────────────

  get normalisedPlate(): string {
    return this.plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  get plateValid(): boolean {
    return PLATE_PATTERN.test(this.normalisedPlate);
  }

  get carReady(): boolean {
    return !!this.make.trim() && !!this.model.trim() && !!this.colour.trim() && this.plateValid && !!this.frontPreview;
  }

  changeSeats(delta: number): void {
    this.seats = Math.max(this.seatsMin, Math.min(this.seatsMax, this.seats + delta));
  }

  // ── Navigation ──────────────────────────────────────────

  next(): void {
    this.error = null;
    if (this.step === 2) {
      if (!this.profileReady) { this.error = 'Add your name and a profile photo.'; return; }
      this.step = 3;
    } else if (this.step === 3) {
      if (!this.cityId) { this.error = 'Pick your city.'; return; }
      this.step = 4;
    } else if (this.step === 4) {
      this.submitCar();
    }
  }

  back(): void {
    this.error = null;
    if (this.step === 2) {
      void this.nav.navigateBack('/carpool-signup');
    } else if (this.step !== 5) {
      this.step = (this.step - 1) as 2 | 3 | 4;
    } else {
      this.step = 4;
    }
  }

  private submitCar(): void {
    if (!this.carReady) {
      this.error = this.plateValid ? 'Fill in every car detail and add the front photo.' : 'Enter the number plate as it is written, for example JK01 AB 4521.';
      return;
    }
    const fd = new FormData();
    fd.append('name', this.name.trim());
    if (this.photoFile) fd.append('photo', this.photoFile);
    fd.append('city_id', String(this.cityId));
    fd.append('make', this.make.trim());
    fd.append('model', this.model.trim());
    fd.append('colour', this.colour.trim());
    fd.append('plate', this.normalisedPlate);
    fd.append('seats', String(this.seats));
    if (this.frontFile) fd.append('front_photo', this.frontFile);
    if (this.interiorFile) fd.append('interior_photo', this.interiorFile);

    this.busy = true;
    this.api.postForm<{ user: { name: string; avatar_url: string | null } }>('/carpool/driver/register', fd).subscribe({
      next: (res) => {
        this.busy = false;
        this.auth.updateUser({ name: res.user?.name } as never);
        this.photoFile = this.frontFile = this.interiorFile = null; // on file now
        this.step = 5;
        this.loadDocuments();
      },
      error: (err) => {
        this.busy = false;
        this.error = this.messageFrom(err);
      },
    });
  }

  // ── Step 5: documents ───────────────────────────────────

  loadDocuments(): void {
    forkJoin({
      me: this.api.get<DriverMe>('/drivers/me'),
      catalog: this.api.get<{ data: CatalogDocument[] }>('/catalog/documents'),
    }).subscribe({
      next: ({ me, catalog }) => this.buildDocs(me.document_requirements ?? [], catalog.data ?? []),
      error: (err) => (this.error = this.messageFrom(err)),
    });
  }

  private buildDocs(reqs: DocumentRequirement[], catalog: CatalogDocument[]): void {
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

  onDocFile(doc: DocUi, slot: DocSlotUi, event: Event): void {
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
        slot.error = this.messageFrom(err);
      },
    });
  }

  slotDone(slot: DocSlotUi): boolean {
    return ['uploaded', 'pending', 'approved'].includes(slot.status);
  }

  get allDocsUploaded(): boolean {
    return this.docs.length > 0 && this.docs.every((d) => d.slots.every((s) => this.slotDone(s)));
  }

  finish(): void {
    void this.nav.navigateRoot('/carpool-signup/status', { animationDirection: 'forward' });
  }

  // ── Helpers ─────────────────────────────────────────────

  private prefill(me: DriverMe | null): void {
    if (!me) return;
    this.name = me.user?.name && me.user.name !== 'User' ? me.user.name : '';
    this.photoPreview = me.user?.avatar_url ?? null;
    const driver = me.driver;
    if (!driver || driver.driver_type !== 'carpool') return;
    if (driver.approval_status === 'approved') {
      this.finish();
      return;
    }
    this.cityId = driver.city_id;
    const car = driver.carpool_vehicle;
    if (car) {
      this.make = car.make;
      this.model = car.model;
      this.colour = car.colour;
      this.plate = car.plate;
      this.seats = car.seats;
      this.frontPreview = car.front_photo_url;
      this.interiorPreview = car.interior_photo_url;
      // Car already sent: carry on with the documents. Back still reaches the earlier steps.
      this.step = 5;
      this.loadDocuments();
    }
  }

  private messageFrom(err: any): string {
    const errors = err?.error?.errors as Record<string, string[]> | undefined;
    const first = errors ? Object.values(errors)[0]?.[0] : null;
    return first || err?.error?.message || 'Something went wrong. Check your connection and try again.';
  }
}
