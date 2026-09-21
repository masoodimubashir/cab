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
const PORT_IP_FILE = path.join(os.homedir(), 'android-dev', `wireless-ip-${PORT}`);
const GLOBAL_IP_FILE = path.join(os.homedir(), 'android-dev', 'wireless-ip');
const IP_FILE = fs.existsSync(PORT_IP_FILE) ? PORT_IP_FILE : GLOBAL_IP_FILE;

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

// Environment for the cap / ionic child processes. Windows machines often have
// `adb` reachable but no ANDROID_HOME set — so `adb devices` works here while
// Capacitor's own device list comes back empty ("phone attached but Capacitor
// can't see it"). If we found adb inside an SDK, hand that SDK down to the
// children via ANDROID_HOME / ANDROID_SDK_ROOT and platform-tools on PATH.
function buildChildEnv() {
  const env = { ...process.env };
  const ptDir = path.dirname(ADB);
  if (path.isAbsolute(ADB) && path.basename(ptDir).toLowerCase() === 'platform-tools') {
    const root = path.dirname(ptDir);
    env.ANDROID_HOME = root;
    env.ANDROID_SDK_ROOT = root;
    const sep = IS_WIN ? ';' : ':';
    const currentPath = env.PATH || env.Path || '';
    if (!currentPath.split(sep).includes(ptDir)) {
      // Windows environment keys are case-insensitive. Keep only one PATH
      // spelling so Node cannot pass an older Path value to the child.
      for (const key of Object.keys(env)) {
        if (IS_WIN && key.toLowerCase() === 'path') delete env[key];
      }
      env.PATH = ptDir + sep + currentPath;
    }
  }
  return env;
}

const CHILD_ENV = buildChildEnv();

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

// Print the target id Capacitor will deploy to.
let capListError = '';
function capTarget(preferred, port) {
  let out = '';
  try {
    out = execFileSync(NPX, ['cap', 'run', 'android', '--list', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: IS_WIN, // Windows needs a shell to resolve npx.cmd
      env: CHILD_ENV, // ensure Capacitor sees the same SDK/adb we found
    });
    capListError = '';
  } catch (err) {
    capListError = [err.stderr, err.stdout].filter(Boolean).map(String).join('\n').trim() || err.message;
    return '';
  }
  return resolveTargetId(out, preferred, port);
}

// Pull target id out of `cap ... --json` output.
function resolveTargetId(out, preferred, port) {
  const parse = (s) => {
    try {
      const arr = JSON.parse(s);
      if (!Array.isArray(arr) || !arr.length) return '';

      // If user passed a specific preferred IP or serial
      if (preferred) {
        const hit = arr.find((d) => d?.id && d.id.includes(preferred));
        if (hit?.id) return hit.id;
      }

      // If port is 8200 (driver) and we have multiple devices connected, pick the 2nd device
      if (port === '8200' && arr.length > 1) {
        return arr[1]?.id || arr[0]?.id || '';
      }

      // Default to 1st device
      return arr[0]?.id || '';
    } catch {
      return '';
    }
  };
  const id = parse(out.trim());
  if (id) return id;
  const start = out.indexOf('[');
  const end = out.lastIndexOf(']');
  return start !== -1 && end > start ? parse(out.slice(start, end + 1)) : '';
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
  target = capTarget(IP_ARG, PORT);
  if (target) break;
  sleep(500);
}

if (!target) {
  const currentDevices = listDevices();
  const online = currentDevices.some((d) => d.state === 'device');
  console.error(online
    ? '❌ ADB sees an authorized device, but Capacitor could not resolve a target.'
    : '❌ The phone disconnected or is no longer authorized during device detection.');
  console.error('   adb devices sees:');
  if (!currentDevices.length) console.error('     (no devices)');
  for (const d of currentDevices) console.error(`     • ${d.serial}  (${d.state})`);
  if (capListError) console.error(`   Capacitor device-list command failed:\n${capListError}`);
  console.error(`   Using SDK: ${CHILD_ENV.ANDROID_HOME || '(none — set ANDROID_HOME to your SDK)'}`);
  console.error('   USB: reconnect the phone, enable USB debugging, and accept the authorization prompt.');
  console.error('   Wireless: adb connect <ip>:5555, or run npm run go:wireless while connected by USB.');
  if (online) console.error('   Diagnose Capacitor with: npx cap run android --list --json');
  process.exit(1);
}

// --- 3. go -----------------------------------------------------------------
const devices = listDevices();
if (devices.length > 1) {
  console.log(`📱 Multiple devices detected (${devices.length}):`);
  for (const d of devices) console.log(`   ${d.serial === target ? '👉' : '  '} ${d.serial} (${d.state})`);
}
console.log(`✅ Deploying live-reload to: ${target}   (port ${PORT})`);
console.log('   Leave this terminal open — every save hot-reloads on the phone.');
console.log('   Press Ctrl+C to stop.');

const run = spawnSync(
  NPX,
  ['ionic', 'cap', 'run', 'android', '-l', '--external', `--port=${PORT}`, `--target=${target}`],
  { stdio: 'inherit', shell: IS_WIN, env: CHILD_ENV }
);
process.exit(run.status ?? 0);
