import { of } from 'rxjs';
import { CarpoolHomePage } from './carpool-home.page';
import { whenLabel } from './carpool-format';

describe('Home join request card (mockup 2: route under the name, then one facts line)', () => {
  const page = () => new CarpoolHomePage({} as any, {} as any, {} as any, { events: of() } as any, {} as any);
  const departs = new Date(Date.now() + 26 * 3_600_000).toISOString();
  const req = (over: any = {}) => ({
    seats: 2, is_free: true, total: 0,
    listing: { departs_at: departs, start: { name: 'Kashmir University' }, end: { name: 'Bemina Bypass' } },
    ...over,
  }) as any;

  it('puts the carpool route on its own line and the time, seats and price in the facts line', () => {
    expect(page().requestFacts(req())).toEqual({
      route: 'Kashmir University to Bemina Bypass',
      when: whenLabel(departs),
      seats: '2 seats',
      price: 'Free ride',
    });
  });

  it('says one seat and the rupee total for a paid request', () => {
    const f = page().requestFacts(req({ seats: 1, is_free: false, total: 250 }));
    expect(f?.seats).toBe('1 seat');
    expect(f?.price).toBe('₹250');
  });

  it('gives nothing when there is no request', () => {
    expect(page().requestFacts(null)).toBeNull();
  });
});
