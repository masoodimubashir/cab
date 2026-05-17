import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { ApiService } from './api.service';

export interface ManagerProfile {
  id: number;
  name: string;
  email: string;
  manager_role: {
    id: number;
    slug: string;
    name: string;
    is_super_admin: boolean;
    is_system: boolean;
    requires_fleet: boolean;
  } | null;
  permissions: string[];           // ['*'] for Super Admin
  manager_city_id: number | null;
  manager_city_name: string | null;
  manager_fleet_id: number | null;
  manager_fleet_name: string | null;
  is_super_admin: boolean;
}

const PROFILE_KEY = 'dc.managerProfile';

/**
 * Holds the currently-logged-in manager and answers permission/city
 * questions for the rest of the app. Profile is cached in localStorage
 * so page reloads stay fast; the live source of truth is /admin/me.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _profile$ = new BehaviorSubject<ManagerProfile | null>(this.readStored());
  readonly profile$ = this._profile$.asObservable();

  private loaded = false;

  constructor(private api: ApiService) {}

  ensureLoaded(force = false): Observable<ManagerProfile | null> {
    if (this.loaded && !force) return of(this._profile$.value);
    return this.api.get<{ user: ManagerProfile }>('/admin/me').pipe(
      map((r) => r?.user || null),
      tap((p) => {
        this.loaded = true;
        this.setProfile(p);
      }),
      catchError(() => {
        this.loaded = true;
        return of(this._profile$.value);
      }),
      shareReplay(1),
    );
  }

  setProfile(p: ManagerProfile | null): void {
    if (p) localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    else localStorage.removeItem(PROFILE_KEY);
    this._profile$.next(p);
  }

  clear(): void {
    this.loaded = false;
    this.setProfile(null);
  }

  get profile(): ManagerProfile | null { return this._profile$.value; }
  get isSuperAdmin(): boolean { return !!this._profile$.value?.is_super_admin; }
  get scopedCityId(): number | null {
    const p = this._profile$.value;
    if (!p || p.is_super_admin) return null;
    return p.manager_city_id;
  }

  /**
   * True if the current user holds the given permission slug.
   * Super Admin returns true for every slug.
   */
  hasPermission(slug: string): boolean {
    const p = this._profile$.value;
    if (!p) return false;
    if (p.permissions?.includes('*')) return true;
    return p.permissions?.includes(slug) === true;
  }

  /** True for any slug in the list. */
  hasAnyPermission(slugs: string[]): boolean {
    return slugs.some((s) => this.hasPermission(s));
  }

  private readStored(): ManagerProfile | null {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}
