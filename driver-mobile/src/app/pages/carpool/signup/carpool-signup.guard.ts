import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CarpoolApiService } from '../carpool-api.service';

/** Opens the carpool sign-up pages only while /carpool/config says sign-up is open. */
@Injectable({ providedIn: 'root' })
export class CarpoolSignupGuard implements CanActivate {
  constructor(
    private carpool: CarpoolApiService,
    private router: Router,
  ) {}

  canActivate(): Observable<boolean | UrlTree> {
    return this.carpool.signupOpen().pipe(map((open) => (open ? true : this.router.parseUrl('/profile'))));
  }
}
