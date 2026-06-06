import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { of, Subscription } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { CityContextService, CityOption } from '../../core/city-context.service';
import { GoogleMapsLoaderService } from '../../core/google-maps-loader.service';
import { ToastService } from '../../core/toast.service';
import {
  ButtonComponent,
  DrawerComponent,
  IconComponent,
  ModalComponent,
} from '../../ui';

interface LatLng {
  lat: number;
  lng: number;
}

interface CityForm {
  name: string;
  country_code: string;
  center_lat: string;
  center_lng: string;
  is_active: boolean;
}

/**
 * City Workspace — the hub for city basics.
 *
 * Top: city CRUD (create / edit / delete cities).
 * Below: the selected city's service-area map, where the geofence boundary
 * is drawn and edited.
 */
@Component({
  selector: 'app-city-workspace',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    IconComponent,
    ButtonComponent,
    DrawerComponent,
    ModalComponent,
  ],
  template: `
    <div class="cw">
      <!-- ===== Header / city basics ===== -->
      <header class="cw__head">
        <div>
          <h1 class="cw__title">City Workspace</h1>
          <p class="cw__sub">
            Set up and manage everything scoped to a city. Use the city switcher
            in the top bar to choose which city you are working on.
          </p>
        </div>
        <tm-button variant="green" (clicked)="openCreate()">
          <tm-icon name="plus" [size]="15" /> Add city
        </tm-button>
      </header>

      <!-- ===== City list ===== -->
      <section class="cw__cities">
        <div class="cw__cities-head">
          <span class="cw__overline">Cities</span>
          <span class="cw__count">{{ cities.length }}</span>
        </div>
        <div class="cw__city-grid">
          <article
            *ngFor="let c of cities"
            class="city-card"
            [class.is-current]="c.id === currentId"
            (click)="select(c.id)"
          >
            <div class="city-card__main">
              <span class="city-card__dot" [class.on]="c.id === currentId"></span>
              <span class="city-card__name">{{ c.name }}</span>
              <span class="city-card__tag" *ngIf="c.is_active === false">Inactive</span>
              <span class="city-card__tag city-card__tag--current" *ngIf="c.id === currentId">Current</span>
            </div>
            <div class="city-card__actions">
              <button type="button" class="icon-btn" (click)="openEdit(c, $event)" aria-label="Edit city">
                <tm-icon name="edit" [size]="15" />
              </button>
              <button type="button" class="icon-btn icon-btn--danger" (click)="askDelete(c, $event)" aria-label="Delete city">
                <tm-icon name="trash" [size]="15" />
              </button>
            </div>
          </article>
          <div *ngIf="cities.length === 0" class="cw__no-cities">
            No cities yet. Click <strong>Add city</strong> to create your first one.
          </div>
        </div>
      </section>

      <!-- ===== City map + geofencing ===== -->
      <section class="cw__mapcard" *ngIf="currentId != null">
        <div class="cw__map-head">
          <div class="cw__map-headtext">
            <span class="cw__overline">Service area</span>
            <span class="cw__map-meta">{{ mapMeta }}</span>
          </div>
          <div class="cw__map-actions">
            <tm-button
              *ngIf="!editingFence"
              variant="green"
              size="sm"
              icon="edit"
              (clicked)="startFenceEdit()"
            >{{ hasFence ? 'Edit boundary' : 'Draw boundary' }}</tm-button>
            <tm-button
              *ngIf="!editingFence && hasFence"
              variant="ghost"
              size="sm"
              icon="trash"
              [disabled]="savingFence"
              (clicked)="removeFence()"
            >Remove</tm-button>

            <ng-container *ngIf="editingFence">
              <tm-button variant="ghost" size="sm" icon="refresh"
                         [disabled]="!draftPolygon.length" (clicked)="undoFencePoint()">Undo</tm-button>
              <tm-button variant="ghost" size="sm" icon="trash"
                         [disabled]="!draftPolygon.length" (clicked)="clearFence()">Clear</tm-button>
              <tm-button variant="ghost" size="sm" (clicked)="cancelFenceEdit()">Cancel</tm-button>
              <tm-button variant="green" size="sm" icon="check"
                         [disabled]="draftPolygon.length < 3 || savingFence" (clicked)="saveFence()">
                {{ savingFence ? 'Saving…' : 'Save boundary' }}
              </tm-button>
            </ng-container>
          </div>
        </div>

        <div class="cw__edithint" *ngIf="editingFence">
          <tm-icon name="pin" [size]="14" />
          Click on the map to drop boundary points — add at least 3.
          <strong>{{ draftPolygon.length }}</strong> placed.
        </div>

        <div class="cw__map" #cityMap></div>
      </section>

      <div class="cw__pick-hint" *ngIf="currentId == null && cities.length > 0">
        Select a city above to manage its service area.
      </div>
    </div>

    <!-- ===== Create / edit drawer ===== -->
    <tm-drawer
      [open]="formOpen"
      [title]="editing ? 'Edit city' : 'Add city'"
      [subtitle]="editing ? editing.name : 'Create a new city'"
      (closed)="onDrawerClosed()"
    >
      <div slot="body" class="form">
        <label class="field">
          <span class="field__lbl">City name <i>*</i></span>
          <input #cityNameInput type="text" [(ngModel)]="form.name"
                 (ngModelChange)="onNameTyped()"
                 placeholder="Search a city on Google Maps…"
                 maxlength="60" autocomplete="off"
                 (keydown.enter)="$event.preventDefault()" />
          <span class="field__err" *ngIf="touched.name && !form.name.trim()">Name is required.</span>
          <span class="field__ok" *ngIf="form.center_lat && form.center_lng">
            <tm-icon name="pin" [size]="12" />
            Pinned · {{ form.center_lat | slice:0:8 }}, {{ form.center_lng | slice:0:8 }}
          </span>
          <span class="field__hint" *ngIf="!(form.center_lat && form.center_lng)">
            Start typing and pick a result so we can centre the map on it.
          </span>
        </label>

        <!-- Live map preview of the searched city -->
        <div class="drawer-map" #drawerMap></div>

        <label class="field">
          <span class="field__lbl">Country code <i>*</i></span>
          <input type="text" [(ngModel)]="form.country_code" (ngModelChange)="touched.cc = true"
                 placeholder="IN" maxlength="2" class="field--short" />
          <span class="field__err" *ngIf="touched.cc && form.country_code.trim().length !== 2">
            Use a 2-letter code (e.g. IN).
          </span>
        </label>

        <label class="toggle">
          <input type="checkbox" [(ngModel)]="form.is_active" />
          <span>City is active</span>
        </label>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="onDrawerClosed()">Cancel</tm-button>
        <tm-button variant="green" [disabled]="!formValid || saving" (clicked)="save()">
          {{ saving ? 'Saving…' : editing ? 'Save changes' : 'Create city' }}
        </tm-button>
      </div>
    </tm-drawer>

    <!-- ===== Delete confirm ===== -->
    <tm-modal
      [open]="!!deleteTarget"
      title="Delete city"
      (closed)="deleteTarget = null"
    >
      <div slot="body">
        <p>
          Delete <strong>{{ deleteTarget?.name }}</strong>? This removes the city and
          everything scoped to it (pricing, promotions, vehicle types, settings).
          This cannot be undone.
        </p>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="deleteTarget = null">Cancel</tm-button>
        <tm-button variant="danger" [disabled]="saving" (clicked)="confirmDelete()">
          {{ saving ? 'Deleting…' : 'Delete city' }}
        </tm-button>
      </div>
    </tm-modal>
  `,
  styles: [`
    .cw { display: flex; flex-direction: column; gap: 22px; }

    .cw__head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }
    .cw__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .cw__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); max-width: 560px; }

    .cw__overline {
      font-size: 11px; font-weight: 800; letter-spacing: 0.6px;
      text-transform: uppercase; color: var(--tm-text-muted);
    }
    .cw__count {
      font-size: 11px; font-weight: 800;
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
      padding: 2px 8px; border-radius: 999px;
    }

    .cw__cities-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .cw__city-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
      gap: 10px;
    }
    .city-card {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 12px 13px;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      cursor: pointer;
      transition: border-color var(--tm-duration-fast) var(--tm-ease),
                  box-shadow var(--tm-duration-fast) var(--tm-ease);
    }
    .city-card:hover { border-color: var(--tm-text-muted); }
    .city-card.is-current {
      border-color: var(--tm-green, #06b6d4);
      box-shadow: 0 0 0 1px var(--tm-green, #06b6d4) inset;
    }
    .city-card__main { display: flex; align-items: center; gap: 9px; min-width: 0; }
    .city-card__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--tm-line); flex: none; }
    .city-card__dot.on { background: var(--tm-green, #06b6d4); }
    .city-card__name {
      font-size: 14px; font-weight: 700; color: var(--tm-text);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .city-card__tag {
      font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.4px;
      color: var(--tm-text-muted); background: var(--tm-canvas-2);
      padding: 2px 6px; border-radius: 6px; flex: none;
    }
    .city-card__tag--current { color: var(--tm-green, #06b6d4); }
    .city-card__actions { display: flex; gap: 4px; flex: none; }

    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 30px; height: 30px; border-radius: 8px;
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
      cursor: pointer;
      transition: background var(--tm-duration-fast) var(--tm-ease), color var(--tm-duration-fast) var(--tm-ease);
    }
    .icon-btn:hover { background: var(--tm-ink); color: #fff; }
    .icon-btn--danger:hover { background: var(--tm-red, #ef4444); }

    .cw__no-cities {
      grid-column: 1 / -1;
      padding: 22px; text-align: center;
      font-size: 13px; color: var(--tm-text-muted);
      background: var(--tm-surface);
      border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
    }

    /* City map */
    .cw__mapcard {
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      overflow: hidden;
    }
    .cw__map-head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 10px; padding: 12px 16px;
      border-bottom: 1px solid var(--tm-line);
      flex-wrap: wrap;
    }
    .cw__map-headtext { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .cw__map-meta { font-size: 12px; color: var(--tm-text-muted); font-family: var(--tm-font-mono, monospace); }
    .cw__map-actions { display: flex; gap: 7px; flex-wrap: wrap; }
    .cw__edithint {
      display: flex; align-items: center; gap: 7px;
      padding: 9px 16px;
      font-size: 12px; font-weight: 600;
      color: var(--tm-info-fg, #1e40af);
      background: var(--tm-info-bg, #eff6ff);
      border-bottom: 1px solid var(--tm-line);
    }
    .cw__edithint strong { font-weight: 800; }
    .cw__map { width: 100%; height: 360px; background: var(--tm-canvas-2); }

    .cw__pick-hint {
      display: flex; align-items: center; gap: 8px; justify-content: center;
      padding: 24px; font-size: 13px; color: var(--tm-text-muted);
    }

    /* Drawer form */
    .form { display: flex; flex-direction: column; gap: 16px; }
    .field { display: flex; flex-direction: column; gap: 5px; }
    .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .field__lbl { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .field__lbl i { color: var(--tm-red, #ef4444); font-style: normal; }
    .field input {
      height: 38px; padding: 0 11px;
      border: 1px solid var(--tm-line); border-radius: 9px;
      background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13px; outline: none;
      transition: border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .field input:focus { border-color: var(--tm-green, #06b6d4); }
    .field--short { max-width: 110px; text-transform: uppercase; }
    .field__err { font-size: 11px; font-weight: 600; color: var(--tm-red, #ef4444); }
    .field__ok {
      display: flex; align-items: center; gap: 4px;
      font-size: 11px; font-weight: 700; color: var(--tm-success-fg, #15803d);
    }
    .field__hint { font-size: 11px; color: var(--tm-text-muted); }
    .form__hint { margin: 0; font-size: 11px; color: var(--tm-text-muted); }
    .drawer-map {
      width: 100%; height: 190px;
      border-radius: 10px;
      border: 1px solid var(--tm-line);
      background: var(--tm-canvas-2);
    }
    .toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--tm-text); }
    .toggle input { width: 16px; height: 16px; }

    @media (max-width: 640px) {
      .cw__head { flex-direction: column; }
      .field-row { grid-template-columns: 1fr; }
    }
  `],
})
export class CityWorkspaceComponent implements OnInit, OnDestroy {
  @ViewChild('cityMap') cityMapRef?: ElementRef<HTMLDivElement>;
  @ViewChild('drawerMap') drawerMapRef?: ElementRef<HTMLDivElement>;
  @ViewChild('cityNameInput') cityNameRef?: ElementRef<HTMLInputElement>;

