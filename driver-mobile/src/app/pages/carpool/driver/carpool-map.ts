import { CarpoolPlace, CarpoolRoute } from '../carpool.models';

declare const google: any;

/**
 * Map pieces for the carpool driver screens: route options from Google and
 * drawing a saved route. The app asks Google, then sends the chosen line to the
 * server (Carpool.md P5), so riders viewing it later cost no map calls.
 */

export interface RouteOption extends CarpoolRoute {
  /** Google's own path, kept for drawing while the driver chooses. */
  path: { lat: number; lng: number }[];
}

const GREEN = '#087f50';
const GREY = '#a8b3bf';
/** Stored lines stay under the server's 500 points (config carpool.route_max_points). */
const MAX_POINTS = 480;

/**
 * Loads Maps with the places and marker libraries. The app has two loaders;
 * if the other one ran first, the missing libraries are imported here.
 */
export async function loadCarpoolMaps(places: { ensureLoaded(): Promise<void> }): Promise<void> {
  await places.ensureLoaded();
  const maps = (window as any).google?.maps;
  if (!maps?.places && maps?.importLibrary) await maps.importLibrary('places');
  if (!maps?.marker && maps?.importLibrary) await maps.importLibrary('marker');
}

/** Up to 3 driving routes between two places. Needs the Maps script loaded. */
export function fetchRouteOptions(from: CarpoolPlace, to: CarpoolPlace): Promise<RouteOption[]> {
  return new Promise((resolve, reject) => {
    new google.maps.DirectionsService().route(
      {
        origin: { lat: from.lat, lng: from.lng },
        destination: { lat: to.lat, lng: to.lng },
        travelMode: google.maps.TravelMode.DRIVING,
        provideRouteAlternatives: true,
        region: 'in',
      },
      (result: any, status: string) => {
        if (status !== 'OK' || !result?.routes?.length) {
          reject(new Error(status));
          return;
        }
        resolve(
          result.routes.slice(0, 3).map((r: any) => {
            const legs = r.legs ?? [];
            const path: { lat: number; lng: number }[] = (r.overview_path ?? []).map((p: any) => ({ lat: p.lat(), lng: p.lng() }));
            return {
              path,
              polyline: thin(path).map((p) => [round(p.lat), round(p.lng)] as [number, number]),
              distance_m: legs.reduce((s: number, l: any) => s + (l.distance?.value ?? 0), 0),
              duration_s: legs.reduce((s: number, l: any) => s + (l.duration?.value ?? 0), 0),
              summary: r.summary ? `Via ${r.summary}` : null,
            };
          }),
        );
      },
    );
  });
}

/** A plain, quiet map in a container. */
export function createMap(el: HTMLElement): any {
  return new google.maps.Map(el, {
    center: { lat: 34.08, lng: 74.8 },
    zoom: 12,
    mapId: 'DEMO_MAP_ID',
    disableDefaultUI: true,
    gestureHandling: 'cooperative',
    clickableIcons: false,
  });
}

/**
 * Draws routes: the chosen one green on top, the others grey. Returns a
 * function that removes everything drawn.
 */
export function drawRoutes(map: any, lines: { lat: number; lng: number }[][], chosen: number, onPick?: (i: number) => void): () => void {
  const drawn: any[] = [];
  const bounds = new google.maps.LatLngBounds();
  lines.forEach((path, i) => {
    if (i === chosen) return;
    const p = new google.maps.Polyline({ map, path, strokeColor: GREY, strokeWeight: 5, strokeOpacity: 1, zIndex: 1, clickable: !!onPick });
    if (onPick) p.addListener('click', () => onPick(i));
    drawn.push(p);
  });
  const path = lines[chosen] ?? [];
  if (path.length) {
    drawn.push(new google.maps.Polyline({ map, path, strokeColor: '#ffffff', strokeWeight: 10, zIndex: 2 }));
    drawn.push(new google.maps.Polyline({ map, path, strokeColor: GREEN, strokeWeight: 6, zIndex: 3 }));
    drawn.push(pin(map, path[0], 'start'), pin(map, path[path.length - 1], 'end'));
  }
  lines.forEach((line) => line.forEach((p) => bounds.extend(p)));
  if (!bounds.isEmpty()) map.fitBounds(bounds, 28);

  return () => drawn.forEach((d) => (d.setMap ? d.setMap(null) : (d.map = null)));
}

/** A saved line ([[lat, lng], ...]) as map points. */
export function toPath(line: [number, number][] | undefined): { lat: number; lng: number }[] {
  return (line ?? []).map(([lat, lng]) => ({ lat, lng }));
}

function pin(map: any, position: { lat: number; lng: number }, kind: 'start' | 'end'): any {
  const el = document.createElement('div');
  // Pickup: ring-and-dot. Drop: pin (its tip sits on the point). Same pair as the screens (2026-11-19).
  el.innerHTML = kind === 'start'
    ? `<svg width="26" height="26" viewBox="0 0 16 16" aria-hidden="true" style="display:block;filter:drop-shadow(0 1px 3px #0005)"><circle cx="8" cy="8" r="6" fill="#fff" stroke="${GREEN}" stroke-width="2"/><circle cx="8" cy="8" r="2.6" fill="${GREEN}"/></svg>`
    : '<svg width="28" height="34" viewBox="0 0 16 20" aria-hidden="true" style="display:block;filter:drop-shadow(0 1px 3px #0005)"><path d="M8 1C4.4 1 1.5 3.8 1.5 7.3c0 4.3 4.9 10.1 5.9 11.3a.8.8 0 001.2 0c1-1.2 5.9-7 5.9-11.3C14.5 3.8 11.6 1 8 1z" fill="#0d1b2a" stroke="#fff" stroke-width="1"/><circle cx="8" cy="7.3" r="2.6" fill="#fff"/></svg>';
  if (kind === 'start') el.style.transform = 'translateY(50%)'; // centre the ring on the point
  return new google.maps.marker.AdvancedMarkerElement({ map, position, content: el, zIndex: 4 });
}

