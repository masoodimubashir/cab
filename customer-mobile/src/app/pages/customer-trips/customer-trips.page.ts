import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import {
  coordsFromTrip,
  googleMapsDirectionsUrl,
  openExternalUrl,
} from '../../core/maps-navigation';

@Component({
  selector: 'app-customer-trips',
  templateUrl: './customer-trips.page.html',
  styleUrls: ['./customer-trips.page.scss'],
  standalone: false,
})
export class CustomerTripsPage {
  loading = false;
  error: string | null = null;
  trips: Record<string, unknown>[] = [];

  constructor(
    private api: ApiService,
    private router: Router
  ) {}

  ionViewWillEnter(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading = true;
    this.error = null;
    this.api.get<{ data: { data?: Record<string, unknown>[] } }>('/customer/trips/history').subscribe({
      next: (res) => {
        const page = res.data as { data?: Record<string, unknown>[] };
        this.trips = (page?.data as Record<string, unknown>[]) || [];
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load trips';
        this.trips = [];
      },
      complete: () => {
        this.loading = false;
      },
    });
  }

  navigatePickupToDrop(t: Record<string, unknown>): void {
    const pickup = coordsFromTrip(t, 'pickup_lat', 'pickup_lng');
    const drop = coordsFromTrip(t, 'drop_lat', 'drop_lng');
    if (!pickup || !drop) return;
    openExternalUrl(
      googleMapsDirectionsUrl({
        origin: pickup,
        destination: drop,
        travelmode: 'driving',
      })
    );
  }

  navigateToNegotiation(t: Record<string, unknown>): void {
    const rawId = t['id'] as unknown;
    const tripId = typeof rawId === 'number' ? rawId : Number(rawId);
    if (!Number.isFinite(tripId) || tripId < 1) return;
    this.router.navigateByUrl(`/customer-tabs/trip/${tripId}`, { replaceUrl: true });
  }
}

