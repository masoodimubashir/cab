import { NgModule, inject } from '@angular/core';
import { AuthService } from './core/auth.service';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { AuthGuard } from './core/auth.guard';
import { GuestGuard } from './core/guest.guard';

export const routes: Routes = [
  {
    path: 'welcome',
    loadChildren: () => import('./pages/welcome/welcome.module').then( m => m.WelcomePageModule),
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
    canActivate: [AuthGuard],
  },
  {
    path: 'customer-tabs',
    loadChildren: () =>
      import('./customer-tabs/customer-tabs.module').then((m) => m.CustomerTabsPageModule),
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
    path: 'performance',
    loadChildren: () =>
      import('./pages/performance/performance.module').then((m) => m.PerformancePageModule),
    canActivate: [AuthGuard],
  },
  {
    path: 'delete-account',
    loadChildren: () =>
      import('./pages/delete-account/delete-account.module').then((m) => m.DeleteAccountPageModule),
    canActivate: [AuthGuard],
  },
  {
    path: 'fixed-book',
    loadChildren: () =>
      import('./pages/fixed-book/fixed-book.module').then((m) => m.FixedBookPageModule),
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
    // Search and Results need carpool switched on (CarpoolEnabledGuard inside);
    // a rider's own carpool pages keep opening while it's off (A36).
    path: 'carpool',
    loadChildren: () => import('./pages/carpool/carpool.module').then((m) => m.CarpoolModule),
    canActivate: [AuthGuard],
  },
  {
    // No splash: opening the app goes straight to the welcome page, or to Home when signed in.
    path: '',
    redirectTo: () => (inject(AuthService).isLoggedIn() ? '/customer-tabs/go' : '/welcome'),
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: '',
  }
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })],
  exports: [RouterModule],
})
export class AppRoutingModule {}
