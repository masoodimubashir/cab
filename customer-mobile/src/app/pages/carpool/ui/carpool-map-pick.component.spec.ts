import { CarpoolMapPickComponent, SRINAGAR } from './carpool-map-pick.component';

// Shared by the driver app (Publish 3b) and the customer app (Choose a place 2c). Keep both copies identical.
describe('Choose on map (mockup 3b, 2c)', () => {
  const at = { lat: 34.1, lng: 74.8 };
  let pick: CarpoolMapPickComponent;
  let named: { [k: string]: (v: { name: string; address: string } | null) => void };

  beforeEach(() => {
    named = {};
    pick = new CarpoolMapPickComponent();
    pick.name = (p) => new Promise((resolve) => (named[`${p.lat},${p.lng}`] = resolve));
  });

  it('starts at the place already in the field, else the phone, else Srinagar', () => {
    expect(CarpoolMapPickComponent.firstCentre(at, { lat: 1, lng: 2 })).toEqual(at);
    expect(CarpoolMapPickComponent.firstCentre(null, { lat: 1, lng: 2 })).toEqual({ lat: 1, lng: 2 });
    expect(CarpoolMapPickComponent.firstCentre(null, null)).toEqual(SRINAGAR);
  });

  it('waits while the map moves and names the spot when it stops', async () => {
    pick.moving();
    expect(pick.state).toBe('finding');
    expect(pick.canUse).toBeFalse();
    const done = pick.settle(at);
    named['34.1,74.8']({ name: 'Nigeen', address: 'Nigeen, Srinagar' });
    await done;
    expect(pick.state).toBe('ready');
    expect(pick.place).toEqual({ name: 'Nigeen', address: 'Nigeen, Srinagar' });
    expect(pick.canUse).toBeTrue();
  });

  it('keeps only the name of the last spot when the map moved again before an answer came', async () => {
    const first = pick.settle(at);
    const second = pick.settle({ lat: 34.2, lng: 74.9 });
    named['34.2,74.9']({ name: 'Hazratbal', address: 'Hazratbal, Srinagar' });
    named['34.1,74.8']({ name: 'Nigeen', address: 'Nigeen, Srinagar' });
    await Promise.all([first, second]);
    expect(pick.place?.name).toBe('Hazratbal');
  });

  it('still lets the spot be used when Google has no name for it', async () => {
    const done = pick.settle(at);
    named['34.1,74.8'](null);
    await done;
    expect(pick.place).toEqual({ name: 'Pinned spot', address: '34.10000, 74.80000' });
    expect(pick.canUse).toBeTrue();
  });

  it('Use this spot hands back the point and its name, once named', async () => {
    const out: any[] = [];
    pick.picked.subscribe((p) => out.push(p));
    pick.use();
    expect(out.length).toBe(0);
    const done = pick.settle(at);
    named['34.1,74.8']({ name: 'Nigeen', address: 'Nigeen, Srinagar' });
    await done;
    pick.use();
    expect(out).toEqual([{ lat: 34.1, lng: 74.8, name: 'Nigeen', address: 'Nigeen, Srinagar' }]);
  });
});
