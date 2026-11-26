import { CarpoolRide, CarpoolRidePosition } from '../carpool.models';
import { RideBanner, RideRing } from '../ui/carpool-ride-banner.component';
import { clock, seatWord, titleWhen } from './rider-format';
import { liveHead } from './rider-live';

export interface RiderBannerInput {
  ride: CarpoolRide;
  view: 'open' | 'sent' | 'accepted' | 'started' | 'ended';
  now: number;
  /** L1.3: the car's newest position while the ride is on the road. */
  live: CarpoolRidePosition | null;
  /** How many seats the search asked for (open page). */
  searchSeats: number;
  /** The search's places, for the open page; null when the page was opened from a link. */
  from: string | null;
  to: string | null;
}

const MIN = 60000;

function countdown(ms: number): RideRing {
  const m = Math.max(0, Math.ceil(ms / MIN));
  if (m < 60) return { kind: 'num', text: String(m), unit: 'min', fill: 1 - m / 60 };
  return { kind: 'num', text: `${Math.floor(m / 60)}h`, unit: 'to go', fill: 0.05 };
}

function leavesIn(ms: number): string {
  const m = Math.max(0, Math.ceil(ms / MIN));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** Minutes to somewhere, as a ring that fills as it gets close (30 minutes or more is empty). */
const minutesRing = (m: number): RideRing => ({ kind: 'num', text: String(Math.max(0, m)), unit: 'min', fill: 1 - Math.min(30, Math.max(0, m)) / 30 });
const broken = (icon: string): RideRing => ({ kind: 'broken', icon });
const ANOTHER = 'Find another carpool for this trip';

/**
 * W21 (mockup "Ride banner, Rider"): which banner the rider's carpool page shows. Greens are the
 * common cases, blues the rare ones.
 */
export function riderBanner(i: RiderBannerInput): RideBanner {
  const r = i.ride;
  const m = r.my_request;
  const first = r.driver.first_name;
  const title = titleWhen(r.departs_at);
  const dep = Date.parse(r.departs_at);

  if (i.view === 'open') {
    const route = `${i.from && i.to ? `${i.from} to ${i.to}` : `${r.start.name} to ${r.end.name}`} · ${first}'s carpool`;
    const base = { title, route };
    if (r.banned) return { ...base, tone: 'over', chip: 'Paused', line: "You can't join carpools right now", note: 'After a report · see Help', ring: { kind: 'icon', icon: 'lock-closed-outline' } };
    switch (r.blocked) {
      case 'full': return { ...base, tone: 'over', chip: 'Full', line: 'Every seat is taken', small: 'Search again for this trip', ring: { kind: 'num', text: '0', unit: 'seats left', fill: 0 } };
      case 'seats': return { ...base, tone: 'rare', chip: 'Open', line: `Not enough seats for ${i.searchSeats}`, small: `Only ${seatWord(r.seats_free)} left`, ring: { kind: 'num', text: String(r.seats_free), unit: 'seats left', fill: r.seats_free / r.seats_total } };
      case 'off': return { ...base, tone: 'rare', chip: 'Open', line: 'Not taking requests right now', small: 'Try again later or search again', ring: { kind: 'icon', icon: 'lock-closed-outline' } };
      case 'own': return { ...base, tone: 'rare', chip: 'Your carpool', line: 'This is your own carpool', small: 'Open it in the driver app', ring: { kind: 'icon', icon: 'car-outline' } };
      case 'ended': return { ...base, tone: 'over', chip: 'Ended', line: 'This carpool has ended', small: 'Search again for this trip', ring: broken('calendar-outline') };
    }
    const price = r.is_free ? 'free' : `₹${r.price_per_seat} a seat`;
    if (r.status === 'in_progress') {
      const mins = r.on_road?.minutes_to_pickup;
      const left = `It left at ${clock(r.on_road?.started_at ?? r.departs_at)} · ${price}`;
      if (mins == null) return { ...base, tone: 'go', chip: 'On the road', live: true, line: 'Already on the road', small: left, ring: { kind: 'icon', icon: 'car-outline' } };
      if (mins < 0) return { ...base, tone: 'go', chip: 'On the road', live: true, line: 'It has probably passed your pickup', small: 'Ask before you request', ring: { kind: 'icon', icon: 'car-outline' } };
      return { ...base, tone: 'go', chip: 'On the road', live: true, line: mins < 1 ? 'It is at your pickup now' : `About ${mins} min from your pickup`, small: left, ring: minutesRing(mins) };
    }
    return {
      ...base, tone: 'wait', chip: 'Open', line: `${r.seats_free} of ${r.seats_total} seats left · ${price}`,
      small: i.from && i.to ? 'Pickup and drop: the closest points to your search' : 'Search with your own pickup and drop to ask',
      ring: { kind: 'num', text: String(r.seats_free), unit: 'seats left', fill: r.seats_total ? r.seats_free / r.seats_total : 0 },
    };
  }

  const base = { title, route: `${m?.pickup.name ?? r.start.name} to ${m?.drop.name ?? r.end.name} · with ${first}` };
  const money = m ? (m.is_free ? 'free ride' : `₹${m.total}`) : '';
  const change: Partial<RideBanner> = r.changed && (i.view === 'sent' || i.view === 'accepted')
    ? r.changed.kind === 'route'
      ? { note: 'Route changed. Check your pickup.', noteIcon: 'map-outline' }
      : { note: r.changed.was_at ? `Time changed from ${clock(r.changed.was_at)}.` : 'Time changed.', noteIcon: 'time-outline' }
    : {};

  if (i.view === 'sent') {
    const sent = { ...base, tone: 'wait' as const, chip: 'Request sent', ring: { kind: 'icon', icon: 'time-outline' } as RideRing };
    if (m?.on_road) return { ...sent, line: `${first} has left and is on the road`, small: 'Your request is still waiting for an answer', ...change };
    return { ...sent, line: `Waiting for ${first} to answer`, small: m ? `${seatWord(m.seats)} · ${money}` : undefined, ...change };
  }

  if (i.view === 'accepted') {
    const acc = { ...base, tone: 'go' as const, chip: 'Accepted' };
    if (i.now > dep && r.status === 'published') {
      return { ...acc, line: `${first} hasn't started yet`, small: `It was due at ${clock(r.departs_at)} · message ${first}`, ...change, ring: { kind: 'icon', icon: 'time-outline' } };
    }
    const soon = dep - i.now < 60 * MIN;
    const small = soon && m ? `Pickup about ${clock(m.pickup.at)} · have your code ready` : m ? `${seatWord(m.seats)} · ${m.is_free ? 'free ride' : `₹${m.total}, paid to ${first}`}` : undefined;
    return { ...acc, line: `Leaves in ${leavesIn(dep - i.now)}`, small, ...change, ring: countdown(dep - i.now) };
  }

  if (i.view === 'started') {
    const live = { ...base, tone: 'go' as const, chip: 'Live', live: true };
    const h = liveHead(i.live, first, m?.drop.name ?? '');
    const p = i.live;
    if (h && p) {
      const ring: RideRing = p.stale || p.minutes === null || p.metres === null
        ? { kind: 'icon', icon: 'alert-circle-outline' }
        : p.target !== 'drop' && p.metres < 100 ? { kind: 'icon', icon: 'car-outline' } : minutesRing(p.minutes);
      return { ...live, line: h.text, small: h.small, ring };
    }
    const plan = m?.ride;
    if (!plan) return { ...live, line: `${first} is on the way`, ring: { kind: 'icon', icon: 'car-outline' } };
    if (plan.picked_up) {
      return { ...live, line: `You're on your way to ${m!.drop.name}`, small: `Drop about ${clock(plan.drop_at)} · from the plan`, ring: minutesRing(Math.ceil((Date.parse(plan.drop_at) - i.now) / MIN)) };
    }
    if (plan.minutes_away < 1) return { ...live, line: `${first} should be at your pickup`, small: 'From the plan', ring: { kind: 'icon', icon: 'car-outline' } };
    return { ...live, line: `${first} is about ${plan.minutes_away} min from your pickup`, small: 'From the plan', ring: minutesRing(plan.minutes_away) };
  }

  // ended
  const over = { ...base, tone: 'over' as const };
  switch (m?.state) {
    case 'completed':
      return {
        ...base, tone: 'done', chip: 'Completed', line: m.dropped_at ? `Dropped at ${m.drop.name} at ${clock(m.dropped_at)}` : `Dropped at ${m.drop.name}`,
        small: m.can_rate ? `Rate ${first} below` : `${seatWord(m.seats)} · ${m.is_free ? 'free ride' : `₹${m.total}, paid to ${first}`}`, ring: { kind: 'done', icon: 'location' },
      };
    case 'cancelled':
      if (r.cancel_reason === 'plan_ended') return { ...over, chip: 'Cancelled', line: "Cancelled: the driver's plan has ended", small: ANOTHER, ring: broken('card-outline') };
      if (r.cancel_reason === 'admin') return { ...over, chip: 'Cancelled', line: 'Cancelled by Dream Cabs', small: ANOTHER, ring: broken('close') };
      if (r.cancel_reason === 'missed_departure') return { ...over, chip: 'Cancelled', line: "Cancelled: it wasn't started", small: ANOTHER, ring: broken('calendar-outline') };
      return r.cancel_note
        ? { ...over, chip: 'Cancelled', line: `Cancelled by ${first}`, note: `Reason: ${r.cancel_note.charAt(0).toLowerCase()}${r.cancel_note.slice(1)}`, ring: broken('close') }
        : { ...over, chip: 'Cancelled', line: `Cancelled by ${first}`, small: ANOTHER, ring: broken('close') };
    case 'declined': return { ...over, chip: 'Declined', line: `${first} couldn't take this request`, small: 'You can still find other carpools', ring: broken('close') };
    case 'removed': return { ...over, chip: 'Removed', line: `${first} removed you from this carpool`, small: ANOTHER, ring: broken('person-remove-outline') };
    case 'filled': return { ...over, chip: 'Full', line: `It filled up before ${first} answered`, small: ANOTHER, ring: broken('people-outline') };
    case 'left': return { ...over, chip: 'You left', line: 'You left this carpool', small: `${first} was told`, ring: broken('walk-outline') };
    case 'withdrawn': return { ...over, chip: 'Withdrawn', line: 'You cancelled this request', small: ANOTHER, ring: broken('close') };
    case 'no_show': return { ...over, chip: 'No-show', line: 'Marked as a no-show', small: `${first} waited at ${m.pickup.name}`, ring: broken('time-outline') };
    case 'ended': {
      const why = m.closed_reason as string | null;
      if (why === 'not_confirmed') return { ...over, chip: 'Ended', line: 'The ride ended without a pickup check', small: 'Help and support can sort it out', ring: broken('help-circle-outline') };
      if (why === 'admin') return { ...over, chip: 'Removed', line: 'Dream Cabs closed this request', small: 'Help and support can explain', ring: broken('person-remove-outline') };
      if (r.status === 'cancelled') {
        // A waiting request closes as "ended" when the carpool is cancelled: say it was cancelled, and by whom.
        const by = r.cancel_reason === 'admin' ? 'Cancelled by Dream Cabs'
          : r.cancel_reason === 'plan_ended' ? "Cancelled: the driver's plan has ended"
            : r.cancel_reason === 'missed_departure' ? "Cancelled: it wasn't started" : `Cancelled by ${first}`;
        return { ...over, chip: 'Cancelled', line: by, small: 'Your request was still waiting', ring: broken('close') };
      }
      return { ...over, chip: 'Ended', line: `It ended before ${first} answered`, small: ANOTHER, ring: broken('calendar-outline') };
    }
    default:
      return { ...over, chip: 'Ended', line: 'This carpool has ended', small: ANOTHER, ring: broken('calendar-outline') };
  }
}
