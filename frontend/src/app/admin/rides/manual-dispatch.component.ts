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
import { ApiService } from '../../core/api.service';
import { GoogleMapsLoaderService } from '../../core/google-maps-loader.service';
import { ButtonComponent, IconComponent, SelectComponent } from '../../ui';

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

type CardKey = 'customer' | 'route' | 'options';

@Component({
  selector: 'app-manual-dispatch',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, IconComponent, SelectComponent],
  template: `
    <div class="page">
      <header class="page-head">
        <h1 class="page-head__title">Manual Dispatch</h1>
        <p class="page-head__sub">Book a ride on behalf of a customer and dispatch it to a driver.</p>
      </header>

      <div class="workspace">
        <!-- ================= LEFT: input cards ================= -->
        <div class="inputs">
          <!-- Customer -->
          <section class="card">
            <button type="button" class="card__head" (click)="toggle('customer')">
              <span class="card__head-icon"><tm-icon name="user" [size]="15" /></span>
              <span class="card__head-title">Customer</span>
              <tm-icon class="card__chev" [name]="open.customer ? 'chevron-up' : 'chevron-down'" [size]="14" />
            </button>
            <div class="card__body" *ngIf="open.customer">
              <label class="fld">
                <span class="fld__label">Phone number</span>
                <input class="in" [(ngModel)]="form.user_phone" (ngModelChange)="onPhoneChange()" placeholder="+91…" autocomplete="off" />
              </label>
              <div class="hint" *ngIf="lookupHint" [class.hint--ok]="customerExisting === true">{{ lookupHint }}</div>

              <label class="fld">
                <span class="fld__label">Name</span>
                <input class="in" [(ngModel)]="form.user_name" placeholder="Customer name" />
              </label>

              <label class="fld">
                <span class="fld__label">City</span>
                <tm-select
                  [options]="cityOptions"
                  [ngModel]="form.city_id"
                  (valueChange)="onCitySelected($event)"
                  placeholder="Select a city"
                />
              </label>

              <div class="fld">
                <span class="fld__label">When</span>
                <div class="seg">
                  <button type="button" class="seg__btn" [class.is-active]="form.scheduleMode === 'asap'" (click)="setSchedule('asap')">ASAP</button>
                  <button type="button" class="seg__btn" [class.is-active]="form.scheduleMode === 'scheduled'" (click)="setSchedule('scheduled')">Scheduled</button>
                </div>
                <input *ngIf="form.scheduleMode === 'scheduled'" class="in" type="datetime-local" [(ngModel)]="form.scheduled_at" />
              </div>
            </div>
          </section>

          <!-- Route -->
          <section class="card">
            <button type="button" class="card__head" (click)="toggle('route')">
              <span class="card__head-icon"><tm-icon name="map-marker" [size]="15" /></span>
              <span class="card__head-title">Route</span>
              <tm-icon class="card__chev" [name]="open.route ? 'chevron-up' : 'chevron-down'" [size]="14" />
            </button>
            <div class="card__body" *ngIf="open.route">
              <label class="fld">
                <span class="fld__label">Pickup</span>
                <input #pickupInput class="in" [(ngModel)]="form.pickup.address" placeholder="Search a place…" autocomplete="off" />
              </label>

              <div class="stops">
                <div *ngFor="let s of form.stops; let i = index" class="stop">
                  <input #stopInput class="in" [(ngModel)]="s.address" [placeholder]="'Stop ' + (i + 1)" autocomplete="off" />
                  <button type="button" class="icon-btn" (click)="removeStop(i)" aria-label="Remove stop"><tm-icon name="x" [size]="14" /></button>
                </div>
                <button type="button" class="add-stop" (click)="addStop()"><tm-icon name="plus" [size]="13" /> Add stop</button>
              </div>

              <label class="fld">
                <span class="fld__label">Destination</span>
                <input #destInput class="in" [(ngModel)]="form.drop.address" placeholder="Search a place…" autocomplete="off" />
              </label>
            </div>
          </section>

          <!-- Options -->
          <section class="card">
            <button type="button" class="card__head" (click)="toggle('options')">
              <span class="card__head-icon"><tm-icon name="cog" [size]="15" /></span>
              <span class="card__head-title">Trip options</span>
              <tm-icon class="card__chev" [name]="open.options ? 'chevron-up' : 'chevron-down'" [size]="14" />
            </button>
            <div class="card__body" *ngIf="open.options">
              <label class="fld">
                <span class="fld__label">Payment method</span>
                <tm-select [options]="paymentOptions" [(ngModel)]="form.payment_method" />
              </label>

              <label class="fld">
                <span class="fld__label">Vehicle type *</span>
                <tm-select [options]="vehicleOptions" [(ngModel)]="form.vehicle_type_id" placeholder="Auto / Bike / Mini…" />
              </label>

              <label class="switch-row">
                <span class="switch-row__text">
                  <span class="switch-row__title">Round trip</span>
                  <span class="switch-row__sub">Driver returns to the pickup point.</span>
                </span>
                <span class="switch">
                  <input type="checkbox" [(ngModel)]="form.is_round_trip" />
                  <span class="switch__track"><span class="switch__thumb"></span></span>
                </span>
              </label>

              <label class="fld">
                <span class="fld__label">Driver notes</span>
                <textarea class="ta" rows="2" [(ngModel)]="form.driver_notes" placeholder="Any instructions for the driver…"></textarea>
              </label>
            </div>
          </section>
        </div>

        <!-- ================= CENTER: map ================= -->
        <section class="map-side">
          <div class="map-shell" #mapContainer></div>
          <div *ngIf="routeSummary" class="route-chips">
            <span class="chip"><tm-icon name="road" [size]="12" /> {{ routeSummary.distanceText }}</span>
            <span class="chip"><tm-icon name="calendar" [size]="12" /> {{ routeSummary.durationText }}</span>
          </div>
        </section>

        <!-- ================= RIGHT: trip ticket ================= -->
        <aside class="ticket">
          <header class="ticket__head">
            <span class="ticket__head-icon"><tm-icon name="send" [size]="16" /></span>
            <div>
              <h2 class="ticket__title">Trip ticket</h2>
              <p class="ticket__sub">Live summary — review and dispatch.</p>
            </div>
          </header>

          <div class="ticket__body">
            <div class="tk-row">
              <span class="tk-row__k">Customer</span>
              <span class="tk-row__v">
                {{ form.user_name || form.user_phone || '—' }}
                <span class="pill pill--ok" *ngIf="customerExisting === true">Existing</span>
                <span class="pill pill--new" *ngIf="customerExisting === false">New</span>
              </span>
            </div>
            <div class="tk-row"><span class="tk-row__k">City</span><span class="tk-row__v">{{ cityName || '—' }}</span></div>
            <div class="tk-row"><span class="tk-row__k">When</span><span class="tk-row__v">{{ whenLabel }}</span></div>

            <div class="tk-route">
              <div class="tk-route__line">
                <span class="dot dot--p"></span>
                <span class="tk-route__addr" [class.is-empty]="!form.pickup.address">{{ form.pickup.address || 'Pickup not set' }}</span>
              </div>
              <div class="tk-route__line" *ngIf="form.stops.length">
                <span class="dot dot--s"></span>
                <span class="tk-route__addr">{{ form.stops.length }} stop{{ form.stops.length > 1 ? 's' : '' }}</span>
              </div>
              <div class="tk-route__line">
                <span class="dot dot--d"></span>
                <span class="tk-route__addr" [class.is-empty]="!form.drop.address">{{ form.drop.address || 'Destination not set' }}</span>
              </div>
            </div>

            <div class="tk-row"><span class="tk-row__k">Payment</span><span class="tk-row__v">{{ form.payment_method | uppercase }}</span></div>
            <div class="tk-row"><span class="tk-row__k">Vehicle</span><span class="tk-row__v">{{ vehicleTypeName || '—' }}</span></div>
            <div class="tk-row" *ngIf="form.is_round_trip"><span class="tk-row__k">Round trip</span><span class="tk-row__v">Yes</span></div>

            <div class="tk-est" *ngIf="estimate">
              <div class="tk-est__row"><span>Distance</span><strong>{{ estimate.estimate.distance_km }} km</strong></div>
              <div class="tk-est__row"><span>Time</span><strong>{{ estimate.estimate.time_min }} min</strong></div>
              <div class="tk-est__row tk-est__row--total"><span>Estimated fare</span><strong>₹ {{ estimate.estimate.estimated_fare | number:'1.2-2' }}</strong></div>
            </div>

            <div class="tk-msg tk-msg--err" *ngIf="error"><tm-icon name="x" [size]="13" /> {{ error }}</div>
            <div class="tk-msg tk-msg--ok" *ngIf="message"><tm-icon name="check" [size]="13" /> {{ message }}</div>
          </div>

          <footer class="ticket__foot">
            <tm-button
              variant="outline"
              icon="rupee"
              [disabled]="!canEstimate || estimating"
              [loading]="estimating"
              (clicked)="getEstimate()"
            >Fare estimate</tm-button>
            <tm-button
              variant="ink"
              icon="send"
              [disabled]="!canBook || booking"
              [loading]="booking"
              (clicked)="book()"
            >Dispatch ride</tm-button>
          </footer>
        </aside>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .page { display: flex; flex-direction: column; gap: var(--tm-space-5); }

    .page-head__title { margin: 0 0 4px; font-size: 24px; font-weight: 800; letter-spacing: -0.02em; color: var(--tm-text); }
    .page-head__sub { margin: 0; font-size: 13px; color: var(--tm-text-muted); font-weight: 500; }

    /* ---------- Workspace grid ---------- */
    .workspace {
      display: grid;
      grid-template-columns: 340px minmax(0, 1fr) 340px;
      gap: var(--tm-space-4);
      align-items: start;
    }

    /* ---------- Left input cards ---------- */
    .inputs { display: flex; flex-direction: column; gap: var(--tm-space-3); min-width: 0; }
    .card {
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg);
      overflow: hidden;
    }
    .card__head {
      display: flex; align-items: center; gap: 10px;
      width: 100%; padding: 12px 14px;
      border: 0; background: transparent; cursor: pointer;
      color: var(--tm-text); font-weight: 800; font-size: 13px;
    }
    .card__head-icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: var(--tm-radius-sm);
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
    }
    .card__head-title { flex: 1; text-align: left; }
    .card__chev { color: var(--tm-text-soft); }
    .card__body {
      display: flex; flex-direction: column; gap: 12px;
      padding: 0 14px 14px;
    }

    /* ---------- Fields ---------- */
    .fld { display: flex; flex-direction: column; gap: 6px; }
    .fld__label {
      font-size: 11px; font-weight: 800; letter-spacing: 0.06em;
      text-transform: uppercase; color: var(--tm-text-muted);
    }
    .in {
      width: 100%; padding: 9px 12px;
      border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-md);
      font-family: inherit; font-size: 14px; color: var(--tm-text);
      background: var(--tm-surface); outline: none;
      transition: border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .in:focus { border-color: var(--tm-ink); }
    .in::placeholder { color: var(--tm-text-soft); }
    .ta {
      width: 100%; padding: 9px 12px;
      border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-md);
      font-family: inherit; font-size: 14px; color: var(--tm-text);
      background: var(--tm-surface); outline: none; resize: vertical; min-height: 60px;
      transition: border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .ta:focus { border-color: var(--tm-ink); }

    .hint { font-size: 12px; color: var(--tm-text-muted); font-weight: 500; }
    .hint--ok { color: var(--tm-green-deep); font-weight: 700; }

    /* ---------- Segmented toggle ---------- */
    .seg { display: inline-flex; gap: 4px; padding: 4px; background: var(--tm-canvas-2); border-radius: var(--tm-radius-md); }
    .seg__btn {
      flex: 1; padding: 7px 12px; border: 0; background: transparent;
      border-radius: calc(var(--tm-radius-md) - 4px);
      font-family: inherit; font-weight: 700; font-size: 12px;
      color: var(--tm-text-muted); cursor: pointer;
      transition: background var(--tm-duration-fast) var(--tm-ease), color var(--tm-duration-fast) var(--tm-ease);
    }
    .seg__btn.is-active { background: var(--tm-surface); color: var(--tm-text); box-shadow: 0 1px 2px rgba(15, 20, 25, 0.1); }

    /* ---------- Stops ---------- */
    .stops { display: flex; flex-direction: column; gap: 6px; }
    .stop { display: grid; grid-template-columns: 1fr auto; gap: 6px; align-items: center; }
    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 34px; height: 34px; flex-shrink: 0;
      border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-md);
      background: var(--tm-surface); color: var(--tm-text-muted); cursor: pointer;
      transition: background var(--tm-duration-fast) var(--tm-ease), color var(--tm-duration-fast) var(--tm-ease);
    }
    .icon-btn:hover { background: var(--tm-danger-bg); color: var(--tm-danger-fg); }
    .add-stop {
      display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;
      padding: 6px 10px; border: 1px dashed var(--tm-line-2); border-radius: var(--tm-radius-md);
      background: transparent; color: var(--tm-text-muted);
      font-family: inherit; font-weight: 700; font-size: 12px; cursor: pointer;
    }
    .add-stop:hover { color: var(--tm-text); border-color: var(--tm-text-soft); }

    /* ---------- Switch ---------- */
    .switch-row {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 12px 14px; border: 1px solid var(--tm-line); border-radius: var(--tm-radius-md);
      background: var(--tm-canvas); cursor: pointer;
    }
    .switch-row__title { display: block; font-size: 13px; font-weight: 700; color: var(--tm-text); }
    .switch-row__sub { display: block; font-size: 11px; color: var(--tm-text-muted); margin-top: 1px; }
    .switch { display: inline-flex; flex-shrink: 0; }
    .switch input { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
    .switch__track {
      position: relative; width: 40px; height: 22px; border-radius: 999px;
      background: var(--tm-line-2); transition: background var(--tm-duration-fast) var(--tm-ease);
    }
    .switch__thumb {
      position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%;
      background: #fff; box-shadow: 0 1px 2px rgba(15, 20, 25, 0.25);
      transition: transform var(--tm-duration-fast) var(--tm-ease);
    }
    .switch input:checked + .switch__track { background: var(--tm-green); }
    .switch input:checked + .switch__track .switch__thumb { transform: translateX(18px); }

    /* ---------- Map ---------- */
    .map-side { position: relative; min-width: 0; }
    .map-shell {
      width: 100%; min-height: 620px; height: 100%;
      border-radius: var(--tm-radius-lg);
      border: 1px solid var(--tm-line);
      overflow: hidden;
    }
    .route-chips { position: absolute; top: 12px; left: 12px; display: flex; gap: 6px; }
    .chip {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 5px 10px; border-radius: var(--tm-radius-pill);
      background: var(--tm-surface); border: 1px solid var(--tm-line);
      box-shadow: var(--tm-shadow-sm);
      font-family: var(--tm-font-mono); font-size: 11px; font-weight: 800; color: var(--tm-text);
    }

    /* ---------- Trip ticket ---------- */
    .ticket {
      position: sticky; top: var(--tm-space-4);
      display: flex; flex-direction: column;
      background: var(--tm-surface); border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg); overflow: hidden;
    }
    .ticket__head {
      display: flex; align-items: center; gap: 12px;
      padding: var(--tm-space-4);
      border-bottom: 1px solid var(--tm-line);
    }
    .ticket__head-icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 36px; height: 36px; flex-shrink: 0;
      border-radius: var(--tm-radius-md); background: var(--tm-ink); color: #fff;
    }
    .ticket__title { margin: 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .ticket__sub { margin: 2px 0 0; font-size: 12px; color: var(--tm-text-muted); }

    .ticket__body { padding: var(--tm-space-4); display: flex; flex-direction: column; gap: 10px; }
    .tk-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .tk-row__k {
      font-size: 11px; font-weight: 800; letter-spacing: 0.06em;
      text-transform: uppercase; color: var(--tm-text-muted); flex-shrink: 0;
    }
    .tk-row__v {
      font-size: 13px; font-weight: 700; color: var(--tm-text);
      text-align: right; display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end;
    }
    .pill {
      display: inline-flex; align-items: center; padding: 2px 8px;
      border-radius: var(--tm-radius-pill); font-size: 10px; font-weight: 800;
      letter-spacing: 0.04em; text-transform: uppercase;
    }
    .pill--ok { background: var(--tm-green-tint); color: var(--tm-green-deep); }
    .pill--new { background: var(--tm-info-bg); color: var(--tm-info-fg); }

    .tk-route {
      position: relative; display: flex; flex-direction: column; gap: 8px;
      padding: 12px; margin: 4px 0;
      background: var(--tm-canvas); border-radius: var(--tm-radius-md);
    }
    .tk-route__line { display: flex; align-items: center; gap: 10px; font-size: 12px; }
    .tk-route__addr { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--tm-text); }
    .tk-route__addr.is-empty { color: var(--tm-text-soft); }
    .dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; border: 2px solid #fff; box-shadow: 0 0 0 1px var(--tm-line-2); }
    .dot--p { background: var(--tm-ink); }
    .dot--s { background: var(--tm-text-soft); }
    .dot--d { background: var(--tm-green); }

    .tk-est {
      display: flex; flex-direction: column; gap: 4px;
      padding: 12px; border-radius: var(--tm-radius-md);
      background: var(--tm-green-tint); border: 1px solid var(--tm-green-deep);
    }
    .tk-est__row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: var(--tm-green-deep); }
    .tk-est__row strong { font-family: var(--tm-font-mono); }
    .tk-est__row--total { border-top: 1px dashed var(--tm-green-deep); padding-top: 6px; margin-top: 2px; font-size: 15px; font-weight: 800; }

    .tk-msg { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; padding: 8px 10px; border-radius: var(--tm-radius-md); }
    .tk-msg--err { background: var(--tm-danger-bg); color: var(--tm-danger-fg); }
    .tk-msg--ok { background: var(--tm-green-tint); color: var(--tm-green-deep); }

    .ticket__foot {
      display: flex; flex-direction: column; gap: 8px;
      padding: var(--tm-space-4);
      border-top: 1px solid var(--tm-line); background: var(--tm-canvas);
    }
    .ticket__foot tm-button { display: block; }

    /* ---------- Responsive ---------- */
    @media (max-width: 1200px) {
      .workspace { grid-template-columns: 320px 1fr; }
      .ticket { grid-column: 1 / -1; position: static; }
      .ticket__foot { flex-direction: row; justify-content: flex-end; }
    }
    @media (max-width: 820px) {
      .workspace { grid-template-columns: 1fr; }
      .map-shell { min-height: 380px; }
    }
  `],
})
export class ManualDispatchComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: false }) mapContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('pickupInput', { static: false }) pickupInput?: ElementRef<HTMLInputElement>;
  @ViewChild('destInput', { static: false }) destInput?: ElementRef<HTMLInputElement>;
  @ViewChildren('stopInput') stopInputs!: QueryList<ElementRef<HTMLInputElement>>;

  cities: City[] = [];
  vehicleTypes: VehicleTypeOpt[] = [];

  readonly paymentOptions = [
    { label: 'Cash', value: 'cash' },
    { label: 'Razorpay', value: 'razorpay' },
  ];

  open: Record<CardKey, boolean> = { customer: true, route: true, options: true };

  form = {
    user_phone: '',
    user_name: '',
    city_id: null as number | null,
    vehicle_type_id: null as number | null,
    payment_method: 'cash' as 'cash' | 'razorpay',
    scheduleMode: 'asap' as 'asap' | 'scheduled',
    scheduled_at: '' as string,
    pickup: { address: '', lat: 0, lng: 0 } as PlacePoint,
    drop: { address: '', lat: 0, lng: 0 } as PlacePoint,
    stops: [] as StopRow[],
    is_round_trip: false,
    driver_notes: '',
  };

  estimate: FareEstimateResponse | null = null;
  routeSummary: { distanceText: string; durationText: string } | null = null;

  lookupHint: string | null = null;
  customerExisting: boolean | null = null;
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

  // ───── select option lists / display getters ─────

  get cityOptions() {
    return this.cities.map((c) => ({ label: c.name, value: c.id }));
  }

  get vehicleOptions() {
    return this.vehicleTypes.map((v) => ({ label: v.name, value: v.id }));
  }

  get cityName(): string | null {
    return this.cities.find((c) => c.id === this.form.city_id)?.name ?? null;
  }

  get vehicleTypeName(): string | null {
    return this.vehicleTypes.find((v) => v.id === this.form.vehicle_type_id)?.name ?? null;
  }

  get whenLabel(): string {
    if (this.form.scheduleMode === 'asap') return 'ASAP';
    if (!this.form.scheduled_at) return 'Scheduled (pick a time)';
    const d = new Date(this.form.scheduled_at);
    return isNaN(d.getTime()) ? 'Scheduled' : d.toLocaleString();
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

  toggle(key: CardKey): void {
    this.open[key] = !this.open[key];
    // Places autocomplete binds to the native pickup/stop/dest inputs; when the
    // Route card re-mounts we must re-wire them once Angular has rendered.
    if (key === 'route' && this.open.route) {
      setTimeout(() => this.attachAutocompletes(), 0);
    }
  }

  onCitySelected(id: number | null): void {
    this.form.city_id = id;
    this.onCityChange();
  }

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
    if (mode === 'asap') this.form.scheduled_at = '';
  }

  onPhoneChange(): void {
    if (this.phoneTimer) window.clearTimeout(this.phoneTimer);
    const phone = this.form.user_phone.trim();
    if (!phone) {
      this.lookupHint = null;
      this.customerExisting = null;
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
            this.customerExisting = true;
            this.lookupHint = `Found existing customer: ${res.user.name || '(no name)'}`;
            if (!this.form.user_name) this.form.user_name = res.user.name || '';
          } else {
            this.customerExisting = false;
            this.lookupHint = 'New customer — a guest profile will be created on booking.';
          }
        },
        error: () => {
          this.lookupHint = null;
          this.customerExisting = null;
        },
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
      const d = new Date(this.form.scheduled_at);
      if (!isNaN(d.getTime())) payload['scheduled_at'] = d.toISOString();
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
        // Send the operator to Rides so they can watch it.
        setTimeout(() => this.router.navigateByUrl('/rides'), 800);
      },
      error: (err) => (this.error = err?.error?.message || 'Failed to book ride'),
      complete: () => (this.booking = false),
    });
  }
}
