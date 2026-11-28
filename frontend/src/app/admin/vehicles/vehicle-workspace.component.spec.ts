/// <reference types="google.maps" />
import { of, Subject, throwError } from 'rxjs';
import { fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { VehicleWorkspaceComponent } from './vehicle-workspace.component';

describe('Vehicle workspace group workflow', () => {
  let page: any;
  const vehicle = { id: 1 };
  let group: any;
  beforeEach(() => {
    page = Object.create(VehicleWorkspaceComponent.prototype);
    group = { id: 10, name: 'Town routes', city_vehicle_type_id: 1, route_ids: [1], driver_user_ids: [] };
    Object.assign(page, {
      cityId: 1, groups: [group], groupSearch: '', groupRouteSearch: '',
      selectedGroupSection: 10, showGroupRoutePicker: true, savingGroupRoutes: false,
      pendingGroupRouteIds: new Set([2, 3, 4, 5]),
      routes: [
        { id: 1, name: 'Existing', city_vehicle_type_id: 1, is_active: true, flat_fare: 10 },
        { id: 2, name: 'Market', origin_name: 'Town', dest_name: 'Market', city_vehicle_type_id: 1, is_active: true, flat_fare: 20 },
        { id: 3, name: 'No fare', city_vehicle_type_id: 1, is_active: true, flat_fare: null },
        { id: 4, name: 'Inactive', city_vehicle_type_id: 1, is_active: false, flat_fare: 20 },
        { id: 5, name: 'Other vehicle', city_vehicle_type_id: 2, is_active: true, flat_fare: 20 },
      ],
      api: { patch: jasmine.createSpy().and.returnValue(of({})) },
      toast: { success: jasmine.createSpy(), error: jasmine.createSpy() },
      loadGroups: jasmine.createSpy(),
    });
  });

  it('adds eligible selected routes in one request and preserves existing membership', () => {
    page.addSelectedRoutesToGroup(vehicle, group);
    expect(page.api.patch).toHaveBeenCalledOnceWith('/admin/cities/1/route-groups/10', {
      name: 'Town routes', route_ids: [1, 2],
    });
    expect(group.route_ids).toEqual([1, 2]);
    expect(page.pendingGroupRouteIds.size).toBe(0);
    expect(page.showGroupRoutePicker).toBeFalse();
  });

  it('preserves selections and membership when saving fails', () => {
    page.api.patch.and.returnValue(throwError(() => new Error('offline')));
    page.addSelectedRoutesToGroup(vehicle, group);
    expect(group.route_ids).toEqual([1]);
    expect(page.pendingGroupRouteIds.has(2)).toBeTrue();
    expect(page.savingGroupRoutes).toBeFalse();
    expect(page.toast.error).toHaveBeenCalled();
  });

  it('blocks duplicate submission while adding routes', () => {
    const response = new Subject();
    page.api.patch.and.returnValue(response);
    page.addSelectedRoutesToGroup(vehicle, group);
    page.addSelectedRoutesToGroup(vehicle, group);
    expect(page.api.patch).toHaveBeenCalledTimes(1);
    response.next({});
    response.complete();
  });

  it('clears stale selections and search when switching groups', () => {
    page.kanbanSearch = 'old search';
    page.openDriverDropdownGroupId = 10;
    page.selectGroupSection('inactive');
    expect(page.selectedGroupSection).toBe('inactive');
    expect(page.pendingGroupRouteIds.size).toBe(0);
    expect(page.showGroupRoutePicker).toBeFalse();
    expect(page.openDriverDropdownGroupId).toBeNull();
    expect(page.kanbanSearch).toBe('');
  });

  it('finds groups by name and only shows the selected group', () => {
    page.groupSearch = ' TOWN ';
    expect(page.navigationGroups(vehicle)).toEqual([group]);
    expect(page.selectedOperationGroups(vehicle)).toEqual([group]);
    page.groupSearch = 'missing';
    expect(page.navigationGroups(vehicle)).toEqual([]);
  });
  it('shows shared groups for a member even when its displayed row uses another ride mode', () => {
    const member = { id: 6, mode_row_ids: [6, 7], vehicle_set_ids: [20] };
    group.vehicle_set_ids = [20];
    expect(page.groupsForVehicle(member)).toEqual([group]);
    expect(page.routesForVehicle(member).map((route: any) => route.id)).toEqual([1]);
    member.vehicle_set_ids = [];
    expect(page.groupsForVehicle(member)).toEqual([]);
  });

  it('searches ungrouped routes without showing inactive or other-vehicle routes', () => {
    page.groupRouteSearch = ' market ';
    expect(page.groupRouteCandidates(vehicle).map((r: any) => r.id)).toEqual([2]);
  });
  it('connects compact vehicle actions to the existing fare, fleet and copy editors', () => {
    page.vehicles = [vehicle]; page.rideTypes = [{ id: 7, name: 'Private' }];
    page.openFareDrawer = jasmine.createSpy(); page.openOperationsDrawer = jasmine.createSpy(); page.openCopyModal = jasmine.createSpy();
    page.handleOperationsAction({ kind: 'vehicle-fare', id: 1, rideTypeId: 7 });
    expect(page.openFareDrawer).toHaveBeenCalledWith(vehicle, page.fareRideTypes[0]);
    page.handleOperationsAction({ kind: 'vehicle-drivers', id: 1 });
    expect(page.openOperationsDrawer).toHaveBeenCalledWith(vehicle, 'drivers');
    page.handleOperationsAction({ kind: 'copy-vehicles', ids: [1] });
    expect([...page.selectedIds]).toEqual([1]); expect(page.openCopyModal).toHaveBeenCalled();
  });
  it('copies a batch from Shared Vehicles to selected cities without overwriting their settings by default', () => {
    const vehicles = Array.from({ length: 10 }, (_, index) => ({ id: index + 11 }));
    Object.assign(page, {
      sharedVehicles: true, vehicles, selectedIds: new Set(), copyForm: {},
      cityCtx: { ensureCitiesLoaded: () => of([]) },
      allCities: [{ id: 1, name: 'Srinagar' }, { id: 2, name: 'Sopore' }, { id: 3, name: 'Kupwara' }],
    });
    page.api.post = jasmine.createSpy().and.returnValue(of({}));
    page.openCopyModal();
    expect(page.availableTargetCities.map((city: { id: number }) => city.id)).toEqual([2, 3]);
    expect(page.copyForm.target_city_ids).toEqual([]);
    page.toggleTargetCity(2);
    page.submitCopyToLocation();
    expect(page.api.post).toHaveBeenCalledOnceWith('/admin/cities/1/vehicle-types/copy-to-city', {
      vehicle_ids: vehicles.map(vehicle => vehicle.id), target_city_ids: [2],
      overwrite_existing: false, copy_pricing: true, copy_seat_layouts: true,
    });
  });
  it('imports the source fleet into the current empty city and refreshes it', () => {
    Object.assign(page, {
      sharedVehicles: true, vehicles: [], rideTypes: [], selectedIds: new Set(), copyForm: {},
      cityCtx: { ensureCitiesLoaded: () => of([]) }, refresh: jasmine.createSpy(),
      allCities: [{ id: 1, name: 'Sopore' }, { id: 2, name: 'Srinagar' }],
    });
    page.api.get = jasmine.createSpy().and.returnValue(of({data: [{id: 11, display_name: 'Sumo', vehicle_type_id: 5}]}));
    page.api.post = jasmine.createSpy().and.returnValue(of({}));
    page.openImport();
    expect(page.api.get).toHaveBeenCalledOnceWith('/admin/cities/2/vehicle-types');
    page.submitCopyToLocation();
    expect(page.api.post).toHaveBeenCalledOnceWith('/admin/cities/2/vehicle-types/copy-to-city', {
      vehicle_ids: [11], target_city_ids: [1], overwrite_existing: false, copy_pricing: true, copy_seat_layouts: true,
    });
    expect(page.refresh).toHaveBeenCalledTimes(1);
  });
  it('edits only the changed field in the current city and the checked cities', () => {
    Object.assign(page, {
      commonDrawerVehicle: { id: 7, display_name: 'Sumo', max_people: 4, luggage_capacity: 1 },
      common: { display_name: 'Sumo', max_people: 7, luggage_capacity: 1 },
      editCityIds: [2], load: jasmine.createSpy(),
    });
    page.saveCommon();
    expect(page.api.patch).toHaveBeenCalledOnceWith('/admin/cities/1/vehicle-types/7/shared-details',
      { max_people: 7, target_city_ids: [2] });
  });
  it('keeps inline edits connected to the existing save and cancel behavior', () => {
    page.vehicles = [vehicle]; page.startCellEdit = jasmine.createSpy(); page.commitCellEdit = jasmine.createSpy(); page.cancelCellEdit = jasmine.createSpy();
    page.handleOperationsCellEdit({ phase: 'start', id: 1, field: 'seats' });
    expect(page.startCellEdit).toHaveBeenCalledWith(vehicle, 'seats');
    page.handleOperationsCellEdit({ phase: 'change', id: 1, field: 'seats', value: '9' }); expect(page.editValue).toBe('9');
    page.handleOperationsCellEdit({ phase: 'save', id: 1, field: 'seats' }); expect(page.commitCellEdit).toHaveBeenCalledWith(vehicle);
    page.handleOperationsCellEdit({ phase: 'cancel', id: 1, field: 'seats' }); expect(page.cancelCellEdit).toHaveBeenCalled();
  });
  it('retries only the unfinished cities when the older API saves part of a rename', fakeAsync(() => {
    Object.assign(page, {
      commonDrawerVehicle: { id: 7, display_name: 'Sumo', max_people: 4, luggage_capacity: 1 },
      common: { display_name: 'Sumo XL', max_people: 4, luggage_capacity: 1 },
      editCityIds: [2], legacyVehicleIds: new Map([[2, 12]]), allCities: [{ id: 2, name: 'Sopore' }],
      load: jasmine.createSpy(),
    });
    page.api.patch.and.returnValues(of({}), throwError(() => ({status: 503})), of({}));
    page.saveCommon(); flushMicrotasks();
    expect(page.editSaveError).toContain('Still to save in Sopore');
    page.saveCommon(); flushMicrotasks();
    const urls = page.api.patch.calls.allArgs().map((args: any[]) => args[0]);
    expect(urls).toEqual(['/admin/cities/1/vehicle-types/7/shared-details',
      '/admin/cities/2/vehicle-types/12/shared-details', '/admin/cities/2/vehicle-types/12/shared-details']);
  }));
});
