import { of, Subject } from 'rxjs';
import { FixedRoutesComponent } from '../fixed/fixed-routes.component';

describe('Existing route editor names and assignments', () => {
  let page: FixedRoutesComponent;
  let api: any;
  const groups = [
    { id: 10, name: 'Stand A', city_vehicle_type_id: 5, route_ids: [7, 8], driver_user_ids: [100] },
    { id: 11, name: 'Stand B', city_vehicle_type_id: 6, route_ids: [7], driver_user_ids: [200] },
    { id: 12, name: 'Stand C', city_vehicle_type_id: 5, route_ids: [], driver_user_ids: [] },
  ];
  function route() {
    return { id: 7, name: 'Custom route title', scope: 'local', origin_city_id: null, dest_city_id: null,
      origin_name: 'Original start', dest_name: 'Original end', origin_lat: 34, origin_lng: 74, dest_lat: 34.1, dest_lng: 74.1,
      city_vehicle_type_id: 5, fare_config: { seat_fare: 50, commission_percent: 10 }, flat_fare: 50,
      is_active: true, path_polyline: [[34, 74], [34.1, 74.1]],
      stops: [{ id: 20, seq: 1, name: 'Original start', lat: 34, lng: 74, is_pickup: true, is_drop: false, is_active: true },
        { id: 21, seq: 2, name: 'Original end', lat: 34.1, lng: 74.1, is_pickup: false, is_drop: true, is_active: true }] } as any;
  }
  beforeEach(() => {
    api = { get: jasmine.createSpy().and.callFake((url: string) => of({ data: url.endsWith('/route-groups') ? groups : [{ id: 1, user_id: 100, name: 'Driver' }] })),
      patch: jasmine.createSpy().and.returnValue(of({ route: { id: 7 } })), post: jasmine.createSpy().and.returnValue(of({})), put: jasmine.createSpy().and.returnValue(of({})) };
    page = new FixedRoutesComponent(api, {} as any, { success: () => undefined, error: jasmine.createSpy() } as any, {} as any, {} as any, {} as any, {} as any);
    page.cityId = 1;
    spyOn<any>(page, 'scheduleMapInit'); spyOn<any>(page, 'clearAlternatives');
    spyOn(page, 'fetchRoutes');
  });
  it('loads the current stand and its drivers, keeps other stands visible and allows Review', () => {
    page.openEdit(route());
    expect(page.wizardStep).toBe(1); expect(page.tool).toBe('origin');
    expect(page.form.origin_name).toBe('Original start'); expect(page.form.dest_name).toBe('Original end');
    expect(page.form.assigned_group_id).toBe(10); expect(page.form.assigned_driver_ids).toEqual([100]);
    expect(page.additionalStandNames).toBe('Stand B');
    expect(page.vehicleFilteredGroups.map(group => group.id)).toContain(11);
    expect(page.getGroupDisplayName()).toBe('Stand A, Stand B');
    page.form.origin_name = 'Renamed start'; page.form.dest_name = 'Renamed end'; page.goToStep(6);
    expect(page.wizardStep).toBe(6); expect(page.formValid).toBeTrue();
    expect(page.form.origin_lat).toBe(34); expect(page.form.dest_lat).toBe(34.1);
  });
  it('saves renamed endpoints and original stop IDs without submitting any assignment changes', async () => {
    page.openEdit(route());
    const loads = spyOn(page, 'loadGroupsAndDrivers');
    page.form.origin_name = 'Renamed start'; page.form.dest_name = 'Renamed end';
    page.submit(); await Promise.resolve();
    expect(api.patch).toHaveBeenCalledTimes(1);
    const [url, payload] = api.patch.calls.mostRecent().args;
    expect(url).toBe('/admin/cities/1/fixed-routes/7');
    expect(payload.origin_name).toBe('Renamed start'); expect(payload.dest_name).toBe('Renamed end');
    expect(payload.stops.map((stop: any) => [stop.id, stop.name])).toEqual([[20, 'Renamed start'], [21, 'Renamed end']]);
    expect(payload.path_polyline).toEqual([[34, 74], [34.1, 74.1]]);
    expect(payload.city_vehicle_type_id).toBe(5); expect(payload.fare_config.seat_fare).toBe(50);
    expect(api.put).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled(); expect(loads).toHaveBeenCalled();
  });
  it('recognizes multiple models linked through stands and saves a route without a legacy model', async () => {
    const record = route(); record.city_vehicle_type_id = null;
    page.openEdit(record);
    page.groups = [{ id: 10, name: 'Linked stand', vehicle_set_ids: [90], route_ids: [7], driver_user_ids: [100] }];
    page.vehicleTypes = [
      { id: 5, display_name: 'SUMO', max_people: 9, luggage_capacity: 0, vehicle_set_id: 90 },
      { id: 6, display_name: 'TAVERA', max_people: 9, luggage_capacity: 0, vehicle_set_id: 90 },
      { id: 8, display_name: 'Other', max_people: 4, luggage_capacity: 0, vehicle_set_id: 91 },
    ];
    expect(page.vehicleTypes.map(vehicle => page.isVehicleLinkedThroughStand(vehicle))).toEqual([true, true, false]);
    expect(page.getVehicleDisplayName(null)).toBe('SUMO (9 seats), TAVERA (9 seats)');
    expect(page.vehicleFilteredGroups.length).toBe(1);
    expect(page.formValid).toBeTrue();
    page.goToStep(6); expect(page.wizardStep).toBe(6);
    page.submit(); await Promise.resolve();
    expect(api.patch.calls.mostRecent().args[1].city_vehicle_type_id).toBeNull();
    expect(api.patch.calls.count()).toBe(1);
    expect(api.put).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled();
  });
  it('does not assign an arbitrary catalogue model when the saved route model is null', () => {
    const record = route(); record.city_vehicle_type_id = null;
    page.openEdit(record);
    api.get.and.returnValue(of({ data: [{ id: '5', display_name: 'SUMO', max_people: 9, is_fixed: true, vehicle_set_id: '90' }] }));
    page.loadVehicleTypes();
    expect(page.form.city_vehicle_type_id).toBeNull();
    expect(page.vehicleTypes[0].id).toBe(5); expect(page.vehicleTypes[0].vehicle_set_id).toBe(90);
  });
  it('normalizes the saved vehicle ID so the corresponding chip is selected', () => {
    const record = route(); record.city_vehicle_type_id = '5';
    page.openEdit(record);
    expect(page.form.city_vehicle_type_id).toBe(5);
  });
  it('searches independently of the editable endpoint names', async () => {
    page.openEdit(route());
    const geocode = spyOn(page, 'geocodeAndSetLocation').and.resolveTo();
    page.originSearchText = 'New start search';
    page.destSearchText = 'New destination search';
    await page.onOriginSearchEnter();
    await page.onDestSearchEnter();
    expect(geocode.calls.allArgs()).toEqual([['New start search', 'origin'], ['New destination search', 'dest']]);
    expect(page.form.origin_name).toBe('Original start');
    expect(page.form.dest_name).toBe('Original end');
    page.form.origin_name = 'Custom start';
    page.form.dest_name = 'Custom end';
    page.onOriginSearchBlur(); page.onDestSearchBlur();
    expect(geocode).toHaveBeenCalledTimes(2);
    expect(page.form.origin_lat).toBe(34); expect(page.form.dest_lat).toBe(34.1);
  });
  it('prefills existing endpoint searches and clears them for a new route', () => {
    page.originSearchText = 'Old start'; page.destSearchText = 'Old end';
    page.openEdit(route());
    expect(page.originSearchText).toBe('Original start'); expect(page.destSearchText).toBe('Original end');
    page.originSearchText = 'Another start'; page.destSearchText = 'Another end';
    page.openCreate();
    expect(page.originSearchText).toBe(''); expect(page.destSearchText).toBe('');
    expect(page.form.origin_name).toBe(''); expect(page.form.dest_name).toBe('');
  });
  it('autofills names from located places and permits renaming before saving', async () => {
    page.openCreate();
    (page as any).map = { panTo: () => undefined, setZoom: () => undefined };
    const location = { lat: () => 34, lng: () => 74 };
    (page as any).geocoder = { geocode: (_request: any, callback: any) => callback([
      { formatted_address: 'Selected landmark, City', geometry: { location } },
    ], 'OK') };
    spyOn<any>(page, 'bestGeocodeStopName').and.returnValue('Selected landmark');
    spyOn<any>(page, 'setOrigin').and.resolveTo();
    spyOn<any>(page, 'setDest').and.resolveTo();
    page.originSearchText = 'Start search'; page.destSearchText = 'End search';
    await page.onOriginSearchEnter(); await page.onDestSearchEnter();
    expect(page.form.origin_name).toBe('Selected landmark');
    expect(page.form.dest_name).toBe('Selected landmark');
    page.form.origin_name = 'Custom origin'; page.form.dest_name = 'Custom destination';
    expect(page.originSearchText).toBe('Selected landmark'); expect(page.destSearchText).toBe('Selected landmark');
  });
  it('adds an explicitly selected stand without removing existing stand memberships', async () => {
    page.openEdit(route()); spyOn(page, 'loadGroupsAndDrivers');
    page.form.assigned_group_id = 12; page.form.assigned_driver_ids = [];
    page.onGroupSelected(12); page.submit();
    await new Promise(resolve => setTimeout(resolve, 0));
    const calls = api.patch.calls.allArgs();
    expect(calls.length).toBe(2); expect(calls[1][0]).toBe('/admin/cities/1/route-groups/12');
    expect(calls[1][1].route_ids).toEqual([7]);
    expect(calls.some((args: any[]) => /route-groups\/(10|11)$/.test(args[0]))).toBeFalse();
  });
  it('does not overwrite an explicit selection with a late assignment response', () => {
    const result = new Subject<any>(); api.get.and.callFake((url: string) => url.endsWith('/route-groups') ? result : of({ data: [{ id: 1 }] }));
    page.openEdit(route()); page.form.assigned_group_id = 'new'; page.form.new_group_name = 'New stand';
    result.next({ data: groups }); expect(page.form.assigned_group_id).toBe('new');
  });
  it('allows an independent existing route to stay independent, while a new route still needs a stand', () => {
    api.get.and.returnValue(of({ data: [] })); page.openEdit(route());
    expect(page.form.assigned_group_id).toBeNull(); expect(page.formValid).toBeTrue();
    page.openCreate(); Object.assign(page.form, route(), { city_vehicle_type_id: 5, seat_fare: 50 });
    expect(page.formValid).toBeFalse();
  });
  it('discards late group responses after the editor closes', () => {
    const result = new Subject<any>(); api.get.and.callFake((url: string) => url.endsWith('/route-groups') ? result : of({ data: [{ id: 1 }] }));
    page.openEdit(route()); page.closeEditor(); result.next({ data: groups });
    expect(page.form.assigned_group_id).toBeNull();
  });
});
