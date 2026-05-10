import { Component, OnDestroy, OnInit } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
import { ApiService } from '../../core/api.service';
import { AuthService, PaymentMethod } from '../../core/auth.service';
import { BackgroundLocationService } from '../../core/background-location.service';
import { MapsLoaderService } from '../../core/maps-loader.service';
import { RealtimeService, TripCustomerLocationPayload } from '../../core/realtime.service';
import {
  coordsFromTrip,
  googleMapsDirectionsUrl,
  openExternalUrl,
} from '../../core/maps-navigation';

declare const google: any;

type AvailableTrip = {
  id: number;
  pickup_address?: string | null;
  pickup_lat: number;
  pickup_lng: number;
  drop_address?: string | null;
  drop_lat: number;
  drop_lng: number;
  estimated_fare?: number | null;
  customer_offer?: number | null;
  payment_method?: PaymentMethod | null;
  created_at?: string;
};

@Component({
  selector: 'app-rides',
  templateUrl: './rides.page.html',
  styleUrls: ['./rides.page.scss'],
  standalone: false,
})
export class RidesPage implements OnInit, OnDestroy {
  private unsubscribeStatus: (() => void) | null = null;
  private availablePoll: any = null;

  tripId: number | null = null;
  busy = false;
  message: string | null = null;
  error: string | null = null;
  lastTrip: Record<string, unknown> | null = null;

  available: AvailableTrip[] = [];
  loadingAvailable = false;

  negotiation: Record<string, unknown> | null = null;
  counterAmount: number | null = null;
  negBusy = false;

  get offers(): Record<string, unknown>[] {
    const raw = this.negotiation?.['offers'];
    return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  }

  get finalAmount(): unknown {
    return this.negotiation?.['final_amount'] ?? null;
  }

  sosBusy = false;

