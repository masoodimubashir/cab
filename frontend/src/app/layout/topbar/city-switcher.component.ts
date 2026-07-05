import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ButtonComponent, DrawerComponent, IconComponent } from '../../ui';
import { ApiService } from '../../core/api.service';
import { CityContextService, CityOption } from '../../core/city-context.service';
import { GoogleMapsLoaderService } from '../../core/google-maps-loader.service';
import { ToastService } from '../../core/toast.service';

interface CityForm {
  name: string;
  country_code: string;
  center_lat: string;
  center_lng: string;
  is_active: boolean;
}

/**
 * Global city switcher — the single control that scopes the whole admin.
 * Lives in the topbar. Every city-scoped page observes CityContextService;
 * changing the city here re-scopes them all.
 *
 * Scoped managers (CityContextService.isLocked) see a read-only label.
 */
@Component({
  selector: 'tm-city-switcher',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, ButtonComponent, DrawerComponent, IconComponent],
  template: `
    <!-- Locked: scoped managers can't switch -->
    <div class="cs cs--locked" *ngIf="locked">
      <tm-icon name="pin" [size]="15" />
      <span class="cs__name">{{ currentName || 'No city' }}</span>
      <span class="cs__lock-tag">Scoped</span>
    </div>

    <!-- Switchable: super admin -->
    <div class="cs" *ngIf="!locked">
      <button
        type="button"
        class="cs__btn"
        [class.is-open]="open"
        [attr.aria-expanded]="open"
        aria-haspopup="listbox"
        (click)="toggle($event)"
      >
        <tm-icon name="pin" [size]="15" />
        <span class="cs__name">{{ currentName || 'Select city' }}</span>
        <tm-icon class="cs__caret" name="chevron-down" [size]="14" />
      </button>

      <button type="button" class="cs__mini" (click)="openCreate($event)" title="Add city" aria-label="Add city">
        <tm-icon name="plus" [size]="15" />
      </button>
      <button type="button" class="cs__mini" [disabled]="!currentCity" (click)="openEdit($event)" title="Edit selected city" aria-label="Edit selected city">
        <tm-icon name="edit" [size]="15" />
      </button>

      <div class="cs__pop" *ngIf="open" role="listbox">
        <div class="cs__search">
          <tm-icon name="search" [size]="14" />
          <input
            #searchBox
            type="text"
            [(ngModel)]="filter"
            placeholder="Search city…"
            autocomplete="off"
          />
        </div>
        <ul class="cs__list">
          <li
            *ngFor="let c of filtered()"
            class="cs__item"
            [class.is-active]="c.id === currentId"
            role="option"
            [attr.aria-selected]="c.id === currentId"
            (click)="pick(c)"
          >
            <span class="cs__dot" [class.on]="c.id === currentId"></span>
            <span class="cs__item-name">{{ c.name }}</span>
            <span class="cs__inactive" *ngIf="c.is_active === false">inactive</span>
            <tm-icon *ngIf="c.id === currentId" name="check" [size]="14" />
          </li>
          <li *ngIf="filtered().length === 0" class="cs__empty">No cities found</li>
        </ul>
      </div>
    </div>

    <tm-drawer
      [open]="formOpen"
      [width]="640"
      [title]="drawerTitle"
      [subtitle]="drawerSubtitle"
      (closed)="closeForm()"
    >
      <div slot="body" class="city-form">
        <label class="city-field">
          <span class="city-field__label">City name <i>*</i></span>
          <input
            #cityNameInput
            type="text"
            [(ngModel)]="form.name"
            (ngModelChange)="onNameTyped()"
            placeholder="Search a city on Google Maps..."
            maxlength="60"
            autocomplete="off"
            (keydown.enter)="$event.preventDefault()"
          />
          <span class="city-field__err" *ngIf="touched.name && !form.name.trim()">Name is required.</span>
          <span class="city-field__ok" *ngIf="form.center_lat && form.center_lng">
            <tm-icon name="pin" [size]="12" />
            Pinned · {{ form.center_lat | slice:0:8 }}, {{ form.center_lng | slice:0:8 }}
          </span>
          <span class="city-field__hint" *ngIf="!(form.center_lat && form.center_lng)">
            Pick a city result so the map can be centred correctly.
          </span>
        </label>

        <div class="city-map" #drawerMap></div>

        <div class="city-grid">
          <label class="city-field">
            <span class="city-field__label">Country code <i>*</i></span>
            <input type="text" [(ngModel)]="form.country_code" (ngModelChange)="touched.cc = true" placeholder="IN" maxlength="2" />
            <span class="city-field__err" *ngIf="touched.cc && form.country_code.trim().length !== 2">
              Use a 2-letter code.
            </span>
          </label>

          <label class="city-toggle">
            <input type="checkbox" [(ngModel)]="form.is_active" />
            <span>City is active</span>
          </label>
        </div>
      </div>

      <div slot="footer">
        <tm-button variant="ghost" (clicked)="closeForm()">Cancel</tm-button>
        <tm-button variant="green" [disabled]="!formValid || saving" (clicked)="save()">
          {{ saving ? "Saving..." : editing ? "Save changes" : "Create city" }}
        </tm-button>
      </div>
    </tm-drawer>
  `,
  styles: [`
    :host { display: inline-flex; }

    .cs { position: relative; display: inline-flex; align-items: center; gap: 6px; }

    .cs--locked,
    .cs__btn {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      height: 36px;
      padding: 0 12px;
      border-radius: var(--tm-radius-md, 10px);
      background: var(--tm-canvas-2);
      color: var(--tm-text);
      font-size: 13px;
      font-weight: 700;
    }
    .cs__btn {
      cursor: pointer;
      border: 1px solid transparent;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .cs__btn:hover { background: var(--tm-line); }
    .cs__btn.is-open { border-color: var(--tm-green, #06b6d4); }
    .cs__mini {
      display: inline-flex; align-items: center; justify-content: center;
      width: 36px; height: 36px; border-radius: var(--tm-radius-md, 10px);
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
      border: 1px solid transparent; cursor: pointer;
      transition: background var(--tm-duration-fast) var(--tm-ease), color var(--tm-duration-fast) var(--tm-ease);
    }
    .cs__mini:hover:not(:disabled) { background: var(--tm-ink); color: #fff; }
    .cs__mini:disabled { opacity: 0.45; cursor: not-allowed; }
    .cs__name { white-space: nowrap; }
    .cs__caret { color: var(--tm-text-muted); }

    .cs__lock-tag {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.4px;
      text-transform: uppercase;
      color: var(--tm-text-muted);
      background: var(--tm-surface);
      padding: 2px 6px;
      border-radius: 6px;
    }

    .cs__pop {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      width: 248px;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      box-shadow: var(--tm-shadow-pop);
      z-index: 1200;
      overflow: hidden;
      animation: cs-pop var(--tm-duration-fast) var(--tm-ease) both;
    }
    @keyframes cs-pop {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .cs__search {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--tm-line);
      color: var(--tm-text-muted);
    }
    .cs__search input {
      flex: 1;
      border: none;
      outline: none;
      background: transparent;
      font-size: 13px;
      color: var(--tm-text);
    }

    .cs__list {
      list-style: none;
      margin: 0;
      padding: 6px;
      max-height: 280px;
      overflow-y: auto;
    }
    .cs__item {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 8px 9px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      color: var(--tm-text);
      cursor: pointer;
    }
    .cs__item:hover { background: var(--tm-canvas-2); }
    .cs__item.is-active { background: var(--tm-canvas-2); }
    .cs__item-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cs__dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--tm-line);
      flex: none;
    }
    .cs__dot.on { background: var(--tm-green, #06b6d4); }
    .cs__inactive {
      font-size: 10px;
      font-weight: 700;
      color: var(--tm-text-muted);
    }
    .cs__empty {
      padding: 14px 10px;
      font-size: 12px;
      color: var(--tm-text-muted);
      text-align: center;
    }

    .city-form { display: flex; flex-direction: column; gap: 16px; }
    .city-field { display: flex; flex-direction: column; gap: 5px; }
    .city-field__label { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .city-field__label i { color: var(--tm-red, #ef4444); font-style: normal; }
    .city-field input {
      height: 40px; padding: 0 12px; border: 1px solid var(--tm-line); border-radius: 9px;
      background: var(--tm-canvas); color: var(--tm-text); font-size: 13px; outline: none;
      transition: border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .city-field input:focus { border-color: var(--tm-green, #06b6d4); }
    .city-field__err { font-size: 11px; font-weight: 600; color: var(--tm-red, #ef4444); }
    .city-field__ok { display: flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; color: var(--tm-success-fg, #15803d); }
    .city-field__hint { font-size: 11px; color: var(--tm-text-muted); }
    .city-map {
      width: 100%; height: 320px; border-radius: 12px; border: 1px solid var(--tm-line);
      background: var(--tm-canvas-2); overflow: hidden;
    }
    .city-grid { display: grid; grid-template-columns: minmax(140px, 180px) 1fr; gap: 16px; align-items: start; }
    .city-grid .city-field input { text-transform: uppercase; }
    .city-toggle {
      display: flex; align-items: center; gap: 8px; min-height: 40px; margin-top: 21px;
      font-size: 13px; font-weight: 700; color: var(--tm-text);
    }
    .city-toggle input { width: 16px; height: 16px; }

    @media (max-width: 640px) {
      .cs__name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
      .city-grid { grid-template-columns: 1fr; }
      .city-toggle { margin-top: 0; }
      .city-map { height: 260px; }
    }
  `],
})
export class CitySwitcherComponent implements OnInit, OnDestroy {
  @ViewChild("drawerMap") drawerMapRef?: ElementRef<HTMLDivElement>;
  @ViewChild("cityNameInput") cityNameRef?: ElementRef<HTMLInputElement>;
  cities: CityOption[] = [];
  currentId: number | null = null;
  open = false;
  filter = "";

