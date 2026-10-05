import { FixedBookPage } from './fixed.page';
import { Subject } from 'rxjs';

describe('Customer route category filters', () => {
  let page: FixedBookPage;
  beforeEach(() => {
    page = Object.create(FixedBookPage.prototype);
    Object.assign(page, {
      routeScope: 'all', search: '', radiusFilterActive: true,
      userCoords: { lat: 34, lng: 74 },
      cdr: { markForCheck: jasmine.createSpy() },
      routes: [
        { id: 1, scope: 'local', distance_to_nearest_pickup: 100 },
        { id: 2, scope: 'outstation', distance_to_nearest_pickup: 200 },
        { id: 3, scope: 'outstation', distance_to_nearest_pickup: 1500 },
        { id: 4, scope: 'local', distance_to_nearest_pickup: null },
      ],
    });
  });

  it('keeps nearby and all-route results within the selected category', () => {
    page.setRouteScope('outstation');
    expect(page.visibleRoutes.map(route => route.id)).toEqual([2]);
    expect(page.nearbyRoutesCount).toBe(1);
    expect(page.scopedRoutes.length).toBe(2);
    page.setRadiusFilter(false);
    expect(page.visibleRoutes.map(route => route.id)).toEqual([2, 3]);
    page.setRouteScope('local');
    expect(page.visibleRoutes.map(route => route.id)).toEqual([1, 4]);
    page.setRouteScope('all');
    expect(page.visibleRoutes.length).toBe(4);
  });

  it('preserves the category for search results even when nearby filtering is bypassed', () => {
    page.search = 'matching route';
    page.setRouteScope('outstation');
    expect(page.visibleRoutes.map(route => route.id)).toEqual([2, 3]);
    page.setRouteScope('local');
    expect(page.visibleRoutes.map(route => route.id)).toEqual([1, 4]);
  });

  it('works without location permission and returns no unrelated routes for an empty category', () => {
    page.userCoords = null;
    page.setRouteScope('local');
    expect(page.visibleRoutes.map(route => route.id)).toEqual([1, 4]);
    page.routes = page.routes.filter(route => route.scope === 'outstation');
    expect(page.visibleRoutes).toEqual([]);
    expect(page.nearbyRoutesCount).toBe(0);
    page.setRouteScope('all');
    expect(page.visibleRoutes.length).toBe(2);
  });

  it('updates the nearest pickup and distance from live fixes and unsubscribes on destruction', async () => {
    const fixes = new Subject<any>();
    const target = page as any;
    const stop = (id: number, lat: number) => ({ id, seq: id, name: `Stop ${id}`, lat, lng: 74, is_pickup: true, is_active: true, is_temporarily_unavailable: false });
    Object.assign(target, {
      userCoords: null, cities: [],
      routes: [{ id: 1, scope: 'local', stops: [stop(1, 34), stop(2, 34.01)] }],
      booking: { trip: { cityId: 1 } },
      fixedLocation: { fix$: fixes, start: async () => {} },
      initUserLocation: async () => {}, loadCities: async () => {}, loadRoutes: () => {}, checkActiveHold: () => {},
      paymentOptions: { load: async () => ({}) }, stopApprovalWaiting: () => {},
    });
    await page.ngOnInit();
    fixes.next({ lat: 34.001, lng: 74, accuracy: 10 });
    expect(page.routes[0].nearest_pickup_stop?.id).toBe(1);
    expect(page.routes[0].distance_to_nearest_pickup).toBe(111);
    fixes.next({ lat: 34.009, lng: 74, accuracy: 20 });
    expect(page.routes[0].nearest_pickup_stop?.id).toBe(2);
    expect(page.locationAccuracy).toBe(20);
    page.ngOnDestroy();
    fixes.next({ lat: 34, lng: 74, accuracy: 5 });
    expect(page.routes[0].nearest_pickup_stop?.id).toBe(2);
  });

  it('clears an old nearest-stop distance if no eligible pickup remains', () => {
    const target = page as any;
    page.routes = [{ id: 1, scope: 'local', distance_to_nearest_pickup: 85, nearest_pickup_stop: { id: 1 }, stops: [{ id: 1, lat: 34, lng: 74, is_pickup: true, is_active: false, is_nearest_pickup: true }] }] as any;
    target.annotateRoutesWithProximity();
    expect(page.routes[0].nearest_pickup_stop).toBeNull();
    expect(page.routes[0].distance_to_nearest_pickup).toBeNull();
    expect(page.routes[0].stops[0].is_nearest_pickup).toBeFalse();
  });

  it('retries real GPS and reports failure without inventing a distance', async () => {
    const target = page as any;
    Object.assign(target, { userCoords: null, geo: { getCurrentFix: async () => null } });
    await page.refreshLocation();
    expect(page.userCoords).toBeNull();
    expect(page.locating).toBeFalse();
    expect(page.locationMessage).toContain('Allow location access');
    target.geo.getCurrentFix = async () => ({ lat: 34, lng: 74, accuracy: 15 });
    target.loadRoutes = jasmine.createSpy();
    await page.refreshLocation();
    expect(page.userCoords).toEqual({ lat: 34, lng: 74 });
    expect(page.locationAccuracy).toBe(15);
    expect(page.locationMessage).toBe('');
    expect(target.loadRoutes).toHaveBeenCalledTimes(1);
  });
});
