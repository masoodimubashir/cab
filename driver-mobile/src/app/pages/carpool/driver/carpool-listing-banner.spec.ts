import { of } from 'rxjs';
import { CarpoolListingPage } from './carpool-listing.page';

/** W21 on the driver's carpool page: the banner follows the carpool, and its strip button does the right thing. */
describe('carpool page banner (driver)', () => {
  let tracker: any, carpool: any, nav: any;
  const T = Date.parse('2026-11-27T03:00:00Z');
  const at = (m: number) => new Date(T + m * 60000).toISOString();
  const l = (over: any = {}) => ({
    id: 7, status: 'published', departs_at: at(0), start_opens_at: at(-60), can_start: false, can_edit: true,
    start: { name: 'Bemina Bypass' }, end: { name: 'Kashmir University' }, seats_total: 4, seats_taken: 1, price_per_seat: 60,
    is_free: false, accepting_requests: true, duration_s: 1440, riders: [], pending_count: 0, ...over,
  });
  const page = (listing: any) => {
    const p = new CarpoolListingPage({ snapshot: { paramMap: { get: () => '7' } } } as any, {} as any, carpool, {} as any, nav, tracker);
    p.id = 7;
    p.listing = listing;
    p.now = T - 82 * 60000;
    return p;
  };

  beforeEach(() => {
    tracker = { state: 'idle', offReason: null, follow: jasmine.createSpy('follow').and.resolveTo(), turnOn: jasmine.createSpy('turnOn').and.resolveTo() };
    carpool = { listing: jasmine.createSpy('listing').and.returnValue(of(l())), delay: jasmine.createSpy('delay').and.returnValue(of(l())), completeRide: jasmine.createSpy('completeRide').and.returnValue(of(l({ status: 'completed' }))) };
    nav = { navigateRoot: jasmine.createSpy('navigateRoot'), navigateForward: jasmine.createSpy('navigateForward'), back: jasmine.createSpy('back') };
  });

  it('shows the banner for the carpool as it stands', () => {
    expect(page(l()).banner?.line).toContain('Start ride opens at');
  });

  it('+10 min in the strip moves the time', () => {
    const p = page(l());
    spyOn(p, 'delay');
    p.bannerAct();
    expect(p.delay).toHaveBeenCalled();
  });

  it('See in the strip opens the Inbox', () => {
    const p = page(l({ pending_count: 2 }));
    p.bannerAct();
    expect(nav.navigateRoot).toHaveBeenCalledWith('/carpool/inbox');
  });

  it('Turn on in the strip asks for location again, and the banner knows location is off', async () => {
    tracker.state = 'off';
    tracker.offReason = 'denied';
    const p = page(l({ status: 'in_progress', started_at: at(1), riders: [{ id: 1, rider: { first_name: 'Aamir' }, ride_state: 'waiting', pickup: { name: 'Jawahar Nagar', at: at(15) }, drop: { name: 'KU', at: at(30) } }] }));
    expect(p.banner?.note).toBe('Location is off');
    p.bannerAct();
    expect(tracker.turnOn).toHaveBeenCalled();
  });

  it('Complete in the strip completes the ride', () => {
    const p = page(l({ status: 'in_progress', started_at: at(1), can_complete: true, riders: [{ id: 1, rider: { first_name: 'Sana' }, ride_state: 'dropped', pickup: { name: 'A', at: at(5) }, drop: { name: 'B', at: at(20) } }] }));
    spyOn(p, 'completeRide');
    p.bannerAct();
    expect(p.completeRide).toHaveBeenCalled();
  });

  it('greys the strip button while the delay or completion is saving', () => {
    const p = page(l());
    expect(p.bannerBusy).toBeFalse();
    p.delaying = true;
    expect(p.bannerBusy).toBeTrue();
  });

  it('puts seats, price and drive time in the riders heading before the ride', () => {
    expect(page(l({ seats_taken: 4 })).ridersHeading).toBe('4 of 4 seats · ₹60 a seat · 24 min drive');
    expect(page(l({ status: 'in_progress' })).ridersHeading).toBe('Riders, in pickup order');
  });

  it('keeps the time on the right of each rider on the road, with a word under it', () => {
    const r = (over: any) => ({ id: 1, rider: { first_name: 'A' }, ride_state: 'waiting', pickup: { name: 'P', at: at(15) }, drop: { name: 'D', at: at(30) }, ...over });
    const next = r({ id: 1 });
    const later = r({ id: 2, pickup: { name: 'Q', at: at(20) } });
    const p = page(l({ status: 'in_progress', riders: [r({ id: 3, ride_state: 'picked_up', picked_up_at: at(8) }), next, later] }));
    p.now = T + 10 * 60000;
    const [inCar, n, l2] = p.listing!.riders!;
    expect(p.rowTime(inCar)).toEqual(jasmine.objectContaining({ word: 'picked up', cls: 'ok' }));
    expect(p.rowTime(n)).toEqual(jasmine.objectContaining({ word: 'next', cls: 'go' }));
    expect(p.rowTime(l2)).toEqual(jasmine.objectContaining({ word: 'pickup', cls: '' }));
    (n as any).arrived_at = at(8);
    expect(p.rowTime(n)).toEqual({ time: '2:00', word: 'waiting', cls: 'go' });
    expect(p.rowTime(r({ ride_state: 'no_show' }))).toEqual({ time: '—', word: 'no-show', cls: 'bad' });
  });

  describe('the clock', () => {
    beforeEach(() => {
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(T - 82 * 60000));
    });
    afterEach(() => jasmine.clock().uninstall());

    it('moves the countdown before the ride too', () => {
      const p = page(l());
      p.startRideClock();
      jasmine.clock().tick(60000);
      expect(p.banner?.ring.text).toBe('21');
      p.stopRideClock();
    });
  });
});
