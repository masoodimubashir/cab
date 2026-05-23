import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface DevLocationOverride {
  lat: number;
  lng: number;
  label: string;
}

export interface DevLocationPreset extends DevLocationOverride {
  id: string;
}

const STORAGE_KEY = 'dev.location.override';

export const DEV_LOCATION_PRESETS: DevLocationPreset[] = [
  { id: 'sopore', label: 'Sopore', lat: 34.3064, lng: 74.4502 },
  { id: 'srinagar', label: 'Srinagar', lat: 34.0837, lng: 74.7973 },
  { id: 'anantnag', label: 'Anantnag', lat: 33.7311, lng: 75.1487 },
  { id: 'baramulla', label: 'Baramulla', lat: 34.1986, lng: 74.3636 },
  { id: 'jammu', label: 'Jammu', lat: 32.7266, lng: 74.8570 },
  { id: 'mumbai', label: 'Mumbai', lat: 19.0760, lng: 72.8777 },
  { id: 'delhi', label: 'Delhi', lat: 28.6139, lng: 77.2090 },
];

/**
 * Dev-only location override for the customer app. Mirrors the driver-app
 * service — both read the same localStorage key per origin (they're separate
 * origins, so each tab/build has its own override state, which is correct).
 */
@Injectable({ providedIn: 'root' })
export class DevLocationService {
  private readonly subject = new BehaviorSubject<DevLocationOverride | null>(this.read());

  isEnabled(): boolean {
    return !environment.production;
  }

  get(): DevLocationOverride | null {
    return this.isEnabled() ? this.subject.value : null;
  }

  changes(): Observable<DevLocationOverride | null> {
    return this.subject.asObservable();
  }

  set(override: DevLocationOverride): void {
    if (!this.isEnabled()) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(override));
    } catch {
      /* private mode etc */
    }
    this.subject.next({ ...override });
  }

  clear(): void {
    if (!this.isEnabled()) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    this.subject.next(null);
  }

  presets(): DevLocationPreset[] {
    return DEV_LOCATION_PRESETS;
  }

  private read(): DevLocationOverride | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.lat !== 'number' || typeof parsed?.lng !== 'number') return null;
      return {
        lat: parsed.lat,
        lng: parsed.lng,
        label: typeof parsed.label === 'string' ? parsed.label : 'Custom',
      };
    } catch {
      return null;
    }
  }
}
