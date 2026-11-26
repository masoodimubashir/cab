import { of } from 'rxjs';
import { CarpoolListingPage } from './carpool-listing.page';
import { arrivedLine, noShowButton, waitedLine } from './carpool-wait';

/** L1.4: the wait at a pickup (mockup 9b, 10b, 13). */
describe('waiting at a pickup', () => {
  const T = Date.parse('2026-11-26T08:50:00Z');
  const rider = (over: any = {}) => ({ id: 3, ride_state: 'waiting', arrived_at: null, no_show_opens_at: null, no_show_state: 'any', ...over });

  describe('the row and sheet line', () => {
    it('counts the wait once the car reached the pickup', () => {
      expect(arrivedLine(rider({ arrived_at: '2026-11-26T08:47:20Z' }) as any, T)).toBe('Arrived · waiting 2:40');
    });

    it('says nothing before arriving or once the rider is in the car', () => {
      expect(arrivedLine(rider() as any, T)).toBeNull();
      expect(arrivedLine(rider({ arrived_at: '2026-11-26T08:47:20Z', ride_state: 'picked_up' }) as any, T)).toBeNull();
    });
  });

  describe('the No-show button', () => {
    it('is open any time when the location is not shared', () => {
      expect(noShowButton(rider() as any, T)).toEqual({ label: 'No-show', open: true });
    });

    it('asks to reach the pickup first while sharing and not there yet', () => {
      expect(noShowButton(rider({ no_show_state: 'not_arrived' }) as any, T)).toEqual({ label: 'Reach the pickup first', open: false });
    });

    it('counts down to when it opens', () => {
      const r = rider({ no_show_state: 'waiting', arrived_at: '2026-11-26T08:46:48Z', no_show_opens_at: '2026-11-26T08:51:48Z' });
      expect(noShowButton(r as any, T)).toEqual({ label: 'No-show in 1:48', open: false });
    });

    it('opens when the countdown is over, without waiting for a reload', () => {
      const r = rider({ no_show_state: 'waiting', no_show_opens_at: '2026-11-26T08:51:48Z' });
      expect(noShowButton(r as any, Date.parse('2026-11-26T08:51:48Z'))).toEqual({ label: 'No-show', open: true });
    });
  });

  it('tells the no-show sheet how long the driver has waited', () => {
    expect(waitedLine(rider({ arrived_at: '2026-11-26T08:43:30Z' }) as any, T)).toBe("you've waited 6 min");
    expect(waitedLine(rider() as any, T)).toBeNull();
  });

  describe('the page', () => {
    let carpool: any;
    const page = () => {
      const tracker = { state: 'sharing', follow: jasmine.createSpy('follow').and.resolveTo() };
      const p = new CarpoolListingPage({ snapshot: { paramMap: { get: () => '7' } } } as any, {} as any, carpool, {} as any, {} as any, tracker as any);
      p.id = 7;
      return p;
    };

    beforeEach(() => {
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(T));
    });
    afterEach(() => jasmine.clock().uninstall());

    it('reloads the riders every 15 s on the road, so an arrival shows up', () => {
      carpool = { listing: jasmine.createSpy('listing').and.returnValue(of({ id: 7, status: 'in_progress', riders: [rider()] })) };
      const p = page();
      p.load();
      p.startRideClock();
      carpool.listing.calls.reset();
      jasmine.clock().tick(15000);
      expect(carpool.listing).toHaveBeenCalledTimes(1);
      p.stopRideClock();
      jasmine.clock().tick(30000);
      expect(carpool.listing).toHaveBeenCalledTimes(1);
    });

    it('keeps the open rider sheet on the fresh rider after a reload', () => {
      const fresh = rider({ arrived_at: '2026-11-26T08:47:20Z', no_show_state: 'waiting', no_show_opens_at: '2026-11-26T08:52:20Z' });
      carpool = { listing: jasmine.createSpy('listing').and.returnValue(of({ id: 7, status: 'in_progress', riders: [fresh] })) };
      const p = page();
      p.rider = rider() as any;
      p.load();
      expect(p.rider).toBe(fresh as any);
      expect(p.noShowFor(p.rider!)).toEqual({ label: 'No-show in 2:20', open: false });
    });

    it('moves the countdown on every second', () => {
      carpool = { listing: jasmine.createSpy('listing').and.returnValue(of({ id: 7, status: 'in_progress', riders: [] })) };
      const p = page();
      p.load();
      p.startRideClock();
      const r = rider({ arrived_at: '2026-11-26T08:47:20Z' }) as any;
      expect(p.arrivedFor(r)).toBe('Arrived · waiting 2:40');
      jasmine.clock().tick(1000);
      expect(p.arrivedFor(r)).toBe('Arrived · waiting 2:41');
      p.stopRideClock();
    });

    it('does not run the clock when the ride is not on the road', () => {
      carpool = { listing: jasmine.createSpy('listing').and.returnValue(of({ id: 7, status: 'published', riders: [] })) };
      const p = page();
      p.load();
      p.startRideClock();
      carpool.listing.calls.reset();
      jasmine.clock().tick(30000);
      expect(carpool.listing).not.toHaveBeenCalled();
      p.stopRideClock();
    });
  });
});