  cities: CityOption[] = [];
  currentId: number | null = null;

  // Drawer / form state
  formOpen = false;
  editing: CityOption | null = null;
  saving = false;
  form: CityForm = this.blankForm();
  touched = { name: false, cc: false };

  // Delete state
  deleteTarget: CityOption | null = null;

  // Geofencing (boundary editing on the city map)
  editingFence = false;
  draftPolygon: LatLng[] = [];
  savingFence = false;

  // Map state
  private mapsReady = false;
  private cityMap: google.maps.Map | null = null;
  private cityMarker: google.maps.Marker | null = null;
  private cityPolygon: google.maps.Polygon | null = null;
  private vertexMarkers: google.maps.Marker[] = [];
  private fenceClickListener: google.maps.MapsEventListener | null = null;
  private drawerMapInst: google.maps.Map | null = null;
  private drawerMarker: google.maps.Marker | null = null;
  private placeAuto: google.maps.places.Autocomplete | null = null;
  private placeAutoListener: google.maps.MapsEventListener | null = null;
  private mapCity: any = {};

  private subs: Subscription[] = [];

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private cityCtx: CityContextService,
    private toast: ToastService,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
    private mapsLoader: GoogleMapsLoaderService,
  ) {}

  ngOnInit(): void {
    // Load Google Maps once for the city map + Places search; non-blocking.
    this.mapsLoader.load().then(() => (this.mapsReady = true)).catch(() => {});
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.subs.push(
      this.cityCtx.cities$.subscribe((list) => {
        this.cities = list;
        this.cdr.markForCheck();
      }),
      this.cityCtx.cityId$.subscribe((id) => {
        const changed = id !== this.currentId;
        this.currentId = id;
        if (changed) {
          // Switching cities discards any in-progress boundary edit.
          this.editingFence = false;
          this.savingFence = false;
          this.loadCity();
        }
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    this.detachAutocomplete();
    this.fenceClickListener?.remove();
    this.cityMarker?.setMap(null);
    this.cityPolygon?.setMap(null);
    this.vertexMarkers.forEach((m) => m.setMap(null));
  }

  /** Whether the selected city already has a saved boundary polygon. */
  get hasFence(): boolean {
    const poly = this.mapCity?.boundary_polygon;
    return Array.isArray(poly) && poly.length >= 3;
  }

  /** Human label for the city-map header. */
  get mapMeta(): string {
    if (this.editingFence) {
      return `Drawing boundary · ${this.draftPolygon.length} point${this.draftPolygon.length === 1 ? '' : 's'}`;
    }
    if (this.hasFence) {
      return `Service area · ${this.mapCity.boundary_polygon.length} boundary points`;
    }
    const lat = this.mapCity?.center_lat;
    const lng = this.mapCity?.center_lng;
    if (lat != null && lng != null) return `${(+lat).toFixed(4)}, ${(+lng).toFixed(4)} · no service area yet`;
    return 'No map centre set';
  }

  select(id: number): void {
    this.cityCtx.setCityId(id);
  }

  // ----- City record (drives the service-area map) -----
  private loadCity(): void {
    const id = this.currentId;
    if (id == null) return;
    this.api
      .get<any>(`/admin/cities/${id}`)
      .pipe(catchError(() => of(null)))
      .subscribe((res) => {
        this.renderCityOnMap(this.cityRecord(res));
        this.cdr.markForCheck();
      });
  }

  // ----- City map + geofencing -----
  private async renderCityOnMap(city: any): Promise<void> {
    this.mapCity = city || {};
    if (!this.mapsReady) {
      try { await this.mapsLoader.load(); this.mapsReady = true; } catch { return; }
    }
    // Wait a tick so the *ngIf-gated map container is in the DOM.
    setTimeout(() => {
      const el = this.cityMapRef?.nativeElement;
      if (!el || !window.google?.maps) return;
      this.ensureCityMap(el);

      // Outside edit mode the drawn polygon mirrors the saved boundary.
      if (!this.editingFence) this.draftPolygon = this.polygonOf(city);
      this.redrawFence();

      this.cityMarker?.setMap(null); this.cityMarker = null;
      const lat = city?.center_lat != null ? Number(city.center_lat) : null;
      const lng = city?.center_lng != null ? Number(city.center_lng) : null;
      const hasCenter = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
      if (hasCenter) {
        this.cityMarker = new google.maps.Marker({ position: { lat: lat!, lng: lng! }, map: this.cityMap });
      }

      // Camera: frame the polygon if there is one, else the centre.
      if (this.draftPolygon.length >= 3) {
        this.fitToPolygon(this.draftPolygon);
      } else if (hasCenter) {
        this.cityMap!.setCenter({ lat: lat!, lng: lng! });
        this.cityMap!.setZoom(12);
      } else {
        this.cityMap!.setCenter({ lat: 20.59, lng: 78.96 });
        this.cityMap!.setZoom(4);
      }
    }, 0);
  }

  /** Creates the city map once and wires the boundary-drawing click handler. */
  private ensureCityMap(el: HTMLElement): void {
    if (this.cityMap) return;
    this.cityMap = new google.maps.Map(el, {
      center: { lat: 20.59, lng: 78.96 }, zoom: 4,
      mapTypeControl: false, streetViewControl: false,
      fullscreenControl: false, clickableIcons: false,
    });
    this.fenceClickListener = this.cityMap.addListener('click', (ev: google.maps.MapMouseEvent) => {
      if (!this.editingFence || !ev.latLng) return;
      this.zone.run(() => {
        this.draftPolygon = [
          ...this.draftPolygon,
          { lat: ev.latLng!.lat(), lng: ev.latLng!.lng() },
        ];
        this.redrawFence();
      });
    });
  }

  /** Extracts a clean {lat,lng}[] from a city's boundary_polygon field. */
  private polygonOf(city: any): LatLng[] {
    const poly = Array.isArray(city?.boundary_polygon) ? city.boundary_polygon : [];
    return poly
      .map((p: any) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
      .filter((p: LatLng) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  }

  /** Redraws the boundary polygon, plus vertex dots while editing. */
  private redrawFence(): void {
    if (!this.cityMap) return;
    this.cityPolygon?.setMap(null); this.cityPolygon = null;
    this.vertexMarkers.forEach((m) => m.setMap(null)); this.vertexMarkers = [];

    const coords = this.draftPolygon;
    if (coords.length >= 3) {
      this.cityPolygon = new google.maps.Polygon({
        paths: coords, strokeColor: '#0891b2', strokeWeight: 2,
        fillColor: '#06b6d4', fillOpacity: 0.16, clickable: false,
      });
      this.cityPolygon.setMap(this.cityMap);
    }
    if (this.editingFence) {
      coords.forEach((p) => {
        this.vertexMarkers.push(new google.maps.Marker({
          position: p, map: this.cityMap!,
          icon: {
            path: google.maps.SymbolPath.CIRCLE, scale: 5,
            fillColor: '#ffffff', fillOpacity: 1,
            strokeColor: '#0891b2', strokeWeight: 2,
          },
        }));
      });
    }
  }

  private fitToPolygon(coords: LatLng[]): void {
    if (!this.cityMap || !coords.length) return;
    const b = new google.maps.LatLngBounds();
    coords.forEach((p) => b.extend(p));
    this.cityMap.fitBounds(b, 30);
  }

  // ----- Geofencing edit actions -----

  startFenceEdit(): void {
    if (this.currentId == null) return;
    this.editingFence = true;
    this.draftPolygon = this.polygonOf(this.mapCity);
    this.redrawFence();
  }

  cancelFenceEdit(): void {
    this.editingFence = false;
    this.draftPolygon = this.polygonOf(this.mapCity);
    this.redrawFence();
  }

  /** Clears the saved service-area boundary (sends a null polygon). */
  removeFence(): void {
    if (this.currentId == null || !this.hasFence || this.savingFence) return;
    this.savingFence = true;
    this.api
      .patch<any>(`/admin/cities/${this.currentId}/polygon`, { boundary_polygon: null })
      .subscribe({
        next: () => {
          this.savingFence = false;
          this.editingFence = false;
          this.draftPolygon = [];
          this.mapCity = { ...this.mapCity, boundary_polygon: null };
          this.redrawFence();
          this.toast.success('Service-area boundary removed');
          this.loadCity();
        },
        error: (err) => {
          this.savingFence = false;
          this.toast.error(err?.error?.message || 'Could not remove the boundary.');
        },
      });
  }

  undoFencePoint(): void {
    this.draftPolygon = this.draftPolygon.slice(0, -1);
    this.redrawFence();
  }

  clearFence(): void {
    this.draftPolygon = [];
    this.redrawFence();
  }

  saveFence(): void {
    if (this.currentId == null || this.draftPolygon.length < 3 || this.savingFence) return;
    this.savingFence = true;
    this.api
      .patch<any>(`/admin/cities/${this.currentId}/polygon`, { boundary_polygon: this.draftPolygon })
      .subscribe({
        next: () => {
          this.savingFence = false;
          this.editingFence = false;
          this.mapCity = { ...this.mapCity, boundary_polygon: [...this.draftPolygon] };
          this.toast.success('Service-area boundary saved');
          this.loadCity(); // refresh map framing
        },
        error: (err) => {
          this.savingFence = false;
          this.toast.error(err?.error?.message || 'Could not save the boundary.');
        },
      });
  }

  // ----- Drawer map + Places search -----
  private setupDrawer(): void {
    const go = () => {
      this.attachAutocomplete();
      const el = this.drawerMapRef?.nativeElement;
      if (el && window.google?.maps) {
        this.drawerMapInst = new google.maps.Map(el, {
          center: { lat: 20.59, lng: 78.96 }, zoom: 4,
          mapTypeControl: false, streetViewControl: false,
          fullscreenControl: false, clickableIcons: false,
        });
        this.updateDrawerMarker();
      }
    };
    if (this.mapsReady) { setTimeout(go, 320); return; }
    this.mapsLoader.load()
      .then(() => { this.mapsReady = true; setTimeout(go, 320); })
      .catch(() => {});
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
      types: ['(cities)'],
      fields: ['name', 'geometry', 'address_components'],
    });
    this.placeAutoListener = this.placeAuto.addListener('place_changed', () => {
      const place = this.placeAuto?.getPlace();
      if (!place?.geometry?.location) return;
      this.zone.run(() => {
        this.form.name = place.name || this.form.name;
        this.form.center_lat = String(place.geometry!.location!.lat());
        this.form.center_lng = String(place.geometry!.location!.lng());
        const cc = place.address_components?.find((c) => c.types.includes('country'))?.short_name;
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
    document.querySelectorAll('.pac-container').forEach((el) => el.remove());
  }

  onNameTyped(): void {
    this.touched.name = true;
    // Manual edits invalidate the previously-pinned coordinates.
    if (!this.form.name.trim()) {
      this.form.center_lat = '';
      this.form.center_lng = '';
      this.updateDrawerMarker();
    }
  }

  /**
   * Unwraps a single-city API payload to the bare record. The cities API
   * returns `{ city: {...} }`; some other paths use `{ data: {...} }`.
   */
  private cityRecord(res: any): any {
    return res?.city ?? res?.data ?? res ?? {};
  }

  // ----- City CRUD -----
  private blankForm(): CityForm {
    return { name: '', country_code: 'IN', center_lat: '', center_lng: '', is_active: true };
  }

  openCreate(): void {
    this.editing = null;
    this.form = this.blankForm();
    this.touched = { name: false, cc: false };
    this.formOpen = true;
    this.setupDrawer();
  }

  onDrawerClosed(): void {
    this.formOpen = false;
    this.detachAutocomplete();
    this.drawerMapInst = null;
    this.drawerMarker = null;
  }

  openEdit(c: CityOption, e: Event): void {
    e.stopPropagation();
    this.editing = c;
    this.touched = { name: false, cc: false };
    // Fetch full record so lat/lng/country are populated.
    this.api.get<any>(`/admin/cities/${c.id}`).subscribe({
      next: (res) => {
        const city = this.cityRecord(res);
        this.form = {
          name: city.name ?? c.name,
          country_code: city.country_code ?? 'IN',
          center_lat: city.center_lat != null ? String(city.center_lat) : '',
          center_lng: city.center_lng != null ? String(city.center_lng) : '',
          is_active: city.is_active !== false,
        };
        this.cdr.markForCheck();
        this.updateDrawerMarker();
      },
      error: () => {
        this.form = { ...this.blankForm(), name: c.name, is_active: c.is_active !== false };
      },
    });
    this.formOpen = true;
    this.setupDrawer();
  }

  get formValid(): boolean {
    return (
      !!this.form.name.trim() &&
      this.form.country_code.trim().length === 2
    );
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
    if (this.form.center_lat.trim()) body['center_lat'] = Number(this.form.center_lat);
    if (this.form.center_lng.trim()) body['center_lng'] = Number(this.form.center_lng);

    const req = this.editing
      ? this.api.patch<any>(`/admin/cities/${this.editing.id}`, body)
      : this.api.post<any>('/admin/cities', body);

    req.subscribe({
      next: (res) => {
        this.saving = false;
        this.onDrawerClosed();
        const wasEditing = !!this.editing;
        this.toast.success(wasEditing ? 'City updated' : 'City created');
        const created = this.cityRecord(res);
        this.cityCtx.ensureCitiesLoaded(true).subscribe(() => {
          if (!wasEditing && created?.id) this.cityCtx.setCityId(created.id);
          else this.loadCity();
        });
      },
      error: (err) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Could not save the city.');
      },
    });
  }

  askDelete(c: CityOption, e: Event): void {
    e.stopPropagation();
    this.deleteTarget = c;
  }

  confirmDelete(): void {
    const c = this.deleteTarget;
    if (!c || this.saving) return;
    this.saving = true;
    this.api.delete(`/admin/cities/${c.id}`).subscribe({
      next: () => {
        this.saving = false;
        this.deleteTarget = null;
        this.toast.success(`${c.name} deleted`);
        this.cityCtx.ensureCitiesLoaded(true).subscribe();
      },
      error: (err) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Could not delete the city.');
      },
    });
  }
}
