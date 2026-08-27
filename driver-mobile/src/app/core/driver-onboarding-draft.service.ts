import { Injectable } from '@angular/core';

export interface DriverRegistrationDraft {
  step: 1 | 2 | 3 | 4;
  city_id: number | null;
  city_ids?: number[];
  service_scope: 'local' | 'outstation' | null;
  service_mode: 'private' | 'fixed' | 'shuttle' | null;
  vehicle_type_id: number | null;
  city_vehicle_type_id: number | null;
  fleet_id: number | null;
  vehicle_model_year: string;
  vehicle_color: string;
  vehicle_reg_no: string;
}

export interface DriverOnboardingProfileDraft {
  name: string;
  email: string;
  dob: string;
  address: string;
  app_version?: string;
  os_version?: string;
  device_type?: string;
}

const PROFILE_STORAGE_KEY = 'driver_onboarding_profile_draft';
const REGISTRATION_STORAGE_KEY = 'driver_registration_draft';

@Injectable({ providedIn: 'root' })
export class DriverOnboardingDraftService {
  private photoFile: File | null = null;

  setProfile(profile: DriverOnboardingProfileDraft, photoFile: File | null): void {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
    this.photoFile = photoFile;
  }

  getProfile(): DriverOnboardingProfileDraft | null {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as DriverOnboardingProfileDraft;
    } catch {
      return null;
    }
  }

  getPhotoFile(): File | null {
    return this.photoFile;
  }

  setRegistration(draft: DriverRegistrationDraft): void {
    localStorage.setItem(REGISTRATION_STORAGE_KEY, JSON.stringify(draft));
  }

  getRegistration(): DriverRegistrationDraft | null {
    const raw = localStorage.getItem(REGISTRATION_STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as DriverRegistrationDraft;
    } catch {
      return null;
    }
  }

  clearRegistration(): void {
    localStorage.removeItem(REGISTRATION_STORAGE_KEY);
  }

  clear(): void {
    localStorage.removeItem(PROFILE_STORAGE_KEY);
    this.clearRegistration();
    this.photoFile = null;
  }
}
