#!/usr/bin/env node
// Cross-platform (Windows / macOS / Linux) version of dev-device.sh.
//
// Launch Capacitor live-reload (hot reload) onto connected phone(s) — USB or Wi-Fi:
//   • Dual-phone isolation: Customer App (8100) binds to Phone 1,
//     Driver App (8200) binds to Phone 2.
//   • Auto-conflict avoidance: if both apps point to the same device, the second
//     app automatically picks the alternate connected phone.
//   • Auto-reconnect: if either remembered wireless phone dropped, attempts Wi-Fi reconnect.
//   • Interactive selection: pass `--select` to pick from all connected phones.
//   • Manual override: pass an IP or serial: `npm run dev:device -- 192.168.29.166`
//
// Usage:  node ../scripts/dev-device.mjs <port> [phone-ip-or-serial | --select]

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const PORT = (process.argv[2] || '8100').trim();
const isDriver = PORT === '8200' || process.cwd().toLowerCase().includes('driver');
const otherPort = isDriver ? '8100' : '8200';
const appName = isDriver ? 'Driver App' : 'Customer App';
const otherAppName = isDriver ? 'Customer App' : 'Driver App';

// Parse optional trailing argument (IP, serial, or flags)
const trailingArgs = process.argv.slice(3);
const WANT_SELECT = trailingArgs.some((a) => a === '--select' || a === '-s' || a === '--choose');
const IS_DRY_RUN = trailingArgs.some((a) => a === '--dry-run');
const CLI_TARGET = (trailingArgs.find((a) => a && !a.startsWith('-')) || '').trim();

const DEV_DIR = path.join(os.homedir(), 'android-dev');
const PORT_IP_FILE = path.join(DEV_DIR, `wireless-ip-${PORT}`);
const OTHER_PORT_IP_FILE = path.join(DEV_DIR, `wireless-ip-${otherPort}`);

const IS_WIN = process.platform === 'win32';
const NPX = IS_WIN ? 'npx.cmd' : 'npx';

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// --- locate adb ------------------------------------------------------------
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
  return 'adb';
}

const ADB = findAdb();

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
      for (const key of Object.keys(env)) {
        if (IS_WIN && key.toLowerCase() === 'path') delete env[key];
      }
      env.PATH = ptDir + sep + currentPath;
    }
  }
  return env;
}

const CHILD_ENV = buildChildEnv();

function adb(args, { allowFail = false } = {}) {
  try {
    return execFileSync(ADB, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    if (allowFail) return (err.stdout || '').toString().trim();
    if (err.code === 'ENOENT') {
      console.error("❌ Couldn't find `adb`. Install Android platform-tools and set ANDROID_HOME.");
      process.exit(1);
    }
    throw err;
  }
}

// Parse `adb devices -l` into [{ serial, state, model, raw }]
function listDevices() {
  const out = adb(['devices', '-l'], { allowFail: true });
  return out
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      const serial = parts[0] || '';
      const state = parts[1] || '';
      const modelMatch = line.match(/model:(\S+)/);
      const model = modelMatch ? modelMatch[1].replace(/_/g, ' ') : '';
      return { serial, state, model, raw: line };
    })
    .filter((d) => d.serial && d.state);
}

function readSaved(filePath) {
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8').trim();
  } catch {}
  return '';
}

function savePref(filePath, val) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, val);
  } catch {}
}

function normalizeConnectHost(target) {
  if (!target) return '';
  const clean = target.trim();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(clean)) return `${clean}:5555`;
  return clean;
}

// Fetch list of targets from Capacitor
function getCapacitorTargets() {
  try {
    const out = execFileSync(NPX, ['cap', 'run', 'android', '--list', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: IS_WIN,
      env: CHILD_ENV,
    });
    const parsed = JSON.parse(out.trim());
    if (Array.isArray(parsed)) return parsed;
    const start = out.indexOf('[');
    const end = out.lastIndexOf(']');
    if (start !== -1 && end > start) return JSON.parse(out.slice(start, end + 1));
  } catch {}
  return [];
}

async function promptSelection(devices, app) {
  console.log(`\n📱 Multiple devices available. Choose phone for ${app}:`);
  devices.forEach((d, i) => {
    console.log(`   [${i + 1}] ${d.serial} ${d.model ? `(${d.model})` : ''} [${d.state}]`);
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`\nEnter number (1-${devices.length}, default 1): `, (ans) => {
      rl.close();
      const n = parseInt(ans.trim(), 10);
      if (!isNaN(n) && n >= 1 && n <= devices.length) {
        resolve(devices[n - 1]);
      } else {
        resolve(devices[0]);
      }
    });
  });
}

