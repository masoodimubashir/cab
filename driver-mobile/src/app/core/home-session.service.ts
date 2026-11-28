import { Injectable } from '@angular/core';
import { AuthService } from './auth.service';

/** In-memory launch state: survives page recreation, resets after a cold start. */
@Injectable({ providedIn: 'root' })
export class HomeSessionService {
  locationLoaderShown = false;
  selectedRequestId: number | null = null;
  readonly handledRequests = new Set<number>();
  constructor(auth: AuthService) {
    auth.registerSessionCleanup(() => {
      this.handledRequests.clear();
      this.selectedRequestId = null;
    });
  }
  readonly dismissedOffers = new Set<string>();
}
