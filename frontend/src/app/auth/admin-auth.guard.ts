import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { map } from 'rxjs/operators';
import { AuthService } from '../core/auth.service';

export const adminAuthGuard: CanActivateFn = (route) => {
  const router = inject(Router);
  const auth = inject(AuthService);

  const token = localStorage.getItem('dreamcabs_token');
  if (!token) {
    return router.parseUrl('/signin');
  }

  const permission = route.data?.['permission'] as string | undefined;
  const permissions = (route.data?.['permissions'] as string[] | undefined) ?? (permission ? [permission] : []);
  if (!permissions.length) {
    return true;
  }

  return auth.ensureLoaded().pipe(
    map(() => auth.hasAnyPermission(permissions) ? true : router.parseUrl(auth.landingRoute())),
  );
};
