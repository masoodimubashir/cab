import { servicePermissions } from './core/service-names.service';
import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { AdminDashboardComponent } from './admin/admin-dashboard.component';
import { AdminTripsComponent } from './admin/admin-trips.component';
import { CustomersListComponent } from './admin/customers/customers-list.component';
import { CustomerDetailComponent } from './admin/customers/customer-detail.component';
import { AdminSafetyEventsComponent } from './admin/admin-safety-events.component';
import { RidesAllComponent } from './admin/rides/rides-all.component';
import { RidesShellComponent } from './admin/rides/rides-shell.component';
import { AdminNotificationsComponent } from './admin/notifications/notifications.component';
import { RideDetailComponent } from './admin/rides/ride-detail.component';
import { ContactDriversComponent } from './admin/contact-drivers/contact-drivers.component';
import { MapsComponent } from './admin/maps/maps.component';
import { CityWorkspaceComponent } from './admin/city-workspace/city-workspace.component';
import { FleetsSettingsComponent } from './admin/settings/fleets.component';
import { SettingsComponent } from './admin/settings/settings.component';
import { OperatorSettingsComponent } from './admin/settings/operator-settings.component';
// App Assets temporarily hidden (not part of the first release). Re-enable by uncommenting.
import { AppAssetsComponent } from './admin/settings/app-assets.component';
import { SetupWizardComponent } from './admin/setup/setup-wizard.component';
import { ManualDispatchComponent } from './admin/rides/manual-dispatch.component';
import { CouponsComponent } from './admin/promotions/coupons.component';
import { BannersComponent } from './admin/promotions/banners.component';
import { SubscriptionsComponent } from './admin/subscriptions/subscriptions.component';
import { FixedRoutesHubComponent } from './admin/fixed/fixed-routes-hub.component';
import { RolesPermissionsComponent } from './admin/rbac/roles-permissions.component';
import { ManagersComponent } from './admin/rbac/managers.component';
import { AnalyticsRealTimeComponent } from './admin/analytics/analytics-real-time.component';
import { AnalyticsGraphsComponent } from './admin/analytics/analytics-graphs.component';
import { AnalyticsReportsComponent } from './admin/analytics/analytics-reports.component';
import { CarpoolListingsComponent } from './admin/carpool/carpool-listings.component';
import { CarpoolReportsComponent } from './admin/carpool/carpool-reports.component';
import { CarpoolSettingsComponent } from './admin/carpool/carpool-settings.component';
import { SigninComponent } from './auth/signin.component';
import { adminAuthGuard } from './auth/admin-auth.guard';

const redirectSharedSurge: CanActivateFn = route =>
  route.queryParamMap.get('view') === 'surge' && route.queryParamMap.get('scope') === 'shared'
    ? inject(Router).createUrlTree(['/operations/shared-surge'])
    : true;