// --- Main Flow -------------------------------------------------------------
async function main() {
  // If user passed an explicit target via CLI
  if (CLI_TARGET) {
    savePref(PORT_IP_FILE, CLI_TARGET);
  }

  const mySaved = readSaved(PORT_IP_FILE);
  const otherSaved = readSaved(OTHER_PORT_IP_FILE);

  // Attempt auto-reconnection for known wireless targets
  for (const s of [CLI_TARGET, mySaved, otherSaved].filter(Boolean)) {
    if (s.includes('.') && !listDevices().some((d) => d.state === 'device' && d.serial.includes(s))) {
      const host = normalizeConnectHost(s);
      adb(['connect', host], { allowFail: true });
    }
  }

  // Allow up to ~5 seconds for wireless links to appear
  for (let i = 0; i < 10; i++) {
    if (listDevices().some((d) => d.state === 'device')) break;
    sleep(500);
  }

  const onlineDevices = listDevices().filter((d) => d.state === 'device');

  if (!onlineDevices.length) {
    console.error(`\n❌ No online Android devices found for ${appName} (port ${PORT}).`);
    console.error('   • Connect your phone via USB or Wi-Fi.');
    console.error('   • If using Wi-Fi:  adb connect <phone-ip>:5555');
    console.error('   • Or run:  npm run dev:device -- <phone-ip>');
    console.error('   • Check status with:  adb devices\n');
    process.exit(1);
  }

  let chosen = null;

  let isFallbackSingleDevice = false;

  // 1. Interactive choice if requested
  if (WANT_SELECT && onlineDevices.length > 1 && process.stdin.isTTY) {
    chosen = await promptSelection(onlineDevices, appName);
  }
  // 2. Explicit CLI target
  else if (CLI_TARGET) {
    chosen = onlineDevices.find((d) => d.serial.includes(CLI_TARGET)) || { serial: CLI_TARGET, model: '' };
  }
  // 3. Exactly 1 device online
  else if (onlineDevices.length === 1) {
    chosen = onlineDevices[0];
    if (otherSaved && chosen.serial.includes(otherSaved) && mySaved && !chosen.serial.includes(mySaved)) {
      isFallbackSingleDevice = true;
      console.log(`\n⚠️  Notice: Only 1 phone online (${chosen.serial}).`);
      console.log(`   It was last saved for ${otherAppName}, but using it temporarily for ${appName}.`);
      console.log(`   To run both apps simultaneously, connect your second phone!\n`);
    }
  }
  // 4. Two or more devices online -> intelligent separation
  else {
    const myMatch = mySaved ? onlineDevices.find((d) => d.serial.includes(mySaved)) : null;
    const otherMatch = otherSaved ? onlineDevices.find((d) => d.serial.includes(otherSaved)) : null;

    if (myMatch && (!otherMatch || myMatch.serial !== otherMatch.serial)) {
      chosen = myMatch;
    } else if (myMatch && otherMatch && myMatch.serial === otherMatch.serial) {
      // Conflict: both apps saved the exact same phone
      if (isDriver) {
        // Driver App yields and takes the other online phone
        chosen = onlineDevices.find((d) => d.serial !== myMatch.serial) || onlineDevices[1];
        console.log(`\n🔄 Conflict avoided: Both apps were set to ${myMatch.serial}.`);
        console.log(`   Auto-assigning ${appName} to alternate phone: ${chosen.serial} (${chosen.model})\n`);
      } else {
        chosen = myMatch;
      }
    } else {
      // No saved device or saved device offline: pick one not used by other app
      const available = onlineDevices.find((d) => otherSaved ? !d.serial.includes(otherSaved) : true);
      chosen = available || (isDriver ? onlineDevices[1] : onlineDevices[0]);
    }
  }

  // Persist the choice for this port (unless temporarily falling back to the only available phone)
  if (!isFallbackSingleDevice) {
    savePref(PORT_IP_FILE, chosen.serial);
  }

  // Match target against Capacitor CLI list
  let targetId = chosen.serial;
  let capTargets = [];
  for (let i = 0; i < 6; i++) {
    capTargets = getCapacitorTargets();
    const hit = capTargets.find(
      (c) => c.id === chosen.serial || chosen.serial.includes(c.id) || c.id.includes(chosen.serial)
    );
    if (hit?.id) {
      targetId = hit.id;
      break;
    }
    sleep(500);
  }

  // Print Clean Dashboard
  console.log('\n' + '='.repeat(66));
  console.log(`🚀 DreamCabs Mobile Live-Reload Launcher`);
  console.log('-'.repeat(66));
  console.log(`📱 Current App : ${appName} (dev-server port ${PORT})`);
  console.log(`🎯 Target Phone: ${targetId} ${chosen.model ? `(${chosen.model})` : ''}`);

  if (onlineDevices.length > 1) {
    const alternate = onlineDevices.find((d) => d.serial !== chosen.serial);
    if (alternate) {
      console.log(`📱 Other Phone : ${alternate.serial} ${alternate.model ? `(${alternate.model})` : ''} <= Reserved for ${otherAppName}`);
    }
  } else {
    console.log(`💡 Tip: Connect a 2nd phone to run ${otherAppName} at the same time.`);
  }

  console.log('-'.repeat(66));
  console.log(`⚡ Deploying live-reload to ${targetId}...`);
  console.log(`   Leave this terminal running — changes will hot-reload on device.`);
  console.log(`   Press Ctrl+C to stop.`);
  console.log('='.repeat(66) + '\n');

  if (IS_DRY_RUN) {
    console.log('🏁 [Dry Run] Device allocation and target verification successful.');
    process.exit(0);
  }

  // Spawn Ionic live-reload onto the targeted phone
  const run = spawnSync(
    NPX,
    ['ionic', 'cap', 'run', 'android', '-l', '--external', `--port=${PORT}`, `--target=${targetId}`],
    { stdio: 'inherit', shell: IS_WIN, env: CHILD_ENV }
  );

  process.exit(run.status ?? 0);
}

main().catch((err) => {
  console.error('Fatal launcher error:', err);
  process.exit(1);
});
