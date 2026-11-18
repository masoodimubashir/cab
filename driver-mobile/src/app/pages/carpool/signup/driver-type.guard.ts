import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { ApiService } from '../../../core/api.service';
import { AuthService } from '../../../core/auth.service';
import { CarpoolApiService } from '../carpool-api.service';
import { DriverMe, DriverTypeMemory } from './carpool-signup.models';

/**
 * Runs before the commercial sign-up wizard (/profile).
 *
 * - Not registered yet, carpool sign-up open, no choice made: ask the first
 *   sign-up question ("How will you drive with Dream Cabs?").
 * - Registered as a carpool driver: go to the carpool status page instead of
 *   the commercial profile.
 * - Everything else (commercial drivers, carpool off, errors): carry on to /profile
 *   exactly as before.
 */
@Injectable({ providedIn: 'root' })
export class DriverTypeGuard implements CanActivate {
  constructor(
    private api: ApiService,
    private auth: AuthService,
    private carpool: CarpoolApiService,
    private router: Router,
  ) {}

  canActivate(): Observable<boolean | UrlTree> {
    const userId = this.auth.getUser()?.id;
    return this.api.get<DriverMe>('/drivers/me').pipe(
      switchMap((me) => {
        if (me.driver?.driver_type === 'carpool') return of(this.router.parseUrl('/carpool-signup/status'));
        if (me.driver || DriverTypeMemory.get(userId) === 'commercial') return of(true);
        return this.carpool.signupOpen().pipe(map((open) => (open ? this.router.parseUrl('/carpool-signup') : true)));
      }),
      catchError(() => of(true)),
    );
  }
}
