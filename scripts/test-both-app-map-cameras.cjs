const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../customer-mobile/node_modules/typescript');

function load(relative, dependencies, globals) {
  const filename = path.join(__dirname, '..', relative);
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText;
  vm.runInNewContext(code, { exports, console, AbortController, setTimeout, clearTimeout, ...globals,
    require: name => dependencies[name] || (name === '@angular/core'
      ? { Component: () => value => value, ViewChild: () => () => {}, Input: () => () => {} } : {}),
  }, { filename });
  return exports;
}

class Element extends EventTarget {
  style = {};
  hidden = false;
  attributes = {};
  classList = { contains: () => false };
  setAttribute(name, value) { this.attributes[name] = value; }
  remove() { this.removed = true; }
}

function setup(app) {
  let id = 0, time = 0;
  const frames = new Map(), controls = [], idle = [], listeners = new Map();
  const div = new Element();
  const state = { center: { lat: 34, lng: 74 }, zoom: 17.5, heading: 0, tilt: 35 };
  const moves = [], fits = [];
  const map = {
    controls: { 1: { push: value => controls.push(value), getLength: () => controls.length,
      getAt: i => controls[i], removeAt: i => controls.splice(i, 1) } },
    getDiv: () => div, getCenter: () => ({ toJSON: () => state.center }),
    getZoom: () => state.zoom, getHeading: () => state.heading, getTilt: () => state.tilt,
    moveCamera: value => { moves.push(value); Object.assign(state, value); },
    fitBounds: (...args) => { fits.push(args); state.tilt = 0; state.heading = 0; },
    setTilt: value => { state.tilt = value; },
    addListener: (name, callback) => { listeners.set(name, callback); return { remove: () => listeners.delete(name) }; },
  };
  const globals = {
    document: { createElement: () => new Element() },
    window: { matchMedia: () => ({ matches: true }) },
    performance: { now: () => time },
    requestAnimationFrame: callback => { frames.set(++id, callback); return id; },
    cancelAnimationFrame: key => frames.delete(key),
    google: { maps: {
      ControlPosition: { RIGHT_TOP: 1 },
      event: { addListenerOnce: (target, name, callback) => idle.push(callback) },
      LatLng: class { constructor(p) { this.p = p; } toJSON() { return this.p; } },
    } },
  };
  const root = app + '-mobile/src/app/core/';
  const interaction = load(root + 'map-camera.ts', {}, globals);
  const camera = load(root + (app === 'customer' ? 'customer-map.ts' : 'driver-map.ts'), {
    './map-camera': interaction, './car-marker.helper': { updateCarMarkerBearing: () => {} },
  }, globals);
  let navigator;
  if (app === 'customer') navigator = load(root + 'navigation-route.helper.ts', {
    './map-camera': interaction, './customer-map': camera,
    './car-marker.helper': { updateCarMarkerBearing: () => {} },
  }, globals);
  const marker = { position: { lat: 34, lng: 74 } };
  const follower = app === 'customer' ? new navigator.NavigationRouteRenderer() : new camera.DriverMapCamera();
  interaction.watchMapCamera(map);
  return {
    app, div, state, moves, fits, idle, controls, listeners, interaction, camera, navigator, globals, map, marker, follower,
    follow(position) {
      if (app === 'customer') follower.follow(map, position, { lat: 34.02, lng: 74.02 }, marker);
      else follower.follow(map, position, 65, marker);
    },
    step() { time += 700; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(time)); },
    fit() { (camera.fitCustomerMap || camera.fitDriverMap)(map, { route: 'latest' }, 60); },
  };
}

