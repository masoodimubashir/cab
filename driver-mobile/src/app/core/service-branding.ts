import { catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiService } from './api.service';

export type ServiceMode = 'private' | 'fixed' | 'shuttle';
export type ServiceBranding = Partial<Record<ServiceMode, { label: string; imageUrl: string }>>;
export const defaultServiceNames = { private: 'Private', fixed: 'Fixed', shuttle: 'Shuttle' };

interface Product {
  mode: ServiceMode;
  name?: string;
  display_name?: string | null;
  image_url?: string | null;
}
interface Catalog {
  scopes?: { modes: Product[] }[];
  service_artwork?: Product[];
}

export function resolveArtworkUrl(url: string | null | undefined): string {
  const value = url?.trim();
  if (!value) return '';
  const apiBase = environment.apiUrl.replace(/\/api\/?$/i, '').replace(/\/$/, '');

  try {
    const apiOrigin = new URL(apiBase);
    const imageUrl = new URL(value, `${apiBase}/`);
    if (!['http:', 'https:'].includes(imageUrl.protocol)) return '';

    if (['localhost', '127.0.0.1', '[::1]'].includes(imageUrl.hostname)) {
      return `${apiBase}${imageUrl.pathname}${imageUrl.search}${imageUrl.hash}`;
    }

    // Older servers can return HTTP links for uploads on our HTTPS API host.
    if (apiOrigin.protocol === 'https:' && imageUrl.protocol === 'http:'
      && imageUrl.host === apiOrigin.host) {
      imageUrl.protocol = 'https:';
    }
    return imageUrl.href;
  } catch {
    return '';
  }
}

export function loadServiceBranding(api: ApiService, cityId?: number | null) {
  // Names and service images are global. The existing catalog URL still needs a city.
  const city = cityId ? of(cityId) : api.get<{ data: { id: number }[] }>('/catalog/cities')
    .pipe(map(list => list.data?.[0]?.id));
  return city.pipe(switchMap(id => {
    if (!id) return of({} as ServiceBranding);
    const read = (path: string) => api.get<Catalog>(path).pipe(catchError(() => of(null)));
    return forkJoin({
      catalog: read(`/catalog/cities/${id}/driver-ride-products`),
      pricing: read(`/pricing/cities/${id}/products`),
    }).pipe(map(({ catalog, pricing }) => {
      const result: ServiceBranding = {};
      const products = (source: Catalog | null) =>
        (source?.scopes ?? []).reduce<Product[]>((items, scope) => items.concat(scope.modes ?? []), []);
      for (const item of [...products(pricing), ...products(catalog), ...(catalog?.service_artwork ?? [])]) {
        if (!(item.mode in defaultServiceNames)) continue;
        const previous = result[item.mode];
        const image = item.image_url?.trim();
        result[item.mode] = {
          label: item.display_name?.trim() || previous?.label || item.name?.trim() || defaultServiceNames[item.mode],
          imageUrl: resolveArtworkUrl(image) || previous?.imageUrl || '',
        };
      }
      return result;
    }));
  }), catchError(() => of({} as ServiceBranding)));
}
