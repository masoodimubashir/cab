import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/api.service';
import { FixedCustomerLocationService } from '../../../core/fixed-customer-location.service';
import type { FixedDeparture, FixedRoute } from './fixed.page';

type Origin = { lat: number; lng: number; source: 'location' | 'route' };

@Component({
  selector: 'app-nearby-departures', standalone: false,
  templateUrl: './nearby-departures.page.html', styleUrls: ['./nearby-departures.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NearbyDeparturesPage implements OnDestroy {
  loading = true;
  error = '';
  routeId = 0;
  origin: Origin | null = null;
  options: Array<{ route: FixedRoute; departures: FixedDeparture[] }> = [];
  private requestId = 0;
  private navigationOrigin: Origin | null;

  constructor(private api: ApiService, private router: Router, private activatedRoute: ActivatedRoute,
    private location: FixedCustomerLocationService, private cdr: ChangeDetectorRef) {
    this.navigationOrigin = this.router.getCurrentNavigation()?.extras.state?.['nearbyOrigin'] ?? null;
  }

  ionViewWillEnter(): void {
    const routeId = Number(this.activatedRoute.snapshot.queryParamMap.get('routeId'));
    if (routeId !== this.routeId) {
      this.origin = null;
      this.navigationOrigin = this.router.getCurrentNavigation()?.extras.state?.['nearbyOrigin'] ?? this.navigationOrigin;
    }
    this.routeId = routeId;
    void this.refresh();
  }

  ionViewWillLeave(): void { ++this.requestId; }
  ngOnDestroy(): void { ++this.requestId; }

  async refresh(): Promise<void> {
    const requestId = ++this.requestId;
    this.loading = true;
    this.error = '';
    this.options = [];
    this.cdr.markForCheck();
    try {
      if (!Number.isSafeInteger(this.routeId) || this.routeId <= 0) throw new Error('Missing route');
      if (!this.origin || this.origin.source === 'location') {
        const fix = await firstValueFrom(this.location.fix$);
        this.origin = fix ? { lat: fix.lat, lng: fix.lng, source: 'location' } : this.navigationOrigin;
        if (!this.origin) {
          const res = await firstValueFrom(this.api.get<{ data: FixedRoute }>(`/fixed/routes/${this.routeId}`));
          const start = res.data.starting_stop ?? res.data.stops[0];
          if (start?.lat != null && start?.lng != null) this.origin = { lat: start.lat, lng: start.lng, source: 'route' };
        }
      }
      if (requestId !== this.requestId) return;
      if (!this.origin || !Number.isFinite(this.origin.lat) || !Number.isFinite(this.origin.lng)) {
        this.error = 'Allow location access to find nearby departures, or return to choose another route.';
        return;
      }
      const res = await firstValueFrom(this.api.get<{ data: Array<{ route: FixedRoute; departures: FixedDeparture[] }> }>(
        `/fixed/routes/${this.routeId}/nearby-departures?lat=${this.origin.lat}&lng=${this.origin.lng}`,
      ));
      if (requestId === this.requestId) this.options = res.data ?? [];
    } catch {
      if (requestId === this.requestId) this.error = 'Couldn’t load nearby departures. Please check your connection and try again.';
    } finally {
      if (requestId === this.requestId) { this.loading = false; this.cdr.markForCheck(); }
    }
  }

  openRoute(route: FixedRoute): void {
    void this.router.navigate(['/customer-tabs/go/fixed'], { queryParams: { routeId: route.id }, replaceUrl: true });
  }

  back(): void {
    void this.router.navigate(['/customer-tabs/go/fixed'], {
      queryParams: Number.isSafeInteger(this.routeId) && this.routeId > 0 ? { routeId: this.routeId } : {}, replaceUrl: true,
    });
  }

  distance(meters: number | null | undefined): string {
    if (meters == null) return '';
    return meters < 1000 ? `${Math.round(meters)} m away` : `${(meters / 1000).toFixed(1)} km away`;
  }
}
