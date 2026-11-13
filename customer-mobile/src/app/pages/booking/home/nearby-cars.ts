export interface NearbyHomeCar {
  id: number;
  lat: number;
  lng: number;
  bearing_deg?: number | null;
  map_marker_url?: string | null;
  driver_name?: string | null;
  image_url?: string | null;
  vehicle?: { name?: string | null; type?: string | null; brand?: string | null; model?: string | null; color?: string | null; image_url?: string | null };
}

export interface NearbyCarGroup { key: number; cars: NearbyHomeCar[] }

export function carDistanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

/** A small stand-sized radius, rather than zoom-dependent map clustering. */
export function groupNearbyCars(cars: NearbyHomeCar[]): NearbyCarGroup[] {
  const groups: NearbyCarGroup[] = [];
  const seen = new Set<number>();
  for (const car of [...cars].sort((a, b) => a.id - b.id)) {
    if (seen.has(car.id) || !Number.isFinite(car.lat) || !Number.isFinite(car.lng)
      || Math.abs(car.lat) > 90 || Math.abs(car.lng) > 180) continue;
    seen.add(car.id);
    const group = groups.find(g => carDistanceMeters(g.cars[0], car) <= 20);
    if (group) group.cars.push(car);
    else groups.push({ key: car.id, cars: [car] });
  }
  return groups;
}

export function roadDistanceLabel(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

type Point = { lat: number; lng: number };
interface RoadDistanceEntry { origin: Point; destination: Point; at: number; pending: boolean; meters: number | null }

/** Only driving-route results are displayed. Geometry is used solely for cache invalidation. */
export class NearbyRoadDistances {
  private entries = new Map<number, RoadDistanceEntry>();
  constructor(
    private request: (origins: Point[], destination: Point) => Promise<Array<number | null>>,
    private changed: () => void,
    private now: () => number = Date.now,
  ) {}

  label(car: NearbyHomeCar, destination: Point | null): string {
    if (!destination) return 'Distance unavailable';
    const entry = this.entries.get(car.id);
    if (!entry || this.moved(entry, car, destination)) return 'Finding road distance…';
    if (entry.pending) return 'Finding road distance…';
    return entry.meters === null ? 'Distance unavailable' : roadDistanceLabel(entry.meters);
  }

  private moved(entry: RoadDistanceEntry, origin: Point, destination: Point): boolean {
    return carDistanceMeters(entry.origin, origin) >= 3 || carDistanceMeters(entry.destination, destination) >= 3;
  }

  update(cars: NearbyHomeCar[], destination: Point | null): void {
    if (!destination) { this.clear(); return; }
    const ids = new Set(cars.map(car => car.id));
    for (const id of this.entries.keys()) if (!ids.has(id)) this.entries.delete(id);
    const pending: Array<{ id: number; entry: RoadDistanceEntry }> = [];
    for (const car of cars) {
      const previous = this.entries.get(car.id);
      if (previous && !this.moved(previous, car, destination)
        && (previous.pending || this.now() - previous.at < 5000)) continue;
      const entry: RoadDistanceEntry = { origin: { lat: car.lat, lng: car.lng }, destination: { ...destination }, at: this.now(), pending: true, meters: null };
      this.entries.set(car.id, entry);
      pending.push({ id: car.id, entry });
    }
    for (let start = 0; start < pending.length; start += 25) {
      const batch = pending.slice(start, start + 25);
      void Promise.resolve().then(() => this.request(batch.map(item => item.entry.origin), { ...destination }))
        .catch(() => [] as Array<number | null>).then(values => {
          let updated = false;
          batch.forEach(({ id, entry }, index) => {
            if (this.entries.get(id) !== entry) return;
            const value = values[index];
            entry.pending = false;
            entry.meters = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
            updated = true;
          });
          if (updated) this.changed();
        });
    }
  }

  clear(): void { this.entries.clear(); }
}

export function carName(car: NearbyHomeCar): string {
  const vehicle = car.vehicle;
  const brand = vehicle?.brand?.trim();
  const model = vehicle?.model?.trim();
  return vehicle?.name?.trim() || (brand ? [brand, model].filter(Boolean).join(' ') : '')
    || vehicle?.type?.trim() || (model && !/^\d{4}$/.test(model) ? model : '') || 'Car name unavailable';
}

export function carImage(car: NearbyHomeCar, failed: ReadonlySet<string>): string | null {
  return [car.image_url, car.vehicle?.image_url].find(url => !!url?.trim() && !failed.has(url)) ?? null;
}
