import { NgModule, inject } from '@angular/core';
import { AuthService } from './core/auth.service';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { AuthGuard } from './core/auth.guard';
import { CarpoolEnabledGuard } from './pages/carpool/carpool-enabled.guard';
import { DriverTypeGuard } from './pages/carpool/signup/driver-type.guard';
import { GuestGuard } from './core/guest.guard';
import { ApprovedDriverGuard } from './core/approved-driver.guard';

export const routes: Routes = [
  {
    path: 'welcome',
    loadChildren: () => import('./pages/welcome/welcome.module').then((m) => m.WelcomePageModule),
    canActivate: [GuestGuard],
  },
  {
    path: 'intro',
    redirectTo: 'auth/login',
    pathMatch: 'full',
  },
  {
    path: 'auth/login',
    loadChildren: () => import('./auth/login/login.module').then((m) => m.LoginPageModule),
    canActivate: [GuestGuard],
  },
  {
    path: 'tabs',
    loadChildren: () => import('./tabs/tabs.module').then((m) => m.TabsPageModule),
    canActivate: [AuthGuard, ApprovedDriverGuard],
  },
  {
    path: 'profile',
    loadChildren: () => import('./pages/profile/profile.module').then((m) => m.ProfilePageModule),
    canActivate: [AuthGuard, DriverTypeGuard],
  },
  {
    path: 'carpool-signup',
    loadChildren: () => import('./pages/carpool/signup/carpool-signup.module').then((m) => m.CarpoolSignupModule),
    canActivate: [AuthGuard],
  },
  {
    path: 'emergency-contacts',
    loadChildren: () =>
      import('./pages/emergency-contacts/emergency-contacts.module').then(
        (m) => m.EmergencyContactsPageModule,
      ),
    canActivate: [AuthGuard],
  },
  {
    path: 'driver-registration',
    redirectTo: 'profile',
    pathMatch: 'full',
  },
  {
    path: 'driver-pending-review',
    loadChildren: () =>
      import('./pages/driver-pending-review/driver-pending-review.module').then(
        (m) => m.DriverPendingReviewPageModule
      ),
    canActivate: [AuthGuard],
  },
  {
    path: 'performance',
    loadChildren: () =>
      import('./pages/performance/performance.module').then((m) => m.PerformancePageModule),
    canActivate: [AuthGuard],
  },
  {
    path: 'subscriptions',
    loadChildren: () =>
      import('./pages/subscriptions/subscriptions.module').then((m) => m.SubscriptionsPageModule),
    canActivate: [AuthGuard],
  },
  {
    path: 'refunds',
    loadChildren: () =>
      import('./pages/refunds/refunds.module').then((m) => m.RefundsPageModule),
    canActivate: [AuthGuard],
  },
  {
    path: 'support',
    loadChildren: () =>
      import('./pages/support/support.module').then((m) => m.SupportPageModule),
    canActivate: [AuthGuard],
  },
  {
    path: 'notifications',
    loadChildren: () =>
      import('./pages/notifications/notifications.module').then((m) => m.NotificationsPageModule),
    canActivate: [AuthGuard],
  },
  {
    path: 'delete-account',
    loadChildren: () =>
      import('./pages/delete-account/delete-account.module').then((m) => m.DeleteAccountPageModule),
    canActivate: [AuthGuard],
  },
  {
    path: 'terms',
    loadChildren: () => import('./pages/terms/terms.module').then((m) => m.TermsPageModule),
  },
  {
    path: 'privacy',
    loadChildren: () => import('./pages/privacy/privacy.module').then((m) => m.PrivacyPageModule),
  },
  {
    path: 'carpool',
    loadChildren: () => import('./pages/carpool/carpool.module').then((m) => m.CarpoolModule),
    canActivate: [AuthGuard, CarpoolEnabledGuard],
  },
  {
    // No splash: opening the app goes straight to the welcome page, or to the dashboard when signed in.
    path: '',
    redirectTo: () => (inject(AuthService).isLoggedIn() ? '/tabs/dashboard' : '/welcome'),
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: '',
  },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })],
  exports: [RouterModule],
})
export class AppRoutingModule {}