  formOpen = false;
  editing: CityOption | null = null;
  saving = false;
  form: CityForm = this.blankForm();
  touched = { name: false, cc: false };

  private mapsReady = false;
  private drawerMapInst: google.maps.Map | null = null;
  private drawerMarker: google.maps.Marker | null = null;
  private placeAuto: google.maps.places.Autocomplete | null = null;
  private placeAutoListener: google.maps.MapsEventListener | null = null;
  private subs: Subscription[] = [];

  private readonly cityMapStyles: google.maps.MapTypeStyle[] = [
    { featureType: "road", stylers: [{ visibility: "off" }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] },
    { featureType: "landscape.natural", stylers: [{ visibility: "off" }] },
    { featureType: "poi", elementType: "geometry", stylers: [{ visibility: "off" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#dbeafe" }] },
    { featureType: "administrative", elementType: "geometry", stylers: [{ visibility: "simplified" }] },
  ];

  constructor(
    public cityCtx: CityContextService,
    private api: ApiService,
    private host: ElementRef<HTMLElement>,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
    private mapsLoader: GoogleMapsLoaderService,
    private toast: ToastService,
  ) {}

  get locked(): boolean {
    return this.cityCtx.isLocked;
  }

  get currentName(): string {
    return this.currentCity?.name ?? "";
  }

  get currentCity(): CityOption | null {
    return this.cities.find((c) => c.id === this.currentId) ?? null;
  }

  get drawerTitle(): string {
    return this.editing ? "Edit city" : "Add city";
  }

  get drawerSubtitle(): string {
    return this.editing?.name || "Search and pin the city location";
  }

  ngOnInit(): void {
    this.mapsLoader.load().then(() => (this.mapsReady = true)).catch(() => {});
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.subs.push(
      this.cityCtx.cities$.subscribe((list) => {
        this.cities = list;
        this.cdr.markForCheck();
      }),
      this.cityCtx.cityId$.subscribe((id) => {
        this.currentId = id;
        this.cdr.markForCheck();
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    this.detachAutocomplete();
    this.drawerMarker?.setMap(null);
    this.drawerMapInst = null;
  }

  filtered(): CityOption[] {
    const q = this.filter.trim().toLowerCase();
    return q ? this.cities.filter((c) => c.name.toLowerCase().includes(q)) : this.cities;
  }

  toggle(e: Event): void {
    e.stopPropagation();
    this.open = !this.open;
    if (!this.open) this.filter = '';
  }

  pick(c: CityOption): void {
    this.cityCtx.setCityId(c.id);
    this.open = false;
    this.filter = '';
  }

  private blankForm(): CityForm {
    return { name: "", country_code: "IN", center_lat: "", center_lng: "", is_active: true };
  }

  openCreate(e?: Event): void {
    e?.stopPropagation();
    this.open = false;
    this.editing = null;
    this.form = this.blankForm();
    this.touched = { name: false, cc: false };
    this.formOpen = true;
    this.setupDrawer();
  }

  openEdit(e?: Event): void {
    e?.stopPropagation();
    const current = this.currentCity;
    if (!current) return;
    this.open = false;
    this.editing = current;
    this.touched = { name: false, cc: false };
    this.form = { ...this.blankForm(), name: current.name, is_active: current.is_active !== false };
    this.formOpen = true;
    this.setupDrawer();

    this.api.get<any>("/admin/cities/" + current.id).subscribe({
      next: (res) => {
        const city = this.cityRecord(res);
        this.form = {
          name: city.name ?? current.name,
          country_code: city.country_code ?? "IN",
          center_lat: city.center_lat != null ? String(city.center_lat) : "",
          center_lng: city.center_lng != null ? String(city.center_lng) : "",
          is_active: city.is_active !== false,
        };
        this.cdr.markForCheck();
        this.updateDrawerMarker();
      },
      error: () => this.toast.error("Could not load the selected city."),
    });
  }

  closeForm(): void {
    this.formOpen = false;
    this.detachAutocomplete();
    this.drawerMarker?.setMap(null);
    this.drawerMarker = null;
    this.drawerMapInst = null;
  }

  get formValid(): boolean {
    return !!this.form.name.trim() && this.form.country_code.trim().length === 2;
  }

  save(): void {
    this.touched = { name: true, cc: true };
    if (!this.formValid || this.saving) return;
    this.saving = true;

    const body: Record<string, unknown> = {
      name: this.form.name.trim(),
      country_code: this.form.country_code.trim().toUpperCase(),
      is_active: this.form.is_active,
    };
    if (this.form.center_lat.trim()) body["center_lat"] = Number(this.form.center_lat);
    if (this.form.center_lng.trim()) body["center_lng"] = Number(this.form.center_lng);

    const req = this.editing
      ? this.api.patch<any>("/admin/cities/" + this.editing.id, body)
      : this.api.post<any>("/admin/cities", body);

    req.subscribe({
      next: (res) => {
        const wasEditing = !!this.editing;
        const saved = this.cityRecord(res);
        this.saving = false;
        this.closeForm();
        this.toast.success(wasEditing ? "City updated" : "City created");
        this.cityCtx.ensureCitiesLoaded(true).subscribe(() => {
          if (saved?.id) this.cityCtx.setCityId(saved.id);
        });
      },
      error: (err) => {
        this.saving = false;
        this.toast.error(err?.error?.message || "Could not save the city.");
      },
    });
  }

  private setupDrawer(): void {
    const go = () => {
      this.attachAutocomplete();
      const el = this.drawerMapRef?.nativeElement;
      if (!el || !window.google?.maps) return;
      this.drawerMapInst = new google.maps.Map(el, {
        center: { lat: 20.59, lng: 78.96 },
        zoom: 4,
        styles: this.cityMapStyles,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
        disableDefaultUI: true,
        zoomControl: true,
      });
      this.updateDrawerMarker();
    };

    if (this.mapsReady) { setTimeout(go, 320); return; }
    this.mapsLoader.load()
      .then(() => { this.mapsReady = true; setTimeout(go, 320); })
      .catch(() => this.toast.error("Could not load Google Maps."));
  }

  private updateDrawerMarker(): void {
    if (!this.drawerMapInst) return;
    this.drawerMarker?.setMap(null);
    this.drawerMarker = null;
    const lat = this.form.center_lat ? Number(this.form.center_lat) : null;
    const lng = this.form.center_lng ? Number(this.form.center_lng) : null;
    if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
      this.drawerMapInst.setCenter({ lat, lng });
      this.drawerMapInst.setZoom(11);
      this.drawerMarker = new google.maps.Marker({ position: { lat, lng }, map: this.drawerMapInst });
    }
  }

  private attachAutocomplete(): void {
    const el = this.cityNameRef?.nativeElement;
    if (!el || !window.google?.maps?.places) return;
    this.detachAutocomplete();
    this.placeAuto = new google.maps.places.Autocomplete(el, {
      types: ["(cities)"],
      fields: ["name", "geometry", "address_components"],
    });
    this.placeAutoListener = this.placeAuto.addListener("place_changed", () => {
      const place = this.placeAuto?.getPlace();
      if (!place?.geometry?.location) return;
      this.zone.run(() => {
        this.form.name = place.name || this.form.name;
        this.form.center_lat = String(place.geometry!.location!.lat());
        this.form.center_lng = String(place.geometry!.location!.lng());
        const cc = place.address_components?.find((c) => c.types.includes("country"))?.short_name;
        if (cc) this.form.country_code = cc;
        this.touched.name = true;
        this.updateDrawerMarker();
        this.cdr.markForCheck();
      });
    });
  }

  private detachAutocomplete(): void {
    this.placeAutoListener?.remove();
    this.placeAutoListener = null;
    this.placeAuto = null;
    document.querySelectorAll(".pac-container").forEach((el) => el.remove());
  }

  onNameTyped(): void {
    this.touched.name = true;
    if (!this.form.name.trim()) {
      this.form.center_lat = "";
      this.form.center_lng = "";
      this.updateDrawerMarker();
    }
  }

  private cityRecord(res: any): any {
    return res?.city ?? res?.data ?? res ?? {};
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent): void {
    if (this.open && !this.host.nativeElement.contains(e.target as Node)) {
      this.open = false;
      this.cdr.markForCheck();
    }
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.open) {
      this.open = false;
      this.cdr.markForCheck();
    }
  }
}
