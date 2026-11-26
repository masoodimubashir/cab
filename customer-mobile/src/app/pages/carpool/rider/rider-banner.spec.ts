import { clock, titleWhen } from './rider-format';
import { RiderBannerInput, riderBanner } from './rider-banner';

/** W21: the banner at the top of the rider's carpool page, in every state (mockup "Ride banner, Rider"). */
describe('rider ride banner', () => {
  const DEP = Date.parse('2026-11-27T03:00:00Z');
  const at = (m: number) => new Date(DEP + m * 60000).toISOString();
  const mine = (over: any = {}) => ({
    state: 'accepted', past: false, seats: 2, total: 120, is_free: false, closed_reason: null, can_rate: false,
    pickup: { name: 'Rajbagh', at: at(12) }, drop: { name: 'Nigeen', at: at(25) }, picked_up_at: null, dropped_at: null,
    on_road: false, ride: null, ...over,
  });
  const ride = (over: any = {}) => ({
    id: 7, status: 'published', departs_at: at(0), driver: { first_name: 'Imran' }, start: { name: 'Bemina' }, end: { name: 'KU' },
    price_per_seat: 60, is_free: false, seats_total: 4, seats_free: 2, cancel_reason: null, cancel_note: null, changed: null,
    blocked: null, banned: false, on_road: null, my_request: mine(), ...over,
  });
  const make = (r: any, view: any, over: Partial<RiderBannerInput> = {}) =>
    riderBanner({ ride: r, view, now: DEP - 130 * 60000, live: null, searchSeats: 1, from: 'Rajbagh', to: 'Nigeen', ...over });

  it('shows the time and the rider\'s own trip with the driver', () => {
    const b = make(ride(), 'accepted');
    expect(b.title).toBe(titleWhen(at(0)));
    expect(b.route).toBe('Rajbagh to Nigeen · with Imran');
  });

  describe('before joining', () => {
    const open = (over: any = {}) => ride({ my_request: null, ...over });

    it('is deep green with the seats left and the price', () => {
      const b = make(open(), 'open');
      expect(b).toEqual(jasmine.objectContaining({ tone: 'wait', chip: 'Open', line: '2 of 4 seats left · ₹60 a seat', small: 'Pickup and drop: the closest points to your search' }));
      expect(b.route).toBe("Rajbagh to Nigeen · Imran's carpool");
      expect(b.ring).toEqual(jasmine.objectContaining({ text: '2', unit: 'seats left', fill: 0.5 }));
    });

    it('says how far the car is when it is already on the road', () => {
      const b = make(open({ status: 'in_progress', on_road: { minutes_to_pickup: 6 } }), 'open');
      expect(b).toEqual(jasmine.objectContaining({ tone: 'go', chip: 'On the road', live: true, line: 'About 6 min from your pickup' }));
    });

    it('says why asking is not possible', () => {
      expect(make(open({ blocked: 'full', seats_free: 0 }), 'open')).toEqual(jasmine.objectContaining({ tone: 'over', chip: 'Full', line: 'Every seat is taken' }));
      expect(make(open({ blocked: 'seats' }), 'open', { searchSeats: 3 })).toEqual(jasmine.objectContaining({ tone: 'rare', line: 'Not enough seats for 3', small: 'Only 2 seats left' }));
      expect(make(open({ blocked: 'off' }), 'open')).toEqual(jasmine.objectContaining({ tone: 'rare', line: 'Not taking requests right now' }));
      expect(make(open({ blocked: 'own' }), 'open')).toEqual(jasmine.objectContaining({ tone: 'rare', chip: 'Your carpool', line: 'This is your own carpool' }));
      expect(make(open({ blocked: 'ended' }), 'open')).toEqual(jasmine.objectContaining({ tone: 'over', chip: 'Ended', line: 'This carpool has ended' }));
    });

    it('says when the rider is paused from carpool', () => {
      expect(make(open({ banned: true }), 'open')).toEqual(jasmine.objectContaining({ tone: 'over', chip: 'Paused', line: "You can't join carpools right now" }));
    });
  });

  describe('going ahead', () => {
    it('waits for an answer, deep green, with the seats and money', () => {
      const b = make(ride({ my_request: mine({ state: 'sent' }) }), 'sent');
      expect(b).toEqual(jasmine.objectContaining({ tone: 'wait', chip: 'Request sent', line: 'Waiting for Imran to answer', small: '2 seats · ₹120' }));
    });

    it('says when the driver left while the request still waits', () => {
      expect(make(ride({ my_request: mine({ state: 'sent', on_road: true }) }), 'sent').line).toBe('Imran has left and is on the road');
    });

    it('counts down to the departure once accepted', () => {
      const b = make(ride(), 'accepted');
      expect(b).toEqual(jasmine.objectContaining({ tone: 'go', chip: 'Accepted', line: 'Leaves in 2 h 10 min', small: '2 seats · ₹120, paid to Imran' }));
    });

    it('asks to have the code ready in the last hour', () => {
      const b = make(ride(), 'accepted', { now: DEP - 25 * 60000 });
      expect(b.line).toBe('Leaves in 25 min');
      expect(b.small).toBe(`Pickup about ${clock(at(12))} · have your code ready`);
    });

    it('says when the driver has not started on time', () => {
      expect(make(ride(), 'accepted', { now: DEP + 6 * 60000 }).line).toBe("Imran hasn't started yet");
    });

    it('puts a time or route change in the strip', () => {
      expect(make(ride({ changed: { kind: 'time', was_at: at(-15) } }), 'accepted').note).toBe(`Time changed from ${clock(at(-15))}.`);
      expect(make(ride({ changed: { kind: 'route', was_at: null } }), 'accepted').note).toBe('Route changed. Check your pickup.');
    });

    it('follows the live car to the pickup, at the pickup and to the drop', () => {
      const live = (o: any) => ({ position: { lat: 1, lng: 1, heading: 0, at: at(10), age_s: 8 }, stale: false, target: 'pickup', metres: 1240, minutes: 3, ...o });
      const started = ride({ status: 'in_progress', my_request: mine({ state: 'started' }) });
      expect(make(started, 'started', { live: live({}) as any })).toEqual(jasmine.objectContaining({ tone: 'go', chip: 'Live', live: true, line: 'Imran is 3 min from your pickup', small: '1.2 km away · updated 8 s ago' }));
      expect(make(started, 'started', { live: live({ metres: 50, minutes: 0 }) as any }).line).toBe('Imran is at your pickup');
      expect(make(started, 'started', { live: live({ target: 'drop', minutes: 9 }) as any }).line).toBe("You're on your way to Nigeen");
      expect(make(started, 'started', { live: live({ stale: true, minutes: null, metres: null }) as any }).line).toBe("Can't see Imran's car right now");
    });

    it('falls back to the plan when nothing is shared', () => {
      const started = (p: any) => ride({ status: 'in_progress', my_request: mine({ state: 'started', ride: p }) });
      expect(make(started({ picked_up: false, minutes_away: 5, pickup_at: at(12), drop_at: at(25) }), 'started').line).toBe('Imran is about 5 min from your pickup');
      expect(make(started({ picked_up: false, minutes_away: 0, pickup_at: at(12), drop_at: at(25) }), 'started').line).toBe('Imran should be at your pickup');
      expect(make(started({ picked_up: true, minutes_away: 0, pickup_at: at(12), drop_at: at(25) }), 'started').small).toBe(`Drop about ${clock(at(25))} · from the plan`);
    });
  });

  describe('finished', () => {
    const ended = (state: string, over: any = {}, rideOver: any = {}) => make(ride({ my_request: mine({ state, past: true, ...over }), ...rideOver }), 'ended');

    it('is soft green with a full ring and a pin once dropped', () => {
      const b = ended('completed', { dropped_at: at(26), can_rate: true });
      expect(b).toEqual(jasmine.objectContaining({ tone: 'done', chip: 'Completed', line: `Dropped at Nigeen at ${clock(at(26))}`, small: 'Rate Imran below' }));
      expect(b.ring).toEqual({ kind: 'done', icon: 'location' });
    });

    it('is deep blue with a dashed ring and the reason when cancelled', () => {
      expect(ended('cancelled', {}, { cancel_reason: 'driver', cancel_note: 'Problem with the car' })).toEqual(jasmine.objectContaining({ tone: 'over', chip: 'Cancelled', line: 'Cancelled by Imran', note: 'Reason: problem with the car' }));
      expect(ended('cancelled', {}, { cancel_reason: 'admin' }).line).toBe('Cancelled by Dream Cabs');
      expect(ended('cancelled', {}, { cancel_reason: 'plan_ended' }).ring).toEqual({ kind: 'broken', icon: 'card-outline' });
      expect(ended('cancelled', {}, { cancel_reason: 'missed_departure' }).ring).toEqual({ kind: 'broken', icon: 'calendar-outline' });
    });

    it('names every other ending with its own icon', () => {
      expect(ended('declined')).toEqual(jasmine.objectContaining({ chip: 'Declined', line: "Imran couldn't take this request", ring: { kind: 'broken', icon: 'close' } }));
      expect(ended('removed').ring).toEqual({ kind: 'broken', icon: 'person-remove-outline' });
      expect(ended('filled')).toEqual(jasmine.objectContaining({ chip: 'Full', ring: { kind: 'broken', icon: 'people-outline' } }));
      expect(ended('left')).toEqual(jasmine.objectContaining({ chip: 'You left', ring: { kind: 'broken', icon: 'walk-outline' } }));
      expect(ended('withdrawn')).toEqual(jasmine.objectContaining({ chip: 'Withdrawn', line: 'You cancelled this request' }));
      expect(ended('no_show')).toEqual(jasmine.objectContaining({ chip: 'No-show', small: 'Imran waited at Rajbagh', ring: { kind: 'broken', icon: 'time-outline' } }));
    });

    it('tells apart the three ways a request ends without a ride (fixes "ended before Imran answered")', () => {
      expect(ended('ended').line).toBe('It ended before Imran answered');
      expect(ended('ended', { closed_reason: 'not_confirmed' })).toEqual(jasmine.objectContaining({ line: 'The ride ended without a pickup check', ring: { kind: 'broken', icon: 'help-circle-outline' } }));
      expect(ended('ended', { closed_reason: 'admin' })).toEqual(jasmine.objectContaining({ chip: 'Removed', line: 'Dream Cabs closed this request' }));
    });

    it('says the carpool was cancelled when a waiting request closed because of it', () => {
      expect(ended('ended', { closed_reason: 'ended' }, { status: 'cancelled', cancel_reason: 'driver' }))
        .toEqual(jasmine.objectContaining({ tone: 'over', chip: 'Cancelled', line: 'Cancelled by Imran', small: 'Your request was still waiting' }));
      expect(ended('ended', { closed_reason: 'ended' }, { status: 'cancelled', cancel_reason: 'admin' }).line).toBe('Cancelled by Dream Cabs');
    });
  });
});
