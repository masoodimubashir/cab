import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

declare const google: any;

/**
 * Minimal Google Maps JS loader for the driver app — only the JS API + geometry.
 * No Places (drivers don't autocomplete addresses inside the app today). The
 * customer-mobile app has a richer PlacesService; if/when the driver needs
 * search-as-you-type, mirror that here.
 */
@Injectable({ providedIn: 'root' })
export class MapsLoaderService {
  private scriptPromise: Promise<void> | null = null;

  ensureLoaded(): Promise<void> {
    if ((window as any).google?.maps) return Promise.resolve();
    if (this.scriptPromise) return this.scriptPromise;

    const apiKey = environment.googleMapsApiKey;
    if (!apiKey) return Promise.reject(new Error('Missing googleMapsApiKey in environment.'));

    this.scriptPromise = new Promise<void>((resolve, reject) => {
      const cbName = '__driverInitGoogleMaps';
      const existing = document.getElementById('driver-google-maps-script');
      if (existing) {
        const tick = () => ((window as any).google?.maps ? resolve() : setTimeout(tick, 50));
        tick();
        return;
      }
      (window as any)[cbName] = () => resolve();
      const script = document.createElement('script');
      script.id = 'driver-google-maps-script';
      script.async = true;
      script.defer = true;
      script.onerror = () => reject(new Error('Failed to load Google Maps JavaScript API.'));
      script.src =
        `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}` +
        '&loading=async' +
        `&callback=${cbName}`;
      document.head.appendChild(script);
    });
    return this.scriptPromise;
  }
}
