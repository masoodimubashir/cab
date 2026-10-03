import { of, Subject } from 'rxjs';
import { DriversListComponent } from './drivers-list.component';
import { DriverRouteGroupsPanelComponent } from './driver-route-groups-panel.component';

describe('All Drivers route allocation integration', () => {
  let page: DriversListComponent;
  let api: { get: jasmine.Spy };
  beforeEach(() => {
    api = { get: jasmine.createSpy() };
    page = new DriversListComponent(api as any, { error: jasmine.createSpy() } as any, {} as any, {} as any, {} as any, {} as any);
  });
  it('loads hosted membership data without inventing a zero route count', () => {
    api.get.and.callFake((url: string) => url.includes('/route-groups')
      ? of({ assigned_group_ids: [2], groups: [{ id: 1, name: 'Other' }, { id: 2, name: 'Airport' }] })
      : of({ data: { data: [{ id: 4 }], total: 1 } }));
    page.reload();
    expect(page.rows[0].route_groups?.map(group => group.name)).toEqual(['Airport']);
    expect(page.rows[0].allocated_route_count).toBeUndefined();
    expect(page.allocationFiltersSupported).toBeFalse();
    page.reload();
    expect(api.get.calls.allArgs().filter(args => args[0].includes('/route-groups')).length).toBe(1);
  });
  it('cancels an old request when city or vehicle filters change during loading', () => {
    const old = new Subject<any>();
    api.get.and.returnValue(old);
    page.reload();
    api.get.and.returnValue(of({ allocation_filters_supported: true, data: { data: [], total: 0 } }));
    page.allocationCityId = 8; page.allocationVehicleId = 12; page.cityScope = 'selected'; page.reload();
    expect(api.get.calls.mostRecent().args[0]).toContain('city_id=8');
    expect(api.get.calls.mostRecent().args[0]).toContain('city_vehicle_type_id=12');
    old.next({ data: { data: [{ id: 99 }], total: 1 } });
    expect(page.rows).toEqual([]); expect(page.total).toBe(0);
    expect(page.allocationFiltersSupported).toBeTrue();
  });
});
describe('Driver assignment loading', () => {
  it('blocks saves before a successful read and after a load failure', () => {
    const response = new Subject<any>();
    const api = { get: jasmine.createSpy().and.returnValue(response), put: jasmine.createSpy() };
    const panel = new DriverRouteGroupsPanelComponent(api as any, {} as any);
    panel.driverId = 4; panel.load(); panel.save(); expect(api.put).not.toHaveBeenCalled();
    response.error(new Error('Unavailable')); panel.save(); expect(api.put).not.toHaveBeenCalled();
    expect(panel.loadFailed).toBeTrue();
  });
});