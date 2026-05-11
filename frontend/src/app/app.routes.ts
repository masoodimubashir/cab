import { Routes } from '@angular/router';
import { AdminDashboardComponent } from './admin/admin-dashboard.component';
import { AdminDriversComponent } from './admin/admin-drivers.component';
import { AdminPricingComponent } from './admin/admin-pricing.component';
import { AdminTripsComponent } from './admin/admin-trips.component';
import { AdminUsersComponent } from './admin/admin-users.component';
import { AdminSafetyEventsComponent } from './admin/admin-safety-events.component';
import { AdminReportsComponent } from './admin/admin-reports.component';
import { RidesMapComponent } from './admin/rides/rides-map.component';
import { RidesAllComponent } from './admin/rides/rides-all.component';
import { DriversActiveComponent } from './admin/drivers/drivers-active.component';
import { DriversDeactivatedComponent } from './admin/drivers/drivers-deactivated.component';
import { DriversLeaderboardComponent } from './admin/drivers/drivers-leaderboard.component';
import { DriversPerformanceComponent } from './admin/drivers/drivers-performance.component';
import { DriverDocumentsComponent } from './admin/drivers/driver-documents.component';
import { DriverApprovalDetailsComponent } from './admin/drivers/driver-approval-details.component';
import { VehiclesComponent } from './admin/vehicles/vehicles.component';
import { ContactDriversComponent } from './admin/contact-drivers/contact-drivers.component';
import { DynamicPricingListComponent } from './admin/dynamic-pricing/dynamic-pricing-list.component';
import { DynamicPricingFormComponent } from './admin/dynamic-pricing/dynamic-pricing-form.component';
import { MapsComponent } from './admin/maps/maps.component';
import { GeofencingComponent } from './admin/settings/geofencing.component';
import { FleetsSettingsComponent } from './admin/settings/fleets.component';
import { SettingsComponent } from './admin/settings/settings.component';
import { VehicleTypeDetailsComponent } from './admin/settings/vehicle-type-details.component';
import { ManualDispatchComponent } from './admin/rides/manual-dispatch.component';
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
  { path: 'safety', component: AdminSafetyEventsComponent, canActivate: [adminAuthGuard] },
  { path: 'reports', component: AdminReportsComponent, canActivate: [adminAuthGuard] },

  { path: 'drivers', redirectTo: 'drivers/active', pathMatch: 'full' },
  { path: 'drivers/active', component: DriversActiveComponent, canActivate: [adminAuthGuard] },
  { path: 'drivers/deactivated', component: DriversDeactivatedComponent, canActivate: [adminAuthGuard] },
  { path: 'drivers/leaderboard', component: DriversLeaderboardComponent, canActivate: [adminAuthGuard] },
  { path: 'drivers/performance', component: DriversPerformanceComponent, canActivate: [adminAuthGuard] },
  { path: 'drivers/approvals', component: AdminDriversComponent, canActivate: [adminAuthGuard] },
  { path: 'drivers/approvals/:driverId', component: DriverApprovalDetailsComponent, canActivate: [adminAuthGuard] },
  { path: 'drivers/documents', component: DriverDocumentsComponent, canActivate: [adminAuthGuard] },
  { path: 'contact-drivers', component: ContactDriversComponent, canActivate: [adminAuthGuard] },

  { path: 'rides', redirectTo: 'rides/all', pathMatch: 'full' },
  { path: 'rides/all', component: RidesAllComponent, canActivate: [adminAuthGuard] },
  { path: 'rides/map', component: RidesMapComponent, canActivate: [adminAuthGuard] },
  { path: 'rides/manual-dispatch', component: ManualDispatchComponent, canActivate: [adminAuthGuard] },

  { path: 'maps', component: MapsComponent, canActivate: [adminAuthGuard] },

  { path: 'vehicles', component: VehiclesComponent, canActivate: [adminAuthGuard] },

  { path: 'settings', redirectTo: 'settings/city', pathMatch: 'full' },
  { path: 'settings/city', component: SettingsComponent, canActivate: [adminAuthGuard] },
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
