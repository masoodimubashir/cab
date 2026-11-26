import { NgZone } from '@angular/core';
import { of, throwError } from 'rxjs';
import { CarpoolRidePage } from './carpool-ride.page';
import { liveHead } from './rider-live';

/** L1.3: the rider sees the driver's car from Start ride until they are dropped (mockup 8m, 8n). */
describe('the car on the rider carpool page', () => {
  const at = (over: any = {}) => ({
    position: { lat: 34.1, lng: 74.8, heading: 40, at: '2026-11-26T08:30:00Z', age_s: 8 },
    stale: false, target: 'pickup', metres: 1240, minutes: 3, ...over,
  });

  describe('the line under the time', () => {
    it('gives minutes and distance to the pickup, and how fresh the position is', () => {
      expect(liveHead(at() as any, 'Imran', 'Nigeen')).toEqual({ live: true, text: 'Imran is 3 min from your pickup', small: '1.2 km away · updated 8 s ago' });
    });

    it('says the car is at the pickup when it is that close', () => {
      expect(liveHead(at({ metres: 60, minutes: 1 }) as any, 'Imran', 'Nigeen')?.text).toBe('Imran is at your pickup');
    });

    it('turns to the drop once picked up', () => {
      expect(liveHead(at({ target: 'drop', minutes: 9 }) as any, 'Imran', 'Nigeen'))
        .toEqual({ live: true, text: "You're on your way to Nigeen", small: 'About 9 min to your drop · updated 8 s ago' });
    });

    it('says it cannot see the car when no position came for a minute (8n)', () => {
      const h = liveHead(at({ stale: true, minutes: null, metres: null, position: { ...at().position, age_s: 130 } }) as any, 'Imran', 'Nigeen');
      expect(h).toEqual({ icon: 'alert-circle-outline', cls: 'grey', text: "Can't see Imran's car right now", small: 'Last seen 2 min ago. Times below are from the plan.' });
    });

    it('trusts the stale flag even if minutes came with it', () => {
      expect(liveHead(at({ stale: true }) as any, 'Imran', 'Nigeen')?.cls).toBe('grey');
    });

    it('leaves the line to the plan while the driver has shared nothing', () => {
      expect(liveHead(null, 'Imran', 'Nigeen')).toBeNull();
      expect(liveHead(at({ position: null, stale: true }) as any, 'Imran', 'Nigeen')).toBeNull();
    });
  });

  describe('the page', () => {
    let carpool: any;
    let page: CarpoolRidePage;
    const ride = (state: string) => ({
      id: 7, status: 'in_progress', departs_at: '2026-11-26T08:30:00Z', driver: { first_name: 'Imran' },
      my_request: { state, past: false, drop: { name: 'Nigeen' }, ride: { picked_up: false, minutes_away: 9, pickup_at: '', drop_at: '' } },
    });

    beforeEach(() => {
      carpool = { ridePosition: jasmine.createSpy('ridePosition').and.returnValue(of(at())) };
      const zone = { run: (fn: () => any) => fn() } as unknown as NgZone;
      page = new CarpoolRidePage({} as any, {} as any, {} as any, carpool, {} as any, zone);
      page.id = 7;
    });

    it('asks for the car while the ride is on the road and shows it', () => {
      page.ride = ride('started') as any;
      page.liveTick();
      expect(carpool.ridePosition).toHaveBeenCalledWith(7);
      expect(page.head?.text).toBe('Imran is 3 min from your pickup');
    });

    it('goes back to the plan when the car is not available', () => {
      page.ride = ride('started') as any;
      carpool.ridePosition.and.returnValue(throwError(() => ({ status: 404 })));
      page.liveTick();
      expect(page.live).toBeNull();
      expect(page.head?.text).toBe('Imran is 9 min from your pickup');
    });

    it('does not ask before the ride starts', () => {
      page.ride = ride('accepted') as any;
      page.liveTick();
      expect(carpool.ridePosition).not.toHaveBeenCalled();
    });
  });
});
