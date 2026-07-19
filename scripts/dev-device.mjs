#!/usr/bin/env node
// Cross-platform (Windows / macOS / Linux) version of dev-device.sh.
//
// Launch Capacitor live-reload (hot reload) onto the connected phone — USB OR
// wireless, with zero fuss:
//   • Finds `adb` on PATH / via ANDROID_HOME / a standard SDK location.
//   • If nothing is connected, auto-reconnects to the last wireless phone we
//     remembered (see go-wireless.mjs) and waits a few seconds for it to come up
//     — so a dropped Wi-Fi link heals itself instead of erroring out.
//   • Reads the --target id from the SAME list Ionic validates against
//     (`cap run android --list --json`), so it can never pass a stale id that
//     Ionic rejects with "<id> is not a valid Target ID."
//
// Usage:  node ../scripts/dev-device.mjs <port> [phone-ip]
//         <port>      dev-server port (8100 customer / 8200 driver)
//         [phone-ip]  optional: connect this wireless IP first (also remembered)

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = process.argv[2] || '8100';
const IP_ARG = process.argv[3] || '';
const IP_FILE = path.join(os.homedir(), 'android-dev', 'wireless-ip'); // remembers the last wireless phone

const IS_WIN = process.platform === 'win32';
const NPX = IS_WIN ? 'npx.cmd' : 'npx';

// Synchronous sleep so the script reads top-to-bottom like the bash original.
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// --- locate adb ------------------------------------------------------------
// Prefer an explicit SDK (ANDROID_HOME / ANDROID_SDK_ROOT), then the OS's
// default SDK location, then fall back to whatever `adb` is on PATH.
function findAdb() {
  const exe = IS_WIN ? 'adb.exe' : 'adb';
  const home = os.homedir();
  const roots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean);

  if (IS_WIN) {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    roots.push(path.join(localAppData, 'Android', 'Sdk'));
  } else if (process.platform === 'darwin') {
    roots.push(path.join(home, 'Library', 'Android', 'sdk'));
  } else {
    roots.push(path.join(home, 'Android', 'Sdk'), path.join(home, 'Android', 'sdk'));
  }

  for (const root of roots) {
    const candidate = path.join(root, 'platform-tools', exe);
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'adb'; // resolved via PATH (works for adb.exe on Windows too)
}

const ADB = findAdb();

// Run adb and return trimmed stdout. With allowFail, swallow non-zero exits.
function adb(args, { allowFail = false } = {}) {
  try {
    return execFileSync(ADB, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    if (allowFail) return (err.stdout || '').toString().trim();
    if (err.code === 'ENOENT') {
      console.error("❌ Couldn't find `adb`. Install the Android platform-tools and either");
      console.error('   add them to PATH or set ANDROID_HOME to your SDK folder, then retry.');
      process.exit(1);
    }
    throw err;
  }
}

// Parse `adb devices` into [{ serial, state }].
function listDevices() {
  return adb(['devices'])
    .split(/\r?\n/)
    .slice(1) // drop the "List of devices attached" header
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 2)
    .map(([serial, state]) => ({ serial, state }));
}

// Is any adb device in state "device" (authorized & online)?
const haveDevice = () => listDevices().some((d) => d.state === 'device');

// Print the id of the first device Capacitor sees (the list Ionic validates
// against). Empty if none / not ready yet.
function capTarget() {
  let out = '';
  try {
    out = execFileSync(NPX, ['cap', 'run', 'android', '--list', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: IS_WIN, // Windows needs a shell to resolve npx.cmd
    });
  } catch {
    return '';
  }
  try {
    const arr = JSON.parse(out);
    const first = Array.isArray(arr) ? arr[0] : null;
    return first && first.id ? first.id : '';
  } catch {
    return '';
  }
}

// --- 1. make sure a phone is attached --------------------------------------
// Try a wireless (re)connect when nothing is attached: prefer an explicit IP
// arg, else the IP we remembered from a previous `go:wireless`.
if (!haveDevice()) {
  let ip = IP_ARG;
  if (!ip && fs.existsSync(IP_FILE)) ip = fs.readFileSync(IP_FILE, 'utf8').trim();
  if (ip) {
    console.log(`🔌 No device attached — trying wireless reconnect to ${ip}:5555 ...`);
    adb(['connect', `${ip}:5555`], { allowFail: true });
    if (IP_ARG) {
      fs.mkdirSync(path.dirname(IP_FILE), { recursive: true });
      fs.writeFileSync(IP_FILE, IP_ARG); // remember a freshly given IP
    }
  }
}

// Wait up to ~10s for a device to come online (handles a slow/flaky reconnect).
for (let i = 0; i < 20; i++) {
  if (haveDevice()) break;
  sleep(500);
}

if (!haveDevice()) {
  console.error('❌ No authorized device found.');
  console.error("   • USB:      plug in the phone and accept 'Allow USB debugging'.");
  console.error('   • Wireless: run  npm run go:wireless  once (while on USB) to set it up,');
  console.error('               then this command auto-reconnects every time.');
  console.error("   Check with:  adb devices   (state must be 'device')");
  process.exit(1);
}

// Remember the wireless phone's IP so next time we auto-reconnect.
const wireless = listDevices().find((d) => d.state === 'device' && d.serial.endsWith(':5555'));
if (wireless) {
  fs.mkdirSync(path.dirname(IP_FILE), { recursive: true });
  fs.writeFileSync(IP_FILE, wireless.serial.replace(/:5555$/, ''));
}

// --- 2. resolve the target id Ionic will accept ----------------------------
// cap's list can lag adb by a moment after a reconnect — retry briefly.
let target = '';
for (let i = 0; i < 10; i++) {
  target = capTarget();
  if (target) break;
  sleep(500);
}

if (!target) {
  console.error("❌ Phone is attached but Capacitor can't see it yet. Re-run the command,");
  console.error('   or unplug/replug (USB) / re-run  adb connect <ip>:5555  (wireless).');
  process.exit(1);
}

// --- 3. go -----------------------------------------------------------------
console.log(`✅ Deploying live-reload to: ${target}   (port ${PORT})`);
console.log('   Leave this terminal open — every save hot-reloads on the phone.');
console.log('   Press Ctrl+C to stop.');

const run = spawnSync(
  NPX,
  ['ionic', 'cap', 'run', 'android', '-l', '--external', `--port=${PORT}`, `--target=${target}`],
  { stdio: 'inherit', shell: IS_WIN }
);
process.exit(run.status ?? 0);
