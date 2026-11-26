import { of, throwError } from 'rxjs';
import { CarpoolTrackerService, carpoolGeo } from './carpool-tracker.service';

/** L1.2: the driver's phone shares its position from Start ride until the ride ends (mockup 9b, 9c). */
describe('carpool location sharing', () => {
  const USER = 5;
  const key = `dc_cp_location_explained_${USER}`;
  let carpool: any, auth: any, alerts: any, plugin: any, answer: string;
  let fixFor: ((loc: any, err: any) => void) | null;
  let tracker: CarpoolTrackerService;
  const realNative = carpoolGeo.native;
  const realPlugin = carpoolGeo.plugin;
  const fix = (lat = 34.1, lng = 74.8) => ({ latitude: lat, longitude: lng, accuracy: 8, speed: 7, bearing: 40, time: Date.now() });

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-11-26T08:30:00Z'));
    localStorage.removeItem(key);
    answer = 'confirm';
    fixFor = null;
    plugin = {
      addWatcher: jasmine.createSpy('addWatcher').and.callFake((_o: any, cb: any) => { fixFor = cb; return Promise.resolve('w1'); }),
      removeWatcher: jasmine.createSpy('removeWatcher').and.resolveTo(),
      openSettings: jasmine.createSpy('openSettings').and.resolveTo(),
    };
    carpoolGeo.native = () => true;
    carpoolGeo.plugin = plugin;
    carpool = { sendPosition: jasmine.createSpy('sendPosition').and.returnValue(of({ stored: true })) };
    auth = { getUser: () => ({ id: USER }), getToken: () => 't', registerSessionCleanup: jasmine.createSpy('registerSessionCleanup') };
    alerts = {
      create: jasmine.createSpy('create').and.callFake(async () => ({
        present: async () => undefined,
        onDidDismiss: async () => ({ role: answer }),
      })),
    };
    tracker = new CarpoolTrackerService(carpool, auth, alerts);
  });

  afterEach(() => {
    carpoolGeo.native = realNative;
    carpoolGeo.plugin = realPlugin;
    localStorage.removeItem(key);
    jasmine.clock().uninstall();
  });

  it('explains once, then shares while the ride is on the road, at most every 5 seconds', async () => {
    await tracker.follow({ id: 7, status: 'in_progress' });
    expect(alerts.create).toHaveBeenCalledTimes(1);
    expect(plugin.addWatcher).toHaveBeenCalledWith(jasmine.objectContaining({
      backgroundTitle: 'Sharing your location with your riders', requestPermissions: true, distanceFilter: 5,
    }), jasmine.any(Function));

    fixFor!(fix(), null);
    expect(tracker.state).toBe('sharing');
    expect(carpool.sendPosition).toHaveBeenCalledWith(7, jasmine.objectContaining({ lat: 34.1, lng: 74.8, accuracy: 8, speed: 7, heading: 40 }));
    jasmine.clock().tick(2000);
    fixFor!(fix(34.101), null);
    expect(carpool.sendPosition).toHaveBeenCalledTimes(1);
    jasmine.clock().tick(3000);
    fixFor!(fix(34.102), null);
    expect(carpool.sendPosition).toHaveBeenCalledTimes(2);

    // The explanation is remembered for this driver.
    await tracker.stop();
    await tracker.follow({ id: 8, status: 'in_progress' });
    expect(alerts.create).toHaveBeenCalledTimes(1);
  });

  it('keeps the position fresh while the car stands still at a pickup', async () => {
    await tracker.follow({ id: 7, status: 'in_progress' });
    fixFor!(fix(), null);
    jasmine.clock().tick(10_000);
    expect(carpool.sendPosition).toHaveBeenCalledTimes(2);
    expect(carpool.sendPosition.calls.mostRecent().args[1].at).toBe(Date.now());
  });

  it('is off when the driver says not now, or Android refuses location, and can open the setting', async () => {
    answer = 'cancel';
    await tracker.follow({ id: 7, status: 'in_progress' });
    expect(tracker.state).toBe('off');
    expect(plugin.addWatcher).not.toHaveBeenCalled();

    expect(tracker.offReason).toBe('declined');
    // A reload does not ask again; Turn on does.
    await tracker.follow({ id: 7, status: 'in_progress' });
    expect(alerts.create).toHaveBeenCalledTimes(1);
    answer = 'confirm';
    await tracker.turnOn();
    expect(alerts.create).toHaveBeenCalledTimes(2);
    expect(plugin.addWatcher).toHaveBeenCalledTimes(1);

    fixFor!(null, { code: 'NOT_AUTHORIZED' });
    expect(tracker.state).toBe('off');
    expect(tracker.offReason).toBe('denied');
    // Turn on opens the setting, and the next look at the ride tries again.
    await tracker.turnOn();
    expect(plugin.openSettings).toHaveBeenCalled();
    await tracker.follow({ id: 7, status: 'in_progress' });
    expect(plugin.addWatcher).toHaveBeenCalledTimes(2);
  });

  it('stops when the ride ends, when the server says it is not on the road, and on sign-out', async () => {
    await tracker.follow({ id: 7, status: 'in_progress' });
    await tracker.follow({ id: 7, status: 'completed' });
    expect(plugin.removeWatcher).toHaveBeenCalledWith({ id: 'w1' });
    expect(tracker.state).toBe('idle');

    await tracker.follow({ id: 9, status: 'in_progress' });
    carpool.sendPosition.and.returnValue(throwError(() => ({ status: 422 })));
    fixFor!(fix(), null);
    await Promise.resolve();
    expect(tracker.state).toBe('idle');

    expect(auth.registerSessionCleanup).toHaveBeenCalledWith(jasmine.any(Function));
  });

  it('leaves a carpool that is not on the road alone', async () => {
    await tracker.follow({ id: 7, status: 'published' });
    expect(plugin.addWatcher).not.toHaveBeenCalled();
    expect(tracker.state).toBe('idle');
  });
});
