import { clock, whenLabel } from './carpool-format';
import { DriverBannerInput, driverBanner } from './driver-banner';

/** W21: the banner at the top of the driver's carpool page, in every state (mockup "Ride banner, Driver"). */
describe('driver ride banner', () => {
  const DEP = Date.parse('2026-11-27T03:00:00Z'); // 8:30 AM in India
  const at = (minFromDep: number) => new Date(DEP + minFromDep * 60000).toISOString();
  const rider = (name: string, over: any = {}) => ({
    id: name.length, rider: { first_name: name, name }, ride_state: 'waiting', status: 'accepted',
    pickup: { name: `${name}'s stop`, at: at(15) }, drop: { name: 'Nigeen', at: at(30) },
    picked_up_at: null, dropped_at: null, arrived_at: null, no_show_opens_at: null, no_show_state: null, ...over,
  });
  const listing = (over: any = {}) => ({
    id: 7, status: 'published', departs_at: at(0), start_opens_at: at(-60), can_start: false, can_edit: true,
    start: { name: 'Bemina Bypass' }, end: { name: 'Kashmir University' }, seats_total: 4, seats_taken: 4,
    price_per_seat: 60, is_free: false, accepting_requests: true, duration_s: 1440, cancel_reason: null, cancel_note: null,
    started_at: null, completed_at: null, completed_by: null, counts_as_ride: true, riders: [rider('Sana'), rider('Aamir')],
    pending_count: 0, can_complete: false, riders_rode: 0, group_chat_id: 3, chats_deleted: false, ...over,
  });
  const make = (l: any, over: Partial<DriverBannerInput> = {}) =>
    driverBanner({ listing: l, now: DEP - 82 * 60000, location: 'none', delayMsg: null, delayMinutes: 10, retentionDays: 1, ...over });

  it('shows the time and the route on every state', () => {
    const b = make(listing());
    expect(b.title).toBe(whenLabel(at(0)));
    expect(b.route).toBe('Bemina Bypass to Kashmir University');
  });

  describe('not started (deep green)', () => {
    it('says when Start ride opens and counts down to it, with +10 min in the strip', () => {
      const b = make(listing());
      expect(b.tone).toBe('wait');
      expect(b.chip).toBe('Upcoming');
      expect(b.line).toBe(`Start ride opens at ${clock(at(-60))}`);
      expect(b.ring).toEqual(jasmine.objectContaining({ kind: 'num', text: '22', unit: 'min' }));
      expect(b.note).toBe('Running late?');
      expect(b.action).toBe('+10 min');
      expect(b.act).toBe('late');
    });

    it('counts hours when Start ride is further away', () => {
      expect(make(listing(), { now: DEP - 5 * 3600000 }).ring).toEqual(jasmine.objectContaining({ text: '4h', unit: 'to go' }));
    });

    it('says Start ride is open and when it leaves', () => {
      const b = make(listing({ can_start: true }), { now: DEP - 14 * 60000 });
      expect(b.line).toBe('Start ride is open · leaves in 14 min');
      expect(b.ring).toEqual(jasmine.objectContaining({ text: '14', unit: 'min' }));
    });

    it('shows the delay message after +10 min, with the button again', () => {
      const b = make(listing(), { delayMsg: 'Moved to 8:40 AM. Riders told.' });
      expect(b.note).toBe('Moved to 8:40 AM. Riders told.');
      expect(b.act).toBe('late');
    });

    it('points to waiting join requests', () => {
      const b = make(listing({ pending_count: 2 }));
      expect(b.note).toBe('2 join requests waiting');
      expect(b.action).toBe('See');
      expect(b.act).toBe('requests');
    });

    it('says when nobody has joined yet', () => {
      const b = make(listing({ seats_taken: 0, riders: [] }));
      expect(b.line).toBe('No riders yet');
    });

    it('is mid blue when requests are switched off', () => {
      const b = make(listing({ accepting_requests: false, seats_taken: 1 }));
      expect(b.tone).toBe('rare');
      expect(b.line).toBe('Not taking join requests');
    });

    it('is mid blue when the departure time has passed and it was not started', () => {
      const b = make(listing({ can_start: true }), { now: DEP + 15 * 60000 });
      expect(b.tone).toBe('rare');
      expect(b.line).toBe(`It's ${clock(at(15))} and the ride hasn't started`);
      expect(b.note).toBe('Start now, or it will be cancelled.');
      expect(b.ring.kind).toBe('icon');
    });
  });

  describe('on the road (bright green, live)', () => {
    const road = (riders: any[], over: any = {}) => listing({ status: 'in_progress', started_at: at(1), riders, ...over });

    it('names the next pickup, counts who is in and gives the arrival time', () => {
      const b = make(road([rider('Sana', { ride_state: 'picked_up', picked_up_at: at(13) }), rider('Aamir'), rider('Tariq')]), { now: DEP + 10 * 60000, location: 'sharing' });
      expect(b.tone).toBe('go');
      expect(b.live).toBeTrue();
      expect(b.line).toBe(`Next pickup: Aamir, about ${clock(at(15))}`);
      expect(b.small).toBe(`Arrival about ${clock(at(25))} · sharing your location`);
      expect(b.ring).toEqual(jasmine.objectContaining({ text: '1/3', unit: 'picked up' }));
    });

    it('says location is turning on while Android asks', () => {
      const b = make(road([rider('Aamir')]), { now: DEP + 5 * 60000, location: 'starting' });
      expect(b.small).toContain('turning on location');
    });

    it('counts the wait at a pickup and when No-show opens (L1.4)', () => {
      const waiting = rider('Aamir', { arrived_at: at(13), no_show_state: 'waiting', no_show_opens_at: at(18) });
      const b = make(road([waiting]), { now: DEP + 15 * 60000 + 40000, location: 'sharing' });
      expect(b.line).toBe("Waiting for Aamir at Aamir's stop");
      expect(b.small).toBe(`No-show opens in 2:20 · arrival about ${clock(at(25))}`);
      expect(b.ring).toEqual(jasmine.objectContaining({ text: '2:40', unit: 'waiting' }));
    });

    it('says No-show is open once the wait is over', () => {
      const waiting = rider('Aamir', { arrived_at: at(13), no_show_state: 'waiting', no_show_opens_at: at(18) });
      expect(make(road([waiting]), { now: DEP + 19 * 60000 }).small).toContain('No-show is open');
    });

    it('names the next drop once everyone is in', () => {
      const b = make(road([rider('Sana', { ride_state: 'picked_up', picked_up_at: at(13) })]), { now: DEP + 20 * 60000 });
      expect(b.line).toBe(`Next drop: Sana at Nigeen, about ${clock(at(30))}`);
    });

    it('puts Location is off with Turn on in the strip', () => {
      const b = make(road([rider('Aamir')]), { now: DEP + 5 * 60000, location: 'off' });
      expect(b.note).toBe('Location is off');
      expect(b.action).toBe('Turn on');
      expect(b.act).toBe('location');
    });

    it('points to a join request that comes in on the road', () => {
      const b = make(road([rider('Aamir')], { pending_count: 1 }), { now: DEP + 5 * 60000, location: 'sharing' });
      expect(b.note).toBe('1 join request waiting');
      expect(b.act).toBe('requests');
    });

    it('offers Complete when everyone is dropped', () => {
      const b = make(road([rider('Sana', { ride_state: 'dropped' }), rider('Aamir', { ride_state: 'no_show' })], { can_complete: true }), { now: DEP + 40 * 60000 });
      expect(b.line).toBe('Everyone is dropped');
      expect(b.action).toBe('Complete');
      expect(b.act).toBe('complete');
      expect(b.ring).toEqual(jasmine.objectContaining({ text: '1/1', unit: 'dropped' }));
    });

    it('is mid blue when it started with nobody on board', () => {
      const b = make(road([], { can_complete: true }), { now: DEP + 5 * 60000 });
      expect(b.tone).toBe('rare');
      expect(b.line).toBe('No riders on this ride');
      expect(b.act).toBe('complete');
    });
  });

  describe('finished', () => {
    const done = (over: any = {}) => listing({ status: 'completed', started_at: at(1), completed_at: at(34), completed_by: 'driver', riders_rode: 2,
      riders: [rider('Sana', { ride_state: 'dropped' }), rider('Aamir', { ride_state: 'dropped' }), rider('Tariq', { ride_state: 'no_show' })], ...over });

    it('is soft green with a full ring, how many rode and when', () => {
      const b = make(done());
      expect(b.tone).toBe('done');
      expect(b.chip).toBe('Completed');
      expect(b.line).toBe(`2 of 3 riders rode · ${clock(at(1))} to ${clock(at(34))}`);
      expect(b.note).toBe('Chats are deleted 1 day after the trip');
      expect(b.ring).toEqual({ kind: 'done', icon: 'checkmark' });
    });

    it('says when the chat is already deleted', () => {
      expect(make(done({ chats_deleted: true })).note).toBe('This chat was deleted');
    });

    it('says when it completed by itself or Dream Cabs ended it', () => {
      expect(make(done({ completed_by: 'auto' })).note).toBe('Completed by itself');
      expect(make(done({ completed_by: 'admin' })).note).toBe('Ended by Dream Cabs');
    });

    it('says when nobody rode', () => {
      const b = make(done({ riders_rode: 0, counts_as_ride: false }));
      expect(b.line).toBe('Nobody rode');
    });

    it('is deep blue with a dashed ring and the reason when cancelled', () => {
      const c = (reason: string, note: string | null = null) => make(listing({ status: 'cancelled', cancel_reason: reason, cancel_note: note }));
      expect(c('driver', 'The car broke down')).toEqual(jasmine.objectContaining({ tone: 'over', chip: 'Cancelled', line: 'Cancelled by you', note: 'Your reason: the car broke down' }));
      expect(c('driver').small).toBe('Riders were told');
      expect(c('driver').ring).toEqual({ kind: 'broken', icon: 'close' });
      expect(c('admin').line).toBe('Cancelled by Dream Cabs');
      expect(c('plan_ended')).toEqual(jasmine.objectContaining({ line: 'Your plan had ended', ring: { kind: 'broken', icon: 'card-outline' } }));
      expect(c('documents')).toEqual(jasmine.objectContaining({ line: 'A document had expired', ring: { kind: 'broken', icon: 'document-text-outline' } }));
      expect(c('missed_departure')).toEqual(jasmine.objectContaining({ line: "It wasn't started", ring: { kind: 'broken', icon: 'calendar-outline' } }));
    });
  });
});
