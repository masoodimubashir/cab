import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, combineLatest, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { CityContextService } from '../../core/city-context.service';
import { RideMode, ServiceNamesService, resolvedRideMode } from '../../core/service-names.service';
import { FixedDeparturesComponent } from '../fixed/fixed-departures.component';
import { FixedBookingsComponent } from '../fixed/fixed-bookings.component';
import { DynamicPricingPanelComponent } from '../pricing/dynamic-pricing-panel.component';
import { RidesListComponent } from '../rides/rides-list.component';
import { CitySettingsComponent } from '../settings/city-settings.component';
import { OperatorSettingsComponent } from '../settings/operator-settings.component';
import { ShuttleBookingsComponent } from '../shuttle/shuttle-bookings.component';
import { VehicleWorkspaceComponent } from './vehicle-workspace.component';

interface BookingType { id: number; name: string; mode?: RideMode }
interface CityVehicles {
  available_ride_types: BookingType[];
  data: { ride_type_id: number | null; ride_type_mode?: RideMode }[];
}

@Component({
  standalone: true,
  imports: [NgTemplateOutlet, FixedDeparturesComponent, FixedBookingsComponent, RouterLink, RidesListComponent, ShuttleBookingsComponent, OperatorSettingsComponent,
    VehicleWorkspaceComponent, CitySettingsComponent, DynamicPricingPanelComponent],
  template: `
    <header><h1>{{ label() }}</h1></header>
    <nav aria-label="Service sections">
      @for (tab of tabs; track tab.key) {
        <a [routerLink]="[]" [queryParams]="{view: tab.key}"
           [attr.aria-current]="view() === tab.key ? 'page' : null">{{ tab.label }}</a>
      }
    </nav>
    @switch (view()) {
      @case ('routes') { <app-vehicle-workspace masterSection="routes" /> }
      @case ('live') { <app-fixed-departures /> }
      @case ('fares') {
        @if (mode !== 'fixed') {
        <app-vehicle-workspace [serviceMode]="mode" [serviceLabel]="label()"
          [canManageVehicles]="auth.hasPermission('vehicles')" [canManagePricing]="auth.hasPermission('pricing')" />
        }
      }
      @case ('surge') {
        <nav aria-label="Surge pricing scope">
          <a [routerLink]="[]" [queryParams]="{view: 'surge'}" aria-current="page">{{ label() }} rules</a>
          <a routerLink="/operations/shared-surge">Shared rules</a>
        </nav>
        <app-dynamic-pricing-panel [serviceMode]="mode" />
      }
      @case ('rules') { <app-city-settings [serviceMode]="mode" [serviceLabel]="label()" /> }
      @case ('service') {
        <app-operator-settings [serviceMode]="mode"
          [canToggleServices]="auth.hasAnyPermission(['city_settings','rides'])"
          [canEditBranding]="auth.hasPermission('operator_settings')" />
      }
      @case ('bookings') {
        @if (mode === 'fixed') { <app-fixed-bookings /> }
        @else if (mode === 'shuttle') { <app-shuttle-bookings [title]="label() + ' bookings'" /> }
        @else {
          @if (auth.hasPermission('manual_dispatch')) { <a class="dispatch" routerLink="/rides/manual-dispatch">Manual dispatch</a> }
          <ng-container [ngTemplateOutlet]="tripList" />
        }
      }
      @case ('history') { <ng-container [ngTemplateOutlet]="tripList" /> }
    }
    <ng-template #tripList>
    @if (serviceTypes(); as state) {
      @if (state.message) { <p role="status">{{ state.message }}</p> }
      @else {
        @if (state.types.length > 1) {
          <nav aria-label="Ride types">
            @for (type of state.types; track type.id) {
              <a [routerLink]="[]" [queryParams]="{view:view(),type:type.id}"
                 [attr.aria-current]="bookingTypeId() === type.id ? 'page' : null">{{ type.name }}</a>
            }
          </nav>
        }
        @if (bookingTypeId(); as typeId) {
          <app-rides-list category="all" [title]="label() + (view() === 'history' ? ' history' : ' bookings')" [serviceRideTypeId]="typeId" />
        }
      }
    }
    </ng-template>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    h1 { margin: 0 0 14px; font-size: 24px; color: var(--tm-text); }
    nav { display: flex; flex-wrap: wrap; gap: 4px; border-bottom: 1px solid var(--tm-border, #dce1e6); margin-bottom: 20px; }
    nav a, .dispatch { padding: 10px 14px; font-size: 14px; color: var(--tm-text-muted); text-decoration: none; }
    nav a[aria-current] { color: var(--tm-text); font-weight: 700; box-shadow: inset 0 -3px #15955b; }
    .dispatch { display: inline-block; margin-bottom: 12px; text-decoration: underline; }
  `],
})
export class ServiceWorkspaceComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly cities = inject(CityContextService);
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  private readonly names = inject(ServiceNamesService);
  readonly mode = this.route.snapshot.data['service'] as RideMode;
  readonly label = computed(() => this.names.labels()[this.mode]);
  readonly tabs = [
    this.mode === 'fixed'
      ? { key: 'routes', label: 'Routes & fares', permissions: ['vehicles'] }
      : { key: 'fares', label: 'Vehicles & fares', permissions: ['vehicles','pricing'] },
    ...(this.mode === 'fixed' ? [] : [{ key: 'surge', label: 'Surge pricing', permissions: ['pricing'] }]),
    { key: 'rules', label: 'Ride settings', permissions: ['city_settings'] },
    { key: 'service', label: 'Service setup', permissions: ['operator_settings','city_settings','rides'] },
    { key: 'bookings', label: 'Bookings', permissions: ['rides'] },
    { key: 'history', label: 'History', permissions: ['rides'] },
    ...(this.mode === 'fixed' ? [{ key: 'live', label: 'Live departures', permissions: ['rides'] }] : []),
  ].filter(tab => this.auth.hasAnyPermission(tab.permissions));
  private readonly params = toSignal(this.route.queryParamMap, { requireSync: true });
  readonly view = computed(() => this.tabs.find(tab => tab.key === this.params().get('view'))?.key ?? this.tabs[0]?.key);

  readonly serviceTypes = toSignal(combineLatest([this.cities.cityId$, this.route.queryParamMap.pipe(
    map(params => params.get('view') === 'history' || (this.mode === 'private' && params.get('view') === 'bookings')), distinctUntilChanged(),
  )]).pipe(switchMap(([city, bookings]) => {
    const status = (message: string) => ({ message, types: [] as BookingType[] });
    if (!bookings || !this.auth.hasPermission('rides')) return of(status(''));
    if (!city) return of(status('Select a city to view bookings.'));
    return this.api.get<CityVehicles>(`/admin/cities/${city}/vehicle-types`).pipe(
      map(res => {
        const types = res.available_ride_types.filter(type => resolvedRideMode(
          type.mode ?? res.data.find(row => row.ride_type_id === type.id)?.ride_type_mode, type.name,
        ) === this.mode);
        return { types, message: types.length ? '' : 'No ride types are configured for this service.' };
      }),
      startWith(status('Loading ride types…')),
      catchError(() => of(status('Could not load ride types for this city.'))),
    );
  })));
  readonly bookingTypeId = computed(() => {
    const types = this.serviceTypes()?.types ?? [];
    return (types.find(type => type.id === Number(this.params().get('type'))) ?? types[0])?.id;
  });

  constructor() { this.cities.ensureCitiesLoaded().subscribe(); }
}
