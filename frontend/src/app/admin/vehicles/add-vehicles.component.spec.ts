import { of, Subject } from 'rxjs';
import { AddVehiclesComponent } from './add-vehicles.component';

describe('Quick vehicle creation', () => {
  let form: AddVehiclesComponent;
  let api: any;
  beforeEach(() => { api = { post: jasmine.createSpy().and.returnValue(of({})) }; form = new AddVehiclesComponent(api, { success: jasmine.createSpy() } as any); form.cityId = 1; form.types = [{ id: 5, name: 'Sumo' }]; });
  it('adds vehicles, new types and group sharing in one request', () => {
    form.rows[0].typeId = 5; form.rows[0].seats = 9; form.addRow();
    form.rows[1].typeId = -1; form.rows[1].typeName = 'Bus'; form.rows[1].seats = 30; form.groupIds.add(7); form.groupIds.add(8);
    expect(form.valid).toBeTrue(); form.save();
    expect(api.post).toHaveBeenCalledOnceWith('/admin/cities/1/vehicle-types/batch', { vehicles: [{ vehicle_type_id: 5, vehicle_type_name: null, display_name: 'Sumo', max_people: 9, luggage_capacity: 0, is_active: true }, { vehicle_type_id: null, vehicle_type_name: 'Bus', display_name: 'Bus', max_people: 30, luggage_capacity: 0, is_active: true }], vehicle_set_id: null, set_name: null, route_group_ids: [7, 8] });
  });
  it('copies settings without sharing a draft or silently duplicating its name', () => {
    form.rows[0].typeId = 5; form.rows[0].name = 'Town Sumo'; form.rows[0].seats = 9; form.addRow(true);
    expect(form.rows[1].name).toBe(''); expect(form.rows[1].seats).toBe(9); expect(form.valid).toBeTrue();
    form.rows[1].name = 'Town Sumo'; expect(form.valid).toBeFalse();
    form.rows[1].name = 'Other Sumo'; form.rows[1].seats = 6; expect(form.rows[0].seats).toBe(9);
  });
  it('keeps all entries and row-specific errors on failure and blocks duplicate saves', () => {
    const response = new Subject(); api.post.and.returnValue(response); form.rows[0].typeId = 5;
    form.save(); form.save(); expect(api.post).toHaveBeenCalledTimes(1);
    response.error({ error: { errors: { 'vehicles.0': ['Vehicle 1 already exists.'] } } });
    expect(form.rows[0].typeId).toBe(5); expect(form.error).toBe('Vehicle 1 already exists.'); expect(form.saving).toBeFalse();
  });
});
