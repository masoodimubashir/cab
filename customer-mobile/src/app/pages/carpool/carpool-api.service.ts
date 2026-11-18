import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import {
  CARPOOL_OFF,
  CarpoolConfig,
  CarpoolPaymentResult,
  CarpoolPlan,
  CarpoolPlanPurchase,
  CarpoolPlanState,
  CarpoolUpiOrder,
} from './carpool.models';

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
        map((c) => (c && c.enabled === true ? c : { ...CARPOOL_OFF, driver_signup: c?.driver_signup === true })),
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

  /** True when private car owners may sign up as carpool drivers (driver app). */
  signupOpen(): Observable<boolean> {
    return this.config().pipe(map((c) => c.driver_signup === true));
  }

  /** Plans the signed-in carpool driver can buy (driver app). */
  plans(): Observable<CarpoolPlan[]> {
    return this.api.get<{ data: CarpoolPlan[] }>('/carpool/plans').pipe(map((r) => r?.data ?? []));
  }

  /** The running plan, a waiting one, and whether the driver may publish (driver app). */
  planState(): Observable<CarpoolPlanState> {
    return this.api.get<CarpoolPlanState>('/carpool/plan');
  }

  createPlanOrder(planId: number): Observable<CarpoolUpiOrder> {
    return this.api.post<CarpoolUpiOrder>('/carpool/plan/upi/order', { plan_id: planId });
  }

  verifyPlanPayment(planId: number, payment: CarpoolPaymentResult): Observable<{ queued: boolean; subscription: CarpoolPlanPurchase; message: string }> {
    return this.api.post('/carpool/plan/upi/verify', { plan_id: planId, ...payment });
  }

  /** Forget the cached config, e.g. after logout. */
  reset(): void {
    this.config$ = null;
    this.fetchedAt = 0;
  }
}
