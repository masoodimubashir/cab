import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ApiService } from '../../../core/api.service';

/**
 * The carpool tabs, Publish and the carpool page are for approved carpool
 * drivers. Anyone else goes to the sign-up status page, which sends commercial
 * drivers back to their own screens.
 */
@Injectable({ providedIn: 'root' })
export class CarpoolDriverGuard implements CanActivate {
  constructor(
    private api: ApiService,
    private router: Router,
  ) {}

  canActivate(): Observable<boolean | UrlTree> {
    return this.api.get<{ driver?: { driver_type?: string; approval_status?: string } | null }>('/drivers/me').pipe(
      map((me) =>
        me.driver?.driver_type === 'carpool' && me.driver.approval_status === 'approved'
          ? true
          : this.router.parseUrl('/carpool-signup/status'),
      ),
      catchError(() => of(this.router.parseUrl('/carpool-signup/status'))),
    );
  }
}
