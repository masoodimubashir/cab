import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import { CARPOOL_OFF, CarpoolConfig } from './carpool.models';

/**
 * Every carpool API call goes through here. Keep identical in both apps.
 *
 * The app never assumes carpool exists: it asks /carpool/config and treats a
 * failed call as "off", so no carpool entry point shows when in doubt.
 */
@Injectable({ providedIn: 'root' })
export class CarpoolApiService {
  /** How long a config answer is reused before asking again. */
  private static readonly CONFIG_TTL_MS = 60_000;

  private config$: Observable<CarpoolConfig> | null = null;
  private fetchedAt = 0;

  constructor(private api: ApiService) {}

  config(force = false): Observable<CarpoolConfig> {
    const stale = Date.now() - this.fetchedAt > CarpoolApiService.CONFIG_TTL_MS;
    if (!this.config$ || stale || force) {
      this.fetchedAt = Date.now();
      this.config$ = this.api.get<CarpoolConfig>('/carpool/config').pipe(
        map((c) => (c && c.enabled === true ? c : CARPOOL_OFF)),
        catchError(() => {
          this.fetchedAt = 0; // try again next time instead of caching the failure
          return of(CARPOOL_OFF);
        }),
        shareReplay(1),
      );
    }
    return this.config$;
  }

  enabled(): Observable<boolean> {
    return this.config().pipe(map((c) => c.enabled));
  }

  /** Forget the cached config, e.g. after logout. */
  reset(): void {
    this.config$ = null;
    this.fetchedAt = 0;
  }
}
