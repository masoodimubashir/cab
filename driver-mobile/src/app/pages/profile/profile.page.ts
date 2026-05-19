import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { ApiService } from '../../core/api.service';
import { AuthService, AuthUser } from '../../core/auth.service';
import { PlacesService, PlaceSuggestion } from '../../core/places.service';

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
  photoFile: File | null = null;
  photoPreview: string | null = null;
  name = '';
  email = '';
  phone = '';
  dob = '';
  /** Picked address (the Place's formatted_address) — used during onboarding,
   *  shown read-only on the edit screen. */
  address = '';

  // Address autocomplete (Google Places) — onboarding only.
  addressQuery = '';
  addressSuggestions: PlaceSuggestion[] = [];
  addressLoading = false;
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
    private router: Router,
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
    // Onboarding needs Places autocomplete — warm the SDK in the background.
    if (this.onboarding) {
      void this.places.ensureLoaded().catch(() => {});
    }
    void this.captureDeviceInfo();
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
    if (!name) { this.error = 'Please enter your name.'; return; }
    // DOB + Address are required during onboarding only — on the edit screen
    // they're locked and we don't send them.
    if (this.onboarding) {
      if (!this.dob) { this.error = 'Please select your date of birth.'; return; }
      if (!this.address) { this.error = 'Please pick your address from the suggestions.'; return; }
    }

    const fd = new FormData();
    fd.append('name', name);
    if (this.email.trim()) fd.append('email', this.email.trim());
    if (this.onboarding) {
      if (this.dob) fd.append('dob', this.dob);
      if (this.address) fd.append('address', this.address);
      if (this.deviceInfo.app_version) fd.append('app_version', this.deviceInfo.app_version.slice(0, 32));
      if (this.deviceInfo.os_version) fd.append('os_version', this.deviceInfo.os_version.slice(0, 32));
      if (this.deviceInfo.device_type) fd.append('device_type', this.deviceInfo.device_type.slice(0, 64));
    }
    if (this.photoFile) fd.append('photo', this.photoFile);

    this.busy = true;
    this.api.postForm<{ user: AuthUser }>('/me/profile', fd).subscribe({
      next: (res) => {
        this.auth.updateUser(res.user);
        this.busy = false;
        // First-time onboarding → move on to vehicle + documents.
        // Otherwise → back to the More tab.
        if (this.onboarding) {
          this.router.navigateByUrl('/driver-registration', { replaceUrl: true });
        } else {
          this.router.navigateByUrl('/tabs/more');
        }
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not save profile.';
        this.busy = false;
      },
    });
  }

  back(): void {
    this.router.navigateByUrl('/tabs/more');
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
