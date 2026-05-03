import { Component, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { IonInput } from '@ionic/angular';
import {
  googleMapsDirectionsUrl,
  openExternalUrl,
  type MapCoords,
} from '../../core/maps-navigation';
import { environment } from '../../../environments/environment';

declare const google: any;

type City = { id: number; name: string; country_code: string };
type RideType = { id: number; name: string; description?: string | null };

type EstimateResponse = {
  currency?: string;
  distance_km?: number;
  time_min?: number;
  estimated_fare?: number;
  commission_percent?: number;
};

@Component({
  selector: 'app-customer-book',
  templateUrl: './customer-book.page.html',
  styleUrls: ['./customer-book.page.scss'],
  standalone: false,
})
export class CustomerBookPage {
  loading = false;
  cities: City[] = [];
  rideTypes: RideType[] = [];

  useMyCurrentLocation = true;

  mapClickTarget: 'pickup' | 'drop' = 'pickup';
  googleMapsReady = false;
  mapsLoadError: string | null = null;

  @ViewChild('pickupAddrIonInput', { read: IonInput })
  private pickupAddrIonInput!: IonInput;

  @ViewChild('dropAddrIonInput', { read: IonInput })
  private dropAddrIonInput!: IonInput;

  private map: any | null = null;
  private pickupMarker: any | null = null;
  private dropMarker: any | null = null;
  private pickupAutocomplete: any | null = null;
  private dropAutocomplete: any | null = null;
  private geocoder: any | null = null;
  private mapsScriptPromise: Promise<void> | null = null;
  private mapInitialized = false;

  cityId: number | null = null;
  rideTypeId: number | null = null;

  pickupAddress = '';
  dropAddress = '';

  pickupLat: number | null = null;
  pickupLng: number | null = null;
  dropLat: number | null = null;
  dropLng: number | null = null;

  estimate: EstimateResponse | null = null;
  error: string | null = null;
  message: string | null = null;

  constructor(
    private api: ApiService,
    private router: Router
  ) {}

  ionViewWillEnter(): void {
    // Load lookup data every time we enter (simple + predictable while developing).
    this.loadLookups();
  }

  ionViewDidEnter(): void {
    void this.initGoogleMapsOnce();
  }

  private async loadGoogleMapsApi(): Promise<void> {
    if ((window as any).google?.maps) return;

    const apiKey = environment.googleMapsApiKey;
    if (!apiKey) {
      throw new Error('Google Maps API key is missing. Set `googleMapsApiKey` in environment.ts.');
    }

    if (this.mapsScriptPromise) return this.mapsScriptPromise;

    this.mapsScriptPromise = new Promise<void>((resolve, reject) => {
      const cbName = '__customerMobileInitGoogleMaps';

      (window as any)[cbName] = () => resolve();

      const existing = document.getElementById('customer-mobile-google-maps-script');
      if (existing) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.id = 'customer-mobile-google-maps-script';
      script.async = true;
      script.defer = true;
      script.onerror = () => reject(new Error('Failed to load Google Maps JavaScript API.'));
      script.src =
        `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}` +
        '&libraries=places' +
        `&callback=${cbName}`;

      document.head.appendChild(script);
    });

    return this.mapsScriptPromise;
  }

  private async initGoogleMapsOnce(): Promise<void> {
    if (this.mapInitialized) return;
    this.mapInitialized = true;

    if (!environment.googleMapsApiKey) {
      this.mapsLoadError = 'Google Maps not configured (set `googleMapsApiKey`).';
      this.googleMapsReady = false;
      return;
    }

    try {
      await this.loadGoogleMapsApi();
      const mapDiv = document.getElementById('booking-map');
      if (!mapDiv) throw new Error('Missing map container element.');

      const center =
        this.pickupCoords() ??
        this.dropCoords() ?? {
          lat: 12.9716,
          lng: 77.5946,
        };

      this.map = new google.maps.Map(mapDiv, {
        center,
        zoom: 13,
        clickable: true,
      });

      this.geocoder = new google.maps.Geocoder();

      this.map.addListener('click', (e: any) => {
        const lat = e?.latLng?.lat?.();
        const lng = e?.latLng?.lng?.();
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        void this.setCoordsFromMapClick(lat, lng);
      });

      // Autocomplete wiring (Places API).
      const pickupInputEl = await this.pickupAddrIonInput.getInputElement();
      const dropInputEl = await this.dropAddrIonInput.getInputElement();

      const pickupAC = new google.maps.places.Autocomplete(pickupInputEl, {
        types: ['geocode'],
        fields: ['geometry', 'formatted_address', 'name'],
        componentRestrictions: { country: 'IN' },
      });
      pickupAC.addListener('place_changed', () => {
        const place = pickupAC.getPlace();
        const geom = place?.geometry;
        if (!geom?.location) return;
        const lat = geom.location.lat();
        const lng = geom.location.lng();

        this.pickupLat = lat;
        this.pickupLng = lng;
        this.pickupAddress = place.formatted_address || place.name || this.pickupAddress;
        this.syncMarkersFromCoords();
      });
      this.pickupAutocomplete = pickupAC;

      const dropAC = new google.maps.places.Autocomplete(dropInputEl, {
        types: ['geocode'],
        fields: ['geometry', 'formatted_address', 'name'],
        componentRestrictions: { country: 'IN' },
      });
      dropAC.addListener('place_changed', () => {
        const place = dropAC.getPlace();
        const geom = place?.geometry;
        if (!geom?.location) return;
        const lat = geom.location.lat();
        const lng = geom.location.lng();

        this.dropLat = lat;
        this.dropLng = lng;
        this.dropAddress = place.formatted_address || place.name || this.dropAddress;
        this.syncMarkersFromCoords();
      });
      this.dropAutocomplete = dropAC;

      this.syncMarkersFromCoords();

      this.googleMapsReady = true;
    } catch (e) {
      this.mapsLoadError = (e as Error)?.message || 'Could not initialize Google Maps.';
      this.googleMapsReady = false;
    }
  }

  private async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    if (!this.geocoder) return null;

    return new Promise((resolve) => {
      this.geocoder.geocode({ location: { lat, lng } }, (results: any[], status: string) => {
        if (status !== 'OK' || !results?.length) {
          resolve(null);
          return;
        }
        resolve(results[0]?.formatted_address || null);
      });
    });
  }

  private async setCoordsFromMapClick(lat: number, lng: number): Promise<void> {
    if (this.mapClickTarget === 'pickup') {
      this.pickupLat = lat;
      this.pickupLng = lng;
      const addr = await this.reverseGeocode(lat, lng);
      if (addr) this.pickupAddress = addr;
    } else {
      this.dropLat = lat;
      this.dropLng = lng;
      const addr = await this.reverseGeocode(lat, lng);
      if (addr) this.dropAddress = addr;
    }

    this.syncMarkersFromCoords();
  }

  /** Called when user manually edits lat/lng inputs. */
  syncMarkersFromCoords(): void {
    if (!this.map) return;

    if (this.pickupLat != null && this.pickupLng != null) {
      const lat = Number(this.pickupLat);
      const lng = Number(this.pickupLng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const pos = { lat, lng };
        if (!this.pickupMarker) {
          this.pickupMarker = new google.maps.Marker({
            map: this.map,
            position: pos,
            title: 'Pickup',
          });
        } else {
          this.pickupMarker.setPosition(pos);
        }
      }
    } else if (this.pickupMarker) {
      this.pickupMarker.setMap(null);
      this.pickupMarker = null;
    }

    if (this.dropLat != null && this.dropLng != null) {
      const lat = Number(this.dropLat);
      const lng = Number(this.dropLng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const pos = { lat, lng };
        if (!this.dropMarker) {
          this.dropMarker = new google.maps.Marker({
            map: this.map,
            position: pos,
            title: 'Drop',
          });
        } else {
          this.dropMarker.setPosition(pos);
        }
      }
    } else if (this.dropMarker) {
      this.dropMarker.setMap(null);
      this.dropMarker = null;
    }
  }

  private loadLookups(): void {
    this.error = null;
    this.message = null;

    // Public endpoints (no auth required).
    this.api.get<{ data: City[] }>('/pricing/cities').subscribe({
      next: (res) => {
        this.cities = res.data || [];
        if (this.cities.length && this.cityId == null) {
          this.cityId = this.cities[0].id;
        }
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load cities';
      },
    });

    this.api.get<{ data: RideType[] }>('/pricing/ride-types').subscribe({
      next: (res) => {
        this.rideTypes = res.data || [];
        if (this.rideTypes.length && this.rideTypeId == null) {
          this.rideTypeId = this.rideTypes[0].id;
        }
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load ride types';
      },
    });
  }

  private coordsOk(): boolean {
    return (
      this.pickupLat != null &&
      this.pickupLng != null &&
      this.dropLat != null &&
      this.dropLng != null &&
      Number.isFinite(this.pickupLat) &&
      Number.isFinite(this.pickupLng) &&
      Number.isFinite(this.dropLat) &&
      Number.isFinite(this.dropLng)
    );
  }

  canPickup(): boolean {
    return (
      this.pickupLat != null &&
      this.pickupLng != null &&
      Number.isFinite(this.pickupLat) &&
      Number.isFinite(this.pickupLng)
    );
  }

  canDrop(): boolean {
    return (
      this.dropLat != null &&
      this.dropLng != null &&
      Number.isFinite(this.dropLat) &&
      Number.isFinite(this.dropLng)
    );
  }

  private pickupCoords(): MapCoords | null {
    if (!this.canPickup()) return null;
    return { lat: this.pickupLat as number, lng: this.pickupLng as number };
  }

  private dropCoords(): MapCoords | null {
    if (!this.canDrop()) return null;
    return { lat: this.dropLat as number, lng: this.dropLng as number };
  }

  private async getMyCurrentLocation(): Promise<MapCoords | null> {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) {
        resolve(null);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });
        },
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 }
      );
    });
  }

  estimateFare(): void {
    this.error = null;
    this.message = null;
    this.estimate = null;

    if (this.cityId == null || this.rideTypeId == null || !this.coordsOk()) {
      this.error = 'Select city + ride type and enter pickup/drop coordinates.';
      return;
    }

    this.loading = true;
    this.api
      .post<EstimateResponse>('/pricing/estimate', {
        city_id: this.cityId,
        ride_type_id: this.rideTypeId,
        pickup_lat: this.pickupLat,
        pickup_lng: this.pickupLng,
        drop_lat: this.dropLat,
        drop_lng: this.dropLng,
      })
      .subscribe({
        next: (res) => {
          this.estimate = res || null;
          this.message = 'Estimate ready.';
        },
        error: (err) => {
          this.error = err?.error?.message || 'Could not estimate fare';
        },
        complete: () => {
          this.loading = false;
        },
      });
  }

  bookTrip(): void {
    this.error = null;
    this.message = null;

    if (this.cityId == null || this.rideTypeId == null || !this.coordsOk()) {
      this.error = 'Select city + ride type and enter pickup/drop coordinates.';
      return;
    }

    this.loading = true;
    this.api
      .post<{ trip: { id: number } & Record<string, unknown>; estimate: EstimateResponse }>(
        '/trips',
        {
          city_id: this.cityId,
          ride_type_id: this.rideTypeId,
          pickup_address: this.pickupAddress || null,
          pickup_lat: this.pickupLat,
          pickup_lng: this.pickupLng,
          drop_address: this.dropAddress || null,
          drop_lat: this.dropLat,
          drop_lng: this.dropLng,
        }
      )
      .subscribe({
        next: (res) => {
          const tripId = (res as any)?.trip?.id as number | undefined;
          this.message = 'Trip requested. Negotiation will start shortly.';
          if (tripId) {
            this.router.navigateByUrl(`/customer-tabs/negotiation/${tripId}`, { replaceUrl: true });
          } else {
            this.router.navigateByUrl('/customer-tabs/my-trips', { replaceUrl: true });
          }
        },
        error: (err) => {
          this.error = err?.error?.message || 'Trip booking failed';
        },
        complete: () => {
          this.loading = false;
        },
      });
  }

  openPickupInMaps(): void {
    const dest = this.pickupCoords();
    if (!dest) return;
    if (!this.useMyCurrentLocation) {
      openExternalUrl(googleMapsDirectionsUrl({ destination: dest, travelmode: 'driving' }));
      return;
    }

    this.getMyCurrentLocation().then((origin) => {
      openExternalUrl(
        googleMapsDirectionsUrl({
          origin: origin ?? undefined,
          destination: dest,
          travelmode: 'driving',
        })
      );
    });
  }

  openDropInMaps(): void {
    const dest = this.dropCoords();
    if (!dest) return;
    if (!this.useMyCurrentLocation) {
      openExternalUrl(googleMapsDirectionsUrl({ destination: dest, travelmode: 'driving' }));
      return;
    }

    this.getMyCurrentLocation().then((origin) => {
      openExternalUrl(
        googleMapsDirectionsUrl({
          origin: origin ?? undefined,
          destination: dest,
          travelmode: 'driving',
        })
      );
    });
  }

  openRouteInMaps(): void {
    const a = this.pickupCoords();
    const b = this.dropCoords();
    if (!a || !b) return;
    openExternalUrl(
      googleMapsDirectionsUrl({
        origin: a,
        destination: b,
        travelmode: 'driving',
      })
    );
  }
}

