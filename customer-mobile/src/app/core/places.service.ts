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
  private autocomplete: any | null = null;
  private placesService: any | null = null;
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
      script.src =
        `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}` +
        '&libraries=places' +
        '&loading=async' +
        `&callback=${cbName}`;
      document.head.appendChild(script);
    });
    return this.scriptPromise;
  }

  private ensureSession(): void {
    if (!this.autocomplete) {
      this.autocomplete = new google.maps.places.AutocompleteService();
    }
    if (!this.placesService) {
      const div = document.createElement('div');
      this.placesService = new google.maps.places.PlacesService(div);
    }
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
      componentRestrictions: { country: 'IN' },
    };
    if (near) {
      opts.location = new google.maps.LatLng(near.lat, near.lng);
      opts.radius = 50_000;
    }

    return new Promise<PlaceSuggestion[]>((resolve) => {
      this.autocomplete.getPlacePredictions(opts, (preds: any[]) => {
        if (!preds) return resolve([]);
        resolve(
          preds.map((p) => ({
            place_id: p.place_id,
            description: p.description,
            main_text: p.structured_formatting?.main_text || p.description,
            secondary_text: p.structured_formatting?.secondary_text || '',
          }))
        );
      });
    });
  }

  async getPlaceDetail(placeId: string): Promise<PlaceDetail | null> {
    await this.ensureLoaded();
    this.ensureSession();

    return new Promise<PlaceDetail | null>((resolve) => {
      this.placesService.getDetails(
        {
          placeId,
          sessionToken: this.sessionToken,
          fields: ['place_id', 'formatted_address', 'name', 'geometry'],
        },
        (place: any, status: string) => {
          this.sessionToken = null;
          if (status !== 'OK' || !place?.geometry?.location) return resolve(null);
          resolve({
            place_id: place.place_id,
            description: place.formatted_address || place.name,
            lat: place.geometry.location.lat(),
            lng: place.geometry.location.lng(),
          });
        }
      );
    });
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