export const routes: Routes = [
  { path: '', redirectTo: 'signin', pathMatch: 'full' },
  { path: 'signin', component: SigninComponent },
  { path: 'dashboard', component: AdminDashboardComponent, canActivate: [adminAuthGuard], data: { permission: 'dashboard' } },
  {
    path: 'profile',
    loadComponent: () => import('./admin/profile/profile.component').then((m) => m.ProfileComponent),
    canActivate: [adminAuthGuard],
  },
  { path: 'setup', component: SetupWizardComponent, canActivate: [adminAuthGuard], data: { permission: 'city_settings' } },
  // Fleet Setup and the standalone fare page are now tabs of the vehicle
  // workspace. Both legacy URLs land on the same page.
  { path: 'fleet', redirectTo: 'vehicles', pathMatch: 'full' },
  { path: 'pricing', pathMatch: 'full', redirectTo: '/operations/shared-surge' },
  { path: 'vehicles/:vehicleRowId/fares', redirectTo: 'vehicles/:vehicleRowId', pathMatch: 'full' },
  { path: 'trips', component: AdminTripsComponent, canActivate: [adminAuthGuard], data: { permission: 'rides' } },
  { path: 'customers', component: CustomersListComponent, canActivate: [adminAuthGuard], data: { permission: 'customers' } },
  { path: 'customers/:id', component: CustomerDetailComponent, canActivate: [adminAuthGuard], data: { permission: 'customers' } },
  { path: 'safety', component: AdminSafetyEventsComponent, canActivate: [adminAuthGuard], data: { permission: 'safety' } },

  // Drivers module is a single-page shell with tabs. All four legacy URLs
  // resolve to the same shell; `data.name` lets the shell pick the right tab.
  {
    path: 'drivers',
    loadComponent: () => import('./admin/drivers/drivers-page.component').then((m) => m.DriversPageComponent),
    canActivate: [adminAuthGuard],
    data: { name: 'drivers-all', permission: 'drivers' },
  },
  { path: 'drivers/active', redirectTo: 'drivers', pathMatch: 'full' },
  { path: 'drivers/deactivated', redirectTo: 'drivers', pathMatch: 'full' },
  {
    path: 'drivers/approvals',
    loadComponent: () => import('./admin/drivers/drivers-page.component').then((m) => m.DriversPageComponent),
    canActivate: [adminAuthGuard],
    data: { name: 'drivers-approvals', permission: 'drivers' },
  },
  // Legacy deep link: the shell reads :driverId and opens the detail drawer.
  {
    path: 'drivers/approvals/:driverId',
    loadComponent: () => import('./admin/drivers/drivers-page.component').then((m) => m.DriversPageComponent),
    canActivate: [adminAuthGuard],
    data: { name: 'drivers-approvals', permission: 'drivers' },
  },
  {
    path: 'drivers/documents',
    loadComponent: () => import('./admin/drivers/drivers-page.component').then((m) => m.DriversPageComponent),
    canActivate: [adminAuthGuard],
    data: { name: 'drivers-documents', permission: 'drivers' },
  },
  {
    path: 'drivers/:id',
    loadComponent: () => import('./admin/drivers/driver-detail.component').then((m) => m.DriverDetailComponent),
    canActivate: [adminAuthGuard],
    data: { permission: 'drivers' },
  },
  { path: 'carpool/listings', component: CarpoolListingsComponent, canActivate: [adminAuthGuard], data: { permission: 'carpool' } },
  { path: 'carpool/reports', component: CarpoolReportsComponent, canActivate: [adminAuthGuard], data: { permission: 'carpool' } },
  { path: 'carpool/settings', component: CarpoolSettingsComponent, canActivate: [adminAuthGuard], data: { permission: 'carpool' } },
  { path: 'carpool', redirectTo: 'carpool/overview', pathMatch: 'full' },
  { path: 'carpool/overview', loadComponent: () => import('./admin/carpool/carpool-overview.component').then((m) => m.CarpoolOverviewComponent), canActivate: [adminAuthGuard], data: { permission: 'carpool' } },
  { path: 'carpool/people', loadComponent: () => import('./admin/carpool/carpool-people.component').then((m) => m.CarpoolPeopleComponent), canActivate: [adminAuthGuard], data: { permission: 'carpool' } },
  { path: 'carpool/plans', loadComponent: () => import('./admin/carpool/carpool-plans.component').then((m) => m.CarpoolPlansComponent), canActivate: [adminAuthGuard], data: { permission: 'carpool' } },
  { path: 'contact-drivers', component: ContactDriversComponent, canActivate: [adminAuthGuard], data: { permission: 'contact_drivers' } },

  { path: 'rides', component: RidesShellComponent, canActivate: [adminAuthGuard], data: { permission: 'rides' } },
  // Backward-compat: old bookmarks for the sub-tabs land on the flat Rides page.
  { path: 'rides/all', redirectTo: 'rides', pathMatch: 'full' },
  { path: 'rides/map', redirectTo: 'rides', pathMatch: 'full' },
  { path: 'rides/manual-dispatch', component: ManualDispatchComponent, canActivate: [adminAuthGuard], data: { permission: 'manual_dispatch' } },
  { path: 'notifications', component: AdminNotificationsComponent, canActivate: [adminAuthGuard] },
  // Dynamic trip-id route — placed AFTER manual-dispatch so the static path wins.
  { path: 'rides/:tripId', component: RideDetailComponent, canActivate: [adminAuthGuard], data: { permission: 'rides' } },

  { path: 'maps', component: MapsComponent, canActivate: [adminAuthGuard], data: { permission: 'live_operations' } },

  // Vehicle workspace — city vehicle list + Common/Normal/Fixed/Shuttle/Drivers/
  // Seat-layout tabs on one page. `:vehicleRowId` deep-links a single vehicle.
  { path: 'vehicles', loadComponent: () => import('./admin/vehicles/vehicle-workspace.component').then(m => m.VehicleWorkspaceComponent), canActivate: [adminAuthGuard], data: { permission: 'vehicles' } },
  { path: 'operations/shared-surge', loadComponent: () => import('./admin/pricing/shared-surge.component').then(m => m.SharedSurgeComponent), canActivate: [adminAuthGuard], data: { permission: 'pricing' } },
  { path: 'operations/shared-vehicles', loadComponent: () => import('./admin/vehicles/operations-workspace.component').then(m => m.OperationsWorkspaceComponent), canActivate: [adminAuthGuard], data: { permission: 'vehicles', sharedVehicles: true } },
  { path: 'operations', redirectTo: 'operations/routes', pathMatch: 'full' },
  ...(['private', 'fixed', 'shuttle'] as const).map(service => ({
    path: service === 'fixed' ? 'operations/routes' : 'operations/' + service,
    loadComponent: () => import('./admin/vehicles/service-workspace.component').then(m => m.ServiceWorkspaceComponent),
    canActivate: service === 'fixed' ? [adminAuthGuard] : [adminAuthGuard, redirectSharedSurge],
    data: { permissions: service === 'fixed' ? servicePermissions.filter(p => p !== 'pricing') : servicePermissions, service },
  })),
  { path: 'operations/drivers', redirectTo: 'drivers', pathMatch: 'full' },
  { path: 'operations/route-groups', redirectTo: 'operations/routes', pathMatch: 'full' },
  {
    path: 'operations/:section',
    loadComponent: () => import('./admin/vehicles/operations-workspace.component').then((m) => m.OperationsWorkspaceComponent),
    canActivate: [adminAuthGuard],
    data: { permission: 'vehicles' },
  },
  { path: 'vehicles/:vehicleRowId', loadComponent: () => import('./admin/vehicles/vehicle-workspace.component').then(m => m.VehicleWorkspaceComponent), canActivate: [adminAuthGuard], data: { permission: 'vehicles' } },

  // Vehicle seat layouts — reusable seat maps per (city × vehicle-type).
  {
    path: 'vehicle-seat-layouts',
    loadComponent: () => import('./admin/vehicle-seat-layouts/seat-layout-list.component').then((m) => m.SeatLayoutListComponent),
    canActivate: [adminAuthGuard],
    data: { permission: 'vehicles' },
  },
  {
    path: 'vehicle-seat-layouts/new',
    loadComponent: () => import('./admin/vehicle-seat-layouts/seat-layout-designer.component').then((m) => m.SeatLayoutDesignerComponent),
    canActivate: [adminAuthGuard],
    data: { permission: 'vehicles' },
  },
  {
    path: 'vehicle-seat-layouts/:id',
    loadComponent: () => import('./admin/vehicle-seat-layouts/seat-layout-designer.component').then((m) => m.SeatLayoutDesignerComponent),
    canActivate: [adminAuthGuard],
    data: { permission: 'vehicles' },
  },

  { path: 'promotions', redirectTo: 'promotions/coupons', pathMatch: 'full' },
  { path: 'promotions/coupons', component: CouponsComponent, canActivate: [adminAuthGuard], data: { permission: 'coupons' } },
  { path: 'promotions/banners', component: BannersComponent, canActivate: [adminAuthGuard], data: { permission: 'coupons' } },

  { path: 'subscriptions', component: SubscriptionsComponent, canActivate: [adminAuthGuard], data: { permission: 'subscriptions' } },

  { path: 'fixed-departures', redirectTo: '/operations/routes?view=live', pathMatch: 'full' },
  { path: 'fixed-routes', redirectTo: '/operations/routes?view=live', pathMatch: 'full' },
  { path: 'shuttle-bookings', redirectTo: '/operations/shuttle?view=bookings', pathMatch: 'full' },

  // B5 — customer-refund register (fixed + shuttle, manual settlement).
  {
    path: 'refunds',
    loadComponent: () => import('./admin/refunds/refunds.component').then((m) => m.AdminRefundsComponent),
    canActivate: [adminAuthGuard],
    data: { permission: 'finance' },
  },

  // Finance — Unified Money Ledger headquarters (transactions, driver wallets, payouts, commissions & earnings)
  { path: 'finance', redirectTo: 'finance/ledger', pathMatch: 'full' },
  { path: 'finance/overview', redirectTo: 'finance/ledger', pathMatch: 'full' },
  {
    path: 'finance/ledger',
    loadComponent: () => import('./admin/finance/finance-ledger.component').then((m) => m.FinanceLedgerComponent),
    canActivate: [adminAuthGuard],
    data: { permission: 'finance' },
  },
  { path: 'finance/money-in', redirectTo: 'finance/ledger', pathMatch: 'full' },
  { path: 'finance/wallets', redirectTo: 'finance/ledger', pathMatch: 'full' },
  { path: 'finance/transfers/pending', redirectTo: 'finance/ledger', pathMatch: 'full' },
  { path: 'finance/transfers/completed', redirectTo: 'finance/ledger', pathMatch: 'full' },
  { path: 'finance/commissions', redirectTo: 'finance/ledger', pathMatch: 'full' },
  { path: 'finance/driver-earnings', redirectTo: 'finance/ledger', pathMatch: 'full' },

  { path: 'roles-permissions', component: RolesPermissionsComponent, canActivate: [adminAuthGuard], data: { permission: 'roles_permissions' } },
  { path: 'managers', component: ManagersComponent, canActivate: [adminAuthGuard], data: { permission: 'managers' } },

  { path: 'settings', redirectTo: 'settings/city', pathMatch: 'full' },
  { path: 'settings/cities', component: CityWorkspaceComponent, canActivate: [adminAuthGuard], data: { permission: 'city_settings' } },
  { path: 'settings/city', component: SettingsComponent, canActivate: [adminAuthGuard], data: { permission: 'city_settings' } },
  { path: 'settings/operator', component: OperatorSettingsComponent, canActivate: [adminAuthGuard], data: { permission: 'operator_settings' } },
  { path: 'settings/profile', redirectTo: 'profile', pathMatch: 'full' },
  // App Assets temporarily hidden (not part of the first release). Re-enable by uncommenting (and the import above).
  { path: 'settings/app-assets', component: AppAssetsComponent, canActivate: [adminAuthGuard], data: { permission: 'app_assets' } },
  { path: 'settings/general', redirectTo: 'settings/city', pathMatch: 'full' },
  { path: 'settings/fleets', component: FleetsSettingsComponent, canActivate: [adminAuthGuard], data: { permission: 'fleets' } },
  { path: 'settings/vehicle-types/:vehicleRowId', redirectTo: '/setup', pathMatch: 'full' },

  { path: 'analytics', redirectTo: 'analytics/real-time', pathMatch: 'full' },
  { path: 'analytics/real-time', component: AnalyticsRealTimeComponent, canActivate: [adminAuthGuard], data: { permission: 'analytics' } },
  { path: 'analytics/graphs', component: AnalyticsGraphsComponent, canActivate: [adminAuthGuard], data: { permission: 'analytics' } },
  { path: 'analytics/reports', component: AnalyticsReportsComponent, canActivate: [adminAuthGuard], data: { permission: 'reports' } },

  // Dynamic pricing is now the second tab of the unified Pricing page.
  { path: 'dynamic-pricing', redirectTo: 'pricing', pathMatch: 'full' },

  { path: '**', redirectTo: 'signin' },
];
