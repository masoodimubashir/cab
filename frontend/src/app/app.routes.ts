import { Routes } from '@angular/router';
import { AdminDashboardComponent } from './admin/admin-dashboard.component';
import { AdminDriversComponent } from './admin/admin-drivers.component';
import { AdminPricingComponent } from './admin/admin-pricing.component';
import { AdminTripsComponent } from './admin/admin-trips.component';
import { AdminUsersComponent } from './admin/admin-users.component';
import { AdminSafetyEventsComponent } from './admin/admin-safety-events.component';
import { AdminReportsComponent } from './admin/admin-reports.component';
import { SigninComponent } from './auth/signin.component';
import { adminAuthGuard } from './auth/admin-auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'signin', pathMatch: 'full' },
  { path: 'signin', component: SigninComponent },
  { path: 'dashboard', component: AdminDashboardComponent, canActivate: [adminAuthGuard] },
  { path: 'pricing', component: AdminPricingComponent, canActivate: [adminAuthGuard] },
  { path: 'drivers', component: AdminDriversComponent, canActivate: [adminAuthGuard] },
  { path: 'trips', component: AdminTripsComponent, canActivate: [adminAuthGuard] },
  { path: 'users', component: AdminUsersComponent, canActivate: [adminAuthGuard] },
  { path: 'safety', component: AdminSafetyEventsComponent, canActivate: [adminAuthGuard] },
  { path: 'reports', component: AdminReportsComponent, canActivate: [adminAuthGuard] },
  { path: '**', redirectTo: 'signin' },
];