function thin<T>(path: T[]): T[] {
  if (path.length <= MAX_POINTS) return path;
  const out: T[] = [];
  for (let i = 0; i < MAX_POINTS; i++) out.push(path[Math.round((i * (path.length - 1)) / (MAX_POINTS - 1))]);
  return out;
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

const M_PER_DEG = 111_320;

export interface RoutePos { lat: number; lng: number; along_m: number; distance_m: number; }

/** The nearest point on the saved route to P, and how far along the route it sits. */
export function snapToPath(path: { lat: number; lng: number }[], p: { lat: number; lng: number }): RoutePos {
  let best: RoutePos = { lat: path[0]?.lat ?? p.lat, lng: path[0]?.lng ?? p.lng, along_m: 0, distance_m: Infinity };
  let along = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const mLng = M_PER_DEG * Math.cos((a.lat * Math.PI) / 180);
    const bx = (b.lng - a.lng) * mLng;
    const by = (b.lat - a.lat) * M_PER_DEG;
    const px = (p.lng - a.lng) * mLng;
    const py = (p.lat - a.lat) * M_PER_DEG;
    const len2 = bx * bx + by * by;
    const t = len2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
    const d = Math.hypot(px - t * bx, py - t * by);
    if (d < best.distance_m) best = { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng), along_m: along + t * Math.sqrt(len2), distance_m: d };
    along += Math.sqrt(len2);
  }
  return best;
}

/** Straight-line metres between two nearby points. */
export function flatMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dx = (b.lng - a.lng) * M_PER_DEG * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const dy = (b.lat - a.lat) * M_PER_DEG;
  return Math.hypot(dx, dy);
}

/** The green draggable pin for a pickup spot. */
export function pickupPin(map: any, at: { lat: number; lng: number }, onDrop: (p: { lat: number; lng: number }) => void): any {
  const el = document.createElement('div');
  el.innerHTML = '<svg width="34" height="44" viewBox="-17 -40 34 44" aria-hidden="true"><path d="M0 0C-4-8-15-16-15-27a15 15 0 0130 0C15-16 4-8 0 0z" fill="#087f50" stroke="#fff" stroke-width="3"/><circle cy="-27" r="5.5" fill="#fff"/></svg>';
  const m = new google.maps.marker.AdvancedMarkerElement({ map, position: at, content: el, zIndex: 5, gmpDraggable: true });
  m.addListener('dragend', () => {
    const p = m.position;
    onDrop({ lat: typeof p.lat === 'function' ? p.lat() : p.lat, lng: typeof p.lng === 'function' ? p.lng() : p.lng });
  });
  return m;
}

/** A grey dot with a label: where the rider asked to be picked up. */
export function askedMarker(map: any, at: { lat: number; lng: number }, label: string): any {
  const el = document.createElement('div');
  el.style.cssText = 'position:relative;width:16px;height:16px';
  el.innerHTML = `<span style="position:absolute;right:26px;top:-4px;padding:4px 12px;border-radius:12px;background:#fff;font:700 12px Roboto,sans-serif;color:#55657b;white-space:nowrap;border:1px solid #e2e8f0">${label.replace(/[<>&]/g, '')}</span><span style="display:block;width:16px;height:16px;box-sizing:border-box;border-radius:50%;background:#fff;border:3px solid #8a97a6"></span>`;
  return new google.maps.marker.AdvancedMarkerElement({ map, position: at, content: el, zIndex: 3 });
}

/** Centres and zooms once the map has settled (a fitBounds just before would otherwise win). */
export function focusMap(map: any, at: { lat: number; lng: number }, zoom: number): void {
  google.maps.event.addListenerOnce(map, 'idle', () => {
    map.setCenter(at);
    map.setZoom(zoom);
  });
}

/** A short name and the full address for a point. */
export function placeName(at: { lat: number; lng: number }): Promise<{ name: string; address: string } | null> {
  return new Promise((resolve) => {
    new google.maps.Geocoder().geocode({ location: at }, (results: any[], status: string) => {
      if (status !== 'OK' || !results?.length) return resolve(null);
      const want = ['point_of_interest', 'neighborhood', 'sublocality_level_2', 'sublocality_level_1', 'sublocality', 'route', 'locality'];
      for (const type of want) {
        for (const r of results) {
          const c = (r.address_components ?? []).find((x: any) => x.types?.includes(type));
          if (c?.long_name && !/^[A-Z0-9]{4}\+/.test(c.long_name) && !/^\d/.test(c.long_name)) {
            return resolve({ name: c.long_name, address: r.formatted_address ?? c.long_name });
          }
        }
      }
      const first = results.find((r) => !r.types?.includes('plus_code')) ?? results[0];
      const address = first?.formatted_address ?? '';
      resolve(address ? { name: address.split(',')[0].trim(), address } : null);
    });
  });
}
