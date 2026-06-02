// Suppress Chrome's "Use of the orientation sensor is deprecated" warning
// that fires from @capacitor/geolocation's web shim. The shim attaches a
// `deviceorientation` listener at construction time to derive compass heading
// for desktop browsers — but desktop hardware rarely provides one, and the
// warning fires every page load. We silently drop registrations for those two
// event names on the window object. Native platforms route geolocation
// through the Capacitor bridge instead of the web shim, so this patch is a
// no-op there. Run BEFORE Angular bootstraps so it precedes Capacitor's
// constructor side-effects.
if (typeof window !== 'undefined') {
  const originalAdd = window.addEventListener.bind(window);
  (window as Window).addEventListener = function (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (type === 'deviceorientation' || type === 'deviceorientationabsolute') return;
    return originalAdd(type as any, listener, options);
  } as typeof window.addEventListener;
}

import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppModule } from './app/app.module';
import { environment } from './environments/environment';

// --- Dev only: auto-target the machine that served this app ----------------
// With `ionic cap run android -l --external` (live reload) the webview is
// served from the laptop's LAN IP, so `window.location.hostname` IS that IP.
// We rewrite the API + Reverb hosts to match, so the phone reaches the
// laptop's Laravel (:8000) and Reverb (:8080) with zero manual IP editing.
// Skipped for production builds (real server) and for plain localhost browser
// dev (already correct).
if (!environment.production && typeof window !== 'undefined') {
  const host = window.location.hostname;
  if (host && host !== 'localhost' && host !== '127.0.0.1') {
    environment.apiUrl = `http://${host}:8000/api`;
    environment.reverbHost = host;
  }
}

platformBrowserDynamic().bootstrapModule(AppModule)
  .catch(err => console.log(err));
