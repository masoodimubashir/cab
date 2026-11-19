import { ApplicationRef, EnvironmentInjector } from '@angular/core';

/** Carpool test build: puts the developer hub on top of the app. */
export function mountDevHub(appRef: ApplicationRef, injector: EnvironmentInjector): void {
  void import('./dev-hub.component').then((m) => m.attachDevHub(appRef, injector));
}
