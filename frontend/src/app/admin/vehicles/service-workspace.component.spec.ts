import { of, Subject } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { CityContextService } from '../../core/city-context.service';
import { DynamicPricingPanelComponent } from '../pricing/dynamic-pricing-panel.component';
import { CitySettingsComponent } from '../settings/city-settings.component';
import { VehicleBasePricingComponent } from '../settings/vehicle-base-pricing.component';
import { VehicleWorkspaceComponent } from './vehicle-workspace.component';

describe('Master service workspaces', () => {
  it('limits a 67-driver card to six avatars and opens all profiles in a modal', () => {
    TestBed.configureTestingModule({ imports: [VehicleWorkspaceComponent], providers: [
      provideHttpClient(), provideRouter([]),
      { provide: CityContextService, useValue: { ensureCitiesLoaded: () => of([]), cities$: of([]), cityId$: of(null) } },
    ] });
    const fixture = TestBed.createComponent(VehicleWorkspaceComponent);
    const page = fixture.componentInstance;
    page.serviceMode = 'private';
    page.canManageDrivers = true;
    fixture.detectChanges();
    Object.assign(page, { cityId: 1, visible: [{id: 7, display_name: 'SUMO', mode_row_ids: [7]}],
      cityDrivers: Array.from({length: 67}, (_, i) => ({ name: 'Driver ' + i, service_modes: ['private'],
        city_vehicle_type_id: 7, email: 'test@example.com', address: 'Test address', vehicle_reg_no: 'TEST-1', phone: '12345' })) });
    fixture.detectChanges();
    const stack = fixture.nativeElement.querySelector('.avatar-stack') as HTMLButtonElement;
    expect(stack.querySelectorAll('.driver-avatar:not(.extra)').length).toBe(6);
    expect(stack.querySelector('.extra')?.textContent?.trim()).toBe('+61');
    for (const avatar of Array.from(stack.querySelectorAll('.driver-avatar'))) {
      const style = getComputedStyle(avatar);
      expect([style.width, style.height, style.borderRadius]).toEqual(['24px', '24px', '50%']);
    }
    stack.click();
    fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]');
    expect(dialog.querySelectorAll('.assigned-profile').length).toBe(67);
    const modalAvatar = getComputedStyle(dialog.querySelector('.driver-avatar'));
    expect([modalAvatar.width, modalAvatar.height, modalAvatar.borderRadius]).toEqual(['30px', '30px', '50%']);
    for (const value of ['Driver 66', 'SUMO', '12345', 'TEST-1', 'test@example.com', 'Test address']) {
      expect(dialog.textContent).toContain(value);
    }
  });
  it('recognises a shared vehicle across services and offers only compatible drivers', () => {
    const page = Object.create(VehicleWorkspaceComponent.prototype);
    const v = { vehicle_type_id: 9, mode_row_ids: [10, 11] };
    Object.assign(page, { serviceMode: 'shuttle', serviceDriverSearch: '', rideTypes: [{id: 2, mode: 'shuttle'}],
      rows: [{id: 10, ride_type_id: 1, is_active: true}, {id: 11, ride_type_id: 2, is_active: true}],
      cityDrivers: [
        {name: 'Assigned', service_modes: ['private', 'shuttle'], city_vehicle_type_id: 10, vehicle_type_id: 9},
        {name: 'Available', service_modes: ['shuttle'], vehicle_type_id: 9},
        {name: 'Other type', service_modes: ['shuttle'], vehicle_type_id: 8},
        {name: 'Private only', service_modes: ['private'], vehicle_type_id: 9},
      ] });
    expect(page.assignedServiceDrivers(v).map((d: any) => d.name)).toEqual(['Assigned']);
    expect(page.availableServiceDrivers(v).map((d: any) => d.name)).toEqual(['Available']);
    expect(page.assignmentTarget(v).id).toBe(11);
    page.serviceMode = 'private';
    expect(page.assignedServiceDrivers(v).length).toBe(1);
    expect(page.availableServiceDrivers(v).map((d: any) => d.name)).toEqual(['Private only']);
  });
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

  it('submits only edited private fare and bidding values together and keeps pending edits on failure', () => {
    const response = new Subject<void>();
    const patch = jasmine.createSpy().and.returnValue(response);
    const api = { get: () => of({ rule: { base_fare: 100, threshold_distance_1_km: 3 } }), patch };
    const toast = { success: jasmine.createSpy(), error: jasmine.createSpy() };
    const card = new VehicleBasePricingComponent(api as any, toast as any);
    card.cityId = 5;
    card.cityVehicleTypeId = 21;
    card.load();
    const page: VehicleWorkspaceComponent = Object.create(VehicleWorkspaceComponent.prototype);
    const row = { id: 21, reverse_bidding_enabled: false };
    Object.assign(page, { api, toast, cityId: 5, activeKind: 'private', canManagePricing: true,
      canManageVehicles: true, activeRow: row, rows: [row], reverseBidding: false, fareEditor: card });
    expect(page.canSavePrivateFare).toBeFalse();
    page.reverseBidding = true;
    card.form['threshold_distance_1_km'] = null;
    page.savePrivateFare();
    page.savePrivateFare();
    const path = '/admin/cities/5/vehicle-types/21/private-rate-card';
    expect(patch).toHaveBeenCalledOnceWith(path, { threshold_distance_1_km: null, reverse_bidding_enabled: true });
    response.error({});
    expect(row.reverse_bidding_enabled).toBeFalse();
    expect(page.canSavePrivateFare).toBeTrue();
    patch.and.returnValue(of(null));
    page.savePrivateFare();
    expect(row.reverse_bidding_enabled).toBeTrue();
    expect(page.canSavePrivateFare).toBeFalse();
    card.commissionType = 'fixed';
    card.fixedCommission = 15;
    page.savePrivateFare();
    expect(patch.calls.mostRecent().args).toEqual([path, { commission_type: 'fixed', fixed_commission: 15 }]);
    page.reverseBidding = false;
    page.savePrivateFare();
    expect(patch.calls.mostRecent().args).toEqual([path, { reverse_bidding_enabled: false }]);
    expect(page.canSavePrivateFare).toBeFalse();
  });
});
