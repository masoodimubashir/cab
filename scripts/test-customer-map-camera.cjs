const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../customer-mobile/node_modules/typescript');

function load(relative, dependencies, globals) {
  const filename = path.join(__dirname, '..', relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, console, setTimeout, clearTimeout, AbortController,
    ...globals,
    require: name => dependencies[name] || (name === '@angular/core'
      ? { Component: () => value => value, ViewChild: () => () => {} } : {}),
  }, { filename });
  return exports;
}

function setup(reducedMotion = true) {
  let clock = 0, nextId = 0;
  const frames = new Map();
  const state = { center: { lat: 34, lng: 74 }, zoom: 20, heading: 110, tilt: 50 };
  const moves = [];
  let options;
  const map = {
    getCenter: () => ({ toJSON: () => state.center }),
    getZoom: () => state.zoom, getHeading: () => state.heading, getTilt: () => state.tilt,
    moveCamera: camera => { moves.push(camera); Object.assign(state, camera); },
  };
  const globals = {
    window: { matchMedia: () => ({ matches: reducedMotion }) },
    performance: { now: () => clock },
    requestAnimationFrame: callback => { frames.set(++nextId, callback); return nextId; },
    cancelAnimationFrame: id => frames.delete(id),
    google: { maps: { Map: class { constructor(element, value) { options = value; return map; } } } },
  };
  const interaction = load('customer-mobile/src/app/core/map-camera.ts', {}, globals);
  const camera = load('customer-mobile/src/app/core/customer-map.ts', { './map-camera': interaction }, globals);
  const fixedMap = load('customer-mobile/src/app/core/fixed-ride-map.ts', {}, globals);
  const navigation = load('customer-mobile/src/app/core/navigation-route.helper.ts', {
    './customer-map': camera, './car-marker.helper': { updateCarMarkerBearing: () => {} },
    './map-camera': interaction,
  }, globals);
  const Page = load('customer-mobile/src/app/pages/fixed-ride-active/fixed-ride-active.page.ts', {
    '../../core/customer-map': camera,
    '../../core/fixed-ride-map': fixedMap,
    '../../core/navigation-route.helper': navigation,
    '../../core/map-camera': interaction,
  }, globals).FixedRideActivePage;
  const renderer = new navigation.NavigationRouteRenderer();
  const element = new EventTarget();
  const marker = { position: { lat: 34, lng: 74 } };
  const page = Object.create(Page.prototype);
  Object.assign(page, {
    map, mapElRef: { nativeElement: element }, navRoute: renderer,
    manualMapCamera: false, walkingLeftPage: false, mapGestureAbort: null,
    inactiveStatuses: new Set(['DROPPED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']),
    booking: { id: 1, status: 'BOOKED', board_lat: 34.01, board_lng: 74.01 },
    userPosition: { lat: 34, lng: 74 }, userLiveMarker: marker,
    pickupMarker: null, dropMarker: null, driverMarker: null, stopMarkers: [],
    places: { ensureLoaded: async () => {} },
  });
  page.bindMapGestures();
  return {
    page, renderer, element, marker, state, moves, map, options: () => options,
    step(time = clock + 650) {
      clock = time;
      const callbacks = [...frames.values()]; frames.clear();
      callbacks.forEach(callback => callback(time));
    },
  };
}

test('map explicitly enables vector rotation and tilt gestures', async () => {
  const f = setup();
  f.page.map = null;
  f.page.updateMarkers = () => {};
  f.page.fitMapBounds = () => {};
  await f.page.ensureMap();
  assert.equal(f.options().renderingType, 'VECTOR');
  assert.equal(f.options().headingInteractionEnabled, true);
  assert.equal(f.options().tiltInteractionEnabled, true);
  f.page.clearMap();
});

