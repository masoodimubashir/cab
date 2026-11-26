import { CarpoolRidePosition } from '../carpool.models';
import { distanceLabel } from './rider-format';

/** A line under the title saying where things stand (mockup .statehead). */
export interface LiveHead { text: string; small?: string; icon?: string; cls?: 'ok' | 'grey'; live?: boolean; }

/** Within this many metres the car counts as at the pickup. */
const AT_PICKUP_M = 100;

/** "8 s ago", "2 min ago". */
export function agoLabel(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  return 'over an hour ago';
}

/**
 * L1.3 (mockup 8m, 8n): the line from the car's real position. Null while the driver has shared nothing,
 * so the page keeps the line worked out from the plan, as before.
 */
export function liveHead(live: CarpoolRidePosition | null, first: string, dropName: string): LiveHead | null {
  const p = live?.position;
  if (!live || !p) return null;
  const ago = agoLabel(p.age_s);
  if (live.stale || live.minutes === null || live.metres === null) {
    return { icon: 'alert-circle-outline', cls: 'grey', text: `Can't see ${first}'s car right now`, small: `Last seen ${ago}. Times below are from the plan.` };
  }
  if (live.target === 'drop') {
    return { live: true, text: `You're on your way to ${dropName}`, small: `About ${live.minutes} min to your drop · updated ${ago}` };
  }
  if (live.metres < AT_PICKUP_M) return { live: true, text: `${first} is at your pickup`, small: `Updated ${ago}` };
  return { live: true, text: `${first} is ${live.minutes} min from your pickup`, small: `${distanceLabel(live.metres)} away · updated ${ago}` };
}
