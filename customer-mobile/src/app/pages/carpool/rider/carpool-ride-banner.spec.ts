import { NgZone } from '@angular/core';
import { CarpoolRidePage } from './carpool-ride.page';

/** W21 on the rider's carpool page: the banner follows the trip, and ⋯ on the map holds Cancel request and Leave carpool. */
describe('carpool page banner (rider)', () => {
  const T = Date.parse('2026-11-27T03:00:00Z');
  const at = (m: number) => new Date(T + m * 60000).toISOString();
  const ride = (state: string | null, over: any = {}) => ({
    id: 7, status: 'published', departs_at: at(0), driver: { first_name: 'Imran' }, start: { name: 'Bemina' }, end: { name: 'KU' },
    price_per_seat: 60, is_free: false, seats_total: 4, seats_free: 2, cancel_reason: null, cancel_note: null, changed: null, blocked: null,
    my_request: state ? { state, past: false, seats: 2, total: 120, is_free: false, pickup: { name: 'Rajbagh', at: at(12) }, drop: { name: 'Nigeen', at: at(25) } } : null,
    ...over,
  });
  let page: CarpoolRidePage;

  beforeEach(() => {
    const zone = { run: (fn: () => any) => fn() } as unknown as NgZone;
    page = new CarpoolRidePage({} as any, {} as any, {} as any, {} as any, {} as any, zone);
  });

  it('shows the banner for the trip as it stands', () => {
    page.ride = ride('sent') as any;
    expect(page.banner?.line).toBe('Waiting for Imran to answer');
  });

  it('offers Cancel request in ⋯ while the request waits', () => {
    page.ride = ride('sent') as any;
    expect(page.menuItems.map((m) => m.label)).toEqual(['Cancel request']);
    page.menuOpen = true;
    page.pick(page.menuItems[0]);
    expect(page.sheet).toBe('cancel');
    expect(page.menuOpen).toBeFalse();
  });

  it('offers Leave carpool in ⋯ once accepted and before the ride starts', () => {
    page.ride = ride('accepted') as any;
    expect(page.menuItems.map((m) => m.label)).toEqual(['Leave carpool']);
    page.pick(page.menuItems[0]);
    expect(page.sheet).toBe('leave');
  });

  it('has no ⋯ when there is nothing to do', () => {
    page.ride = ride('accepted', { status: 'in_progress' }) as any;
    expect(page.menuItems).toEqual([]);
    page.ride = ride(null) as any;
    expect(page.menuItems).toEqual([]);
  });
});
