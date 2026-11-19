import { Params } from '@angular/router';
import { CarpoolSearchQuery } from '../carpool.models';
import { addDays, daysFromToday, indiaDate } from './rider-format';

/** A place the rider picked: `name` is short ("Rajbagh"), `address` the full line. */
export interface RiderPlace {
  lat: number;
  lng: number;
  name: string;
  address: string;
  /** True when it came from the phone's location ("your location"). */
  mine?: boolean;
}

/** What the rider searched for. Travels between Search, Results and the carpool page in the URL. */
export interface RiderSearch {
  from: RiderPlace;
  to: RiderPlace;
  /** India date, YYYY-MM-DD. */
  date: string;
  seats: number;
}

export const HORIZON_DAYS = 30;
const RECENT_KEY = 'carpool_recent_searches';

export function toParams(s: RiderSearch): Params {
  return {
    from: s.from.name, from_lat: s.from.lat, from_lng: s.from.lng, from_addr: s.from.address, ...(s.from.mine ? { from_mine: 1 } : {}),
    to: s.to.name, to_lat: s.to.lat, to_lng: s.to.lng, to_addr: s.to.address,
    date: s.date, seats: s.seats,
  };
}

/** The search from URL params, or null when a place is missing. Old dates move to today. */
export function fromParams(p: Params): RiderSearch | null {
  const place = (k: 'from' | 'to'): RiderPlace | null => {
    const lat = Number(p[`${k}_lat`]);
    const lng = Number(p[`${k}_lng`]);
    if (!p[k] || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, name: String(p[k]), address: String(p[`${k}_addr`] ?? p[k]), mine: k === 'from' && !!p['from_mine'] };
  };
  const from = place('from');
  const to = place('to');
  if (!from || !to) return null;
  return { from, to, date: clampDate(String(p['date'] ?? '')), seats: clampSeats(Number(p['seats'])) };
}

export function toQuery(s: RiderSearch): CarpoolSearchQuery {
  return { from_lat: s.from.lat, from_lng: s.from.lng, to_lat: s.to.lat, to_lng: s.to.lng, date: s.date, seats: s.seats };
}

/** A day from today to the horizon; anything else becomes today. */
export function clampDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return indiaDate();
  const n = daysFromToday(date);
  if (n < 0) return indiaDate();
  if (n > HORIZON_DAYS) return addDays(indiaDate(), HORIZON_DAYS);
  return date;
}

export function clampSeats(n: number): number {
  return Number.isFinite(n) ? Math.min(6, Math.max(1, Math.round(n))) : 1;
}

/** The last three searches, kept on this phone only. */
export function recentSearches(): RiderSearch[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((r) => r?.from?.name && r?.to?.name).slice(0, 3) : [];
  } catch {
    return [];
  }
}

export function rememberSearch(s: RiderSearch): void {
  try {
    const key = (r: RiderSearch) => `${r.from.name}|${r.to.name}`;
    const list = [s, ...recentSearches().filter((r) => key(r) !== key(s))].slice(0, 3);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Private mode or storage full: recent searches are a convenience only.
  }
}
