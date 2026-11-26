import { of } from 'rxjs';
import { DynamicPricingPanelComponent } from '../pricing/dynamic-pricing-panel.component';
import { CitySettingsComponent } from '../settings/city-settings.component';
import { VehicleBasePricingComponent } from '../settings/vehicle-base-pricing.component';
import { VehicleWorkspaceComponent } from './vehicle-workspace.component';

describe('Master service workspaces', () => {
  it('uses the stable mode even when an operator renames a ride type', () => {
    const page = Object.create(VehicleWorkspaceComponent.prototype);
    page.serviceMode = 'shuttle';
    page.rideTypes = [{ id: 1, name: 'Solo', mode: 'private' }, { id: 2, name: 'Pool', mode: 'shuttle' }];
    expect(page.fareRideTypes.map((type: {id: number}) => type.id)).toEqual([2]);
    page.serviceMode = 'private';
    expect(page.fareRideTypes.map((type: {id: number}) => type.id)).toEqual([1]);
  });

  it('keeps mixed and citywide surge rules visible and protects their other vehicles', () => {
    const page = Object.create(DynamicPricingPanelComponent.prototype);
    page.serviceMode = 'private';
    page.vehicleTypes = [{id: 10}];
    const privateRule = {id: 1, city_vehicle_type_ids: [10]};
    const shared = {id: 2, city_vehicle_type_ids: [10, 11]};
    const citywide = {id: 3, city_vehicle_type_ids: []};
    page.rules = [privateRule, shared, citywide, {id: 4, city_vehicle_type_ids: [11]}];
    expect(page.serviceRules).toEqual([privateRule, shared, citywide]);
    expect(page.isShared(privateRule)).toBeFalse();
    expect(page.isShared(shared)).toBeTrue();
    expect(page.isShared(citywide)).toBeTrue();
  });

  it('shows only mixed, all-vehicle and legacy rules in Shared Pricing', () => {
    const page = Object.create(DynamicPricingPanelComponent.prototype);
    page.sharedOnly = true;
    page.vehicleScopeLoaded = true;
    page.vehicleModes = new Map([[1, 'private'], [2, 'shuttle'], [3, 'private']]);
    page.rules = [[1], [1, 3], [2], [1, 2], [], [77]].map(ids => ({ city_vehicle_type_ids: ids }));
    expect(page.serviceRules.map((r: any) => r.city_vehicle_type_ids)).toEqual([[1, 2], [], [77]]);
  });

  for (const mode of ['private', 'fixed', 'shuttle']) {
    it('saves only the ' + mode + ' ride settings and preserves an untouched shared charge', () => {
      const page = Object.create(CitySettingsComponent.prototype);
      const form = { negotiation_floor_percent: 10, private_no_show_charge_per_minute: 2,
        shuttle_join_after_start_enabled: false, fixed_customer_grace_minutes: 3, cancellation_charge_percent: 8 };
      const post = jasmine.createSpy().and.returnValue(of({ settings: {...form} }));
      Object.assign(page, { cityId: 5, serviceMode: mode, form, savedCancellationPercent: 8,
        dispatcherSettings: [], api: { postMultipart: post }, toast: { success: () => {} }, fetchDispatcherSettings: () => {} });
      page.save();
      const body: FormData = post.calls.mostRecent().args[1];
      expect(body.has('negotiation_floor_percent')).toBe(mode === 'private');
      expect(body.has('private_no_show_charge_per_minute')).toBe(mode === 'private');
      expect(body.has('shuttle_join_after_start_enabled')).toBe(mode === 'shuttle');
      expect(body.has('fixed_customer_grace_minutes')).toBe(mode === 'fixed');
      expect(body.has('cancellation_charge_percent')).toBeFalse();
    });
  }

  it('preserves the saved multiplier and targets the selected service vehicle when updating a rate card', () => {
    const post = jasmine.createSpy().and.returnValue(of({}));
    const api = { get: () => of({ rule: {base_fare: 100, surge_multiplier: 1.75} }), post };
    const card = new VehicleBasePricingComponent(api as any, {success: () => {}} as any);
    card.cityId = 5;
    card.cityVehicleTypeId = 21;
    card.load();
    card.form['base_fare'] = 110;
    card.save();
    expect(post).toHaveBeenCalledOnceWith('/admin/pricing-rules',
      jasmine.objectContaining({city_vehicle_type_id: 21, surge_multiplier: 1.75, base_fare: 110}));
  });
});
