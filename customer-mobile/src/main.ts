// Suppress Chrome's "Use of the orientation sensor is deprecated" warning
// that fires from @capacitor/geolocation's web shim. The shim registers a
// `deviceorientation` listener at construction time to derive compass heading
// for desktop browsers — desktop hardware rarely provides one, and the
// warning fires every page load. Native platforms route geolocation through
// the Capacitor bridge instead of the web shim, so this patch is a no-op
// there. Must run BEFORE Angular bootstraps so it precedes any Capacitor
// import side-effect.
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

platformBrowserDynamic().bootstrapModule(AppModule)
  .catch(err => console.log(err));
