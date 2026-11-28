import { of, Subject, throwError } from 'rxjs';
import { fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { AddVehiclesComponent } from './add-vehicles.component';

describe('Quick vehicle creation', () => {
  let form: AddVehiclesComponent;
  let api: any;
  beforeEach(() => { api = { post: jasmine.createSpy().and.returnValue(of({data: []})) }; form = new AddVehiclesComponent(api, { success: jasmine.createSpy() } as any, { hasPermission: () => true } as any); form.cityId = 1; form.types = [{ id: 5, name: 'Sumo' }]; });
  it('adds to chosen cities in one request and retries a failed photo without recreating vehicles', fakeAsync(() => {
    form.rows[0].typeId = 5;
    const file = new File(['test'], 'sumo.png', {type: 'image/png'});
    form.choosePhoto(form.rows[0], {files: [file], value: ''} as unknown as HTMLInputElement);
    const data = [{id: 9, display_name: 'Sumo', max_people: 4}];
    api.post.and.returnValue(of({data}));
    api.postMultipart = jasmine.createSpy().and.returnValues(throwError(() => new Error('offline')), of({}));
    const closed = spyOn(form.closed, 'emit');
    form.extraCityIds = [2, 3];
    form.save();
    flushMicrotasks();
    expect(form.error).toContain('Vehicles saved');
    expect(closed).not.toHaveBeenCalled();
    expect(api.post.calls.first().args[0]).toBe('/admin/cities/1/vehicle-types/batch-in-cities');
    expect(api.post.calls.first().args[1].target_city_ids).toEqual([2, 3]);
    form.save();
    flushMicrotasks();
    expect(api.post).toHaveBeenCalledTimes(1);
    const [path, body] = api.postMultipart.calls.mostRecent().args;
    expect(path).toBe('/admin/app-assets');
    expect(body.get('key')).toBe('booking_card');
    expect(body.get('display_name')).toBe('Sumo');
    expect(body.get('image').name).toBe('sumo.png');
    expect(closed).toHaveBeenCalledTimes(1);
  }));
  it('adds vehicles and new types without assigning routes', () => {
    form.rows[0].typeId = 5; form.rows[0].seats = 9; form.addRow();
    form.rows[1].typeId = -1; form.rows[1].typeName = 'Bus'; form.rows[1].seats = 30;
    expect(form.valid).toBeTrue(); form.save();
    expect(api.post).toHaveBeenCalledOnceWith('/admin/cities/1/vehicle-types/batch', { vehicles: [{ vehicle_type_id: 5, vehicle_type_name: null, display_name: 'Sumo', max_people: 9, luggage_capacity: 0, is_active: true }, { vehicle_type_id: null, vehicle_type_name: 'Bus', display_name: 'Bus', max_people: 30, luggage_capacity: 0, is_active: true }], route_group_ids: [], target_city_ids: [] });
  });
  it('finishes a failed city copy against the older API without recreating the source vehicle', fakeAsync(() => {
    form.rows[0].typeId = 5;
    form.cityName = 'Srinagar';
    form.extraCityIds = [2];
    api.post.and.returnValues(throwError(() => ({status: 404})), of({data: [{id: 11, display_name: 'Sumo'}]}),
      throwError(() => ({status: 503})), of({}));
    form.save();
    flushMicrotasks();
    expect(form.error).toContain('saved in Srinagar');
    form.save();
    flushMicrotasks();
    const urls = api.post.calls.allArgs().map((args: any[]) => args[0].split('/').pop());
    expect(urls).toEqual(['batch-in-cities', 'batch', 'copy-to-city', 'copy-to-city']);
  }));
  it('copies settings without sharing a draft or silently duplicating its name', () => {
    form.rows[0].typeId = 5; form.rows[0].name = 'Town Sumo'; form.rows[0].seats = 9; form.addRow(true);
    expect(form.rows[1].typeId).toBeNull(); expect(form.rows[1].name).toBe(''); expect(form.rows[1].seats).toBe(9); expect(form.valid).toBeFalse();
    form.rows[1].typeId = -1; form.rows[1].typeName = 'Bus'; expect(form.valid).toBeTrue();
    form.rows[1].name = 'Town Sumo'; expect(form.valid).toBeFalse();
    form.rows[1].name = 'Other Sumo'; form.rows[1].seats = 6; expect(form.rows[0].seats).toBe(9);
  });
  it('releases the type when a row changes or is removed', () => {
    form.types = [{ id: 5, name: 'Sumo' }, { id: 6, name: 'Swift' }];
    form.addRow();
    const [first, second] = form.rows;
    const choices = () => form.availableTypes(second).map(type => type.value);
    first.typeId = 5;
    expect(choices()).toEqual([-1, 6]);
    expect(form.availableTypes(first).some(type => type.value === 5)).toBeTrue();
    first.typeId = 6;
    expect(choices()).toEqual([-1, 5]);
    form.removeRow(0);
    expect(choices()).toEqual([-1, 5, 6]);
  });
  it('keeps all entries and row-specific errors on failure and blocks duplicate saves', () => {
    const response = new Subject(); api.post.and.returnValue(response); form.rows[0].typeId = 5;
    form.save(); form.save(); expect(api.post).toHaveBeenCalledTimes(1);
    response.error({ error: { errors: { 'vehicles.0': ['Vehicle 1 already exists.'] } } });
    expect(form.rows[0].typeId).toBe(5); expect(form.error).toBe('Vehicle 1 already exists.'); expect(form.saving).toBeFalse();
  });
});
