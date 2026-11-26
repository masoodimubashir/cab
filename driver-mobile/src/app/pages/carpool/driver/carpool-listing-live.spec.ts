import { of } from 'rxjs';
import { CarpoolListingPage } from './carpool-listing.page';

/** L1.2 on the carpool page: "Sharing location" in the header (9b) or the amber "Location is off" line (9c). */
describe('carpool page while the ride is on the road', () => {
  let tracker: any, carpool: any;
  const page = () => {
    const p = new CarpoolListingPage({ snapshot: { paramMap: { get: () => '7' } } } as any, {} as any, carpool, {} as any, {} as any, tracker);
    p.listing = { id: 7, status: 'in_progress' } as any;
    return p;
  };

  beforeEach(() => {
    tracker = { state: 'idle', offReason: null, follow: jasmine.createSpy('follow').and.resolveTo(), turnOn: jasmine.createSpy('turnOn').and.resolveTo() };
    carpool = { listing: jasmine.createSpy('listing').and.returnValue(of({ id: 7, status: 'in_progress' })) };
  });

  it('says "Sharing location" while positions go out, "In progress" otherwise', () => {
    tracker.state = 'sharing';
    expect(page().liveLabel).toBe('Sharing location');
    tracker.state = 'starting';
    expect(page().liveLabel).toBe('In progress');
  });

  it('shows "Location is off" with Turn on when refused, not in the browser preview', async () => {
    tracker.state = 'off';
    tracker.offReason = 'denied';
    const p = page();
    expect(p.locationOff).toBeTrue();
    await p.turnOnLocation();
    expect(tracker.turnOn).toHaveBeenCalled();
    tracker.offReason = 'unsupported';
    expect(p.locationOff).toBeFalse();
    p.listing = { id: 7, status: 'completed' } as any;
    tracker.offReason = 'denied';
    expect(p.locationOff).toBeFalse();
  });

  it('starts or stops sharing every time the carpool is loaded', () => {
    const p = page();
    p.load();
    expect(tracker.follow).toHaveBeenCalledWith(jasmine.objectContaining({ id: 7, status: 'in_progress' }));
  });
});
