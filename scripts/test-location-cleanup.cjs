const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('../customer-mobile/node_modules/typescript');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(setImmediate);

function fixture(app) {
  const cache = new Map();
  const storage = new Map();
  const alerts = [];
  const native = { addWatcher: async () => 'native-1', removeWatcher: async () => {} };
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const filename = path.join(__dirname, '..', app, 'src/app/core', name + '.ts');
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
    }).outputText;
    const exports = {};
    cache.set(name, exports);
    vm.runInNewContext(code, {
      exports, console, setTimeout: callback => setImmediate(callback),
      localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
      require: module => {
        if (module === '@angular/core') return { Injectable: () => value => value };
        if (module === '@capacitor/core') return { Capacitor: { isNativePlatform: () => true }, registerPlugin: () => native };
        if (module === './location-watcher-registry') return load('location-watcher-registry');
        if (module.includes('environment')) return { environment: {} };
        return {};
      },
    }, { filename });
    return exports;
  }
  const registry = load('location-watcher-registry').locationWatchers;
  const Auth = load('auth.service').AuthService;
  const auth = new Auth({ create: async options => { alerts.push(options); return { present: async () => {} }; } });
  auth.setSession('session', { id: 1, name: 'Test' });
  return { registry, auth, alerts, native, load };
}

for (const app of ['customer-mobile', 'driver-mobile']) {
  test(app + ': logout immediately clears credentials but waits and retries native removal', async () => {
    const { registry, auth, alerts } = fixture(app);
    let attempts = 0;
    const released = deferred();
    await registry.add('native', async () => 'one', async () => { if (++attempts <= 3) throw Error('platform failure'); await released.promise; });
    let finished = false;
    const logout = auth.logout().then(() => { finished = true; });
    assert.equal(auth.getToken(), null);
    for (let i = 0; i < 10; i++) await tick();
    assert.equal(finished, false);
    assert.equal(attempts, 4);
    assert.equal(alerts.length, 1);
    released.resolve(); await logout;
    assert.equal(finished, true);
    await registry.stopAll(); assert.equal(attempts, 4);
  });
  test(app + ': logout drains watchers whose creation is still pending', async () => {
    const { registry, auth } = fixture(app);
    const created = deferred(); let removed;
    const start = registry.add('native', () => created.promise, async id => { removed = id; });
    let finished = false;
    const logout = auth.logout().then(() => { finished = true; });
    await tick(); assert.equal(finished, false);
    created.resolve('late-handle'); await start; await logout;
    assert.equal(removed, 'late-handle');
  });
  test(app + ': concurrent stops share removal and failed creation does not block logout', async () => {
    const { registry, auth } = fixture(app);
    let calls = 0; const release = deferred();
    await registry.add('native', async () => 'same', async () => { calls++; await release.promise; });
    const first = registry.remove('native', 'same');
    const logout = auth.logout();
    assert.equal(auth.logout(), logout);
    await tick(); assert.equal(calls, 1);
    release.resolve(); await Promise.all([first, logout]);
    await assert.rejects(registry.add('native', async () => { throw Error('start failed'); }, async () => {}));
    await registry.stopAll();
  });
  test(app + ': a failing cleanup callback retries without preventing other cleanup', async () => {
    const { auth } = fixture(app); let attempts = 0; let other = false;
    auth.registerSessionCleanup(() => { if (++attempts < 3) throw Error('temporary'); });
    auth.registerSessionCleanup(() => { other = true; });
    await auth.logout(); assert.equal(attempts, 3); assert.equal(other, true);
  });
}

test('driver trip tracking: late native creation is removed on logout and callbacks stop posting', async () => {
  const { native, auth, load } = fixture('driver-mobile');
  const created = deferred(); let callback; let attempts = 0; let posts = 0;
  native.addWatcher = async (_, cb) => { callback = cb; return created.promise; };
  native.removeWatcher = async () => { if (++attempts < 3) throw Error('busy'); };
  const Service = load('background-location.service').BackgroundLocationService;
  const service = new Service({ post: () => { posts++; return { subscribe() {} }; } }, {}, auth, { ensure: async () => true });
  const starting = service.start(123); await tick();
  const logout = auth.logout();
  callback({ latitude: 1, longitude: 2 }, null);
  created.resolve('late-trip');
  await Promise.all([starting, logout]);
  assert.equal(attempts, 3); assert.equal(posts, 0); assert.equal(service.isStreaming(), false);
});

test('driver presence: a restart already stopping the old watcher cannot revive tracking after logout', async () => {
  const { native, auth, load } = fixture('driver-mobile');
  let adds = 0; let callback; const removed = deferred(); let attempts = 0;
  native.addWatcher = async (_, cb) => { adds++; callback = cb; return 'presence'; };
  native.removeWatcher = async () => { if (++attempts === 1) throw Error('busy'); await removed.promise; };
  const Service = load('driver-presence.service').DriverPresenceService;
  const service = new Service({ post: () => ({ subscribe() {} }) }, {
    requestPermissions: async () => {}, getCurrentPosition: async () => null,
  }, auth, { ensure: async () => true });
  await service.start();
  const restart = service.restartWatcher();
  const logout = auth.logout();
  callback(null, { code: 2 });
  removed.resolve(); await Promise.all([restart, logout]);
  assert.equal(adds, 1); assert.equal(attempts, 2); assert.equal(service.isStreaming(), false);
});
