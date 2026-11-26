import { Component, OnDestroy, OnInit } from '@angular/core';
import { NavController } from '@ionic/angular';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ApiService } from '../../../core/api.service';
import { AuthService } from '../../../core/auth.service';
import { DriverMe } from './carpool-signup.models';
import { DocSlotUi, DocUi, SignupDocs, messageFrom } from './signup-docs';

interface CityOpt { id: number; name: string }

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
  styleUrls: ['./carpool-signup.page.scss', './carpool-signup-look.scss'],
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

  /** Documents step: the list and uploads live in SignupDocs, shared with the Fix documents screen. */
  readonly docCtl: SignupDocs;
  get docs(): DocUi[] { return this.docCtl.docs; }

  /** Title and one line of text for the navy header, per step (mockup 1b to 1e). */
  get head(): { title: string; sub: string } {
    return {
      2: { title: 'Your profile', sub: 'Riders see your photo and first name. Use a clear photo of your face.' },
      3: { title: 'Your city', sub: "Where you'll offer carpools." },
      4: { title: 'Your car', sub: "The car you'll drive. It must be registered as private, not commercial." },
      5: { title: 'Your documents', sub: 'We check every document by hand before you can publish.' },
    }[this.step];
  }

  private objectUrls: string[] = [];

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private nav: NavController,
  ) {
    this.docCtl = new SignupDocs(api);
  }

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
    this.docCtl.load((msg) => (this.error = msg));
  }

  onDocFile(doc: DocUi, slot: DocSlotUi, event: Event): void {
    this.docCtl.upload(doc, slot, event);
  }

  slotDone(slot: DocSlotUi): boolean {
    return this.docCtl.slotDone(slot);
  }

  get allDocsUploaded(): boolean {
    return this.docCtl.allUploaded;
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
    return messageFrom(err);
  }

}
