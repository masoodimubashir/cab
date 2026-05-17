import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { AuthGuard } from './core/auth.guard';

const routes: Routes = [
  {
    path: 'welcome',
    loadChildren: () => import('./pages/welcome/welcome.module').then( m => m.WelcomePageModule)
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
    path: '',
    redirectTo: 'splash',
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: 'splash',
  },
  {
    path: 'splash',
    loadChildren: () => import('./pages/splash/splash.module').then( m => m.SplashPageModule)
  }
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })],
  exports: [RouterModule],
})
export class AppRoutingModule {}
