import { Routes } from '@angular/router';
import { AdminDashboardComponent } from './admin/admin-dashboard.component';
import { AdminPricingComponent } from './admin/admin-pricing.component';
import { AdminTripsComponent } from './admin/admin-trips.component';
import { AdminUsersComponent } from './admin/admin-users.component';
import { CustomersListComponent } from './admin/customers/customers-list.component';
import { CustomerDetailComponent } from './admin/customers/customer-detail.component';
import { AdminSafetyEventsComponent } from './admin/admin-safety-events.component';
import { AdminReportsComponent } from './admin/admin-reports.component';
import { RidesMapComponent } from './admin/rides/rides-map.component';
import { RidesAllComponent } from './admin/rides/rides-all.component';
import { VehiclesComponent } from './admin/vehicles/vehicles.component';
import { ContactDriversComponent } from './admin/contact-drivers/contact-drivers.component';
import { DynamicPricingListComponent } from './admin/dynamic-pricing/dynamic-pricing-list.component';
import { DynamicPricingFormComponent } from './admin/dynamic-pricing/dynamic-pricing-form.component';
import { MapsComponent } from './admin/maps/maps.component';
import { GeofencingComponent } from './admin/settings/geofencing.component';
import { FleetsSettingsComponent } from './admin/settings/fleets.component';
import { SettingsComponent } from './admin/settings/settings.component';
import { OperatorSettingsComponent } from './admin/settings/operator-settings.component';
import { VehicleTypeDetailsComponent } from './admin/settings/vehicle-type-details.component';
import { ManualDispatchComponent } from './admin/rides/manual-dispatch.component';
import { CityWidePromotionsComponent } from './admin/promotions/city-wide-promotions.component';
import { PromoCodesComponent } from './admin/promotions/promo-codes.component';
import { CouponsComponent } from './admin/promotions/coupons.component';
import { ReferralsComponent } from './admin/promotions/referrals.component';
import { RolesPermissionsComponent } from './admin/rbac/roles-permissions.component';
import { ManagersComponent } from './admin/rbac/managers.component';
import { AnalyticsRealTimeComponent } from './admin/analytics/analytics-real-time.component';
import { AnalyticsGraphsComponent } from './admin/analytics/analytics-graphs.component';
import { AnalyticsReportsComponent } from './admin/analytics/analytics-reports.component';
import { SigninComponent } from './auth/signin.component';
import { adminAuthGuard } from './auth/admin-auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'signin', pathMatch: 'full' },
  { path: 'signin', component: SigninComponent },
  { path: 'dashboard', component: AdminDashboardComponent, canActivate: [adminAuthGuard] },
  { path: 'pricing', component: AdminPricingComponent, canActivate: [adminAuthGuard] },
  { path: 'trips', component: AdminTripsComponent, canActivate: [adminAuthGuard] },
  { path: 'users', component: AdminUsersComponent, canActivate: [adminAuthGuard] },
  { path: 'customers', component: CustomersListComponent, canActivate: [adminAuthGuard] },
  { path: 'customers/:id', component: CustomerDetailComponent, canActivate: [adminAuthGuard] },
  { path: 'safety', component: AdminSafetyEventsComponent, canActivate: [adminAuthGuard] },
  { path: 'reports', component: AdminReportsComponent, canActivate: [adminAuthGuard] },

  // Drivers module is a single-page shell with tabs. All four legacy URLs
  // resolve to the same shell; `data.name` lets the shell pick the right tab.
  {
    path: 'drivers',
    loadComponent: () => import('./admin/drivers/drivers-page.component').then((m) => m.DriversPageComponent),
    canActivate: [adminAuthGuard],
    data: { name: 'drivers-all' },
  },
  { path: 'drivers/active', redirectTo: 'drivers', pathMatch: 'full' },
  { path: 'drivers/deactivated', redirectTo: 'drivers', pathMatch: 'full' },
  {
    path: 'drivers/approvals',
    loadComponent: () => import('./admin/drivers/drivers-page.component').then((m) => m.DriversPageComponent),
    canActivate: [adminAuthGuard],
    data: { name: 'drivers-approvals' },
  },
  // Legacy deep link: the shell reads :driverId and opens the detail drawer.
  {
    path: 'drivers/approvals/:driverId',
    loadComponent: () => import('./admin/drivers/drivers-page.component').then((m) => m.DriversPageComponent),
    canActivate: [adminAuthGuard],
    data: { name: 'drivers-approvals' },
  },
  {
    path: 'drivers/documents',
    loadComponent: () => import('./admin/drivers/drivers-page.component').then((m) => m.DriversPageComponent),
    canActivate: [adminAuthGuard],
    data: { name: 'drivers-documents' },
  },
  { path: 'contact-drivers', component: ContactDriversComponent, canActivate: [adminAuthGuard] },

  { path: 'rides', redirectTo: 'rides/all', pathMatch: 'full' },
  { path: 'rides/all', component: RidesAllComponent, canActivate: [adminAuthGuard] },
  { path: 'rides/map', component: RidesMapComponent, canActivate: [adminAuthGuard] },
  { path: 'rides/manual-dispatch', component: ManualDispatchComponent, canActivate: [adminAuthGuard] },

  { path: 'maps', component: MapsComponent, canActivate: [adminAuthGuard] },

  { path: 'vehicles', component: VehiclesComponent, canActivate: [adminAuthGuard] },

  { path: 'promotions', redirectTo: 'promotions/city-wide', pathMatch: 'full' },
  { path: 'promotions/city-wide', component: CityWidePromotionsComponent, canActivate: [adminAuthGuard] },
  { path: 'promotions/promo-codes', component: PromoCodesComponent, canActivate: [adminAuthGuard] },
  { path: 'promotions/coupons', component: CouponsComponent, canActivate: [adminAuthGuard] },
  { path: 'promotions/referrals', component: ReferralsComponent, canActivate: [adminAuthGuard] },

  { path: 'roles-permissions', component: RolesPermissionsComponent, canActivate: [adminAuthGuard] },
  { path: 'managers', component: ManagersComponent, canActivate: [adminAuthGuard] },

  { path: 'settings', redirectTo: 'settings/city', pathMatch: 'full' },
  { path: 'settings/city', component: SettingsComponent, canActivate: [adminAuthGuard] },
  { path: 'settings/operator', component: OperatorSettingsComponent, canActivate: [adminAuthGuard] },
  { path: 'settings/general', redirectTo: 'settings/city', pathMatch: 'full' },
  { path: 'settings/geofencing', component: GeofencingComponent, canActivate: [adminAuthGuard] },
  { path: 'settings/fleets', component: FleetsSettingsComponent, canActivate: [adminAuthGuard] },
  { path: 'settings/vehicle-types/:rideTypeId', component: VehicleTypeDetailsComponent, canActivate: [adminAuthGuard] },

  { path: 'analytics', redirectTo: 'analytics/real-time', pathMatch: 'full' },
  { path: 'analytics/real-time', component: AnalyticsRealTimeComponent, canActivate: [adminAuthGuard] },
  { path: 'analytics/graphs', component: AnalyticsGraphsComponent, canActivate: [adminAuthGuard] },
  { path: 'analytics/reports', component: AnalyticsReportsComponent, canActivate: [adminAuthGuard] },

  { path: 'dynamic-pricing', component: DynamicPricingListComponent, canActivate: [adminAuthGuard] },
  { path: 'dynamic-pricing/new', component: DynamicPricingFormComponent, canActivate: [adminAuthGuard] },
  { path: 'dynamic-pricing/:id', component: DynamicPricingFormComponent, canActivate: [adminAuthGuard] },

  { path: '**', redirectTo: 'signin' },
];
