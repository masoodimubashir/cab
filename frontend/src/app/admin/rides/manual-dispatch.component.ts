import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChild,
  ViewChildren,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { CheckboxModule } from 'primeng/checkbox';
import { CalendarModule } from 'primeng/calendar';
import { TagModule } from 'primeng/tag';
import { ApiService } from '../../core/api.service';
import { GoogleMapsLoaderService } from '../../core/google-maps-loader.service';

interface City {
  id: number;
  name: string;
  center_lat: number | null;
  center_lng: number | null;
  boundary_polygon: { lat: number; lng: number }[] | null;
}

interface VehicleTypeOpt {
  id: number;
  name: string;
}

interface PlacePoint {
  address: string;
  lat: number;
  lng: number;
}

type StopRow = PlacePoint;

interface FareEstimateResponse {
  estimate: {
    distance_km: number;
    time_min: number;
    estimated_fare: number;
    fare_breakdown: Record<string, number | null>;
  };
  pricing_rule_id: number;
}

@Component({
  selector: 'app-manual-dispatch',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    DropdownModule,
    InputTextModule,
    InputTextareaModule,
    CheckboxModule,
    CalendarModule,
    TagModule,
  ],
  template: `
    <p-card header="Manual Dispatch">
      <div class="layout">
        <section class="form-side">
          <h3 class="section-h">User Details</h3>

          <label class="field">
            <span>User Phone No.</span>
            <input
              pInputText
              [(ngModel)]="form.user_phone"
              (ngModelChange)="onPhoneChange()"
              placeholder="+91…"
              autocomplete="off"
            />
          </label>
          <div *ngIf="lookupHint" class="muted small">{{ lookupHint }}</div>

          <label class="field">
            <span>User Name</span>
            <input pInputText [(ngModel)]="form.user_name" placeholder="Customer name" />
          </label>

          <label class="field">
            <span>City</span>
            <p-dropdown
              [options]="cities"
              [(ngModel)]="form.city_id"
              (onChange)="onCityChange()"
              placeholder="Select a city"
              optionLabel="name"
              optionValue="id"
              appendTo="body"
              [filter]="true"
            ></p-dropdown>
          </label>

          <div class="schedule">
            <span class="muted small">Schedule</span>
            <div class="schedule__toggle">
              <button
                pButton
                type="button"
                [label]="'ASAP'"
                [class.p-button-text]="form.scheduleMode !== 'asap'"
                (click)="setSchedule('asap')"
              ></button>
              <button
                pButton
                type="button"
                [label]="'Scheduled'"
                [class.p-button-text]="form.scheduleMode !== 'scheduled'"
                (click)="setSchedule('scheduled')"
              ></button>
            </div>
            <p-calendar
              *ngIf="form.scheduleMode === 'scheduled'"
              [(ngModel)]="form.scheduled_at"
              [showTime]="true"
              [showSeconds]="false"
              [hourFormat]="'12'"
              [showIcon]="true"
              dateFormat="dd-mm-yy"
              appendTo="body"
              styleClass="schedule__cal"
            ></p-calendar>
          </div>

          <h3 class="section-h">Pickup &amp; Stops</h3>

          <label class="field">
            <span>Pickup Address</span>
            <input
              #pickupInput
              pInputText
              [(ngModel)]="form.pickup.address"
              placeholder="Search a place…"
              autocomplete="off"
            />
          </label>

          <div class="stops">
            <div *ngFor="let s of form.stops; let i = index" class="stop-row">
              <input
                #stopInput
                pInputText
                [(ngModel)]="s.address"
                [placeholder]="'Stop ' + (i + 1)"
                autocomplete="off"
              />
              <button
                pButton
                type="button"
                icon="pi pi-times"
                class="p-button-text p-button-danger"
                (click)="removeStop(i)"
              ></button>
            </div>
            <button
              pButton
              type="button"
              icon="pi pi-plus"
              label="Add Stop"
              class="p-button-text"
              (click)="addStop()"
            ></button>
          </div>

          <label class="field">
            <span>Destination Address</span>
            <input
              #destInput
              pInputText
              [(ngModel)]="form.drop.address"
              placeholder="Search a place…"
              autocomplete="off"
            />
          </label>

          <h3 class="section-h">Trip Settings</h3>

          <label class="field">
            <span>Payment Method</span>
            <p-dropdown
              [options]="paymentOptions"
              [(ngModel)]="form.payment_method"
              optionLabel="label"
              optionValue="value"
              appendTo="body"
            ></p-dropdown>
          </label>

          <label class="field">
            <span>Vehicle Type *</span>
            <p-dropdown
              [options]="vehicleTypes"
              [(ngModel)]="form.vehicle_type_id"
              placeholder="Auto / Bike / Mini…"
              optionLabel="name"
              optionValue="id"
              appendTo="body"
            ></p-dropdown>
          </label>

          <label class="checkbox">
            <p-checkbox [(ngModel)]="form.is_round_trip" [binary]="true"></p-checkbox>
            Round Trip
          </label>

          <label class="field">
            <span>Driver Notes</span>
            <textarea
              pInputTextarea
              [(ngModel)]="form.driver_notes"
              rows="2"
              placeholder="Any instructions for the driver…"
            ></textarea>
          </label>

          <div *ngIf="error" class="error">{{ error }}</div>
          <div *ngIf="message" class="ok">{{ message }}</div>

          <div *ngIf="estimate" class="estimate">
            <div class="estimate__row">
              <span class="muted small">Distance</span>
              <strong>{{ estimate.estimate.distance_km }} km</strong>
            </div>
            <div class="estimate__row">
              <span class="muted small">Time</span>
              <strong>{{ estimate.estimate.time_min }} min</strong>
            </div>
            <div class="estimate__row total">
              <span>Estimated Fare</span>
              <strong>₹ {{ estimate.estimate.estimated_fare | number:'1.2-2' }}</strong>
            </div>
          </div>

          <div class="actions">
            <button
              pButton
              type="button"
              label="Get Fare Estimate"
              icon="pi pi-calculator"
              class="p-button-secondary"
              [disabled]="!canEstimate || estimating"
              (click)="getEstimate()"
            ></button>
            <button
              pButton
              type="button"
              label="Book Ride"
              icon="pi pi-check"
              [disabled]="!canBook || booking"
              (click)="book()"
            ></button>
          </div>
        </section>

        <section class="map-side">
          <div class="map-shell" #mapContainer></div>
          <div *ngIf="routeSummary" class="route-summary">
            <p-tag [value]="routeSummary.distanceText" severity="info"></p-tag>
            <p-tag [value]="routeSummary.durationText" severity="info"></p-tag>
          </div>
        </section>
      </div>
    </p-card>
  `,
  styles: [
    `
      .layout {
        display: grid;
        grid-template-columns: 420px 1fr;
        gap: 20px;
        min-height: 720px;
      }
      .form-side {
        display: flex;
        flex-direction: column;
        gap: 12px;
        max-height: 80vh;
        overflow: auto;
        padding-right: 8px;
      }
      .map-side {
        position: relative;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      .map-shell {
        flex: 1;
        min-height: 600px;
        border-radius: 12px;
        border: 1px solid rgba(15, 23, 42, 0.1);
      }
      .route-summary {
        position: absolute;
        top: 12px;
        left: 12px;
        display: flex;
        gap: 6px;
      }
      .section-h {
        margin: 8px 0 0;
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(15, 23, 42, 0.55);
        border-top: 1px solid rgba(15, 23, 42, 0.06);
        padding-top: 10px;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .field > span {
        font-size: 12px;
        font-weight: 700;
        color: rgba(15, 23, 42, 0.7);
      }
      .checkbox {
        display: inline-flex;
        gap: 6px;
        align-items: center;
        font-size: 13px;
      }
      .stops {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .stop-row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 6px;
        align-items: center;
      }
      .schedule {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .schedule__toggle {
        display: flex;
        gap: 6px;
      }
      .schedule__cal {
        width: 100%;
      }
      .estimate {
        background: rgba(34, 197, 94, 0.08);
        border: 1px solid rgba(34, 197, 94, 0.3);
        border-radius: 8px;
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .estimate__row {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .estimate__row.total {
        border-top: 1px dashed rgba(34, 197, 94, 0.4);
        padding-top: 6px;
        font-size: 16px;
      }
      .actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-top: 4px;
      }
      .muted {
        color: rgba(15, 23, 42, 0.55);
      }
      .small {
        font-size: 12px;
      }
      .error {
        color: #b00020;
        font-weight: 700;
      }
      .ok {
        color: #1f8b4c;
        font-weight: 700;
      }
      :host ::ng-deep p-dropdown,
      :host ::ng-deep p-calendar {
        width: 100%;
      }
      :host ::ng-deep .p-dropdown,
      :host ::ng-deep .p-calendar {
        width: 100%;
      }

      @media (max-width: 1100px) {
        .layout {
          grid-template-columns: 1fr;
        }
        .map-shell {
          min-height: 380px;
        }
      }
    `,
  ],
})
export class ManualDispatchComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: false }) mapContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('pickupInput', { static: false }) pickupInput?: ElementRef<HTMLInputElement>;
  @ViewChild('destInput', { static: false }) destInput?: ElementRef<HTMLInputElement>;
  @ViewChildren('stopInput') stopInputs!: QueryList<ElementRef<HTMLInputElement>>;

  cities: City[] = [];
  vehicleTypes: VehicleTypeOpt[] = [];

  paymentOptions = [
    { label: 'CASH', value: 'cash' },
    { label: 'RAZORPAY', value: 'razorpay' },
  ];

  form = {
    user_phone: '',
    user_name: '',
    city_id: null as number | null,
    vehicle_type_id: null as number | null,
    payment_method: 'cash' as 'cash' | 'razorpay',
    scheduleMode: 'asap' as 'asap' | 'scheduled',
    scheduled_at: null as Date | null,
    pickup: { address: '', lat: 0, lng: 0 } as PlacePoint,
    drop: { address: '', lat: 0, lng: 0 } as PlacePoint,
    stops: [] as StopRow[],
    is_round_trip: false,
    driver_notes: '',
  };

  estimate: FareEstimateResponse | null = null;
  routeSummary: { distanceText: string; durationText: string } | null = null;

  lookupHint: string | null = null;
  estimating = false;
  booking = false;
  error: string | null = null;
  message: string | null = null;

  private map: google.maps.Map | null = null;
  private mapsReady = false;
  private pickupMarker: google.maps.Marker | null = null;
  private dropMarker: google.maps.Marker | null = null;
  private stopMarkers: google.maps.Marker[] = [];
  private directionsRenderer: google.maps.DirectionsRenderer | null = null;
  private directionsService: google.maps.DirectionsService | null = null;
  private cityBoundary: google.maps.Polygon | null = null;

  private autocompletes: google.maps.places.Autocomplete[] = [];
  private autocompleteListeners: google.maps.MapsEventListener[] = [];
  private phoneTimer: number | null = null;

  constructor(
    private api: ApiService,
    private zone: NgZone,
    private mapsLoader: GoogleMapsLoaderService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.api.get<{ data: City[] }>('/admin/cities').subscribe((res) => {
      this.cities = res?.data || [];
    });
    this.api
      .get<{ data: VehicleTypeOpt[] }>('/admin/vehicle-types-global?active_only=1')
      .subscribe((res) => {
        this.vehicleTypes = (res?.data || []).map((v) => ({ id: v.id, name: v.name }));
      });
  }

  ngAfterViewInit(): void {
    void this.initMap();
  }

  ngOnDestroy(): void {
    this.detachAutocompletes();
    this.pickupMarker?.setMap(null);
    this.dropMarker?.setMap(null);
    this.stopMarkers.forEach((m) => m.setMap(null));
    this.directionsRenderer?.setMap(null);
    this.cityBoundary?.setMap(null);
    if (this.phoneTimer) window.clearTimeout(this.phoneTimer);
    document.querySelectorAll('.pac-container').forEach((el) => el.remove());
  }

  // ───── derived state ─────

  get canEstimate(): boolean {
    return !!(
      this.form.city_id &&
      this.form.vehicle_type_id &&
      this.form.pickup.lat &&
      this.form.drop.lat
    );
  }

  get canBook(): boolean {
    return !!(this.canEstimate && this.form.user_phone.trim());
  }

  // ───── form actions ─────

  onCityChange(): void {
    const city = this.cities.find((c) => c.id === this.form.city_id);
    if (city?.center_lat != null && city?.center_lng != null && this.map) {
      this.map.setCenter({ lat: city.center_lat, lng: city.center_lng });
      this.map.setZoom(12);
    }
    this.drawCityBoundary(city);
  }

  private drawCityBoundary(city: City | undefined): void {
    this.cityBoundary?.setMap(null);
    this.cityBoundary = null;
    if (!city || !this.map || !this.mapsReady) return;
    const polygon = city.boundary_polygon;
    if (!polygon || polygon.length < 3) return;

    this.cityBoundary = new google.maps.Polygon({
      paths: polygon.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) })),
      strokeColor: '#16a34a',
      strokeOpacity: 0.9,
      strokeWeight: 2,
      fillColor: '#16a34a',
      fillOpacity: 0.08,
      clickable: false,
      map: this.map,
    });

    const bounds = new google.maps.LatLngBounds();
    polygon.forEach((p) => bounds.extend({ lat: Number(p.lat), lng: Number(p.lng) }));
    this.map.fitBounds(bounds, 40);
  }

  setSchedule(mode: 'asap' | 'scheduled'): void {
    this.form.scheduleMode = mode;
    if (mode === 'asap') this.form.scheduled_at = null;
  }

  onPhoneChange(): void {
    if (this.phoneTimer) window.clearTimeout(this.phoneTimer);
    const phone = this.form.user_phone.trim();
    if (!phone) {
      this.lookupHint = null;
      return;
    }
    this.phoneTimer = window.setTimeout(() => this.lookupUser(phone), 400);
  }

  private lookupUser(phone: string): void {
    this.api
      .post<{ user: { id: number; name: string; phone: string } | null }>(
        '/admin/manual-dispatch/lookup-user',
        { phone },
      )
      .subscribe({
        next: (res) => {
          if (res.user) {
            this.lookupHint = `Found existing customer: ${res.user.name || '(no name)'} `;
            if (!this.form.user_name) this.form.user_name = res.user.name || '';
          } else {
            this.lookupHint = 'New customer — a guest profile will be created on booking.';
          }
        },
        error: () => (this.lookupHint = null),
      });
  }

  addStop(): void {
    this.form.stops = [...this.form.stops, { address: '', lat: 0, lng: 0 }];
    setTimeout(() => this.attachAutocompletes(), 0);
  }

  removeStop(i: number): void {
    this.form.stops = this.form.stops.filter((_, idx) => idx !== i);
    this.refreshRoute();
  }

  // ───── map + places ─────

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
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: true,
      clickableIcons: false,
    });

    this.directionsService = new google.maps.DirectionsService();
    this.directionsRenderer = new google.maps.DirectionsRenderer({
      suppressMarkers: true,
      polylineOptions: { strokeColor: '#3b82f6', strokeWeight: 4 },
    });
    this.directionsRenderer.setMap(this.map);

    this.mapsReady = true;
    this.attachAutocompletes();
    // Re-attach when stops are added/removed.
    this.stopInputs.changes.subscribe(() => setTimeout(() => this.attachAutocompletes(), 0));

    // If a city was selected before the map finished loading, draw it now.
    if (this.form.city_id) {
      this.drawCityBoundary(this.cities.find((c) => c.id === this.form.city_id));
    }
  }

  private attachAutocompletes(): void {
    if (!this.mapsReady || !window.google?.maps?.places) return;
    this.detachAutocompletes();

    const wireUp = (
      el: HTMLInputElement | undefined,
      onPick: (p: PlacePoint) => void,
    ) => {
      if (!el) return;
      const ac = new google.maps.places.Autocomplete(el, {
        fields: ['name', 'formatted_address', 'geometry'],
      });
      this.autocompletes.push(ac);
      this.autocompleteListeners.push(
        ac.addListener('place_changed', () => {
          const place = ac.getPlace();
          if (!place?.geometry?.location) return;
          this.zone.run(() => {
            onPick({
              address: place.formatted_address || place.name || '',
              lat: place.geometry!.location!.lat(),
              lng: place.geometry!.location!.lng(),
            });
            this.refreshRoute();
          });
        }),
      );
    };

    wireUp(this.pickupInput?.nativeElement, (p) => (this.form.pickup = p));
    wireUp(this.destInput?.nativeElement, (p) => (this.form.drop = p));
    this.stopInputs?.forEach((ref, idx) => {
      wireUp(ref.nativeElement, (p) => {
        this.form.stops = this.form.stops.map((s, i) => (i === idx ? p : s));
      });
    });
  }

  private detachAutocompletes(): void {
    this.autocompleteListeners.forEach((l) => l.remove());
    this.autocompleteListeners = [];
    this.autocompletes = [];
  }

  private refreshRoute(): void {
    if (!this.mapsReady || !this.directionsService || !this.directionsRenderer || !this.map) return;
    if (!this.form.pickup.lat || !this.form.drop.lat) {
      this.directionsRenderer.set('directions', null);
      this.routeSummary = null;
      this.placeSimpleMarkers();
      return;
    }
    const waypoints = this.form.stops
      .filter((s) => s.lat && s.lng)
      .map((s) => ({ location: new google.maps.LatLng(s.lat, s.lng), stopover: true }));

    this.directionsService.route(
      {
        origin: { lat: this.form.pickup.lat, lng: this.form.pickup.lng },
        destination: { lat: this.form.drop.lat, lng: this.form.drop.lng },
        waypoints,
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        this.zone.run(() => {
          if (status === google.maps.DirectionsStatus.OK && result) {
            this.directionsRenderer!.setDirections(result);
            const leg = result.routes[0]?.legs?.[0];
            const totalMeters = (result.routes[0]?.legs || []).reduce((sum, l) => sum + (l.distance?.value || 0), 0);
            const totalSeconds = (result.routes[0]?.legs || []).reduce((sum, l) => sum + (l.duration?.value || 0), 0);
            this.routeSummary = {
              distanceText: `${(totalMeters / 1000).toFixed(1)} km`,
              durationText: `${Math.round(totalSeconds / 60)} min`,
            };
            this.placeSimpleMarkers();
          } else {
            // Fall back to straight markers if Directions failed (e.g. no route).
            this.directionsRenderer!.set('directions', null);
            this.routeSummary = null;
            this.placeSimpleMarkers();
            this.fitToPoints();
          }
        });
      },
    );
  }

  private placeSimpleMarkers(): void {
    this.pickupMarker?.setMap(null);
    this.dropMarker?.setMap(null);
    this.stopMarkers.forEach((m) => m.setMap(null));
    this.stopMarkers = [];

    if (this.form.pickup.lat) {
      this.pickupMarker = new google.maps.Marker({
        position: { lat: this.form.pickup.lat, lng: this.form.pickup.lng },
        map: this.map!,
        label: { text: 'P', color: '#fff', fontWeight: '700' },
      });
    }
    if (this.form.drop.lat) {
      this.dropMarker = new google.maps.Marker({
        position: { lat: this.form.drop.lat, lng: this.form.drop.lng },
        map: this.map!,
        label: { text: 'D', color: '#fff', fontWeight: '700' },
      });
    }
    this.form.stops.forEach((s, i) => {
      if (!s.lat) return;
      this.stopMarkers.push(
        new google.maps.Marker({
          position: { lat: s.lat, lng: s.lng },
          map: this.map!,
          label: { text: String(i + 1), color: '#fff', fontWeight: '700' },
        }),
      );
    });
  }

  private fitToPoints(): void {
    if (!this.map) return;
    const bounds = new google.maps.LatLngBounds();
    let any = false;
    if (this.form.pickup.lat) {
      bounds.extend({ lat: this.form.pickup.lat, lng: this.form.pickup.lng });
      any = true;
    }
    if (this.form.drop.lat) {
      bounds.extend({ lat: this.form.drop.lat, lng: this.form.drop.lng });
      any = true;
    }
    this.form.stops.forEach((s) => {
      if (s.lat) {
        bounds.extend({ lat: s.lat, lng: s.lng });
        any = true;
      }
    });
    if (any) this.map.fitBounds(bounds, 60);
  }

  // ───── submit ─────

  private buildPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      city_id: this.form.city_id,
      vehicle_type_id: this.form.vehicle_type_id,
      pickup_address: this.form.pickup.address || null,
      pickup_lat: this.form.pickup.lat,
      pickup_lng: this.form.pickup.lng,
      drop_address: this.form.drop.address || null,
      drop_lat: this.form.drop.lat,
      drop_lng: this.form.drop.lng,
      payment_method: this.form.payment_method,
      is_round_trip: this.form.is_round_trip,
      driver_notes: this.form.driver_notes || null,
    };
    const stops = this.form.stops.filter((s) => s.lat && s.lng);
    if (stops.length) payload['stops'] = stops;
    if (this.form.scheduleMode === 'scheduled' && this.form.scheduled_at) {
      payload['scheduled_at'] = this.form.scheduled_at.toISOString();
    }
    return payload;
  }

  getEstimate(): void {
    if (!this.canEstimate || this.estimating) return;
    this.estimating = true;
    this.error = null;
    this.message = null;
    this.api
      .post<FareEstimateResponse>('/admin/manual-dispatch/fare-estimate', this.buildPayload())
      .subscribe({
        next: (res) => (this.estimate = res),
        error: (err) => (this.error = err?.error?.message || 'Failed to get fare estimate'),
        complete: () => (this.estimating = false),
      });
  }

  book(): void {
    if (!this.canBook || this.booking) return;
    this.booking = true;
    this.error = null;
    this.message = null;

    const payload = {
      ...this.buildPayload(),
      user_phone: this.form.user_phone.trim(),
      user_name: this.form.user_name.trim() || null,
    };

    this.api.post<{ trip: { id: number } }>('/admin/manual-dispatch/book', payload).subscribe({
      next: (res) => {
        this.message = `Trip #${res.trip.id} dispatched.`;
        // Send the operator to All Rides so they can watch it.
        setTimeout(() => this.router.navigateByUrl('/rides/all'), 800);
      },
      error: (err) => (this.error = err?.error?.message || 'Failed to book ride'),
      complete: () => (this.booking = false),
    });
  }
}
