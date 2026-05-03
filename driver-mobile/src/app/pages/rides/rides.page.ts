import { Component } from '@angular/core';
import { ApiService } from '../../core/api.service';
import {
  coordsFromTrip,
  googleMapsDirectionsUrl,
  openExternalUrl,
} from '../../core/maps-navigation';

@Component({
  selector: 'app-rides',
  templateUrl: './rides.page.html',
  styleUrls: ['./rides.page.scss'],
  standalone: false,
})
export class RidesPage {
  tripId: number | null = null;
  busy = false;
  message: string | null = null;
  error: string | null = null;
  lastTrip: Record<string, unknown> | null = null;

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

  constructor(private api: ApiService) {}

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
