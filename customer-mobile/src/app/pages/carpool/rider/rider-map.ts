declare const google: any;

/**
 * Map pieces for the carpool rider screens: the driver's saved route in grey,
 * the rider's part of it in green, the pickup (round) and drop (square), and
 * a pin that only moves along the route (customer mockup 4, 5, 5b). The route
 * comes from the server, so drawing it costs no Google route calls.
 */

export interface LatLng { lat: number; lng: number; }
export interface RoutePos extends LatLng { along_m: number; distance_m: number; }

const GREEN = '#087f50';
const GREY = '#a8b3bf';
const NAVY = '#101a2c';
const M_PER_DEG = 111320;

/** Loads Maps with the places and marker libraries (the app has two loaders; fill in what's missing). */
export async function loadRiderMaps(places: { ensureLoaded(): Promise<void> }): Promise<void> {
  await places.ensureLoaded();
  const maps = (window as any).google?.maps;
  if (!maps?.places && maps?.importLibrary) await maps.importLibrary('places');
  if (!maps?.marker && maps?.importLibrary) await maps.importLibrary('marker');
}

/** A plain, quiet map. `free` lets one finger pan it (the full-screen pin view). */
export function createMap(el: HTMLElement, free = false): any {
  return new google.maps.Map(el, {
    center: { lat: 34.08, lng: 74.8 },
    zoom: 12,
    mapId: 'DEMO_MAP_ID',
    disableDefaultUI: true,
    gestureHandling: free ? 'greedy' : 'cooperative',
    clickableIcons: false,
  });
}

/** A saved line ([[lat, lng], ...]) as map points. */
export function toPath(line: [number, number][] | undefined): LatLng[] {
  return (line ?? []).map(([lat, lng]) => ({ lat, lng }));
}

/**
 * Draws the driver's route grey and, when given, the rider's part green with
 * the pickup and drop. `ended` greys the pickup and drop and leaves out the
 * green part (cancelled or ended pages). Returns a function that removes it all.
 */
export function drawRide(map: any, path: LatLng[], part: { pickup: LatLng & { along_m?: number }; drop: LatLng & { along_m?: number } } | null, ended = false, fit = true): () => void {
  const drawn: any[] = [];
  if (path.length < 2) return () => undefined;
  drawn.push(new google.maps.Polyline({ map, path, strokeColor: '#ffffff', strokeWeight: 11, zIndex: 1, clickable: false }));
  drawn.push(new google.maps.Polyline({ map, path, strokeColor: GREY, strokeWeight: 6, zIndex: 2, clickable: false }));
  const bounds = new google.maps.LatLngBounds();
  path.forEach((p) => bounds.extend(p));
  if (part) {
    if (!ended) {
      const a = part.pickup.along_m ?? snapToPath(path, part.pickup).along_m;
      const b = part.drop.along_m ?? snapToPath(path, part.drop).along_m;
      drawn.push(new google.maps.Polyline({ map, path: subPath(path, a, b), strokeColor: GREEN, strokeWeight: 7, zIndex: 3, clickable: false }));
    }
    drawn.push(marker(map, part.pickup, dot(ended ? GREY : GREEN, true)), marker(map, part.drop, dot(ended ? GREY : NAVY, false)));
  }
  if (fit) {
    map.fitBounds(bounds, 28);
    // The page may still be sliding in; fit again once the map has its real size.
    google.maps.event.addListenerOnce(map, 'idle', () => map.fitBounds(bounds, 28));
    setTimeout(() => map.fitBounds(bounds, 28), 450);
  }
  return () => drawn.forEach((d) => (d.setMap ? d.setMap(null) : (d.map = null)));
}

/** A round blue dot for the rider's own place. */
export function youMarker(map: any, at: LatLng): any {
  const el = document.createElement('div');
  el.style.cssText = 'width:14px;height:14px;border-radius:50%;background:#3d7bd9;border:3px solid #fff;box-shadow:0 0 0 8px #3d7bd922';
  return new google.maps.marker.AdvancedMarkerElement({ map, position: at, content: el, zIndex: 3 });
}

/** The green pickup pin (customer 5b). Draggable when `onDrop` is given. */
export function pickupPin(map: any, at: LatLng, onDrop?: (p: LatLng) => void): any {
  const el = document.createElement('div');
  el.innerHTML = '<svg width="34" height="44" viewBox="-17 -40 34 44" aria-hidden="true"><path d="M0 0C-4-8-15-16-15-27a15 15 0 0130 0C15-16 4-8 0 0z" fill="#087f50" stroke="#fff" stroke-width="3"/><circle cy="-27" r="5.5" fill="#fff"/></svg>';
  const m = new google.maps.marker.AdvancedMarkerElement({ map, position: at, content: el, zIndex: 5, gmpDraggable: !!onDrop });
  if (onDrop) {
    m.addListener('dragend', () => {
      const p = m.position;
      onDrop({ lat: typeof p.lat === 'function' ? p.lat() : p.lat, lng: typeof p.lng === 'function' ? p.lng() : p.lng });
    });
  }
  return m;
}

/** The nearest point on the line to P, with how far along the line it sits. */
export function snapToPath(path: LatLng[], p: LatLng): RoutePos {
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
    if (d < best.distance_m) {
      best = { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng), along_m: along + t * Math.sqrt(len2), distance_m: d };
    }
    along += Math.sqrt(len2);
  }
  return best;
}

/** Length of the line in metres. */
export function pathLength(path: LatLng[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) total += flat(path[i], path[i + 1]);
  return total;
}

/** Straight-line metres between two nearby points. */
export function flat(a: LatLng, b: LatLng): number {
  const dx = (b.lng - a.lng) * M_PER_DEG * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const dy = (b.lat - a.lat) * M_PER_DEG;
  return Math.hypot(dx, dy);
}

/** The part of the line between two positions along it. */
export function subPath(path: LatLng[], fromM: number, toM: number): LatLng[] {
  const out: LatLng[] = [];
  let along = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = flat(path[i], path[i + 1]);
    const next = along + seg;
    const at = (m: number): LatLng => {
      const t = seg > 0 ? (m - along) / seg : 0;
      return { lat: path[i].lat + t * (path[i + 1].lat - path[i].lat), lng: path[i].lng + t * (path[i + 1].lng - path[i].lng) };
    };
    if (next >= fromM && along <= toM) {
      if (!out.length) out.push(fromM > along ? at(fromM) : path[i]);
      out.push(toM < next ? at(toM) : path[i + 1]);
    }
    along = next;
  }
  return out;
}

/** A short name and the full address for a point ("Rajbagh", "Rajbagh, Srinagar, ..."). */
export function placeName(at: LatLng): Promise<{ name: string; address: string } | null> {
  return new Promise((resolve) => {
    new google.maps.Geocoder().geocode({ location: at }, (results: any[], status: string) => {
      if (status !== 'OK' || !results?.length) return resolve(null);
      // Area names first; house numbers ("422/32") and plus codes are no use as a pickup name.
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

function dot(color: string, round: boolean): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = round
    ? `width:16px;height:16px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 4px #0004`
    : `width:14px;height:14px;border-radius:3px;background:${color};border:3px solid #fff;box-shadow:0 1px 4px #0004`;
  return el;
}

function marker(map: any, position: LatLng, content: HTMLElement): any {
  return new google.maps.marker.AdvancedMarkerElement({ map, position: { lat: position.lat, lng: position.lng }, content, zIndex: 4 });
}