test('normal navigation still follows the live marker at the configured camera zoom', () => {
  const f = setup();
  f.renderer.follow(f.map, { lat: 34.001, lng: 74.001 }, { lat: 34.01, lng: 74.01 }, f.marker);
  f.step();
  assert.equal(f.state.zoom, 17.5);
  assert.equal(f.state.center.lat, 34.001);
  assert.equal(f.marker.position.lat, 34.001);
});

test('touch, pointer, wheel and navigation keys pause the camera without consuming the gesture', () => {
  for (const type of ['touchstart', 'pointerdown', 'wheel', 'keydown']) {
    const f = setup();
    const event = new Event(type, { cancelable: true });
    if (type === 'keydown') Object.defineProperty(event, 'key', { value: 'ArrowLeft' });
    f.element.dispatchEvent(event);
    assert.equal(f.page.manualMapCamera, true, type);
    assert.equal(event.defaultPrevented, false, type);
    f.page.clearMap();
  }
});

test('GPS and repeated route refreshes preserve manual zoom, heading, tilt and center while updating markers', () => {
  for (const status of ['BOOKED', 'BOARDED']) {
    const f = setup();
    f.page.booking.status = status;
    f.page.booking.drop_lat = 34.02;
    f.page.booking.drop_lng = 74.02;
    f.page.driverMarker = f.marker;
    f.renderer.render = async () => {};
    f.element.dispatchEvent(new Event('touchstart'));
    for (const lat of [34.001, 34.002, 34.003]) {
      f.page.userPosition = f.page.driverPosition = { lat, lng: 74.001 };
      f.page.renderRoutePolyline();
      f.step();
      assert.equal(f.marker.position.lat, lat, status);
    }
    assert.equal(f.moves.length, 0, status);
    assert.equal(f.state.zoom, 20, status);
    assert.equal(f.state.heading, 110, status);
    assert.equal(f.state.tilt, 50, status);
    assert.equal(f.state.center.lat, 34, status);
  }
});

test('manual gesture interrupts an already running camera animation', () => {
  const f = setup(false);
  f.renderer.follow(f.map, { lat: 34.001, lng: 74.001 }, { lat: 34.01, lng: 74.01 }, f.marker);
  f.step(200);
  const count = f.moves.length;
  f.element.dispatchEvent(new Event('pointerdown'));
  f.state.zoom = 21;
  f.state.heading = 220;
  f.step(700);
  assert.equal(f.moves.length, count);
  assert.equal(f.state.zoom, 21);
  assert.equal(f.state.heading, 220);
  assert.equal(f.marker.position.lat, 34.001);
});

test('route recalculation and automatic fallback framing do not resume a paused camera', () => {
  const f = setup();
  f.element.dispatchEvent(new Event('wheel'));
  f.renderer.clear();
  f.page.fitMapBounds();
  f.renderer.follow(f.map, { lat: 34.002, lng: 74.002 }, { lat: 34.02, lng: 74.02 }, f.marker);
  f.step();
  assert.equal(f.moves.length, 0);
  assert.equal(f.marker.position.lat, 34.002);
});

test('explicit recenter resumes following even when GPS position has not changed', () => {
  const f = setup();
  f.renderer.render = async () => {};
  f.page.renderRoutePolyline(); f.step();
  f.element.dispatchEvent(new Event('wheel'));
  f.state.zoom = 21; f.state.heading = 220;
  f.page.recenterMap(); f.step();
  assert.equal(f.page.manualMapCamera, false);
  assert.equal(f.state.zoom, 17.5);
  assert.equal(f.state.center.lat, f.page.userPosition.lat);
  assert.notEqual(f.state.heading, 220);
});

test('map teardown removes gesture listeners and clears manual camera state', () => {
  const f = setup();
  f.element.dispatchEvent(new Event('touchstart'));
  f.page.clearMap();
  f.element.dispatchEvent(new Event('wheel'));
  assert.equal(f.page.manualMapCamera, false);
  assert.equal(f.page.mapGestureAbort, null);
  assert.equal(f.page.map, null);
});
