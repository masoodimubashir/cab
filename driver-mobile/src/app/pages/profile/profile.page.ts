import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { ApiService } from '../../core/api.service';
import { AuthService, AuthUser } from '../../core/auth.service';
import { DriverOnboardingDraftService } from '../../core/driver-onboarding-draft.service';
import { GeolocationService } from '../../core/geolocation.service';
import { PlacesService, PlaceSuggestion } from '../../core/places.service';

declare const google: any;

type ServiceScope = 'local' | 'outstation';
type ServiceMode = 'private' | 'fixed' | 'shuttle';
interface DriverProfile { city_id?: number | null; service_scope?: ServiceScope | null; service_mode?: ServiceMode | null; }
interface RideModeOption { scope: ServiceScope; mode: ServiceMode; name: string; }
interface RideScopeOption { scope: ServiceScope; name: string; modes: RideModeOption[]; }

/**
 * Driver profile page — photo, name, email (optional).
 *
 * Used in two contexts:
 *   1. First-time onboarding: a brand-new driver lands here straight after OTP
 *      and on Continue is forwarded to /driver-registration to set up their
 *      vehicle + upload documents.
 *   2. From the More tab: existing drivers edit their profile and return.
 *
 * The `?next=registration` query param flag is set by login.routeAfterAuth so
 * we know to forward on Continue instead of bouncing back to /tabs/more.
 */
@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  standalone: false,
})
export class ProfilePage implements OnInit {
  @ViewChild('addressFieldWrap') addressFieldWrap?: ElementRef<HTMLElement>;
  @ViewChild('addressMapEl') addressMapEl?: ElementRef<HTMLElement>;
  photoFile: File | null = null;
  photoPreview: string | null = null;
  readonly defaultAvatar = 'assets/default-avatar.svg';
  name = '';
  email = '';
  phone = '';
  dob = '';
  /** Picked address (the Place's formatted_address) — used during onboarding,
   *  shown read-only on the edit screen. */
  address = '';
  registeredServiceLabel = 'Not selected';
  registeredServiceLoading = false;

  // Address autocomplete (Google Places) — onboarding only.
  addressQuery = '';
  addressSuggestions: PlaceSuggestion[] = [];
  addressLoading = false;
  mapPickerOpen = false;
  mapLoading = false;
  mapError: string | null = null;
  mapSelectedAddress = '';
  mapSelectedPosition: { lat: number; lng: number } | null = null;
  private addressMap: any = null;
  private addressMapMarker: any = null;
  private addressMapClickListener: any = null;
  private addressSkipNextQueryEmit = false;
  private addressDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Yesterday — server validator is `before:today` (strict), so today would 422.
  readonly maxDob = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  // Captured once on init; sent silently with the profile payload so the
  // admin Customer module shows device + app metadata without asking.
  private deviceInfo: { app_version?: string; os_version?: string; device_type?: string } = {};

  busy = false;
  error: string | null = null;

