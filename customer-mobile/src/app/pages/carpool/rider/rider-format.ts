/**
 * Dates, distances and money for the carpool rider screens. Carpool days are
 * India days (Carpool.md P8), so times are shown in India time whatever the
 * phone's own time zone. Same rules as the driver app's carpool-format.ts.
 */
export const INDIA_TZ = 'Asia/Kolkata';

/** India calendar date (YYYY-MM-DD) of a moment. */
export function indiaDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: INDIA_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Adds days to a YYYY-MM-DD date. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from today (India) to a YYYY-MM-DD date. */
export function daysFromToday(date: string): number {
  return Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${indiaDate()}T12:00:00Z`)) / 86_400_000);
}

/** "8:30 AM". */
export function clock(d: Date | string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: INDIA_TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(d));
}

/** "Fri, 13 Nov". */
export function shortDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00Z`));
}

/** "Sun 15 Nov", as the carpool page titles write it. */
export function plainDate(date: string): string {
  return shortDate(date).replace(',', '');
}

/** "Today", "Tomorrow" or "Fri, 13 Nov". */
export function dayLabel(date: string): string {
  const n = daysFromToday(date);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  return shortDate(date);
}

/** Carpool page title: "Today, 8:30 AM" or "Sun 15 Nov, 9:00 AM". */
export function titleWhen(iso: string): string {
  const date = indiaDate(new Date(iso));
  const n = daysFromToday(date);
  const day = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : plainDate(date);
  return `${day}, ${clock(iso)}`;
}

/** "Today" / "Tomorrow" / "Sun, 15 Nov" for a moment, as My trips writes it. */
export function dayOf(iso: string): string {
  return dayLabel(indiaDate(new Date(iso)));
}

/** "150 m" or "1.2 km". */
export function distanceLabel(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

/** "1 seat" / "2 seats". */
export function seatWord(n: number): string {
  return `${n} ${n === 1 ? 'seat' : 'seats'}`;
}

/** "₹60" or "Free". */
export function priceLabel(p: { is_free: boolean; price_per_seat: number }): string {
  return p.is_free ? 'Free' : `₹${p.price_per_seat}`;
}

/** First part of an address: "Rajbagh" from "Rajbagh, Srinagar, Jammu and Kashmir". */
export function shortName(address: string): string {
  return (address.split(',')[0] || address).trim();
}
