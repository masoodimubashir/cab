import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

export interface CityOption {
  id: number;
  name: string;
  is_active?: boolean;
  country_code?: string;
  center_lat?: number | string | null;
  center_lng?: number | string | null;
}

const STORAGE_KEY = 'dc.selectedCityId';

/**
 * Holds the currently-selected admin city.
 *
 * - Super Admin can pick any city from the dropdown.
 * - Scoped managers (manager_city_id set) are locked to their city; the
 *   dropdown becomes read-only via `isLocked`.
 */
@Injectable({ providedIn: 'root' })
export class CityContextService {
  private readonly _cityId$ = new BehaviorSubject<number | null>(this.readStored());
  private readonly _cities$ = new BehaviorSubject<CityOption[]>([]);
  private loading = false;
  private loaded = false;

  readonly cityId$ = this._cityId$.asObservable();
  readonly cities$ = this._cities$.asObservable();

  constructor(private api: ApiService, private auth: AuthService) {}

  /** True when the current user has a fixed city — the dropdown should be read-only. */
  get isLocked(): boolean {
    const p = this.auth.profile;
    return !!p && !p.is_super_admin && p.manager_city_id != null;
  }

  /** Returns the city ID the current user is pinned to, if any. */
  get lockedCityId(): number | null {
    return this.isLocked ? this.auth.profile!.manager_city_id : null;
  }

  /** Lazily fetch the cities list once and cache it. Re-call to refresh. */
  ensureCitiesLoaded(force = false): Observable<CityOption[]> {
    if ((this.loaded && !force) || this.loading) {
      return of(this._cities$.value);
    }
    this.loading = true;
    return this.api
      .get<{ data?: CityOption[] } | CityOption[]>('/admin/cities')
      .pipe(
        map((res): CityOption[] => (Array.isArray(res) ? res : res?.data ?? [])),
        tap((list) => {
          this._cities$.next(list);
          this.loaded = true;
          this.loading = false;

          // If the user is scoped to a city, force-select it regardless of
          // any stale value in localStorage.
          if (this.isLocked) {
            const locked = this.lockedCityId;
            if (locked != null && this._cityId$.value !== locked) {
              this.setCityId(locked);
            }
            return;
          }

          // Super Admin: keep the stored selection if still valid, otherwise
          // default to the first active city in the list.
          if (this._cityId$.value == null && list.length > 0) {
            const first = list.find((c) => c.is_active !== false) ?? list[0];
            this.setCityId(first.id);
          }
          if (this._cityId$.value != null && !list.some((c) => c.id === this._cityId$.value)) {
            this.setCityId(list[0]?.id ?? null);
          }
        }),
        catchError(() => {
          this.loading = false;
          return of([] as CityOption[]);
        }),
        shareReplay(1),
      );
  }

  setCityId(id: number | null): void {
    // A scoped manager cannot switch away from their assigned city.
    if (this.isLocked && id !== this.lockedCityId) {
      id = this.lockedCityId;
    }
    if (id == null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, String(id));
    }
    this._cityId$.next(id);
  }

  get currentCityId(): number | null {
    return this._cityId$.value;
  }

  private readStored(): number | null {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
}
