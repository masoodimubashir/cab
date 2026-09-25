#!/usr/bin/env node
// Cross-platform (Windows / macOS / Linux) version of go-wireless.sh.
//
// One-time-per-session helper: flip the USB-connected phone to wireless adb and
// remember its IP, so `npm run dev:device` can auto-reconnect over Wi-Fi from
// then on (no cable, no typing the IP).
//
// Run it ONCE with the phone plugged in via USB:
//     npm run go:wireless          (from inside customer-mobile / driver-mobile)
// Then you can unplug the cable and just use  npm run dev:device.
//
// Requirements: phone on the SAME Wi-Fi as the laptop, USB debugging allowed,
// and `adb` reachable (on PATH, or via ANDROID_HOME / a standard SDK location).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2).join(' ').toLowerCase();
const isDriver = process.cwd().toLowerCase().includes('driver') || args.includes('driver') || args.includes('8200');
const PORT = isDriver ? '8200' : '8100';
const appName = isDriver ? 'Driver App' : 'Customer App';
const PORT_IP_FILE = path.join(os.homedir(), 'android-dev', `wireless-ip-${PORT}`);
const GLOBAL_IP_FILE = path.join(os.homedir(), 'android-dev', 'wireless-ip');

// Synchronous sleep so the script reads top-to-bottom like the bash original.
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// --- locate adb ------------------------------------------------------------
// Prefer an explicit SDK (ANDROID_HOME / ANDROID_SDK_ROOT), then the OS's
// default SDK location, then fall back to whatever `adb` is on PATH.
function findAdb() {
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const home = os.homedir();
  const roots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean);

  if (process.platform === 'win32') {
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

// Run adb and return trimmed stdout. With allowFail, swallow non-zero exits and
// return whatever came out (used for `adb connect`, which is chatty on retry).
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

const isWireless = (serial) => serial.endsWith(':5555');

// --- 1. find a USB-connected, authorized device ----------------------------
const usb = listDevices().find((d) => d.state === 'device' && !isWireless(d.serial));
if (!usb) {
  console.error("❌ No USB phone found. Plug the phone in via USB and accept the");
  console.error("   'Allow USB debugging?' prompt, then run this again.");
  console.error('   (Check with: adb devices — you want a plain serial in state \'device\'.)');
  process.exit(1);
}

// --- 2. discover the phone's Wi-Fi IP from the device itself ----------------
function phoneWifiIp(serial) {
  const addr = adb(['-s', serial, 'shell', 'ip', '-f', 'inet', 'addr', 'show', 'wlan0'], {
    allowFail: true,
  });
  let m = addr.match(/inet (\d+\.\d+\.\d+\.\d+)\//);
  if (m) return m[1];

  const route = adb(['-s', serial, 'shell', 'ip', 'route'], { allowFail: true });
  m = route.match(/src (\d+\.\d+\.\d+\.\d+)/);
  return m ? m[1] : '';
}

const ip = phoneWifiIp(usb.serial);
if (!ip) {
  console.error("❌ Couldn't read the phone's Wi-Fi IP. Make sure Wi-Fi is ON and the");
  console.error('   phone is on the same network, then run this again.');
  process.exit(1);
}

// --- 3. switch to TCP/IP, connect, and remember the IP ---------------------
console.log(`📶 Phone Wi-Fi IP: ${ip}`);
console.log('   Switching adb to TCP/IP mode on port 5555 ...');
adb(['-s', usb.serial, 'tcpip', '5555'], { allowFail: true });
sleep(1000);

console.log('   Connecting over Wi-Fi ...');
fs.mkdirSync(path.dirname(PORT_IP_FILE), { recursive: true });
fs.writeFileSync(PORT_IP_FILE, ip);
if (PORT === '8100') {
  fs.writeFileSync(GLOBAL_IP_FILE, ip);
}

// Some phones are slow to bring the Wi-Fi adb link up — poll for a few seconds
// instead of giving up after one check.
let ok = false;
for (let i = 0; i < 10; i++) {
  adb(['connect', `${ip}:5555`], { allowFail: true });
  if (listDevices().some((d) => d.serial === `${ip}:5555` && d.state === 'device')) {
    ok = true;
    break;
  }
  sleep(1000);
}

if (ok) {
  console.log(`✅ Wireless ready and remembered for ${appName} (${ip}:5555).`);
  console.log('   You can unplug the USB cable now.');
  console.log(`   From now on just run:  npm run dev:device  (inside ${isDriver ? 'driver-mobile' : 'customer-mobile'})`);
} else {
  console.log("⚠️  Sent the connect command but the wireless device didn't come up.");
  console.log(`   IP is remembered for ${appName} — keep USB plugged for now, or retry:  adb connect ${ip}:5555`);
}