  // Live map for the active trip — shows pickup pin + the customer's GPS as
  // they walk to the curb, plus this driver's own position for context.
  private map: any | null = null;
  private pickupMarker: any | null = null;
  private dropMarker: any | null = null;
  private customerMarker: any | null = null;
  private selfMarker: any | null = null;
  customerPosition: { lat: number; lng: number } | null = null;
  mapReady = false;
  private selfWatchId: number | null = null;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private bgLocation: BackgroundLocationService,
    private realtime: RealtimeService,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private mapsLoader: MapsLoaderService
  ) {}

  canSOS(): boolean {
    const status = this.lastTrip?.['status'] as string | undefined;
    if (!status) return false;
    return status !== 'COMPLETED' && status !== 'CANCELLED';
  }

  async triggerSOS(): Promise<void> {
    if (this.sosBusy) return;
    const id = (this.lastTrip?.['id'] as number | undefined) ?? this.tripId;
    if (!id) return;

    const a = await this.alertCtrl.create({
      header: 'Send SOS?',
      message: 'Admins will be alerted with your trip and current location.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Send SOS',
          role: 'destructive',
          handler: () => {
            void this.doTriggerSOS(id);
          },
        },
      ],
    });
    await a.present();
  }

  private async doTriggerSOS(tripId: number): Promise<void> {
    this.sosBusy = true;
    const payload: { lat?: number; lng?: number } = {};
    try {
      const pos = await this.getCurrentPosition();
      if (pos) {
        payload.lat = pos.lat;
        payload.lng = pos.lng;
      }
    } catch {
      /* best-effort */
    }
    this.api.post(`/trips/${tripId}/sos`, payload).subscribe({
      next: async () => {
        const t = await this.toastCtrl.create({
          message: 'SOS sent. Help is on the way.',
          duration: 3000,
          color: 'success',
        });
        await t.present();
      },
      error: async (err: any) => {
        const t = await this.toastCtrl.create({
          message: err?.error?.message || 'Could not send SOS.',
          duration: 3000,
          color: 'danger',
        });
        await t.present();
      },
      complete: () => {
        this.sosBusy = false;
      },
    });
  }

  private getCurrentPosition(): Promise<{ lat: number; lng: number } | null> {
    return new Promise((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 10_000 }
      );
    });
  }

  ngOnInit(): void {
    this.refreshAvailable();
    this.availablePoll = setInterval(() => this.refreshAvailable(), 8000);
  }

  ngOnDestroy(): void {
    if (this.unsubscribeStatus) {
      this.unsubscribeStatus();
      this.unsubscribeStatus = null;
    }
    if (this.availablePoll) {
      clearInterval(this.availablePoll);
      this.availablePoll = null;
    }
    this.stopSelfPositionWatch();
  }

  refreshAvailable(): void {
    this.loadingAvailable = true;
    this.api.get<{ data: AvailableTrip[]; reason?: string }>('/trips/available').subscribe({
      next: (res) => {
        this.available = res?.data || [];
        if (res?.reason && !this.available.length) {
          this.message = res.reason;
        }
      },
      error: () => {
        // silent — driver may be offline / not approved yet
      },
      complete: () => {
        this.loadingAvailable = false;
      },
    });
  }

  pickAvailable(t: AvailableTrip, action: 'accept' | 'counter'): void {
    this.tripId = t.id;
    this.error = null;
    this.message = null;
    if (action === 'accept') {
      // Accept the customer's offer at face value.
      this.counterAmount = t.customer_offer ?? t.estimated_fare ?? 0;
      this.acceptCustomerOffer();
    } else {
      // Pre-fill counter at +10 over what the customer offered.
      const base = t.customer_offer ?? t.estimated_fare ?? 100;
      this.counterAmount = Math.round((base + 10) / 5) * 5;
    }
  }

  loadTrip(): void {
    const id = this.validId();
    if (id == null) return;
    this.busy = true;
    this.error = null;
    this.message = null;
    this.api
      .get<{ trip?: Record<string, unknown>; negotiation?: Record<string, unknown> }>(
        `/trips/${id}/negotiation`
      )
      .subscribe({
        next: (res) => {
          this.lastTrip = res.trip || null;
          this.negotiation = res.negotiation || null;
          // If we just loaded an in-flight trip (e.g. after a reload mid-ride),
          // bring up the live map and re-subscribe to streams.
          const status = this.lastTrip?.['status'] as string | undefined;
          if (status && status !== 'COMPLETED' && status !== 'CANCELLED') {
            void this.initLiveMap();
            this.startSelfPositionWatch();
            if (this.lastTrip?.['driver_id']) {
              this.startTripStreams(id);
            }
          }
        },
        error: (err) => {
          this.error = err?.error?.message || 'Could not load trip.';
          this.lastTrip = null;
        },
        complete: () => {
          this.busy = false;
        },
      });
  }

  get tripPaymentMethod(): PaymentMethod | null {
    const m = this.lastTrip?.['payment_method'];
    return m === 'cash' || m === 'upi' || m === 'qr' ? m : null;
  }

  get acceptsTripPayment(): boolean {
    const m = this.tripPaymentMethod;
    if (!m) return true;
    const accepted = this.auth.getUser()?.accepted_payment_methods ?? ['cash', 'upi', 'qr'];
    return accepted.includes(m);
  }

  get pickupCoords() {
    return this.lastTrip ? coordsFromTrip(this.lastTrip, 'pickup_lat', 'pickup_lng') : null;
  }

  get dropCoords() {
    return this.lastTrip ? coordsFromTrip(this.lastTrip, 'drop_lat', 'drop_lng') : null;
  }

  get canNavigatePickup(): boolean {
    return this.pickupCoords !== null;
  }

  get canNavigateDrop(): boolean {
    return this.dropCoords !== null;
  }

  get canNavigateRoute(): boolean {
    return this.pickupCoords !== null && this.dropCoords !== null;
  }

  /** From current location (or Maps default) to pickup. */
  navigateToPickup(): void {
    const dest = this.pickupCoords;
    if (!dest) return;
    openExternalUrl(googleMapsDirectionsUrl({ destination: dest, travelmode: 'driving' }));
  }

  /** From current location to drop-off. */
  navigateToDrop(): void {
    const dest = this.dropCoords;
    if (!dest) return;
    openExternalUrl(googleMapsDirectionsUrl({ destination: dest, travelmode: 'driving' }));
  }

  /** Full ride path: pickup → drop (no “my location” leg). */
  navigatePickupToDrop(): void {
    const a = this.pickupCoords;
    const b = this.dropCoords;
    if (!a || !b) return;
    openExternalUrl(googleMapsDirectionsUrl({ origin: a, destination: b, travelmode: 'driving' }));
  }

  private validId(): number | null {
    const raw = this.tripId;
    const id = raw == null || raw === ('' as unknown) ? NaN : Number(raw);
    if (!Number.isFinite(id) || id < 1) {
      this.error = 'Enter a valid trip ID';
      return null;
    }
    return id;
  }

  accept(): void {
    const id = this.validId();
    if (id == null) return;
    this.busy = true;
    this.error = null;
    this.message = null;
    this.api.post<{ trip?: Record<string, unknown> }>(`/trips/${id}/driver-accept`, {}).subscribe({
      next: (res) => {
        this.lastTrip = res.trip || null;
        this.message = 'Ride accepted';
        this.startTripStreams(id);
      },
      error: (err) => {
        this.error = err?.error?.message || 'Accept failed';
        this.lastTrip = null;
      },
      complete: () => {
        this.busy = false;
      },
    });
  }

  private startTripStreams(tripId: number): void {
    void this.bgLocation.start(tripId);

    if (this.unsubscribeStatus) this.unsubscribeStatus();
    this.unsubscribeStatus = this.realtime.subscribeTripStatus(
      tripId,
      (payload) => {
        if (this.lastTrip) this.lastTrip['status'] = payload.status;
        if (payload.status === 'COMPLETED' || payload.status === 'CANCELLED') {
          void this.bgLocation.stop();
          this.stopSelfPositionWatch();
        }
      },
      (payload) => this.onCustomerLocation(payload)
    );

    void this.initLiveMap();
    this.startSelfPositionWatch();
  }

  // ─────────────────────────────────────────────────────────────────
  // Live trip map
  // ─────────────────────────────────────────────────────────────────

  private async initLiveMap(): Promise<void> {
    if (this.mapReady) {
      this.refreshTripMarkers();
      return;
    }
    try {
      await this.mapsLoader.ensureLoaded();
      const div = document.getElementById('driver-trip-map');
      if (!div) return;
      this.map = new google.maps.Map(div, {
        center: { lat: 28.6139, lng: 77.209 },
        zoom: 14,
        disableDefaultUI: true,
      });
      this.mapReady = true;
      this.refreshTripMarkers();
    } catch {
      // Maps may be unavailable (no key, offline) — page still works without it.
    }
  }

  private refreshTripMarkers(): void {
    if (!this.map || !this.lastTrip) return;
    const pickup = coordsFromTrip(this.lastTrip, 'pickup_lat', 'pickup_lng');
    const drop = coordsFromTrip(this.lastTrip, 'drop_lat', 'drop_lng');

    if (pickup) {
      if (!this.pickupMarker) {
        this.pickupMarker = new google.maps.Marker({
          position: pickup,
          map: this.map,
          label: 'P',
          title: 'Pickup',
        });
      } else {
        this.pickupMarker.setPosition(pickup);
      }
    }
    if (drop) {
      if (!this.dropMarker) {
        this.dropMarker = new google.maps.Marker({
          position: drop,
          map: this.map,
          label: 'D',
          title: 'Drop',
        });
      } else {
        this.dropMarker.setPosition(drop);
      }
    }
    this.fitMap();
  }

  private fitMap(): void {
    if (!this.map) return;
    const bounds = new google.maps.LatLngBounds();
    let any = false;
    for (const m of [this.pickupMarker, this.dropMarker, this.customerMarker, this.selfMarker]) {
      if (m) {
        bounds.extend(m.getPosition());
        any = true;
      }
    }
    if (any) this.map.fitBounds(bounds, 80);
  }

  private onCustomerLocation(p: TripCustomerLocationPayload): void {
    const loc = p.location;
    if (loc?.lat == null || loc?.lng == null) return;
    const pos = { lat: Number(loc.lat), lng: Number(loc.lng) };
    this.customerPosition = pos;
    if (!this.map) return;
    if (!this.customerMarker) {
      this.customerMarker = new google.maps.Marker({
        position: pos,
        map: this.map,
        title: 'Customer',
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#1e6cf0',
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
        zIndex: 3,
      });
      this.fitMap();
    } else {
      this.customerMarker.setPosition(pos);
    }
  }

  private startSelfPositionWatch(): void {
    if (this.selfWatchId !== null) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    this.selfWatchId = navigator.geolocation.watchPosition(
      (pos) => this.onSelfPosition(pos),
      () => this.stopSelfPositionWatch(),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 10_000 }
    );
  }

  private stopSelfPositionWatch(): void {
    if (this.selfWatchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.selfWatchId);
    }
    this.selfWatchId = null;
  }

  private onSelfPosition(pos: GeolocationPosition): void {
    if (!this.map) return;
    const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (!this.selfMarker) {
      this.selfMarker = new google.maps.Marker({
        position: p,
        map: this.map,
        title: 'You',
        icon: {
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 6,
          fillColor: '#1f8b4c',
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
        zIndex: 2,
      });
      this.fitMap();
    } else {
      this.selfMarker.setPosition(p);
    }
  }

  markCustomerNoShow(): void {
    const id = this.tripId ?? (this.lastTrip?.['id'] as number | undefined);
    if (!id) return;
    this.busy = true;
    this.error = null;
    this.message = null;
    this.api
      .post<{ trip?: Record<string, unknown>; fee?: number }>(`/trips/${id}/no-show`, { role: 'customer' })
      .subscribe({
        next: (res) => {
          this.lastTrip = res.trip || null;
          const fee = res.fee ?? 0;
          this.message = `Trip cancelled (no-show). Cancellation fee ₹${fee}`;
          void this.bgLocation.stop();
        },
        error: (err) => {
          this.error = err?.error?.message || 'Could not mark no-show';
        },
        complete: () => {
          this.busy = false;
        },
      });
  }

  reject(): void {
    const id = this.validId();
    if (id == null) return;
    this.busy = true;
    this.error = null;
    this.message = null;
    this.api.post<{ message?: string }>(`/trips/${id}/driver-reject`, {}).subscribe({
      next: (res) => {
        this.message = res.message || 'Rejected';
        this.lastTrip = null;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Reject failed';
      },
      complete: () => {
        this.busy = false;
      },
    });
  }

  acceptCustomerOffer(): void {
    const id = this.validId();
    if (id == null) return;
    this.negBusy = true;
    this.error = null;
    this.message = null;

    this.api.post<{ negotiation: Record<string, unknown> }>(`/trips/${id}/negotiation/driver-action`, {
      action: 'ACCEPT',
    }).subscribe({
      next: (res) => {
        this.negotiation = res.negotiation || null;
        this.message = 'Offer accepted';
      },
      error: (err) => {
        this.error = err?.error?.message || 'Accept failed';
        this.negotiation = null;
      },
      complete: () => {
        this.negBusy = false;
      },
    });
  }

  counterCustomerOffer(): void {
    const id = this.validId();
    if (id == null) return;
    if (this.counterAmount == null || !Number.isFinite(this.counterAmount) || this.counterAmount < 0) {
      this.error = 'Enter a valid counter amount.';
      return;
    }

    this.negBusy = true;
    this.error = null;
    this.message = null;

    this.api
      .post<{ negotiation: Record<string, unknown> }>(`/trips/${id}/negotiation/driver-action`, {
        action: 'COUNTER',
        amount: this.counterAmount,
      })
      .subscribe({
        next: (res) => {
          this.negotiation = res.negotiation || null;
          this.message = 'Counter sent';
        },
        error: (err) => {
          this.error = err?.error?.message || 'Counter failed';
          this.negotiation = null;
        },
        complete: () => {
          this.negBusy = false;
        },
      });
  }

}
