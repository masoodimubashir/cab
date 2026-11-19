import { ApplicationRef, EnvironmentInjector } from '@angular/core';

/**
 * Normal builds: the developer hub does not exist. The carpool test build swaps this file for
 * dev-hub.entry.carpooltest.ts (see the `carpooltest` configuration in angular.json).
 */
export function mountDevHub(_appRef: ApplicationRef, _injector: EnvironmentInjector): void {
  // nothing
}
