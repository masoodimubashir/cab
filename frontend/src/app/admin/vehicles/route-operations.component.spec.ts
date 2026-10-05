import { SimpleChange } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { RouteOperationsComponent } from './route-operations.component';
import { RouteGroupSetupComponent } from './route-group-setup.component';

describe('Routes operations workspace', () => {
  let page: RouteOperationsComponent;
  beforeEach(() => {
    page = new RouteOperationsComponent(); page.cityId = 1; page.cityName = 'Sopore';
    page.vehicles = [{ id: 1, display_name: 'Sumo', vehicle_type_id: 1, max_people: 9, luggage_capacity: 1, is_active: true, vehicle_set_ids: [10] }, { id: 2, display_name: 'Bus', vehicle_type_id: 2, max_people: 30, luggage_capacity: 2, is_active: false, vehicle_set_ids: [10] }];
    page.groups = [{ id: 5, name: 'Town service', is_active: true, city_vehicle_type_id: 1, vehicle_set_ids: [10], route_ids: [20], driver_user_ids: [50] }];
    page.routes = [{ id: 20, name: 'Market route', origin_name: 'Town', dest_name: 'Market', city_vehicle_type_id: 1, scope: 'local', flat_fare: 20, booking_window_hours: 2, is_active: true }, { id: 21, name: 'Incomplete', origin_name: 'Town', dest_name: 'Station', city_vehicle_type_id: 1, scope: 'outstation', flat_fare: null, booking_window_hours: 2, is_active: false }];
    page.drivers = [{ id: 3, user_id: 50, name: 'Driver One', phone: null, vehicle_type_id: 2, city_vehicle_type_id: 2, vehicle_reg_no: null, vehicle_model: null, vehicle_color: null }];
  });
  it('finds routes through shared groups for another vehicle without copying them', () => {
    page.vehicleId = 2;
    expect(page.filteredRoutes.map(route => route.id)).toEqual([20]);
    expect(page.routes.length).toBe(2);
    page.search = 'town service'; expect(page.filteredRoutes.map(route => route.id)).toEqual([20]);
  });
  it('separates inactive routes from incomplete setup and resets filters', () => {
    page.status = 'inactive'; expect(page.filteredRoutes.map(route => route.id)).toEqual([21]);
    page.status = 'attention'; expect(page.filteredRoutes.map(route => route.id)).toEqual([21]);
    page.scope = 'local'; expect(page.filteredRoutes).toEqual([]);
    page.clearFilters(); expect(page.filteredRoutes.length).toBe(2);
  });
  it('keeps driver assignment in the workspace and resets dialogs when switching cities', () => {
    page.driverAssignment = page.drivers[0]; page.groupSetupOpen = true; page.routeStarterOpen = true;
    page.ngOnChanges({ cityId: new SimpleChange(1, 2, false) });
    expect(page.driverAssignment).toBeNull(); expect(page.groupSetupOpen).toBeFalse(); expect(page.routeStarterOpen).toBeFalse();
  });
  it('selects an existing group with the route preselected', () => {
    page.assignRoute(page.routes[0]); page.chooseGroupForRoute(page.groups[0]);
    expect(page.editingGroup?.id).toBe(5); expect(page.initialRouteId).toBe(20); expect(page.groupSetupOpen).toBeTrue();
  });
  it('opens pricing before an unpriced route can be added to a group', () => {
    const action = jasmine.createSpy(); page.action.subscribe(action);
    page.assignRoute(page.routes[1]);
    expect(page.routeForGroup).toBeNull();
    expect(action).toHaveBeenCalledWith({ kind: 'edit-route', id: 21, vehicleId: null });
  });
  it('renders clear management views and visible actions without leaving Routes', () => {
    TestBed.configureTestingModule({ imports: [RouteOperationsComponent], providers: [{ provide: ApiService, useValue: { get: () => of({ groups: [], assigned_group_ids: [], effective_routes: [] }) } }, { provide: ToastService, useValue: {} }] });
    const fixture = TestBed.createComponent(RouteOperationsComponent); Object.assign(fixture.componentInstance, page); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Routes & fleet');
    const tabs: HTMLButtonElement[] = [...fixture.nativeElement.querySelectorAll('.workspace-nav button')];
    tabs[2].click(); fixture.detectChanges(); expect(fixture.nativeElement.textContent).toContain('Manage types'); expect(fixture.nativeElement.textContent).toContain('Seat layouts');
    tabs[3].click(); fixture.detectChanges();
    const assign = fixture.nativeElement.querySelector('.assign') as HTMLButtonElement; assign.click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.assignment').textContent).toContain('Fixed route access');
    fixture.destroy();
  });
  it('restores every grouping mode with expansion and collapse while retaining route actions', () => {
    for (const mode of ['route-set', 'city-area', 'scope', 'type', 'all-routes'] as const) {
      page.grouping = mode; page.changeGrouping();
      expect(page.directoryRows.some(row => row.kind !== 'route')).toBeTrue();
      page.expandDirectory();
      expect(new Set(page.directoryRows.filter(row => row.route).map(row => row.route!.id))).toEqual(new Set([20, 21]));
      page.explorer.collapseAll(); expect(page.directoryRows.every(row => !row.route)).toBeTrue();
    }
    page.grouping = 'routes'; expect(page.directoryRows.map(row => row.route?.id)).toEqual([20, 21]);
    localStorage.removeItem('master-route-view:v1:1');
  });
  it('keeps bulk selection and vehicle type filtering independent of route grouping', () => {
    page.vehicleTypeId = 2; expect(page.filteredVehicles.map(vehicle => vehicle.id)).toEqual([2]);
    page.selectVisibleVehicles(); expect([...page.selectedVehicleIds]).toEqual([2]);
    const action = jasmine.createSpy(); page.action.subscribe(action); page.vehicleBatch('copy-vehicles');
    expect(action).toHaveBeenCalledWith({ kind: 'copy-vehicles', ids: [2] });
    page.selectVisibleVehicles(); expect(page.selectedVehicleIds.size).toBe(0);
  });
  it('renders configured vehicle and driver photos and falls back when a photo fails', () => {
    TestBed.configureTestingModule({ imports: [RouteOperationsComponent] });
    const fixture = TestBed.createComponent(RouteOperationsComponent);
    fixture.componentInstance.vehicles = [{ ...page.vehicles[0], image_url: '/vehicle.jpg' }];
    fixture.componentInstance.drivers = [{ ...page.drivers[0], avatar_url: '/driver.jpg' }];
    fixture.componentInstance.view = 'vehicles'; fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.vehicle-photo img').getAttribute('src')).toBe('/vehicle.jpg');
    fixture.nativeElement.querySelector('.vehicle-photo img').dispatchEvent(new Event('error')); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.vehicle-photo tm-icon')).not.toBeNull();
    fixture.componentInstance.changeView('drivers'); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.driver-photo img').getAttribute('src')).toBe('/driver.jpg');
    fixture.nativeElement.querySelector('.driver-photo img').dispatchEvent(new Event('error')); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.driver-photo').textContent.trim()).toBe('DO');
    fixture.destroy();
  });
  it('focuses inline editing immediately and supports keyboard cancellation', () => {
    TestBed.configureTestingModule({ imports: [RouteOperationsComponent] });
    const fixture = TestBed.createComponent(RouteOperationsComponent);
    fixture.componentInstance.vehicles = page.vehicles; fixture.componentInstance.view = 'vehicles';
    fixture.componentInstance.editId = 1; fixture.componentInstance.editField = 'seats'; fixture.componentInstance.editValue = '9';
    const event = jasmine.createSpy(); fixture.componentInstance.cellEdit.subscribe(event); fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('.cell-input'); expect(document.activeElement).toBe(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(event).toHaveBeenCalledWith({ phase: 'cancel', id: 1, field: 'seats', value: undefined }); fixture.destroy();
  });
  it('paginates filtered results and returns to page one when search or page size changes', () => {
    page.routes = Array.from({ length: 23 }, (_, index) => ({ ...page.routes[0], id: index + 100, name: `Route ${index + 1}` }));
    expect(page.pageCount).toBe(3); expect(page.pagedDirectoryRows.length).toBe(10);
    page.goToPage(3); expect(page.firstItem).toBe(21); expect(page.lastItem).toBe(23);
    page.search = 'Route 1'; expect(page.currentPage).toBe(1); expect(page.totalItems).toBe(11);
    page.changePageSize(25); expect(page.pageCount).toBe(1); expect(page.pagedDirectoryRows.length).toBe(11);
    page.changePageSize(0); expect(page.pageSize).toBe(25);
    page.search = ''; page.changePageSize(10); page.goToPage(3); page.routes = page.routes.slice(0, 11);
    expect(page.currentPage).toBe(2); expect(page.lastItem).toBe(11);
  });
  it('repeats group headings when a branch continues onto another page without dropping routes', () => {
    page.routes = Array.from({ length: 15 }, (_, index) => ({ ...page.routes[0], id: index + 100 }));
    page.groups[0].route_ids = page.routes.map(route => route.id); page.grouping = 'route-set'; page.expandDirectory();
    expect(page.totalItems).toBe(16); page.goToPage(2);
    expect(page.pagedDirectoryRows[0].name).toBe('Town service'); expect(page.pagedDirectoryRows[0].kind).toBe('group');
    expect(page.pagedDirectoryRows.filter(row => row.route).length).toBe(6);
    const lastPageRoutes = page.pagedDirectoryRows.filter(row => row.route).map(row => row.route!.id);
    page.goToPage(1);
    expect([...page.pagedDirectoryRows.filter(row => row.route).map(row => row.route!.id), ...lastPageRoutes]).toEqual(page.routes.map(route => route.id));
  });
  it('selects only vehicles on the current page and preserves earlier page selections', () => {
    page.changeView('vehicles'); page.vehicles = Array.from({ length: 15 }, (_, index) => ({ ...page.vehicles[0], id: index + 100 }));
    page.selectVisibleVehicles(); expect(page.selectedVehicleIds.size).toBe(10);
    page.goToPage(2); expect(page.allVisibleVehiclesSelected).toBeFalse();
    page.selectVisibleVehicles(); expect(page.selectedVehicleIds.size).toBe(15);
    page.selectVisibleVehicles(); expect(page.selectedVehicleIds.size).toBe(10);
    page.goToPage(1); expect(page.allVisibleVehiclesSelected).toBeTrue();
  });
  it('renders working page navigation and a page size selector', () => {
    TestBed.configureTestingModule({ imports: [RouteOperationsComponent] });
    const fixture = TestBed.createComponent(RouteOperationsComponent);
    fixture.componentInstance.routes = Array.from({ length: 11 }, (_, index) => ({ ...page.routes[0], id: index + 100 })); fixture.detectChanges();
    const next = fixture.nativeElement.querySelector('[aria-label="Next page"]'); expect(next.disabled).toBeFalse(); next.click(); fixture.detectChanges();
    expect(fixture.componentInstance.currentPage).toBe(2); expect(next.disabled).toBeTrue();
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(1);
    const size = fixture.nativeElement.querySelector('[aria-label="Rows per page"]'); size.selectedIndex = 1; size.dispatchEvent(new Event('change')); fixture.detectChanges();
    expect(fixture.componentInstance.pageSize).toBe(25); expect(fixture.componentInstance.currentPage).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(11); fixture.destroy();
  });
});

describe('Combined route group setup', () => {
  let editor: RouteGroupSetupComponent;
  let api: any;
  beforeEach(() => {
    api = { post: jasmine.createSpy().and.returnValue(of({})), put: jasmine.createSpy().and.returnValue(of({})) };
    editor = new RouteGroupSetupComponent(api, { success: jasmine.createSpy() } as any);
    editor.cityId = 1; editor.ngOnChanges({ cityId: new SimpleChange(null, 1, true) });
    editor.name = 'Town service';
  });
  it('saves name, status, routes, sharing and drivers in a single request', () => {
    editor.routeIds.add(20); editor.driverIds.add(50); editor.vehicleIds.add(1); editor.setIds.add(10); editor.active = false;
    editor.save();
    expect(api.post).toHaveBeenCalledOnceWith('/admin/cities/1/route-groups/setup', { name: 'Town service', is_active: false, city_vehicle_type_id: null, route_ids: [20], driver_user_ids: [50], vehicle_ids: [1], vehicle_set_ids: [10] });
  });
  it('creates several groups with common assignments in one request and rejects duplicate names', () => {
    editor.extraNames = ['Express service']; editor.routeIds.add(20); editor.driverIds.add(50); editor.vehicleIds.add(1);
    editor.save(); expect(api.post).toHaveBeenCalledOnceWith('/admin/cities/1/route-groups/setup-batch', { name: 'Town service', names: ['Town service', 'Express service'], is_active: true, city_vehicle_type_id: null, route_ids: [20], driver_user_ids: [50], vehicle_ids: [1], vehicle_set_ids: [] });
    editor.extraNames = ['town SERVICE']; expect(editor.namesValid).toBeFalse(); editor.save(); expect(api.post).toHaveBeenCalledTimes(1);
  });
  it('automatically selects vehicles added from the setup form without losing the draft', () => {
    editor.vehicles = [{ id: 1, display_name: 'Sumo', vehicle_type_id: 1 }]; editor.createVehicles();
    editor.vehicles = [...editor.vehicles, { id: 2, display_name: 'Bus', vehicle_type_id: 2 }, { id: 3, display_name: 'Tavera', vehicle_type_id: 3, vehicle_set_id: 10 }];
    editor.ngOnChanges({ vehicles: new SimpleChange([], editor.vehicles, false) });
    expect(editor.vehicleIds.has(2)).toBeTrue(); expect(editor.setIds.has(10)).toBeTrue(); expect(editor.name).toBe('Town service');
  });
  it('keeps all selections on failure and prevents duplicate submissions', () => {
    const request = new Subject(); api.post.and.returnValue(request); editor.routeIds.add(20);
    editor.save(); editor.save(); expect(api.post).toHaveBeenCalledTimes(1);
    request.error({ error: { message: 'Try again' } });
    expect(editor.error).toBe('Try again'); expect(editor.routeIds.has(20)).toBeTrue(); expect(editor.saving).toBeFalse();
  });
  it('keeps edits while adding a route and automatically selects the new priced route', () => {
    editor.routes = [{ id: 20, name: 'Existing', origin_name: 'A', dest_name: 'B', flat_fare: 20, scope: 'local', is_active: true, city_vehicle_type_id: 1, booking_window_hours: null }];
    editor.routeVehicleId = 1; editor.createRoute();
    editor.routes = [...editor.routes, { ...editor.routes[0], id: 21, name: 'New' }];
    editor.ngOnChanges({ routes: new SimpleChange([], editor.routes, false) });
    expect(editor.name).toBe('Town service'); expect(editor.routeIds.has(21)).toBeTrue();
  });
  it('groups ride-mode options under one vehicle choice without moving existing set members', () => {
    editor.vehicles = [{ id: 1, display_name: 'Sumo', vehicle_type_id: 1 }, { id: 2, display_name: 'Sumo', vehicle_type_id: 1 }, { id: 3, display_name: 'Bus', vehicle_type_id: 2, vehicle_set_id: 10 }];
    expect(editor.standaloneVehicles).toEqual([{ name: 'Sumo', ids: [1, 2] }]);
    editor.toggleFamily([1, 2]); expect([...editor.vehicleIds]).toEqual([1, 2]);
  });
  it('keeps the vehicle checkbox stable while toggling a grouped family', () => {
    TestBed.configureTestingModule({ imports: [RouteGroupSetupComponent], providers: [{ provide: ApiService, useValue: api }, { provide: ToastService, useValue: { success: () => undefined } }] });
    const fixture = TestBed.createComponent(RouteGroupSetupComponent);
    fixture.componentInstance.cityId = 1; fixture.componentInstance.section = 'vehicles';
    fixture.componentInstance.vehicles = [{ id: 1, display_name: 'Bus', vehicle_type_id: 2 }, { id: 2, display_name: 'Bus', vehicle_type_id: 2 }];
    fixture.detectChanges();
    const checkbox: HTMLInputElement = fixture.nativeElement.querySelector('.choices input');
    checkbox.click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.choices input')).toBe(checkbox);
    expect(checkbox.checked).toBeTrue(); expect([...fixture.componentInstance.vehicleIds]).toEqual([1, 2]);
    fixture.destroy();
  });
});
