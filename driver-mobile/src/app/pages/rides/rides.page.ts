import { Component, OnDestroy, OnInit } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { AuthService, PaymentMethod } from '../../core/auth.service';
import { BackgroundLocationService } from '../../core/background-location.service';
import { RealtimeService } from '../../core/realtime.service';
import {
  coordsFromTrip,
  googleMapsDirectionsUrl,
  openExternalUrl,
} from '../../core/maps-navigation';

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

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private bgLocation: BackgroundLocationService,
    private realtime: RealtimeService
  ) {}

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
    this.unsubscribeStatus = this.realtime.subscribeTripStatus(tripId, (payload) => {
      if (this.lastTrip) this.lastTrip['status'] = payload.status;
      if (payload.status === 'COMPLETED' || payload.status === 'CANCELLED') {
        void this.bgLocation.stop();
      }
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
