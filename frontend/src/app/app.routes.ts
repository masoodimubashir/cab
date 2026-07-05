import { Routes } from '@angular/router';
import { AdminDashboardComponent } from './admin/admin-dashboard.component';
import { PricingComponent } from './admin/pricing/pricing.component';
import { AdminTripsComponent } from './admin/admin-trips.component';
import { OperationsComponent } from './admin/operations/operations.component';
import { CustomersListComponent } from './admin/customers/customers-list.component';
import { CustomerDetailComponent } from './admin/customers/customer-detail.component';
import { AdminSafetyEventsComponent } from './admin/admin-safety-events.component';
import { AdminReportsComponent } from './admin/admin-reports.component';
import { RidesAllComponent } from './admin/rides/rides-all.component';
import { RidesShellComponent } from './admin/rides/rides-shell.component';
import { AdminNotificationsComponent } from './admin/notifications/notifications.component';
import { RideDetailComponent } from './admin/rides/ride-detail.component';
import { VehiclesComponent } from './admin/vehicles/vehicles.component';
import { ContactDriversComponent } from './admin/contact-drivers/contact-drivers.component';
import { MapsComponent } from './admin/maps/maps.component';
import { FleetsSettingsComponent } from './admin/settings/fleets.component';
import { SettingsComponent } from './admin/settings/settings.component';
import { OperatorSettingsComponent } from './admin/settings/operator-settings.component';
import { AppAssetsComponent } from './admin/settings/app-assets.component';
import { VehicleTypeDetailsComponent } from './admin/settings/vehicle-type-details.component';
import { VehicleFareSetupComponent } from './admin/settings/vehicle-fare-setup.component';
import { ManualDispatchComponent } from './admin/rides/manual-dispatch.component';
import { CouponsComponent } from './admin/promotions/coupons.component';
import { SubscriptionsComponent } from './admin/subscriptions/subscriptions.component';
import { FixedDeparturesComponent } from './admin/fixed/fixed-departures.component';
import { ShuttleBookingsComponent } from './admin/shuttle/shuttle-bookings.component';
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
  { path: 'pricing', component: PricingComponent, canActivate: [adminAuthGuard] },
  { path: 'vehicles/:vehicleRowId/fares', component: VehicleFareSetupComponent, canActivate: [adminAuthGuard] },
  { path: 'trips', component: AdminTripsComponent, canActivate: [adminAuthGuard] },
  { path: 'operations', component: OperationsComponent, canActivate: [adminAuthGuard] },
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
  {
    path: 'drivers/:id',
    loadComponent: () => import('./admin/drivers/driver-detail.component').then((m) => m.DriverDetailComponent),
    canActivate: [adminAuthGuard],
  },
  { path: 'contact-drivers', component: ContactDriversComponent, canActivate: [adminAuthGuard] },

  { path: 'rides', component: RidesShellComponent, canActivate: [adminAuthGuard] },
  // Backward-compat: old bookmarks for the sub-tabs land on the flat Rides page.
  { path: 'rides/all', redirectTo: 'rides', pathMatch: 'full' },
  { path: 'rides/map', redirectTo: 'rides', pathMatch: 'full' },
  { path: 'rides/manual-dispatch', component: ManualDispatchComponent, canActivate: [adminAuthGuard] },
  { path: 'notifications', component: AdminNotificationsComponent, canActivate: [adminAuthGuard] },
  // Dynamic trip-id route — placed AFTER manual-dispatch so the static path wins.
  { path: 'rides/:tripId', component: RideDetailComponent, canActivate: [adminAuthGuard] },

  { path: 'maps', component: MapsComponent, canActivate: [adminAuthGuard] },

  { path: 'vehicles', component: VehiclesComponent, canActivate: [adminAuthGuard] },

  { path: 'promotions', redirectTo: 'promotions/coupons', pathMatch: 'full' },
  { path: 'promotions/coupons', component: CouponsComponent, canActivate: [adminAuthGuard] },

  { path: 'subscriptions', component: SubscriptionsComponent, canActivate: [adminAuthGuard] },

  { path: 'fixed-departures', component: FixedDeparturesComponent, canActivate: [adminAuthGuard] },
  { path: 'shuttle-bookings', component: ShuttleBookingsComponent, canActivate: [adminAuthGuard] },

  { path: 'roles-permissions', component: RolesPermissionsComponent, canActivate: [adminAuthGuard] },
  { path: 'managers', component: ManagersComponent, canActivate: [adminAuthGuard] },

  { path: 'settings', redirectTo: 'settings/city', pathMatch: 'full' },
  { path: 'settings/city', component: SettingsComponent, canActivate: [adminAuthGuard] },
  { path: 'settings/operator', component: OperatorSettingsComponent, canActivate: [adminAuthGuard] },
  { path: 'settings/app-assets', component: AppAssetsComponent, canActivate: [adminAuthGuard] },
  { path: 'settings/general', redirectTo: 'settings/city', pathMatch: 'full' },
  { path: 'settings/fleets', component: FleetsSettingsComponent, canActivate: [adminAuthGuard] },
  { path: 'settings/vehicle-types/:vehicleRowId', component: VehicleTypeDetailsComponent, canActivate: [adminAuthGuard] },

  { path: 'analytics', redirectTo: 'analytics/real-time', pathMatch: 'full' },
  { path: 'analytics/real-time', component: AnalyticsRealTimeComponent, canActivate: [adminAuthGuard] },
  { path: 'analytics/graphs', component: AnalyticsGraphsComponent, canActivate: [adminAuthGuard] },
  { path: 'analytics/reports', component: AnalyticsReportsComponent, canActivate: [adminAuthGuard] },

  // Dynamic pricing is now the second tab of the unified Pricing page.
  { path: 'dynamic-pricing', redirectTo: 'pricing', pathMatch: 'full' },

  { path: '**', redirectTo: 'signin' },
];
