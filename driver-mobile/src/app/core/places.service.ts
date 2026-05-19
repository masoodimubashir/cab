import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

declare const google: any;

export type PlaceSuggestion = {
  place_id: string;
  description: string;
  main_text: string;
  secondary_text: string;
};

export type PlaceDetail = {
  place_id: string;
  description: string;
  lat: number;
  lng: number;
};

/**
 * Google Places wrapper for the driver app. Mirrors the customer-mobile
 * PlacesService — same shape, same session-token handling — so when both
 * apps eventually share code we can drop one of them.
 *
 * Requires Places API (New) enabled on the Google Cloud project that owns
 * `environment.googleMapsApiKey`.
 */
@Injectable({ providedIn: 'root' })
export class PlacesService {
  private scriptPromise: Promise<void> | null = null;
  private sessionToken: any | null = null;

  async ensureLoaded(): Promise<void> {
    if ((window as any).google?.maps?.places) return;
    if (this.scriptPromise) return this.scriptPromise;

    const apiKey = environment.googleMapsApiKey;
    if (!apiKey) throw new Error('Missing googleMapsApiKey in environment.');

    this.scriptPromise = new Promise<void>((resolve, reject) => {
      const cbName = '__driverInitGoogleMapsPlaces';
      const existing = document.getElementById('driver-google-maps-places-script');
      if (existing) {
        const tick = () => ((window as any).google?.maps?.places ? resolve() : setTimeout(tick, 50));
        tick();
        return;
      }
      (window as any)[cbName] = () => resolve();
      const script = document.createElement('script');
      script.id = 'driver-google-maps-places-script';
      script.async = true;
      script.defer = true;
      script.onerror = () => reject(new Error('Failed to load Google Maps JavaScript API.'));
      script.src =
        `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}` +
        '&libraries=places,marker' +
        '&loading=async' +
        `&callback=${cbName}`;
      document.head.appendChild(script);
    });
    return this.scriptPromise;
  }

  private ensureSession(): void {
    if (!this.sessionToken) {
      this.sessionToken = new google.maps.places.AutocompleteSessionToken();
    }
  }

  async autocompleteSearch(query: string, near?: { lat: number; lng: number }): Promise<PlaceSuggestion[]> {
    if (!query || query.trim().length < 2) return [];
    await this.ensureLoaded();
    this.ensureSession();

    const opts: any = {
      input: query,
      sessionToken: this.sessionToken,
      includedRegionCodes: ['IN'],
    };
    if (near) {
      opts.locationBias = { center: { lat: near.lat, lng: near.lng }, radius: 50_000 };
    }

    try {
      const { suggestions } =
        await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(opts);
      return (suggestions ?? [])
        .filter((s: any) => s?.placePrediction)
        .map((s: any) => {
          const p = s.placePrediction;
          const main = p.mainText?.text ?? p.text?.text ?? '';
          const secondary = p.secondaryText?.text ?? '';
          return {
            place_id: p.placeId,
            description: p.text?.text ?? main,
            main_text: main,
            secondary_text: secondary,
          };
        });
    } catch {
      return [];
    }
  }

  async getPlaceDetail(placeId: string): Promise<PlaceDetail | null> {
    await this.ensureLoaded();
    this.ensureSession();

    try {
      const place = new google.maps.places.Place({ id: placeId });
      await place.fetchFields({ fields: ['id', 'formattedAddress', 'displayName', 'location'] });
      if (!place.location) return null;
      const lat = typeof place.location.lat === 'function' ? place.location.lat() : place.location.lat;
      const lng = typeof place.location.lng === 'function' ? place.location.lng() : place.location.lng;
      this.sessionToken = null;
      return {
        place_id: place.id ?? placeId,
        description: place.formattedAddress ?? place.displayName ?? '',
        lat,
        lng,
      };
    } catch {
      this.sessionToken = null;
      return null;
    }
  }
}
