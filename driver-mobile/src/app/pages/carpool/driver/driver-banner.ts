import { CarpoolListing } from '../carpool.models';
import { RideBanner, RideRing } from '../ui/carpool-ride-banner.component';
import { clock, whenLabel } from './carpool-format';

/** What the strip's button does on the driver page. */
export type DriverBannerAct = 'late' | 'requests' | 'location' | 'complete';
export interface DriverBanner extends RideBanner { act?: DriverBannerAct; }

export interface DriverBannerInput {
  listing: CarpoolListing;
  now: number;
  /** The phone's location sharing (L1.2): sharing, starting (Android asking), off, or none (not on the road / browser). */
  location: 'sharing' | 'starting' | 'off' | 'none';
  /** "Moved to 8:40 AM." for a few seconds after +10 min. */
  delayMsg: string | null;
  delayMinutes: number;
  retentionDays: number;
}

const MIN = 60000;

/** "2:40" for minutes and seconds. */
function mss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A countdown ring: minutes within the hour (filling as it nears), else hours. */
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

const requestsNote = (n: number) => `${n} join request${n === 1 ? '' : 's'} waiting`;

/**
 * W21 (mockup "Ride banner, Driver"): which banner the driver's carpool page shows. Greens are the
 * common cases, blues the rare ones; the ring counts down, counts riders or shows how it ended.
 */