for (const app of ['customer', 'driver']) {
  test(`${app}: rotation, tilt and direct map gestures are enabled`, () => {
    const f = setup(app), style = f.camera.CUSTOMER_MAP_STYLE || f.camera.DRIVER_MAP_STYLE;
    assert.equal(style.headingInteractionEnabled, true);
    assert.equal(style.tiltInteractionEnabled, true);
    assert.equal(style.gestureHandling, 'greedy');
  });

  test(`${app}: gestures preserve zoom/rotation while live markers continue updating`, () => {
    const f = setup(app);
    f.follow({ lat: 34.001, lng: 74.001 }); f.step();
    f.div.dispatchEvent(new Event('touchstart'));
    Object.assign(f.state, { zoom: 21, heading: 230, tilt: 55, center: { lat: 34.2, lng: 74.2 } });
    for (const lat of [34.002, 34.003]) { f.follow({ lat, lng: 74.003 }); f.step(); }
    assert.equal(f.state.zoom, 21);
    assert.equal(f.state.heading, 230);
    assert.equal(f.state.tilt, 55);
    assert.equal(f.state.center.lat, 34.2);
    assert.equal(f.marker.position.lat, 34.003);
    assert.equal(f.controls[0].hidden, false);
    assert.equal(f.controls[0].attributes['aria-label'], 'Recenter map');
  });

  test(`${app}: recenter uses the latest GPS and continues following`, () => {
    const f = setup(app);
    f.follow({ lat: 34.001, lng: 74.001 }); f.step();
    f.div.dispatchEvent(new Event('wheel'));
    f.state.zoom = 22;
    f.follow({ lat: 34.004, lng: 74.004 }); f.step();
    f.controls[0].dispatchEvent(new Event('click'));
    assert.equal(f.state.zoom, 17.5);
    assert.equal(f.state.center.lat, 34.004);
    assert.equal(f.controls[0].hidden, true);
    f.follow({ lat: 34.005, lng: 74.005 }); f.step();
    assert.equal(f.state.center.lat, 34.005);
  });

  test(`${app}: rerouting/camera reset does not discard the user's manual viewport`, () => {
    const f = setup(app);
    f.div.dispatchEvent(new Event('pointerdown'));
    f.state.zoom = 22; f.state.heading = 190;
    if (app === 'customer') f.follower.clear(); else f.follower.reset();
    f.follow({ lat: 34.005, lng: 74.005 }); f.step();
    assert.equal(f.state.zoom, 22);
    assert.equal(f.state.heading, 190);
    assert.equal(f.marker.position.lat, 34.005);
  });

  test(`${app}: background bounds fitting and its delayed tilt reset respect gestures`, () => {
    const f = setup(app);
    f.fit();
    f.div.dispatchEvent(new Event('wheel'));
    f.state.zoom = 21; f.state.heading = 100; f.state.tilt = 0;
    f.idle.splice(0).forEach(callback => callback());
    f.fit();
    assert.equal(f.fits.length, 1);
    assert.equal(f.state.tilt, 0);
    assert.equal(f.state.zoom, 21);
    assert.equal(f.state.heading, 100);
    f.controls[0].dispatchEvent(new Event('click'));
    assert.equal(f.fits.length, 2);
    assert.equal(f.state.tilt, 35);
  });

  test(`${app}: keyboard/drag interactions work and recenter registrations are not duplicated`, () => {
    const f = setup(app);
    const key = new Event('keydown'); Object.defineProperty(key, 'key', { value: 'ArrowRight' });
    f.div.dispatchEvent(key);
    assert.equal(f.interaction.isMapCameraManual(f.map), true);
    f.interaction.resumeMapCamera(f.map);
    assert.equal(f.interaction.isMapCameraManual(f.map), false);
    f.listeners.get('dragstart')();
    assert.equal(f.interaction.isMapCameraManual(f.map), true);
    f.interaction.watchMapCamera(f.map);
    assert.equal(f.controls.length, 1);
  });

  test(`${app}: releasing a map removes controls and gesture listeners`, () => {
    const f = setup(app), button = f.controls[0];
    f.interaction.releaseMapCamera(f.map);
    f.div.dispatchEvent(new Event('wheel'));
    assert.equal(f.interaction.isMapCameraManual(f.map), false);
    assert.equal(f.controls.length, 0);
    assert.equal(f.listeners.size, 0);
    assert.equal(button.removed, true);
  });
}

test('driver: maps without a marker also preserve manual camera and resume to the latest GPS', () => {
  const f = setup('driver');
  f.div.dispatchEvent(new Event('wheel'));
  f.state.zoom = 22;
  f.follower.follow(f.map, { lat: 34.003, lng: 74.003 }, 90);
  assert.equal(f.state.zoom, 22);
  f.controls[0].dispatchEvent(new Event('click'));
  assert.equal(f.state.zoom, 17.5);
  assert.equal(f.state.center.lat, 34.003);
});

test('customer: private/shuttle live ride route updates use the shared manual-camera behavior', () => {
  const f = setup('customer');
  const Page = load('customer-mobile/src/app/pages/trip-active/trip-active.page.ts', {
    '../../core/customer-map': f.camera, '../../core/map-camera': f.interaction,
    '../../core/navigation-route.helper': f.navigator,
  }, f.globals).TripActivePage;
  const page = Object.create(Page.prototype);
  Object.assign(page, { map: f.map, navRoute: f.follower, selfMarker: f.marker, driverMarker: f.marker,
    selfPosition: { lat: 34.001, lng: 74.001 }, driverPosition: { lat: 34.002, lng: 74.002 },
    ensurePassengerMarker: () => {}, shouldShowRoute: () => true,
  });
  f.follower.render = async () => {};
  f.div.dispatchEvent(new Event('touchstart'));
  f.state.zoom = 22; f.state.heading = 120;
  for (const status of ['EN_ROUTE_PICKUP', 'EN_ROUTE_DROP']) {
    page.trip = { status, pickup_lat: 34.01, pickup_lng: 74.01, drop_lat: 34.02, drop_lng: 74.02 };
    page.syncRoute(); f.step();
    assert.equal(f.state.zoom, 22);
    assert.equal(f.state.heading, 120);
  }
  assert.equal(f.marker.position.lat, page.driverPosition.lat);
  f.controls[0].dispatchEvent(new Event('click'));
  assert.equal(f.state.center.lat, page.driverPosition.lat);
});

test('both apps retain identical shared interaction behavior', () => {
  assert.equal(fs.readFileSync(path.join(__dirname, '../customer-mobile/src/app/core/map-camera.ts'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../driver-mobile/src/app/core/map-camera.ts'), 'utf8'));
});
