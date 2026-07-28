import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

const CACHE_KEY = 'dreamcabs_driver_state';
const CACHE_TTL_MS = 60_000; // 1 minute — keeps tab nav snappy without going stale.

type DriverState = 'approved' | 'pending' | 'registering';

interface CachedState {
  state: DriverState;
  at: number;
}

/**
 * Gates the driver-side tabs.
 *
 *   approved    → allow the requested route
 *   pending     → redirect to /driver-pending-review (the locked under-review screen)
 *   registering → redirect to /driver-registration (still needs to upload docs)
 *
 * Resolves the state from a cached /drivers/me snapshot (TTL ~1 min). The
 * pending-review page polls /drivers/me anyway, so transitions are reflected
 * promptly without hammering the backend on every navigation.
 */
@Injectable({ providedIn: 'root' })
export class ApprovedDriverGuard implements CanActivate {
  constructor(
    private auth: AuthService,
    private api: ApiService,
    private router: Router,
  ) {}

  canActivate(): Observable<boolean | UrlTree> | boolean | UrlTree {
    if (!this.auth.isLoggedIn()) {
      return this.router.parseUrl('/auth/login');
    }

    const cached = this.readCache();
    if (cached) {
      return this.toDecision(cached.state);
    }

    return this.api
      .get<{ driver: { approval_status?: string } | null; documents: { status: string }[] }>('/drivers/me')
      .pipe(
        map((res) => {
          const status = res.driver?.approval_status ?? null;
          const hasDocs = (res.documents ?? []).length > 0;
          let state: DriverState = 'registering';
          if (status === 'approved') state = 'approved';
          else if (hasDocs) state = 'pending';
          this.writeCache(state);
          return this.toDecision(state);
        }),
        catchError(() => of(this.router.parseUrl('/auth/login'))),
      );
  }

  private toDecision(state: DriverState): boolean | UrlTree {
    if (state === 'approved') return true;
    if (state === 'pending') return this.router.parseUrl('/driver-pending-review');
    return this.router.parseUrl('/profile');
  }

  /**
   * External setters used by login / registration / pending-review pages so
   * their fresher snapshot of /drivers/me flows through the guard.
   */
  static setStateApproved(): void { ApprovedDriverGuard.writeStaticCache('approved'); }
  static setStatePending(): void { ApprovedDriverGuard.writeStaticCache('pending'); }
  static setStateRegistering(): void { ApprovedDriverGuard.writeStaticCache('registering'); }
  static clearCache(): void { localStorage.removeItem(CACHE_KEY); }

  private writeCache(state: DriverState): void {
    ApprovedDriverGuard.writeStaticCache(state);
  }

  private readCache(): CachedState | null {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as CachedState;
      if (!parsed?.at || Date.now() - parsed.at > CACHE_TTL_MS) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private static writeStaticCache(state: DriverState): void {
    const payload: CachedState = { state, at: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  }
}