export function driverBanner(i: DriverBannerInput): DriverBanner {
  const l = i.listing;
  const base = { title: whenLabel(l.departs_at), route: `${l.start.name} to ${l.end.name}` };
  const riders = l.riders ?? [];
  const dep = Date.parse(l.departs_at);

  if (l.status === 'published') {
    const up = { ...base, tone: 'wait' as const, chip: 'Upcoming' };
    if (i.now > dep) {
      return { ...up, tone: 'rare', line: `It's ${clock(new Date(i.now))} and the ride hasn't started`, note: 'Start now, or it will be cancelled.', noteIcon: 'alert-circle-outline', ring: { kind: 'icon', icon: 'time-outline' } };
    }
    const opens = Date.parse(l.start_opens_at);
    const ring = l.can_start ? countdown(dep - i.now) : countdown(opens - i.now);
    const strip: Partial<DriverBanner> = l.pending_count
      ? { note: requestsNote(l.pending_count), noteIcon: 'people-outline', action: 'See', act: 'requests' }
      : l.can_edit
        ? { note: i.delayMsg ?? 'Running late?', noteIcon: 'time-outline', action: `+${i.delayMinutes} min`, act: 'late' }
        : {};
    if (!l.accepting_requests && !l.seats_taken) {
      return { ...up, tone: 'rare', line: 'Not taking join requests', small: 'Turn requests on from Home', ring };
    }
    if (!l.accepting_requests) {
      return { ...up, tone: 'rare', line: 'Not taking join requests', ...strip, ring };
    }
    if (l.can_start) return { ...up, line: `Start ride is open · leaves in ${leavesIn(dep - i.now)}`, ...strip, ring };
    if (!l.seats_taken) return { ...up, line: 'No riders yet', small: 'Riders along your route can ask to join', ...strip, ring };
    return { ...up, line: `Start ride opens at ${clock(l.start_opens_at)}`, ...strip, ring };
  }

  if (l.status === 'in_progress') {
    const live = { ...base, tone: 'go' as const, chip: 'Live', live: true };
    const active = riders.filter((r) => r.ride_state !== 'no_show');
    const picked = active.filter((r) => r.ride_state === 'picked_up' || r.ride_state === 'dropped').length;
    const dropped = active.filter((r) => r.ride_state === 'dropped').length;
    const complete: Partial<DriverBanner> = { note: 'All done', noteIcon: 'checkmark-circle-outline', action: 'Complete', act: 'complete' };
    if (!active.length) {
      return { ...live, tone: 'rare', line: 'No riders on this ride', ...(l.can_complete ? { ...complete, note: 'At the end' } : {}), ring: { kind: 'num', text: '0/0', unit: 'riders', fill: 0 } };
    }
    if (l.can_complete) {
      return { ...live, line: 'Everyone is dropped', ...complete, ring: { kind: 'num', text: `${dropped}/${active.length}`, unit: 'dropped', fill: 1 } };
    }
    const arrival = l.started_at ? clock(new Date(Date.parse(l.started_at) + l.duration_s * 1000)) : null;
    const sharing = i.location === 'sharing' ? 'sharing your location' : i.location === 'starting' ? 'turning on location…' : null;
    const after = [arrival ? `arrival about ${arrival}` : null, sharing].filter(Boolean).join(' · ');
    const strip: Partial<DriverBanner> = i.location === 'off'
      ? { note: 'Location is off', noteIcon: 'alert-circle-outline', action: 'Turn on', act: 'location' }
      : l.pending_count
        ? { note: requestsNote(l.pending_count), noteIcon: 'people-outline', action: 'See', act: 'requests' }
        : {};
    const pickedRing: RideRing = { kind: 'num', text: `${picked}/${active.length}`, unit: 'picked up', fill: picked / active.length };

    const here = riders.find((r) => r.ride_state === 'waiting' && r.arrived_at);
    if (here) {
      const waited = i.now - Date.parse(here.arrived_at!);
      const opensAt = here.no_show_opens_at ? Date.parse(here.no_show_opens_at) : null;
      const open = !opensAt || i.now >= opensAt;
      const span = opensAt ? opensAt - Date.parse(here.arrived_at!) : 0;
      return {
        ...live, line: `Waiting for ${here.rider.first_name} at ${here.pickup.name}`,
        small: [open ? 'No-show is open' : `No-show opens in ${mss(opensAt! - i.now + 999)}`, arrival ? `arrival about ${arrival}` : null].filter(Boolean).join(' · '),
        ...strip, ring: { kind: 'num', text: mss(waited), unit: 'waiting', fill: span > 0 ? Math.min(1, waited / span) : 1 },
      };
    }
    const next = riders.find((r) => r.ride_state === 'waiting');
    if (next) {
      return { ...live, line: `Next pickup: ${next.rider.first_name}, about ${clock(next.pickup.at)}`, small: cap(after), ...strip, ring: pickedRing };
    }
    const drop = [...riders].filter((r) => r.ride_state === 'picked_up').sort((a, b) => Date.parse(a.drop.at) - Date.parse(b.drop.at))[0];
    return {
      ...live, line: drop ? `Next drop: ${drop.rider.first_name} at ${drop.drop.name}, about ${clock(drop.drop.at)}` : 'On the road',
      small: cap(after), ...strip, ring: pickedRing,
    };
  }

  if (l.status === 'completed') {
    const fin = { ...base, tone: 'done' as const, chip: 'Completed', ring: { kind: 'done', icon: 'checkmark' } as RideRing };
    const total = riders.length;
    const span = l.started_at && l.completed_at ? ` · ${clock(l.started_at)} to ${clock(l.completed_at)}` : '';
    const line = !l.riders_rode ? 'Nobody rode' : `${l.riders_rode} of ${total} rider${total === 1 ? '' : 's'} rode${span}`;
    const by = l.completed_by as string | null;
    if (by === 'auto') return { ...fin, line, note: 'Completed by itself', noteIcon: 'time-outline' };
    if (by === 'admin') return { ...fin, line, note: 'Ended by Dream Cabs', noteIcon: 'information-circle-outline' };
    if (!l.riders_rode) return { ...fin, line, small: "It doesn't count as a ride" };
    if (l.chats_deleted) return { ...fin, line, note: 'This chat was deleted', noteIcon: 'chatbubble-outline' };
    if (l.group_chat_id) {
      return { ...fin, line, note: `Chats are deleted ${i.retentionDays} ${i.retentionDays === 1 ? 'day' : 'days'} after the trip`, noteIcon: 'chatbubble-outline' };
    }
    return { ...fin, line };
  }

  // cancelled
  const off = { ...base, tone: 'over' as const, chip: 'Cancelled' };
  const broken = (icon: string): RideRing => ({ kind: 'broken', icon });
  switch (l.cancel_reason) {
    case 'admin': return { ...off, line: 'Cancelled by Dream Cabs', small: 'Riders were told', ring: broken('close') };
    case 'plan_ended': return { ...off, line: 'Your plan had ended', small: 'Buy a plan to publish again', ring: broken('card-outline') };
    case 'documents': return { ...off, line: 'A document had expired', small: 'Renew it in Documents to publish', ring: broken('document-text-outline') };
    case 'missed_departure': return { ...off, line: "It wasn't started", small: 'Cancelled at the end of the day', ring: broken('calendar-outline') };
    default:
      return l.cancel_note
        ? { ...off, line: 'Cancelled by you', note: `Your reason: ${l.cancel_note.charAt(0).toLowerCase()}${l.cancel_note.slice(1)}`, ring: broken('close') }
        : { ...off, line: 'Cancelled by you', small: 'Riders were told', ring: broken('close') };
  }
}

/** "arrival about 9:04 · sharing…" reads as a sentence start. */
function cap(s: string): string | undefined {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : undefined;
}

