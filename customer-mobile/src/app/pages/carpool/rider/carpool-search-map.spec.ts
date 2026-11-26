import { NgZone } from '@angular/core';
import { CarpoolSearchPage } from './carpool-search.page';

describe('Choose a place: Choose on map (mockup 2b, 2c)', () => {
  const spot = { lat: 34.11, lng: 74.83, name: 'Nigeen Lake', address: 'Nigeen, Srinagar' };
  let page: CarpoolSearchPage;
  let geo: any;

  beforeEach(() => {
    geo = { getCurrentPosition: jasmine.createSpy('getCurrentPosition').and.resolveTo({ lat: 34.05, lng: 74.79 }) };
    const zone = { run: (fn: () => any) => fn() } as unknown as NgZone;
    page = new CarpoolSearchPage({} as any, {} as any, {} as any, {} as any, geo, {} as any, zone);
  });

  it('opens over the place search for the same field, at its place if it has one', () => {
    page.picking = 'to';
    page.openMap();
    expect(page.mapFor).toBe('to');
    expect(page.mapStart).toBeNull();
    page.to = { ...spot };
    expect(page.mapStart).toEqual({ lat: 34.11, lng: 74.83 });
  });

  it('fills the field like a suggestion and closes both the map and the search', () => {
    page.picking = 'to';
    page.from = { lat: 1, lng: 2, name: 'Rajbagh', address: 'Rajbagh' };
    page.openMap();
    page.mapPicked(spot);
    expect(page.to).toEqual({ ...spot, mine: false });
    expect(page.mapFor).toBeNull();
    expect(page.picking).toBeNull();
  });

  it('Back on the map returns to the place search', () => {
    page.picking = 'from';
    page.openMap();
    page.closeMap();
    expect(page.mapFor).toBeNull();
    expect(page.picking).toBe('from');
  });

  it('finds the phone for the map', async () => {
    expect(await page.phoneSpot()).toEqual({ lat: 34.05, lng: 74.79 });
  });
});
