import { Injectable } from '@angular/core';
import { Geolocation } from '@capacitor/geolocation';

export type LatLng = { lat: number; lng: number };

@Injectable({ providedIn: 'root' })
export class GeolocationService {
  async getCurrentPosition(): Promise<LatLng | null> {
    try {
      const perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted') {
        const req = await Geolocation.requestPermissions();
        if (req.location !== 'granted') return this.browserFallback();
      }
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 8000,
      });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      return this.browserFallback();
    }
  }

  private browserFallback(): Promise<LatLng | null> {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 }
      );
    });
  }
}
