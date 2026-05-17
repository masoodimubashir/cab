import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { ApiService } from '../../core/api.service';
import { GoogleMapsLoaderService } from '../../core/google-maps-loader.service';

interface PolygonPoint {
  lat: number;
  lng: number;
}

interface City {
  id: number;
  name: string;
  country_code: string | null;
  center_lat: number | null;
  center_lng: number | null;
  boundary_polygon: PolygonPoint[] | null;
  is_active: boolean;
}

@Component({
  selector: 'app-geofencing',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, ButtonModule, InputTextModule, TagModule],
  template: `
    <p-card header="Geofencing">
      <div class="layout">
        <aside class="cities">
          <div class="cities__header">
            <span class="cities__title">Cities</span>
            <button pButton type="button" icon="pi pi-plus" label="Add" (click)="openAdd()"></button>
          </div>

          <div *ngIf="adding" class="add-form">
            <input
              #searchInput
              pInputText
              [(ngModel)]="newCityName"
              placeholder="Search a city on Google Maps…"
              autocomplete="off"
              (keydown.enter)="$event.preventDefault()"
            />
            <div *ngIf="pickedCenter" class="hint muted">
              📍 {{ pickedCenter.lat | number:'1.4-4' }}, {{ pickedCenter.lng | number:'1.4-4' }}
            </div>
            <div *ngIf="!pickedCenter && newCityName.trim()" class="hint muted">
              Pick a result from the dropdown so we can center the map on it.
            </div>
            <div class="add-form__actions">
              <button pButton type="button" label="Cancel" class="p-button-text" (click)="cancelAdd()"></button>
              <button
                pButton
                type="button"
                label="Save"
                [disabled]="!newCityName.trim() || saving"
                (click)="confirmAdd()"
              ></button>
            </div>
          </div>

          <div class="cities__list">
            <div *ngIf="!cities.length && !loading" class="empty">No cities yet. Click Add to create one.</div>
            <div
              *ngFor="let c of cities"
              class="city-row"
              [class.selected]="selected?.id === c.id"
              (click)="selectCity(c)"
            >
              <div class="city-row__main">
                <div class="city-row__name">{{ c.name }}</div>
                <div class="city-row__meta">
                  <p-tag
                    [value]="c.boundary_polygon?.length ? 'fenced' : 'no fence'"
                    [severity]="c.boundary_polygon?.length ? 'success' : 'warning'"
                  ></p-tag>
                  <span *ngIf="c.boundary_polygon?.length" class="muted">
                    {{ c.boundary_polygon!.length }} pts
                  </span>
                </div>
              </div>
              <button
                pButton
                type="button"
                icon="pi pi-trash"
                class="p-button-text p-button-danger p-button-sm"
                (click)="deleteCity(c, $event)"
              ></button>
            </div>
          </div>
        </aside>

        <section class="map-side">
          <div class="map-toolbar">
            <ng-container *ngIf="selected; else pickHint">
              <span class="hint">
                <strong>{{ selected.name }}</strong>
                <ng-container *ngIf="editing">
                  — click on the map to add vertices ({{ draftPolygon.length }} so far).
                </ng-container>
                <ng-container *ngIf="!editing && selected.boundary_polygon?.length">
                  — service area: {{ selected.boundary_polygon!.length }} points.
                </ng-container>
                <ng-container *ngIf="!editing && !selected.boundary_polygon?.length">
                  — no fence yet.
                </ng-container>
              </span>
              <button
                *ngIf="!editing"
                pButton
                type="button"
                icon="pi pi-pencil"
                label="Edit Polygon"
                (click)="startEdit()"
              ></button>
              <ng-container *ngIf="editing">
                <button
                  pButton
                  type="button"
                  icon="pi pi-undo"
                  label="Undo"
                  class="p-button-text"
                  [disabled]="!draftPolygon.length"
                  (click)="undoPoint()"
                ></button>
                <button
                  pButton
                  type="button"
                  icon="pi pi-trash"
                  label="Clear"
                  class="p-button-text p-button-danger"
                  [disabled]="!draftPolygon.length"
                  (click)="clearPolygon()"
                ></button>
                <button pButton type="button" label="Cancel" class="p-button-text" (click)="cancelEdit()"></button>
                <button
                  pButton
                  type="button"
                  label="Save"
                  [disabled]="draftPolygon.length < 3 || saving"
                  (click)="savePolygon()"
                ></button>
              </ng-container>
            </ng-container>
            <ng-template #pickHint>
              <span class="hint">Pick a city on the left, then click <em>Edit Polygon</em>.</span>
            </ng-template>
          </div>
          <div class="map-shell" #mapContainer></div>
        </section>
      </div>

      <div *ngIf="error" class="error">{{ error }}</div>
      <div *ngIf="message" class="ok">{{ message }}</div>
    </p-card>
  `,
  styles: [
    `
      .layout {
        display: grid;
        grid-template-columns: 320px 1fr;
        gap: 18px;
        min-height: 560px;
      }
      .cities {
        display: flex;
        flex-direction: column;
        background: rgba(248, 250, 252, 0.7);
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 12px;
        padding: 12px;
        min-height: 0;
      }
      .cities__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      .cities__title {
        font-weight: 800;
        color: #0f172a;
      }
      .add-form {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 10px;
        padding: 10px;
        border: 1px dashed rgba(59, 130, 246, 0.4);
        border-radius: 8px;
        background: rgba(59, 130, 246, 0.05);
      }
      .add-form__actions {
        display: flex;
        gap: 6px;
        justify-content: flex-end;
      }
      .cities__list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        overflow: auto;
        flex: 1;
      }
      .city-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 10px;
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 8px;
        background: #fff;
        cursor: pointer;
      }
      .city-row.selected {
        border-color: #3b82f6;
        background: rgba(59, 130, 246, 0.08);
      }
      .city-row__name {
        font-weight: 700;
        color: #0f172a;
      }
      .city-row__meta {
        display: flex;
        gap: 6px;
        align-items: center;
        margin-top: 4px;
      }
      .map-side {
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      .map-toolbar {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-bottom: 8px;
        flex-wrap: wrap;
      }
      .hint {
        font-size: 13px;
        color: rgba(15, 23, 42, 0.7);
        flex: 1;
      }
      .map-shell {
        flex: 1;
        min-height: 480px;
        border-radius: 12px;
        border: 1px solid rgba(15, 23, 42, 0.1);
      }
      .muted {
        font-size: 12px;
        color: rgba(15, 23, 42, 0.55);
      }
      .empty {
        color: rgba(15, 23, 42, 0.55);
        font-size: 13px;
        text-align: center;
        padding: 12px;
      }
      .error {
        margin-top: 12px;
        color: #b00020;
        font-weight: 700;
      }
      .ok {
        margin-top: 12px;
        color: #1f8b4c;
        font-weight: 700;
      }

      @media (max-width: 980px) {
        .layout {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class GeofencingComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: false }) mapContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('searchInput', { static: false }) searchInput?: ElementRef<HTMLInputElement>;

  cities: City[] = [];
  selected: City | null = null;
  editing = false;
  adding = false;
  newCityName = '';
  pickedCenter: PolygonPoint | null = null;
  draftPolygon: PolygonPoint[] = [];

  loading = false;
  saving = false;
  error: string | null = null;
  message: string | null = null;

  private map: google.maps.Map | null = null;
  private polygonLayer: google.maps.Polygon | null = null;
  private vertexMarkers: google.maps.Marker[] = [];
  private clickListener: google.maps.MapsEventListener | null = null;
  private mapsReady = false;
  private autocomplete: google.maps.places.Autocomplete | null = null;
  private autocompleteListener: google.maps.MapsEventListener | null = null;
  private pickedViewport: google.maps.LatLngBounds | null = null;

  constructor(
    private api: ApiService,
    private zone: NgZone,
    private mapsLoader: GoogleMapsLoaderService,
  ) {}

  ngOnInit(): void {
    this.fetch();
  }

  ngAfterViewInit(): void {
    void this.initMap();
  }

  ngOnDestroy(): void {
    this.clickListener?.remove();
    this.polygonLayer?.setMap(null);
    this.vertexMarkers.forEach((m) => m.setMap(null));
    this.detachAutocomplete();
  }

  // ───── city list actions ─────

  openAdd(): void {
    this.adding = true;
    this.newCityName = '';
    this.pickedCenter = null;
    this.pickedViewport = null;
    setTimeout(() => this.attachAutocomplete(), 0);
  }

  cancelAdd(): void {
    this.adding = false;
    this.newCityName = '';
    this.pickedCenter = null;
    this.pickedViewport = null;
    this.detachAutocomplete();
  }

  confirmAdd(): void {
    const name = this.newCityName.trim();
    if (!name || this.saving) return;
    this.saving = true;
    this.error = null;

    const payload: Record<string, unknown> = { name };
    if (this.pickedCenter) {
      payload['center_lat'] = this.pickedCenter.lat;
      payload['center_lng'] = this.pickedCenter.lng;
    }

    this.api.post<{ city: City }>('/admin/cities', payload).subscribe({
      next: (res) => {
        this.cities = [...this.cities, res.city].sort((a, b) => a.name.localeCompare(b.name));
        this.adding = false;
        this.newCityName = '';
        this.message = `Added ${res.city.name}. Click on the map to draw the service area.`;
        this.selectCity(res.city);
        // Auto-enter draw mode so the user can immediately start fencing.
        this.editing = true;
        this.draftPolygon = [];
        this.redrawPolygon([]);
        this.detachAutocomplete();
      },
      error: (err) => (this.error = err?.error?.message || 'Failed to add city'),
      complete: () => (this.saving = false),
    });
  }

  private attachAutocomplete(): void {
    const input = this.searchInput?.nativeElement;
    if (!input || !this.mapsReady || !window.google?.maps?.places) return;
    this.detachAutocomplete();

    this.autocomplete = new google.maps.places.Autocomplete(input, {
      types: ['(cities)'],
      fields: ['name', 'formatted_address', 'geometry'],
    });
    this.autocompleteListener = this.autocomplete.addListener('place_changed', () => {
      const place = this.autocomplete?.getPlace();
      if (!place || !place.geometry?.location) return;
      this.zone.run(() => {
        this.newCityName = place.name || place.formatted_address || this.newCityName;
        this.pickedCenter = {
          lat: place.geometry!.location!.lat(),
          lng: place.geometry!.location!.lng(),
        };
        this.pickedViewport = place.geometry?.viewport ?? null;
        // Live-pan the map so the admin sees where the city is right away.
        if (this.map) {
          if (this.pickedViewport) {
            this.map.fitBounds(this.pickedViewport, 40);
          } else {
            this.map.setCenter(this.pickedCenter);
            this.map.setZoom(12);
          }
        }
      });
    });
  }

  private detachAutocomplete(): void {
    this.autocompleteListener?.remove();
    this.autocompleteListener = null;
    this.autocomplete = null;
    // Drop the autocomplete dropdown DOM left over by Google.
    document.querySelectorAll('.pac-container').forEach((el) => el.remove());
  }

  deleteCity(c: City, ev: Event): void {
    ev.stopPropagation();
    if (!window.confirm(`Delete city "${c.name}"? This will leave existing trips and pricing rules unlinked.`)) {
      return;
    }
    this.api.delete(`/admin/cities/${c.id}`).subscribe({
      next: () => {
        this.cities = this.cities.filter((x) => x.id !== c.id);
        if (this.selected?.id === c.id) {
          this.selected = null;
          this.editing = false;
          this.draftPolygon = [];
          this.redrawPolygon([]);
        }
        this.message = `Deleted ${c.name}.`;
      },
      error: (err) => (this.error = err?.error?.message || 'Failed to delete city'),
    });
  }

  selectCity(c: City): void {
    if (this.editing && !window.confirm('Discard unsaved polygon changes?')) return;
    this.editing = false;
    this.selected = c;
    this.draftPolygon = c.boundary_polygon ? [...c.boundary_polygon] : [];
    this.redrawPolygon(this.draftPolygon);
    if (this.draftPolygon.length) {
      this.fitToPolygon(this.draftPolygon);
    } else if (c.center_lat != null && c.center_lng != null && this.map) {
      this.map.setCenter({ lat: c.center_lat, lng: c.center_lng });
      this.map.setZoom(12);
    }
  }

  // ───── polygon edit mode ─────

  startEdit(): void {
    if (!this.selected) return;
    this.editing = true;
    this.draftPolygon = this.selected.boundary_polygon ? [...this.selected.boundary_polygon] : [];
    this.redrawPolygon(this.draftPolygon);
  }

  cancelEdit(): void {
    if (!this.selected) return;
    this.editing = false;
    this.draftPolygon = this.selected.boundary_polygon ? [...this.selected.boundary_polygon] : [];
    this.redrawPolygon(this.draftPolygon);
  }

  undoPoint(): void {
    this.draftPolygon = this.draftPolygon.slice(0, -1);
    this.redrawPolygon(this.draftPolygon);
  }

  clearPolygon(): void {
    this.draftPolygon = [];
    this.redrawPolygon(this.draftPolygon);
  }

  savePolygon(): void {
    if (!this.selected || this.draftPolygon.length < 3 || this.saving) return;
    this.saving = true;
    this.error = null;
    this.api
      .patch<{ city: City }>(`/admin/cities/${this.selected.id}/polygon`, {
        boundary_polygon: this.draftPolygon,
      })
      .subscribe({
        next: (res) => {
          const updated = res.city;
          this.cities = this.cities.map((c) => (c.id === updated.id ? updated : c));
          this.selected = updated;
          this.editing = false;
          this.message = `Saved fence for ${updated.name}.`;
        },
        error: (err) => (this.error = err?.error?.message || 'Failed to save polygon'),
        complete: () => (this.saving = false),
      });
  }

  // ───── data ─────

  private fetch(): void {
    this.loading = true;
    this.api.get<{ data: City[] }>('/admin/cities').subscribe({
      next: (res) => {
        this.cities = (res?.data || []).sort((a, b) => a.name.localeCompare(b.name));
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load cities';
        this.loading = false;
      },
    });
  }

  // ───── map ─────

  private async initMap(): Promise<void> {
    if (!this.mapContainer?.nativeElement) return;
    try {
      await this.mapsLoader.load();
    } catch {
      this.zone.run(() => (this.error = 'Could not load Google Maps.'));
      return;
    }
    this.map = new google.maps.Map(this.mapContainer.nativeElement, {
      center: { lat: 33.7311, lng: 75.1487 },
      zoom: 11,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
    });
    this.mapsReady = true;

    this.clickListener = this.map.addListener('click', (ev: google.maps.MapMouseEvent) => {
      if (!this.editing || !ev.latLng) return;
      this.zone.run(() => {
        this.draftPolygon = [
          ...this.draftPolygon,
          { lat: ev.latLng!.lat(), lng: ev.latLng!.lng() },
        ];
        this.redrawPolygon(this.draftPolygon);
      });
    });

    if (this.selected) {
      this.draftPolygon = this.selected.boundary_polygon ? [...this.selected.boundary_polygon] : [];
      this.redrawPolygon(this.draftPolygon);
      if (this.draftPolygon.length) this.fitToPolygon(this.draftPolygon);
    }
  }

  private redrawPolygon(coords: PolygonPoint[]): void {
    if (!this.map || !this.mapsReady) return;

    this.polygonLayer?.setMap(null);
    this.polygonLayer = null;
    this.vertexMarkers.forEach((m) => m.setMap(null));
    this.vertexMarkers = [];

    if (!coords.length) return;

    if (coords.length >= 3) {
      this.polygonLayer = new google.maps.Polygon({
        paths: coords,
        strokeColor: '#3b82f6',
        strokeWeight: 2,
        fillColor: '#3b82f6',
        fillOpacity: 0.18,
        clickable: false,
      });
      this.polygonLayer.setMap(this.map);
    }

    if (this.editing) {
      coords.forEach((p) => {
        const marker = new google.maps.Marker({
          position: p,
          map: this.map!,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 5,
            fillColor: '#ffffff',
            fillOpacity: 1,
            strokeColor: '#3b82f6',
            strokeWeight: 2,
          },
        });
        this.vertexMarkers.push(marker);
      });
    }
  }

  private fitToPolygon(coords: PolygonPoint[]): void {
    if (!this.map || !coords.length) return;
    const bounds = new google.maps.LatLngBounds();
    coords.forEach((p) => bounds.extend(p));
    this.map.fitBounds(bounds, 40);
  }
}
