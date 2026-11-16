import { FixedBookPage } from './fixed.page';

describe('Fixed pickup travel warning', () => {
  const badgam = { id: 21, name: 'Badgam', center_lat: 34.01608, center_lng: 74.73531 };
  const sopore = { id: 3, name: 'Sopore', center_lat: 34.3033, center_lng: 74.4466 };
  let page: FixedBookPage;
  let alert: any;
  let create: jasmine.Spy;
  let loadSeats: jasmine.Spy;
  beforeEach(() => {
    page = Object.create(FixedBookPage.prototype);
    alert = { present: jasmine.createSpy().and.resolveTo(), onDidDismiss: jasmine.createSpy().and.resolveTo({ role: 'cancel' }) };
    create = jasmine.createSpy().and.resolveTo(alert);
    loadSeats = jasmine.createSpy();
    Object.assign(page, {
      step: 'details', boardStopId: 1, dropStopId: 2, cities: [badgam, sopore],
      userCoords: { lat: badgam.center_lat, lng: badgam.center_lng },
      selectedCity: sopore, cityId: sopore.id, travelWarningOpen: false,
      alertCtrl: { create }, cdr: { markForCheck: jasmine.createSpy() }, loadSeatMap: loadSeats,
      route: { id: 7, origin_name: 'Sopore', stops: [
        { id: 1, seq: 1, name: 'Sopore stand', lat: sopore.center_lat, lng: sopore.center_lng, is_pickup: true, is_active: true },
        { id: 2, seq: 2, name: 'Destination', is_drop: true, is_active: true },
      ] },
    });
  });

  it('uses GPS rather than the selected browsing city to warn about a Sopore pickup', () => {
    expect(page.pickupTravelWarning).toContain('pickup is at Sopore stand in Sopore');
    expect(page.pickupTravelWarning).toContain("You're in Badgam");
    expect(page.pickupTravelWarning).toContain('You can still book if you can reach the pickup point before departure');
  });

  it('allows a local intermediate pickup even when the route starts in another city', () => {
    page.route!.stops.push({ id: 3, seq: 2, name: 'Badgam stop', lat: badgam.center_lat,
      lng: badgam.center_lng, is_pickup: true, is_drop: false, is_active: true, is_temporarily_unavailable: false });
    page.boardStopId = null;
    expect(page.pickupTravelWarning).toBeNull();
    page.boardStopId = 3;
    expect(page.pickupTravelWarning).toBeNull();
    page.boardStopId = 1;
    expect(page.pickupTravelWarning).toContain('Sopore stand');
  });

  it('keeps the customer at the stop-selection step when they cancel the warning', async () => {
    await page.goToSeats();
    expect(page.step).toBe('details');
    expect(loadSeats).not.toHaveBeenCalled();
    expect(create.calls.mostRecent().args[0].buttons[1].text).toBe('I can reach the pickup');
    expect(page.travelWarningOpen).toBeFalse();
  });

  it('allows a distant booking after the customer confirms they can reach the pickup', async () => {
    alert.onDidDismiss.and.resolveTo({ role: 'confirm' });
    await page.goToSeats();
    expect(page.step).toBe('seats');
    expect(loadSeats).toHaveBeenCalledTimes(1);
  });

  it('does not prompt for a nearby pickup in the current city', async () => {
    page.userCoords = { lat: sopore.center_lat, lng: sopore.center_lng };
    await page.goToSeats();
    expect(create).not.toHaveBeenCalled();
    expect(page.step).toBe('seats');
  });

  it('explains unavailable GPS without pretending the browsing city is the customer location', () => {
    page.userCoords = null;
    expect(page.pickupTravelWarning).toContain('current location is unavailable');
    expect(page.pickupTravelWarning).not.toContain('currently in Sopore');
  });

  it('does not advance if the selected pickup changes while the warning is open', async () => {
    alert.onDidDismiss.and.callFake(async () => { page.boardStopId = 3; return { role: 'confirm' }; });
    await page.goToSeats();
    expect(page.step).toBe('details');
    expect(loadSeats).not.toHaveBeenCalled();
  });
});
