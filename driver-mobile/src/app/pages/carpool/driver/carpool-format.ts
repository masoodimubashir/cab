import { CarpoolListing } from '../carpool.models';

/**
 * Dates and money for the carpool driver screens. Carpool days are India days
 * (Carpool.md P8), so times are always shown in India time, whatever the
 * phone's own time zone.
 */
export const INDIA_TZ = 'Asia/Kolkata';
const IST_OFFSET = '+05:30';

/** India calendar date (YYYY-MM-DD) of a moment. */
export function indiaDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: INDIA_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** India clock time (HH:mm, 24 h) of a moment. */
export function indiaTime(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: INDIA_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

/** An India date and time as an ISO string the server reads. */
export function indiaIso(date: string, time: string): string {
  return `${date}T${time}:00${IST_OFFSET}`;
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

/** "8:30 AM" from a 24 h "08:30". */
export function clockFromHm(hm: string): string {
  const [h, m] = hm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "Today", "Tomorrow" or "Mon, 16 Nov" for a YYYY-MM-DD date. */
export function dayLabel(date: string): string {
  const n = daysFromToday(date);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  return shortDate(date);
}

/** "Fri, 13 Nov". */
export function shortDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(d);
}

/** "Today, 8:30 AM" / "Tomorrow, 6:00 PM" / "Mon, 16 Nov, 7:00 AM". */
export function whenLabel(iso: string): string {
  return `${dayLabel(indiaDate(new Date(iso)))}, ${clock(iso)}`;
}

/** "24 min" / "1 h 5 min". */
export function durationLabel(seconds: number): string {
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** "14.2 km". */
export function kmLabel(metres: number): string {
  return `${(metres / 1000).toFixed(metres < 100_000 ? 1 : 0)} km`;
}

/** "₹60" or "Free". */
export function priceLabel(l: Pick<CarpoolListing, 'is_free' | 'price_per_seat'>): string {
  return l.is_free ? 'Free' : `₹${l.price_per_seat}`;
}

/** How a past carpool ended, for the Past filter (mockup 2b). */
export function endedLabel(l: CarpoolListing): string {
  if (l.status === 'completed') return 'Completed';
  if (l.status === 'cancelled') return 'Cancelled';
  return 'Not started';
}

export function cancelReasonLabel(l: CarpoolListing): string | null {
  switch (l.cancel_reason) {
    case 'driver': return l.cancel_note ? `Cancelled by you: ${l.cancel_note}` : 'Cancelled by you';
    case 'missed_departure': return 'Not started on the day';
    case 'plan_ended': return "Cancelled: your plan had ended";
    case 'admin': return 'Cancelled by Dream Cabs';
    default: return l.status === 'published' ? 'Not started on the day' : null;
  }
}

/** "Good morning" by India time. */
export function greeting(): string {
  const h = Number(indiaTime(new Date()).slice(0, 2));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