  // True when we're inside the onboarding flow — affects header copy and the
  // destination on Continue.
  onboarding = false;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private draft: DriverOnboardingDraftService,
    private router: Router,
    private geo: GeolocationService,
    private places: PlacesService,
  ) {}

  ngOnInit(): void {
    this.onboarding = window.location.search.includes('next=registration');
    const me = this.auth.getUser();
    if (me) {
      this.name = me.name && me.name !== 'User' ? me.name : '';
      this.email = me.email && !me.email.endsWith('@otp.local') ? me.email : '';
      this.phone = me.phone ?? '';
      this.photoPreview = this.auth.resolveAvatarUrl(me);
      // Prefill the read-only DOB + Address on the edit screen. Backend
      // returns dob as an ISO date string (YYYY-MM-DD); we keep the ISO form
      // for the native picker (onboarding) and a separately formatted display
      // string. Address is whatever the user picked in Places.
      this.dob = me.dob ?? '';
      this.address = me.address ?? '';
      this.addressQuery = this.address;
    }
    if (!this.onboarding) {
      this.loadRegisteredService();
    }
    // Onboarding needs Places autocomplete — warm the SDK in the background.
    if (this.onboarding) {
      void this.places.ensureLoaded().catch(() => {});
    }
    void this.captureDeviceInfo();
  }

  /** Header reload button — re-sync the form from the latest stored user. */
  reload(): void {
    const me = this.auth.getUser();
    if (me) {
      this.name = me.name && me.name !== 'User' ? me.name : '';
      this.email = me.email && !me.email.endsWith('@otp.local') ? me.email : '';
      this.phone = me.phone ?? '';
      this.photoPreview = this.auth.resolveAvatarUrl(me);
      this.dob = me.dob ?? '';
      this.address = me.address ?? '';
      this.addressQuery = this.address;
    }
    if (!this.onboarding) {
      this.loadRegisteredService();
    }
    this.photoFile = null;
    this.error = null;
  }


  private loadRegisteredService(): void {
    this.registeredServiceLoading = true;
    this.api.get<{ driver: DriverProfile | null }>('/drivers/me').subscribe({
      next: (res) => {
        const driver = res.driver;
        if (!driver?.service_scope || !driver?.service_mode) {
          this.registeredServiceLabel = 'Not selected';
          return;
        }

        this.registeredServiceLabel = this.fallbackServiceLabel(driver.service_scope, driver.service_mode);
        if (!driver.city_id) return;

        this.api.get<{ scopes: RideScopeOption[] }>(`/catalog/cities/${driver.city_id}/driver-ride-products`).subscribe({
          next: (catalog) => {
            const scope = (catalog.scopes ?? []).find((row) => row.scope === driver.service_scope);
            const mode = scope?.modes?.find((row) => row.mode === driver.service_mode);
            if (scope && mode) {
              this.registeredServiceLabel = `${scope.name} ${mode.name}`;
            }
          },
        });
      },
      complete: () => { this.registeredServiceLoading = false; },
      error: () => {
        this.registeredServiceLabel = 'Not selected';
        this.registeredServiceLoading = false;
      },
    });
  }

  private fallbackServiceLabel(scope: ServiceScope, mode: ServiceMode): string {
    const scopeLabel = scope === 'outstation' ? 'Outstation' : 'Local';
    const modeLabel = mode === 'fixed' ? 'Fixed' : mode === 'shuttle' ? 'Shuttle' : 'Private';
    return `${scopeLabel} ${modeLabel}`;
  }

  /** Pretty form for the locked edit screen (e.g. "12 Apr 1997"). */
  get dobDisplay(): string {
    if (!this.dob) return '';
    const d = new Date(this.dob);
    if (Number.isNaN(d.getTime())) return this.dob;
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  }

  onAddressQueryChange(value: string | null | undefined): void {
    const q = (value ?? '').toString();
    this.addressQuery = q;
    if (this.addressSkipNextQueryEmit) {
      this.addressSkipNextQueryEmit = false;
      return;
    }
    if (this.address && q !== this.address) {
      this.address = '';
    }
    if (this.addressDebounceTimer) clearTimeout(this.addressDebounceTimer);
    if (!q.trim()) {
      this.addressSuggestions = [];
      return;
    }
    this.scrollAddressFieldIntoView();
    this.addressDebounceTimer = setTimeout(() => {
      this.fetchAddressSuggestions(q);
    }, 220);
  }

  private async fetchAddressSuggestions(q: string): Promise<void> {
    this.addressLoading = true;
    try {
      this.addressSuggestions = await this.places.autocompleteSearch(q);
    } catch {
      this.addressSuggestions = [];
    } finally {
      this.addressLoading = false;
    }
  }

  scrollAddressFieldIntoView(): void {
    setTimeout(() => {
      this.addressFieldWrap?.nativeElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 120);
  }

  async pickAddress(s: PlaceSuggestion): Promise<void> {
    this.addressLoading = true;
    try {
      const detail = await this.places.getPlaceDetail(s.place_id);
      const formatted = detail?.description || s.description;
      this.address = formatted;
      this.addressQuery = formatted;
      this.addressSkipNextQueryEmit = true;
      this.addressSuggestions = [];
    } finally {
      this.addressLoading = false;
    }
  }

  openAddressMap(): void {
    if (this.busy) return;
    this.mapPickerOpen = true;
    this.mapError = null;
    this.mapSelectedAddress = this.address || this.addressQuery || '';
    this.mapSelectedPosition = null;
    setTimeout(() => void this.initAddressMap(), 120);
  }

  closeAddressMap(): void {
    this.mapPickerOpen = false;
  }

  confirmMapAddress(): void {
    let picked = this.mapSelectedAddress.trim();
    if (!picked && this.mapSelectedPosition) {
      picked = `${this.mapSelectedPosition.lat.toFixed(6)}, ${this.mapSelectedPosition.lng.toFixed(6)}`;
    }
    if (!picked) {
      this.mapError = 'Tap a place on the map first.';
      return;
    }
    this.address = picked;
    this.addressQuery = picked;
    this.addressSkipNextQueryEmit = true;
    this.addressSuggestions = [];
    this.mapPickerOpen = false;
  }

  private async initAddressMap(): Promise<void> {
    const el = this.addressMapEl?.nativeElement;
    if (!el) return;
    this.mapLoading = true;
    this.mapError = null;
    try {
      await this.places.ensureLoaded();
      const center = await this.initialMapCenter();
      this.addressMap = new google.maps.Map(el, {
        center,
        zoom: 15,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: 'greedy',
      });
      if (this.addressMapClickListener?.remove) this.addressMapClickListener.remove();
      this.addressMapClickListener = this.addressMap.addListener('click', (ev: any) => {
        const latLng = ev?.latLng;
        if (!latLng) return;
        void this.pickAddressFromMap({ lat: latLng.lat(), lng: latLng.lng() });
      });
      await this.pickAddressFromMap(center);
    } catch {
      this.mapError = 'Could not load the map. Type and pick your address instead.';
    } finally {
      this.mapLoading = false;
    }
  }

  private async initialMapCenter(): Promise<{ lat: number; lng: number }> {
    const current = await this.currentPosition();
    if (current) return current;

    const typed = (this.address || this.addressQuery).trim();
    if (typed) {
      const geocoded = await this.geocodeAddress(typed);
      if (geocoded) return geocoded;
    }
    return { lat: 20.5937, lng: 78.9629 };
  }

  private async currentPosition(): Promise<{ lat: number; lng: number } | null> {
    try {
      const perm = await this.geo.checkPermissions();
      if (perm?.location === 'prompt' || perm?.coarseLocation === 'prompt') {
        await this.geo.requestPermissions();
      }
    } catch {
      /* continue to location request; web may prompt lazily */
    }

    try {
      const fix = await this.geo.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      });
      return { lat: fix.lat, lng: fix.lng };
    } catch {
      return null;
    }
  }

  private geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
    return new Promise((resolve) => {
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ address }, (results: any[], status: string) => {
        const loc = status === 'OK' ? results?.[0]?.geometry?.location : null;
        resolve(loc ? { lat: loc.lat(), lng: loc.lng() } : null);
      });
    });
  }

  private async pickAddressFromMap(position: { lat: number; lng: number }): Promise<void> {
    this.mapLoading = true;
    this.mapError = null;
    this.mapSelectedPosition = position;
    this.mapSelectedAddress = `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}`;
    this.setAddressMapMarker(position);
    try {
      const label = await this.reverseGeocode(position);
      if (label) this.mapSelectedAddress = label;
    } catch {
      /* coordinates remain selected */
    } finally {
      this.mapLoading = false;
    }
  }

  private reverseGeocode(position: { lat: number; lng: number }): Promise<string | null> {
    return new Promise((resolve) => {
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ location: position }, (results: any[], status: string) => {
        resolve(status === 'OK' ? (results?.[0]?.formatted_address ?? null) : null);
      });
    });
  }

  private setAddressMapMarker(position: { lat: number; lng: number }): void {
    if (!this.addressMap) return;
    if (!this.addressMapMarker) {
      this.addressMapMarker = new google.maps.Marker({
        map: this.addressMap,
        position,
        draggable: false,
      });
    } else {
      this.addressMapMarker.setPosition(position);
    }
    this.addressMap.panTo(position);
  }

  private async captureDeviceInfo(): Promise<void> {
    try { this.deviceInfo.device_type = Capacitor.getPlatform(); } catch { /* ignore */ }
    try {
      if (typeof navigator !== 'undefined') {
        this.deviceInfo.os_version = parseOsVersion(navigator.userAgent);
      }
    } catch { /* ignore */ }
    try {
      if (Capacitor.isNativePlatform()) {
        const info = await CapacitorApp.getInfo();
        this.deviceInfo.app_version = info.version?.slice(0, 32);
      }
    } catch { /* ignore */ }
  }

  onPhotoError(ev: Event): void {
    const i = ev.target as HTMLImageElement;
    if (i && i.src.indexOf('default-avatar') === -1) i.src = this.defaultAvatar;
  }

  onPhotoChange(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) return;
    this.photoFile = file;
    const reader = new FileReader();
    reader.onload = () => { this.photoPreview = reader.result as string; };
    reader.readAsDataURL(file);
  }

  submit(): void {
    this.error = null;
    const name = this.name.trim();
    const email = this.email.trim();
    if (!name) { this.error = 'Please enter your name.'; return; }
    if (this.onboarding && !email) { this.error = 'Please enter your email address.'; return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { this.error = 'Please enter a valid email address.'; return; }
    // DOB + Address are required during onboarding only — on the edit screen
    // they're locked and we don't send them.
    if (this.onboarding) {
      if (!this.dob) { this.error = 'Please select your date of birth.'; return; }
      if (!this.address) { this.error = 'Please pick your address from the suggestions.'; return; }
    }

    if (this.onboarding) {
      this.draft.setProfile({
        name,
        email,
        dob: this.dob,
        address: this.address,
        app_version: this.deviceInfo.app_version?.slice(0, 32),
        os_version: this.deviceInfo.os_version?.slice(0, 32),
        device_type: this.deviceInfo.device_type?.slice(0, 64),
      }, this.photoFile);
      this.router.navigateByUrl('/driver-registration', { replaceUrl: true });
      return;
    }

    const fd = new FormData();
    fd.append('name', name);
    if (email) fd.append('email', email);
    if (this.photoFile) fd.append('photo', this.photoFile);

    this.busy = true;
    this.api.postForm<{ user: AuthUser }>('/me/profile', fd).subscribe({
      next: (res) => {
        this.auth.updateUser(res.user);
        this.busy = false;
        this.router.navigateByUrl('/tabs/more');
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not save profile.';
        this.busy = false;
      },
    });
  }
}

// Extract a short OS label ("Android 7.0", "iOS 17.4", "Windows 10", …) from a
// User-Agent string so we stay well under the users.os_version varchar(32).
function parseOsVersion(ua: string | undefined | null): string | undefined {
  if (!ua) return undefined;
  const patterns: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
    [/Android\s([\d._]+)/i,           (m) => `Android ${m[1]}`],
    [/iPhone OS\s([\d_]+)/i,          (m) => `iOS ${m[1].replace(/_/g, '.')}`],
    [/CPU OS\s([\d_]+)\s+like Mac/i,  (m) => `iOS ${m[1].replace(/_/g, '.')}`],
    [/Mac OS X\s([\d._]+)/i,          (m) => `macOS ${m[1].replace(/_/g, '.')}`],
    [/Windows NT\s([\d.]+)/i,         (m) => `Windows NT ${m[1]}`],
    [/CrOS\s[^\s]+\s([\d.]+)/i,       (m) => `ChromeOS ${m[1]}`],
    [/Linux/i,                        () => 'Linux'],
  ];
  for (const [rx, fmt] of patterns) {
    const m = ua.match(rx);
    if (m) return fmt(m).slice(0, 32);
  }
  return 'Web';
}
