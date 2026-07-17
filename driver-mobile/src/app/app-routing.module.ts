import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { AuthGuard } from './core/auth.guard';
import { ApprovedDriverGuard } from './core/approved-driver.guard';

const routes: Routes = [
  {
    path: 'splash',
    loadChildren: () => import('./pages/splash/splash.module').then((m) => m.SplashPageModule),
  },
  {
    path: 'welcome',
    loadChildren: () => import('./pages/welcome/welcome.module').then((m) => m.WelcomePageModule),
  },
  {
    path: 'intro',
    loadChildren: () => import('./pages/intro/intro.module').then((m) => m.IntroPageModule),
  },
  {
    path: 'auth/login',
    loadChildren: () => import('./auth/login/login.module').then((m) => m.LoginPageModule),
  },
  {
    path: 'tabs',
    loadChildren: () => import('./tabs/tabs.module').then((m) => m.TabsPageModule),
    canActivate: [AuthGuard, ApprovedDriverGuard],
  },
  {
    path: 'profile',
    loadChildren: () => import('./pages/profile/profile.module').then((m) => m.ProfilePageModule),
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
    loadChildren: () =>
      import('./pages/driver-registration/driver-registration.module').then(
        (m) => m.DriverRegistrationPageModule
      ),
    canActivate: [AuthGuard],
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
    path: 'payment-methods',
    loadChildren: () =>
      import('./pages/payment-methods/payment-methods.module').then((m) => m.PaymentMethodsPageModule),
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
    path: '',
    redirectTo: 'splash',
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: 'splash',
  },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })],
  exports: [RouterModule],
})
export class AppRoutingModule {}
