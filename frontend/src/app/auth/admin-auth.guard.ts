import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { inject } from '@angular/core';

export const adminAuthGuard: CanActivateFn = (): boolean | UrlTree => {
  const router = inject(Router);

  const token = localStorage.getItem('dreamcabs_token');
  if (token) {
    return true;
  }

  return router.parseUrl('/signin');
};

