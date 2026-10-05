const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('../customer-mobile/node_modules/typescript');

// Exercise the real page methods with device, maps and HTTP boundaries stubbed.
function load(relative, dependencies = {}, globals = {}) {
  const filename = path.join(__dirname, '..', relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, console, Date, URLSearchParams, setTimeout, clearTimeout, ...globals,
    require: name => {
      if (dependencies[name]) return dependencies[name];
      if (name === '@angular/core') return {
        Component: () => value => value, ViewChild: () => () => {},
        ChangeDetectionStrategy: { OnPush: 0 },
      };
      return {};
    },
  }, { filename });
  return exports;
}

const helper = load('driver-mobile/src/app/core/customer-location.helper.ts');
test('origin remains available during boarding and becomes passed only after departure', () => {
  const Page = load('driver-mobile/src/app/pages/fixed-driver/fixed-driver.page.ts').FixedDriverPage;
  const page = Object.create(Page.prototype);
  Object.assign(page, {
    activeVehicle: { status: 'DISPATCHED', fixed_last_reached_stop_seq: 1 },
    stops: [{ id: 1, seq: 1, name: 'Origin' }, { id: 2, seq: 2, name: 'Next' }],
    passengers: [],
  });
  assert.equal(page.reachedStopSeq, 1); // Arrival still enables passenger boarding actions.
  assert.equal(page.stopGuide[0].status, 'next');
  assert.equal(page.stopGuide[1].status, 'pending');
  page.openStopDetail(page.stops[0]);
  assert.equal(page.selectedStopDetail.isReached, false);
  page.activeVehicle.status = 'DEPARTED';
  assert.equal(page.stopGuide[0].status, 'done');
  assert.equal(page.stopGuide[1].status, 'next');

  const MapPage = load('driver-mobile/src/app/pages/fixed-driver/fixed-driver-map.page.ts').FixedDriverMapPage;
  const mapPage = Object.create(MapPage.prototype);
  Object.assign(mapPage, { vehicle: { status: 'DISPATCHED', fixed_last_reached_stop_seq: 1 },
    passengers: [], citySettings: null });
  mapPage.openStopDetail(page.stops[0]);
  assert.equal(mapPage.selectedStopDetail.isReached, false);
  assert.equal(mapPage.selectedStopDetail.isNext, true);
  mapPage.vehicle.status = 'DEPARTED';
  mapPage.openStopDetail(page.stops[0]);
  assert.equal(mapPage.selectedStopDetail.isReached, true);
});

test('live GPS expires and coordinate-only changes invalidate markers', () => {
  const now = Date.now();
  const customer = { id: 1, status: 'BOOKED', customer_lat: 34, customer_lng: 74,
    customer_location_updated_at: new Date(now - 60_000).toISOString() };
  assert.equal(helper.isCustomerLocationLive(customer, now), true);
  assert.equal(helper.isCustomerLocationLive(customer, now + 61_000), false);
  for (const stamp of [null, 'invalid', new Date(now + 60_000).toISOString()]) {
    assert.equal(helper.isCustomerLocationLive({ ...customer, customer_location_updated_at: stamp }, now), false);
  }
  assert.notEqual(helper.customerMarkerSignature([customer]),
    helper.customerMarkerSignature([{ ...customer, customer_lat: 34.001 }]));
});

test('full-screen manifest polling refreshes a walking customer and expires the live marker', () => {
  const Page = load('driver-mobile/src/app/pages/fixed-driver/fixed-driver-map.page.ts', {
    '../../core/customer-location.helper': helper,
  }).FixedDriverMapPage;
  const customer = { id: 1, status: 'BOOKED', customer_lat: 34, customer_lng: 74,
    customer_location_updated_at: new Date(Date.now() - 60_000).toISOString() };
  let response = { departure: { id: 1 }, passengers: [customer], stops: [] };
  const page = Object.create(Page.prototype);
  let refreshes = 0;
  Object.assign(page, {
    route: { snapshot: { paramMap: { get: () => '1' } } }, map: {}, stops: [], passengers: [customer],
    renderedPassengerSignature: helper.customerMarkerSignature([customer]),
    api: { get: () => ({ subscribe: observer => observer.next(response) }) },
    refreshMap: () => refreshes++,
  });
  page.load(false);
  assert.equal(refreshes, 0);
  response = { ...response, passengers: [{ ...customer, customer_lat: 34.001 }] };
  page.load(false);
  assert.equal(refreshes, 1);
  assert.equal(page.passengers[0].customer_lat, 34.001);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 61_000;
    page.load(false);
    assert.equal(refreshes, 2);
    assert.equal(page.isCustomerLive(page.passengers[0]), false);
  } finally { Date.now = realNow; }
});

