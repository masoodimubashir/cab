import { CarpoolJoinRequest } from '../carpool.models';

/** "2:40" for minutes and seconds. */
function mss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** L1.4 (9b, 10b): "Arrived · waiting 2:40" once the car reached a waiting rider's pickup. */
export function arrivedLine(r: CarpoolJoinRequest, now: number): string | null {
  if (r.ride_state !== 'waiting' || !r.arrived_at) return null;
  return `Arrived · waiting ${mss(now - Date.parse(r.arrived_at))}`;
}

/**
 * L1.4 (10b): the No-show button. While the location is shared it opens only after the car reached the
 * pickup and waited; with location off it is open any time. The server checks the same rule.
 */
export function noShowButton(r: CarpoolJoinRequest, now: number): { label: string; open: boolean } {
  if (r.no_show_state === 'not_arrived') return { label: 'Reach the pickup first', open: false };
  if (r.no_show_state === 'waiting' && r.no_show_opens_at) {
    const left = Date.parse(r.no_show_opens_at) - now;
    if (left > 0) return { label: `No-show in ${mss(left + 999)}`, open: false };
  }
  return { label: 'No-show', open: true };
}

/** L1.4 (13): "you've waited 6 min" on the no-show sheet. */
export function waitedLine(r: CarpoolJoinRequest, now: number): string | null {
  if (!r.arrived_at) return null;
  return `you've waited ${Math.max(0, Math.floor((now - Date.parse(r.arrived_at)) / 60000))} min`;
}
