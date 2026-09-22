/// <reference types="google.maps" />
import { of, Subject, throwError } from 'rxjs';
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

  it('searches ungrouped routes without showing inactive or other-vehicle routes', () => {
    page.groupRouteSearch = ' market ';
    expect(page.groupRouteCandidates(vehicle).map((r: any) => r.id)).toEqual([2]);
  });
});
