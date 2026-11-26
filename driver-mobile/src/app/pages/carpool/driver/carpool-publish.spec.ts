import { CarpoolPublishPage } from './carpool-publish.page';

describe('Publish step 1: Choose on map (mockup 3, 3b)', () => {
  const spot = { lat: 34.12, lng: 74.84, name: 'Kashmir University', address: 'Hazratbal, Srinagar' };
  let page: CarpoolPublishPage;
  let geo: any;

  beforeEach(() => {
    geo = { getCurrentPosition: jasmine.createSpy('getCurrentPosition').and.resolveTo({ lat: 34.05, lng: 74.79, accuracy: 5 }) };
    page = new CarpoolPublishPage({} as any, {} as any, {} as any, {} as any, geo);
  });

  it('opens the map for the field that is selected, starting at its place', () => {
    page.active = 'to';
    page.openMap();
    expect(page.mapFor).toBe('to');
    expect(page.mapStart).toBeNull();
    page.mapPicked(spot);
    page.openMap();
    expect(page.mapStart).toEqual({ lat: 34.12, lng: 74.84 });
  });

  it('fills the field like a suggestion, then moves on to To', () => {
    page.active = 'from';
    page.openMap();
    page.mapPicked(spot);
    expect(page.from).toEqual(spot);
    expect(page.query.from).toBe('Kashmir University');
    expect(page.mapFor).toBeNull();
    expect(page.active).toBe('to');
  });

  it('closing the map changes nothing', () => {
    page.openMap();
    page.closeMap();
    expect(page.mapFor).toBeNull();
    expect(page.from).toBeNull();
  });

  it('finds the phone for the map, and gives nothing when location is off', async () => {
    expect(await page.locateMe()).toEqual({ lat: 34.05, lng: 74.79 });
    geo.getCurrentPosition.and.resolveTo(null);
    expect(await page.locateMe()).toBeNull();
  });
});
