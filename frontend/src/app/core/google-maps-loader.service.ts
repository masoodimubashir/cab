import { Injectable } from '@angular/core';

const API_KEY = 'AIzaSyDlGsZl3dalGOAKXG5nspcI5fduHQjk3-Q';
const SCRIPT_ID = 'shared-google-maps-script';
const CALLBACK_NAME = '__sharedInitGoogleMaps';

/**
 * Loads the Google Maps JS API once per page (drawing + places libraries),
 * shared across the admin map components. Idempotent.
 */
@Injectable({ providedIn: 'root' })
export class GoogleMapsLoaderService {
  private loadPromise: Promise<typeof google> | null = null;

  load(): Promise<typeof google> {
    const w = window as any;
    if (w.google?.maps?.drawing) {
      return Promise.resolve(w.google);
    }
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = new Promise<typeof google>((resolve, reject) => {
      const existing = document.getElementById(SCRIPT_ID);
      const onReady = () => {
        if (w.google?.maps?.drawing) {
          resolve(w.google);
        } else {
          // Library may still be loading even if the base script is present.
          const tick = () => (w.google?.maps?.drawing ? resolve(w.google) : setTimeout(tick, 50));
          tick();
        }
      };

      if (existing) {
        onReady();
        return;
      }

      w[CALLBACK_NAME] = () => onReady();

      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.async = true;
      script.defer = true;
      script.onerror = () => reject(new Error('Failed to load Google Maps JS API.'));
      script.src =
        `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(API_KEY)}` +
        '&libraries=drawing,places' +
        '&loading=async' +
        `&callback=${CALLBACK_NAME}`;
      document.head.appendChild(script);
    });

    return this.loadPromise;
  }
}
