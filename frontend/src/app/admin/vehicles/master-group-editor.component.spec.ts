import { SimpleChange } from '@angular/core';
import { Subject } from 'rxjs';
import { MasterGroupEditorComponent } from './master-group-editor.component';

describe('Focused Master group editor', () => {
  let editor: MasterGroupEditorComponent;
  let api: any;
  let response: Subject<any>;
  beforeEach(() => {
    response = new Subject<any>();
    api = { patch: jasmine.createSpy().and.returnValue(response), put: jasmine.createSpy().and.returnValue(response) };
    editor = new MasterGroupEditorComponent(api, { success: jasmine.createSpy(), error: jasmine.createSpy() } as any);
    editor.group = { id: 7, name: 'Airport', is_active: true, city_vehicle_type_id: 10, route_ids: [1], driver_user_ids: [50] };
    editor.cityId = 2;
    editor.routes = [
      { id: 1, name: 'Route one', scope: 'local', origin_name: 'Origin', dest_name: 'Destination', flat_fare: 20, is_active: true, booking_window_hours: 2, city_vehicle_type_id: 10 },
      { id: 2, name: 'Route two', scope: 'local', origin_name: 'Origin', dest_name: 'Destination', flat_fare: null, is_active: true, booking_window_hours: 2, city_vehicle_type_id: 10 },
    ];
    editor.ngOnChanges({ group: new SimpleChange(null, editor.group, true) });
  });
  it('opens with only assigned routes and changes drafts without mutating records or saving', () => {
    expect(editor.shownRoutes.map(route => route.id)).toEqual([1]);
    editor.toggleRoute(editor.routes[0]); editor.toggleDriver(50);
    expect(editor.group.route_ids).toEqual([1]); expect(editor.group.driver_user_ids).toEqual([50]);
    expect(api.patch).not.toHaveBeenCalled(); expect(api.put).not.toHaveBeenCalled();
  });
  it('blocks new unpriced routes and saves explicit removal to the existing API', () => {
    editor.toggleRoute(editor.routes[1]); expect(editor.routeIds.has(2)).toBeFalse();
    editor.toggleRoute(editor.routes[0]); editor.save();
    expect(api.patch).toHaveBeenCalledOnceWith('/admin/cities/2/route-groups/7', { name: 'Airport', route_ids: [] });
    response.next({}); expect(editor.routesChanged).toBeFalse();
  });
  it('saves driver user IDs separately without losing a pending name edit', () => {
    editor.name = 'Renamed'; editor.setTab('drivers'); editor.toggleDriver(60); editor.save();
    expect(api.put).toHaveBeenCalledOnceWith('/admin/cities/2/route-groups/7/drivers', { driver_user_ids: [50, 60] });
    response.next({}); expect(editor.driversChanged).toBeFalse(); expect(editor.routesChanged).toBeTrue();
    editor.group = { ...editor.group, driver_user_ids: [50, 60] };
    editor.ngOnChanges({ group: new SimpleChange(null, editor.group, false) });
    expect(editor.name).toBe('Renamed');
  });
  it('keeps drafts available to retry after a save failure', () => {
    editor.name = 'Renamed'; editor.save(); response.error({ error: { message: 'Try again' } });
    expect(editor.saving).toBeFalse(); expect(editor.routesChanged).toBeTrue(); expect(editor.name).toBe('Renamed');
  });
});
