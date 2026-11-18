import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CarpoolApiService } from './carpool-api.service';

/** Lets a carpool route open only while /carpool/config says carpool is on. Keep identical in both apps. */
@Injectable({ providedIn: 'root' })
export class CarpoolEnabledGuard implements CanActivate {
  constructor(
    private carpool: CarpoolApiService,
    private router: Router,
  ) {}

  canActivate(): Observable<boolean | UrlTree> {
    return this.carpool.enabled().pipe(map((on) => (on ? true : this.router.parseUrl('/'))));
  }
}
