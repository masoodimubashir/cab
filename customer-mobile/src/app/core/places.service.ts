import { Injectable } from '@angular/core';
import { environment } from '../../../src/environments/environment';

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
      const cbName = '__sharedInitGoogleMaps';
      const existing = document.getElementById('shared-google-maps-script');
      if (existing) {
        const tick = () => ((window as any).google?.maps?.places ? resolve() : setTimeout(tick, 50));
        tick();
        return;
      }
      (window as any)[cbName] = () => resolve();
      const script = document.createElement('script');
      script.id = 'shared-google-maps-script';
      script.async = true;
      script.defer = true;
      script.onerror = () => reject(new Error('Failed to load Google Maps JavaScript API.'));
      // Libraries:
      //   places  → AutocompleteSuggestion / Place (replaces AutocompleteService)
      //   marker  → AdvancedMarkerElement (replaces google.maps.Marker)
      //   routes  → Route.computeRoutes (replaces DirectionsService/Renderer)
      script.src =
        `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}` +
        '&libraries=places,marker,routes' +
        '&loading=async' +
        `&callback=${cbName}`;
      document.head.appendChild(script);
    });
    return this.scriptPromise;
  }

  /**
   * Issue a fresh session token. Used to bundle an autocomplete query +
   * details fetch into a single billable session per Place selection.
   */
  private ensureSession(): void {
    if (!this.sessionToken) {
      this.sessionToken = new google.maps.places.AutocompleteSessionToken();
    }
  }

  /**
   * Autocomplete using the new AutocompleteSuggestion API (replaces the
   * deprecated AutocompleteService). Returns the same PlaceSuggestion shape
   * we already pass around so callers don't need to change.
   *
   * Requires the **Places API (New)** to be enabled in Google Cloud — the
   * legacy Places API key alone returns REQUEST_DENIED.
   */
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
      // locationBias replaces the deprecated location/radius pair. Circle
      // accepts a literal {center, radius_meters}; we keep the same 50 km
      // radius the legacy call used.
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

  /**
   * Place details via the new Place class (replaces the deprecated
   * PlacesService.getDetails). Returns the same PlaceDetail shape we already
   * pass around. Closes the autocomplete session on success — a new search
   * begins a new session.
   */
  async getPlaceDetail(placeId: string): Promise<PlaceDetail | null> {
    await this.ensureLoaded();
    this.ensureSession();

    try {
      const place = new google.maps.places.Place({ id: placeId });
      await place.fetchFields({ fields: ['id', 'formattedAddress', 'displayName', 'location'] });
      if (!place.location) return null;
      // place.location is a LatLng instance — .lat() / .lng() are functions.
      const lat = typeof place.location.lat === 'function' ? place.location.lat() : place.location.lat;
      const lng = typeof place.location.lng === 'function' ? place.location.lng() : place.location.lng;
      // Session ends on details fetch; let the next search start a fresh one.
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

  async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    await this.ensureLoaded();
    const geocoder = new google.maps.Geocoder();
    return new Promise<string | null>((resolve) => {
      geocoder.geocode({ location: { lat, lng } }, (results: any[], status: string) => {
        if (status !== 'OK' || !results?.length) return resolve(null);
        const preferred = ['street_address', 'premise', 'route', 'sublocality', 'neighborhood', 'locality'];
        for (const want of preferred) {
          const hit = results.find((r) => Array.isArray(r.types) && r.types.includes(want));
          if (hit?.formatted_address) return resolve(hit.formatted_address);
        }
        const nonPlusCode = results.find(
          (r) => Array.isArray(r.types) && !r.types.includes('plus_code') && r.formatted_address
        );
        resolve(nonPlusCode?.formatted_address || results[0]?.formatted_address || null);
      });
    });
  }
}