test('real map refresh replaces marker coordinates, distances and stale labels', () => {
  class Marker {
    constructor(options) { Object.assign(this, options); }
    addListener() {}
  }
  const Page = load('driver-mobile/src/app/pages/fixed-driver/fixed-driver-map.page.ts', {
    '../../core/customer-location.helper': helper,
    './fixed-driver.page': load('driver-mobile/src/app/pages/fixed-driver/fixed-driver.page.ts'),
  }, { google: { maps: { marker: { AdvancedMarkerElement: Marker } } } }).FixedDriverMapPage;
  const customer = { id: 1, status: 'BOOKED', board_stop_id: 1, customer_lat: 34, customer_lng: 74,
    customer_location_updated_at: new Date().toISOString() };
  let response = { departure: { id: 1 }, passengers: [customer],
    stops: [{ id: 1, seq: 1, name: 'Pickup', lat: 34, lng: 74 }] };
  const page = Object.create(Page.prototype);
  Object.assign(page, {
    route: { snapshot: { paramMap: { get: () => '1' } } }, map: {}, stops: [], passengers: [],
    stopMarkers: [], passengerMarkers: [], driverPosition: { lat: 34, lng: 74 },
    renderedPassengerSignature: '', fitMap: () => {}, buildStopMarker: () => ({}),
    buildPassengerMarker: (kind, count, name, live, avatar, distance) => ({ live, distance }),
    api: { get: () => ({ subscribe: observer => observer.next(response) }) },
  });
  page.load(false);
  const old = page.passengerMarkers[0];
  response = { ...response, passengers: [{ ...customer, customer_lat: 34.001 }] };
  page.load(false);
  const moved = page.passengerMarkers[0];
  assert.equal(old.map, null);
  assert.equal(moved.position.lat, 34.001);
  assert.notEqual(moved.content.distance, old.content.distance);
  response = { ...response, passengers: [{ ...response.passengers[0],
    customer_location_updated_at: new Date(Date.now() - 180_000).toISOString() }] };
  page.load(false);
  assert.equal(page.passengerMarkers[0].content.live, false);
  assert.match(page.passengerMarkers[0].title, /Last known location/);
});

for (const gps of [null, { lat: 34.2, lng: 74.2 }]) {
  test(gps ? 'GPS fix creates the customer pin' : 'city fallback centres the map without a customer pin', async () => {
    const Page = load('customer-mobile/src/app/pages/booking/home/booking-home.page.ts', {
      '../booking.service': { scopesOffered: () => [], pointInPolygon: () => true },
    }).BookingHomePage;
    const page = Object.create(Page.prototype);
    const pins = [], centres = [], zooms = [];
    Object.assign(page, {
      zone: { run: fn => fn() }, cdr: { markForCheck: () => {} },
      booking: { cities: async () => [{ id: 1, name: 'City', center_lat: 34, center_lng: 74,
        boundary_polygon: [{ lat: 33, lng: 73 }, { lat: 35, lng: 73 }, { lat: 35, lng: 75 }] }],
        catalog: async () => [], setCity: () => {} },
      geo: { getCurrentPosition: async () => gps, getCurrentFix: async () => null },
      map: { setCenter: pos => centres.push(pos), setZoom: zoom => zooms.push(zoom) },
      places: {}, rebuildTiles: () => {},
      updateMapPosition: (...args) => pins.push(args),
    });
    await page.loadLocationAndCatalog();
    assert.equal(pins.length, gps ? 1 : 0);
    assert.equal(centres.length, gps ? 0 : 1);
    if (!gps) assert.equal(zooms[0], 12);
    assert.equal(page.located, !!gps);
    assert.equal(page.locationFetching, false);
  });
}

test('route search sends the term to the server and cancels previous results', () => {
  const Page = load('customer-mobile/src/app/pages/booking/fixed/fixed.page.ts').FixedBookPage;
  const page = Object.create(Page.prototype);
  let cancelled = 0;
  const requests = [];
  Object.assign(page, {
    cityId: 1, search: 'Hidden route', userCoords: { lat: 34, lng: 74 }, routesRequestId: 0,
    cdr: { markForCheck: () => {} }, annotateRoutesWithProximity: () => {}, sortRoutesByProximity: () => {},
    api: { get: url => ({ subscribe: observer => {
      requests.push({ url, observer }); return { unsubscribe: () => cancelled++ };
    } }) },
  });
  page.loadRoutes();
  assert.equal(new URLSearchParams(requests[0].url.split('?')[1]).get('q'), 'Hidden route');
  page.search = 'New route';
  page.loadRoutes();
  assert.equal(cancelled, 1);
  requests[0].observer.next({ data: [{ name: 'Old route' }] });
  assert.equal(page.routes, undefined);
  requests[1].observer.next({ data: [{ name: 'New route' }] });
  assert.equal(page.visibleRoutes[0].name, 'New route');
  page.clearSearch();
  assert.equal(new URLSearchParams(requests[2].url.split('?')[1]).has('q'), false);
  requests[2].observer.error();
  assert.equal(page.error, 'Could not load routes. Please try again.');
  page.retryRoutes();
  assert.equal(page.loading, true);
  assert.equal(page.error, null);
  requests[3].observer.next({ data: [{ name: 'Recovered route' }] });
  assert.equal(page.visibleRoutes[0].name, 'Recovered route');
});
