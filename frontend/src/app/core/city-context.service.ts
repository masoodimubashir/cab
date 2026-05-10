import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { ApiService } from './api.service';

export interface CityOption {
  id: number;
  name: string;
  is_active?: boolean;
}

const STORAGE_KEY = 'dc.selectedCityId';

/**
 * Holds the currently-selected admin city. Powers the global header
 * dropdown so that pages such as General Settings and City Settings
 * always know which city to edit. Persisted in localStorage so the
 * choice survives reloads.
 */
@Injectable({ providedIn: 'root' })
export class CityContextService {
  private readonly _cityId$ = new BehaviorSubject<number | null>(this.readStored());
  private readonly _cities$ = new BehaviorSubject<CityOption[]>([]);
  private loading = false;
  private loaded = false;

  readonly cityId$ = this._cityId$.asObservable();
  readonly cities$ = this._cities$.asObservable();

  constructor(private api: ApiService) {}

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
          // If nothing selected yet, default to the first active city.
          if (this._cityId$.value == null && list.length > 0) {
            const first = list.find((c) => c.is_active !== false) ?? list[0];
            this.setCityId(first.id);
          }
          // If the stored id is no longer valid (deleted city), clear it.
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
