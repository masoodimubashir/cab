import { computed, Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Subject, catchError, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

export type RideMode = 'private' | 'fixed' | 'shuttle';
export const servicePermissions = ['vehicles', 'pricing', 'city_settings', 'operator_settings', 'rides'];

export function resolvedRideMode(mode: RideMode | null | undefined, name: string | null): RideMode {
  if (mode) return mode;
  const lower = name?.toLowerCase() ?? '';
  if (lower.includes('shuttle')) return 'shuttle';
  if (lower.includes('fixed')) return 'fixed';
  return 'private';
}

const defaults = { private: 'Private', fixed: 'Fixed', shuttle: 'Shuttle' };
type Settings = { [K in RideMode as `${K}_service_name` | `${K}_service_image_url`]: string | null };
const defaultImages: Record<RideMode, string | null> = { private: null, fixed: null, shuttle: null };
const fallback = { labels: defaults, images: defaultImages };

function fromSettings(settings: Settings) {
  const labels = {
    private: settings.private_service_name?.trim() || defaults.private,
    fixed: settings.fixed_service_name?.trim() || defaults.fixed,
    shuttle: settings.shuttle_service_name?.trim() || defaults.shuttle,
  };
  return { labels, images: { private: settings.private_service_image_url,
    fixed: settings.fixed_service_image_url, shuttle: settings.shuttle_service_image_url } };
}

interface CatalogMode {
  mode: string;
  image_url?: string | null;
  display_name?: string | null;
}

@Injectable({ providedIn: 'root' })
export class ServiceNamesService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly saved = new Subject<Settings>();

  private readonly branding = toSignal(this.auth.profile$.pipe(
    map(profile => profile && this.auth.hasAnyPermission(servicePermissions) ? profile : null),
    distinctUntilChanged(),
    switchMap(profile => {
      if (!profile) return of(fallback);
      return this.saved.pipe(
        startWith(undefined),
        switchMap(name => {
          if (name !== undefined) return of(fromSettings(name));
          return this.loadName(profile.manager_city_id).pipe(catchError(() => of(fallback)));
        }),
      );
    }),
  ), { initialValue: fallback });
  readonly labels = computed(() => this.branding().labels);
  readonly images = computed(() => this.branding().images);

  private loadName(managerCityId: number | null) {
    if (this.auth.hasPermission('operator_settings')) {
      return this.api.get<{ settings: Settings }>('/admin/operator-settings')
        .pipe(map(res => fromSettings(res.settings)));
    }
    // The catalogue is global, but its read endpoint still takes a city ID.
    const cityId = managerCityId ? of(managerCityId)
      : this.api.get<{ data: { id: number }[] }>('/catalog/cities').pipe(map(res => res.data[0]?.id));
    return cityId.pipe(switchMap(id => {
      if (!id) return of(fallback);
      return this.api.get<{ service_artwork?: CatalogMode[]; scopes: { modes: CatalogMode[] }[] }>(
        `/catalog/cities/${id}/driver-ride-products`,
      ).pipe(map(res => {
        const modes = res.service_artwork ?? res.scopes.flatMap(scope => scope.modes);
        const names = { ...defaults };
        const images = { ...defaultImages };
        for (const mode of modes) {
          if (mode.mode === 'private' || mode.mode === 'fixed' || mode.mode === 'shuttle') {
            images[mode.mode] = mode.image_url ?? null;
            names[mode.mode] = mode.display_name?.trim() || defaults[mode.mode];
          }
        }
        return { labels: names, images };
      }));
    }));
  }

  updateSavedNames(settings: Settings): void {
    this.saved.next(settings);
  }
}
