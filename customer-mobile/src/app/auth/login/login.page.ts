import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { ViewWillEnter, ViewDidEnter, ViewWillLeave } from '@ionic/angular';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { ApiService } from '../../core/api.service';
import { AuthService, AuthUser } from '../../core/auth.service';
import { GeolocationService } from '../../core/geolocation.service';
import { PlacesService, PlaceSuggestion } from '../../core/places.service';
import { PushService } from '../../core/push.service';
import {
  mapFirebaseAuthError,
  normalizeFirebaseIdToken,
  PhoneAuthService,
} from '../../core/phone-auth.service';
import { normalizePhoneToE164 } from '../../core/phone-normalize';

type AuthExchangeResponse = {
  token: string;
  user: AuthUser;
};

/**
 * Flow:
 *   method  → user taps "Login with phone"
 *   phone   → enter mobile number
 *   perms   → disclosure ("we use phone/SMS/contacts/device id/files") — Allow grants all
 *   otp     → enter SMS code
 *   info    → first-time signup completes name + email + photo
 */
type Step = 'phone' | 'perms' | 'otp' | 'info' | 'success';

const RESEND_SECONDS = 60;

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false,
})
export class LoginPage implements ViewWillEnter, ViewDidEnter, ViewWillLeave, OnDestroy {
  step: Step = 'phone';
  phone = '';
  otp = '';
  otpLength = 6; // Dynamic OTP length matching backend/Firebase configuration
  otpInputFocused = false;
  phoneInputFocused = false;

  countries: Array<{ name: string; code: string; flag: string; iso: string }> = [
    { name: 'Algeria',        code: '213', flag: '🇩🇿', iso: 'DZ' },
    { name: 'Argentina',      code: '54',  flag: '🇦🇷', iso: 'AR' },
    { name: 'Australia',      code: '61',  flag: '🇦🇺', iso: 'AU' },
    { name: 'Austria',        code: '43',  flag: '🇦🇹', iso: 'AT' },
    { name: 'Bahrain',        code: '973', flag: '🇧🇭', iso: 'BH' },
    { name: 'Bangladesh',     code: '880', flag: '🇧🇩', iso: 'BD' },
    { name: 'Belgium',        code: '32',  flag: '🇧🇪', iso: 'BE' },
    { name: 'Brazil',         code: '55',  flag: '🇧🇷', iso: 'BR' },
    { name: 'Canada',         code: '1',   flag: '🇨🇦', iso: 'CA' },
    { name: 'Chile',          code: '56',  flag: '🇨🇱', iso: 'CL' },
    { name: 'China',          code: '86',  flag: '🇨🇳', iso: 'CN' },
    { name: 'Colombia',       code: '57',  flag: '🇨🇴', iso: 'CO' },
    { name: 'Denmark',        code: '45',  flag: '🇩🇰', iso: 'DK' },
    { name: 'Egypt',          code: '20',  flag: '🇪🇬', iso: 'EG' },
    { name: 'Finland',        code: '358', flag: '🇫🇮', iso: 'FI' },
    { name: 'France',         code: '33',  flag: '🇫🇷', iso: 'FR' },
    { name: 'Germany',        code: '49',  flag: '🇩🇪', iso: 'DE' },
    { name: 'Greece',         code: '30',  flag: '🇬🇷', iso: 'GR' },
    { name: 'Hong Kong',      code: '852', flag: '🇭🇰', iso: 'HK' },
    { name: 'Hungary',        code: '36',  flag: '🇭🇺', iso: 'HU' },
    { name: 'India',          code: '91',  flag: '🇮🇳', iso: 'IN' },
    { name: 'Indonesia',      code: '62',  flag: '🇮🇩', iso: 'ID' },
    { name: 'Iran',           code: '98',  flag: '🇮🇷', iso: 'IR' },
    { name: 'Iraq',           code: '964', flag: '🇮🇶', iso: 'IQ' },
    { name: 'Ireland',        code: '353', flag: '🇮🇪', iso: 'IE' },
    { name: 'Israel',         code: '972', flag: '🇮🇱', iso: 'IL' },
    { name: 'Italy',          code: '39',  flag: '🇮🇹', iso: 'IT' },
    { name: 'Japan',          code: '81',  flag: '🇯🇵', iso: 'JP' },
    { name: 'Jordan',         code: '962', flag: '🇯🇴', iso: 'JO' },
    { name: 'Kenya',          code: '254', flag: '🇰🇪', iso: 'KE' },
    { name: 'Kuwait',         code: '965', flag: '🇰🇼', iso: 'KW' },
    { name: 'Malaysia',       code: '60',  flag: '🇲🇾', iso: 'MY' },
    { name: 'Mexico',         code: '52',  flag: '🇲🇽', iso: 'MX' },
    { name: 'Morocco',        code: '212', flag: '🇲🇦', iso: 'MA' },
    { name: 'Nepal',          code: '977', flag: '🇳🇵', iso: 'NP' },
    { name: 'Netherlands',    code: '31',  flag: '🇳🇱', iso: 'NL' },
    { name: 'New Zealand',    code: '64',  flag: '🇳🇿', iso: 'NZ' },
    { name: 'Nigeria',        code: '234', flag: '🇳🇬', iso: 'NG' },
    { name: 'Norway',         code: '47',  flag: '🇳🇴', iso: 'NO' },
    { name: 'Oman',           code: '968', flag: '🇴🇲', iso: 'OM' },
    { name: 'Pakistan',       code: '92',  flag: '🇵🇰', iso: 'PK' },
    { name: 'Peru',           code: '51',  flag: '🇵🇪', iso: 'PE' },
    { name: 'Philippines',    code: '63',  flag: '🇵🇭', iso: 'PH' },
    { name: 'Poland',         code: '48',  flag: '🇵🇱', iso: 'PL' },
    { name: 'Portugal',       code: '351', flag: '🇵🇹', iso: 'PT' },
    { name: 'Qatar',          code: '974', flag: '🇶🇦', iso: 'QA' },
    { name: 'Romania',        code: '40',  flag: '🇷🇴', iso: 'RO' },
    { name: 'Russia',         code: '7',   flag: '🇷🇺', iso: 'RU' },
    { name: 'Saudi Arabia',   code: '966', flag: '🇸🇦', iso: 'SA' },
    { name: 'Singapore',      code: '65',  flag: '🇸🇬', iso: 'SG' },
    { name: 'South Africa',   code: '27',  flag: '🇿🇦', iso: 'ZA' },
    { name: 'South Korea',    code: '82',  flag: '🇰🇷', iso: 'KR' },
    { name: 'Spain',          code: '34',  flag: '🇪🇸', iso: 'ES' },
    { name: 'Sri Lanka',      code: '94',  flag: '🇱🇰', iso: 'LK' },
    { name: 'Sweden',         code: '46',  flag: '🇸🇪', iso: 'SE' },
    { name: 'Switzerland',    code: '41',  flag: '🇨🇭', iso: 'CH' },
    { name: 'Taiwan',         code: '886', flag: '🇹🇼', iso: 'TW' },
    { name: 'Thailand',       code: '66',  flag: '🇹🇭', iso: 'TH' },
    { name: 'Turkey',         code: '90',  flag: '🇹🇷', iso: 'TR' },
    { name: 'UAE',            code: '971', flag: '🇦🇪', iso: 'AE' },
    { name: 'Ukraine',        code: '380', flag: '🇺🇦', iso: 'UA' },
    { name: 'United Kingdom', code: '44',  flag: '🇬🇧', iso: 'GB' },
    { name: 'United States',  code: '1',   flag: '🇺🇸', iso: 'US' },
    { name: 'Vietnam',        code: '84',  flag: '🇻🇳', iso: 'VN' },
  ];
  country = this.countries.find(c => c.iso === 'IN') || this.countries[0]; // Default to India
  showCountryPicker = false;

  infoName = '';
  infoEmail = '';
  infoDob = '';
  /** Final picked address (the Place's formatted_address). */
  infoAddress = '';
  infoPhotoFile: File | null = null;
  infoPhotoPreview: string | null = null;

  // Address autocomplete (Google Places)
  addressQuery = '';
  addressSuggestions: PlaceSuggestion[] = [];
  addressLoading = false;
  /** Skip the next query-change emit after we set query from a pick(). */
  private addressSkipNextQueryEmit = false;
  private addressDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Captured once after permissions/OTP so they're ready before submitInfo runs.
  // Sent silently with the profile payload so the admin Customer module shows
  // device + app metadata without asking the user.
  private deviceInfo: { app_version?: string; os_version?: string; device_type?: string } = {};

  // Yesterday in YYYY-MM-DD — feeds `[max]` on the DOB input. Server validator
  // is `before:today` (strict), so picking today would 422. Yesterday is the
  // latest the server will accept for a DOB.
  readonly maxDob = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  resendSecondsLeft = 0;
  private resendInterval: ReturnType<typeof setInterval> | null = null;

  loading = false;
  error: string | null = null;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private router: Router,
    private phoneAuth: PhoneAuthService,
    private push: PushService,
    private places: PlacesService,
    private geo: GeolocationService,
  ) {}

  ionViewWillEnter(): void {
    if (this.auth.isLoggedIn()) {
      this.router.navigateByUrl('/customer-tabs/book', { replaceUrl: true });
    }
  }

  ionViewDidEnter(): void {
    if (this.phoneAuth.isConfigured()) {
      this.installRecaptchaSoon();
    }
    void this.captureDeviceInfo();
  }

  /**
   * Reads platform + app version + UA string once on page entry and stashes
   * them on `this.deviceInfo`. We don't `await` this from anywhere — by the
   * time the user reaches the `info` step it's already populated, and worst
   * case the fields are absent on the request (backend treats them nullable).
   */
  private async captureDeviceInfo(): Promise<void> {
    try {
      this.deviceInfo.device_type = Capacitor.getPlatform();
    } catch { /* ignore */ }
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

  /**
   * Called by the address `<ion-input>` on every keystroke. Debounces a
   * Places autocomplete fetch and updates the suggestions list. Typing after
   * a pick clears the locked address so the user can re-search.
   */
  onAddressQueryChange(value: string | null | undefined): void {
    const q = (value ?? '').toString();
    this.addressQuery = q;
    if (this.addressSkipNextQueryEmit) {
      this.addressSkipNextQueryEmit = false;
      return;
    }
    // Typing again invalidates the prior pick — the address isn't "locked" anymore.
    if (this.infoAddress && q !== this.infoAddress) {
      this.infoAddress = '';
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
      this.infoAddress = formatted;
      this.addressQuery = formatted;
      this.addressSkipNextQueryEmit = true;
      this.addressSuggestions = [];
    } finally {
      this.addressLoading = false;
    }
  }

  ionViewWillLeave(): void {
    this.phoneAuth.teardownRecaptcha();
    this.stopResendTimer();
  }

  ngOnDestroy(): void {
    this.stopResendTimer();
  }

  private installRecaptchaSoon(): void {
    queueMicrotask(() => {
      try {
        this.phoneAuth.setupInvisibleRecaptcha('recaptcha-container');
      } catch (e) {
        this.error = (e as Error).message;
      }
    });
  }

  get firebaseReady(): boolean {
    return this.phoneAuth.isConfigured();
  }

  get firebaseSetup(): ReturnType<PhoneAuthService['firebaseSetupStatus']> {
    return this.phoneAuth.firebaseSetupStatus();
  }

  get otpReady(): boolean {
    return this.otp.trim().length >= this.otpLength;
  }

  get otpCells(): number[] {
    return Array.from({ length: this.otpLength }, (_, i) => i);
  }

  get resendDisplay(): string {
    const s = this.resendSecondsLeft;
    return `Resend code 00:${s.toString().padStart(2, '0')}`;
  }

  isButtonDisabled(): boolean {
    if (this.step === 'phone') {
      return !this.firebaseReady || !this.phone || this.phone.trim().length !== 10;
    }
    if (this.step === 'perms') {
      return false;
    }
    if (this.step === 'otp') {
      return !this.otpReady;
    }
    if (this.step === 'info') {
      return (
        !this.infoName.trim() ||
        !this.infoEmail.trim() ||
        !this.infoDob ||
        !this.infoAddress
      );
    }
    if (this.step === 'success') {
      return false;
    }
    return true;
  }

  handlePrimaryAction(): void {
    if (this.step === 'phone') {
      this.proceedToPerms();
    } else if (this.step === 'perms') {
      void this.allowPermsAndSendOtp();
    } else if (this.step === 'otp') {
      void this.verifyOtp();
    } else if (this.step === 'info') {
      void this.submitInfo();
    } else if (this.step === 'success') {
      void this.router.navigateByUrl('/customer-tabs/book', { replaceUrl: true });
    }
  }

  // ── Step transitions ─────────────────────────────────────────────

  goBack(): void {
    if (this.step === 'perms') {
      this.denyPerms();
    } else if (this.step === 'otp') {
      this.backToPhone();
    } else if (this.step === 'info') {
      this.backToPhone();
    }
  }

  backToPhone(): void {
    this.step = 'phone';
    this.otp = '';
    this.error = null;
    this.stopResendTimer();
    this.phoneAuth.resetOtpOnly();
    this.resetRecaptcha();
  }

  pickCountry(c: { name: string; code: string; flag: string; iso: string }): void {
    this.country = c;
    this.showCountryPicker = false;
  }

  // Step 1 → 2: validate phone, then show permissions disclosure.
  proceedToPerms(): void {
    this.error = null;
    if (!this.phone || this.phone.trim().length !== 10) {
      this.error = 'Enter a valid 10-digit mobile number.';
      return;
    }
    const normalized = normalizePhoneToE164(this.phone, this.country.code);
    if (!normalized) {
      this.error = 'Enter a valid mobile number for the selected country.';
      return;
    }
    if (!this.assertFirebaseReady()) {
      return;
    }
    this.step = 'perms';
  }

  // Permissions step: Deny sends the user back to phone entry.
  denyPerms(): void {
    this.step = 'phone';
  }

  // Permissions step: Allow grants what we can request, then sends the OTP.
  async allowPermsAndSendOtp(): Promise<void> {
    this.error = null;
    this.loading = true;
    try {
      await this.geo.requestPermissions();
      try { await FirebaseMessaging.requestPermissions(); } catch { /* ignore */ }
      localStorage.setItem('dreamcabs_permissions_granted', '1');
      await this.sendOtp();
    } finally {
      this.loading = false;
    }
  }

  private async sendOtp(): Promise<void> {
    const normalized = normalizePhoneToE164(this.phone, this.country.code);
    if (!normalized) return;
    try {
      this.phoneAuth.setupInvisibleRecaptcha('recaptcha-container');
      await this.phoneAuth.sendOtp(normalized);
      this.step = 'otp';
      this.startResendTimer();
    } catch (e) {
      this.error = mapFirebaseAuthError(e);
      this.step = 'phone';
      this.resetRecaptchaQuiet();
    }
  }

  async resendOtp(): Promise<void> {
    if (this.resendSecondsLeft > 0 || this.loading) return;
    this.loading = true;
    try {
      await this.sendOtp();
    } finally {
      this.loading = false;
    }
  }

  async verifyOtp(): Promise<void> {
    this.error = null;
    if (!this.otpReady) {
      this.error = 'Enter the code from your SMS.';
      return;
    }
    this.loading = true;
    try {
      const idToken = await this.phoneAuth.confirmOtp(this.otp.trim());
      const user = await this.exchangeOtpToken(idToken);
      if (this.userNeedsProfile(user)) {
        this.infoName = user.name && user.name !== 'User' ? user.name : '';
        this.infoEmail = this.isSyntheticEmail(user.email) ? '' : user.email ?? '';
        this.step = 'info';
        this.stopResendTimer();
        // Warm the Places API loader in the background — by the time the user
        // taps the address field, the SDK is usually already in memory.
        void this.places.ensureLoaded().catch(() => {});
      } else {
        this.router.navigateByUrl('/customer-tabs/book', { replaceUrl: true });
      }
    } catch (e) {
      this.error = mapFirebaseAuthError(e) || 'Invalid code. Try again or request a new OTP.';
    } finally {
      this.loading = false;
    }
  }

  // ── Profile completion (first-time signup) ───────────────────────

  onPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) return;
    this.infoPhotoFile = file;
    const reader = new FileReader();
    reader.onload = () => {
      this.infoPhotoPreview = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  async submitInfo(): Promise<void> {
    this.error = null;
    const name = this.infoName.trim();
    const email = this.infoEmail.trim();
    if (!name) {
      this.error = 'Please enter your name.';
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.error = 'Please enter a valid email address.';
      return;
    }
    if (!this.infoDob) {
      this.error = 'Please select your date of birth.';
      return;
    }
    if (!this.infoAddress) {
      this.error = 'Please pick your address from the suggestions.';
      return;
    }

    const fd = new FormData();
    fd.append('name', name);
    fd.append('email', email);
    // Only append non-empty values — Laravel's ConvertEmptyStringsToNull turns
    // '' into null which `nullable` skips, but belt-and-braces (and avoids
    // accidentally tripping `before:today` on a malformed string).
    if (this.infoDob) fd.append('dob', this.infoDob);
    if (this.infoAddress) fd.append('address', this.infoAddress);
    if (this.deviceInfo.app_version) fd.append('app_version', this.deviceInfo.app_version.slice(0, 32));
    if (this.deviceInfo.os_version) fd.append('os_version', this.deviceInfo.os_version.slice(0, 32));
    if (this.deviceInfo.device_type) fd.append('device_type', this.deviceInfo.device_type.slice(0, 64));
    if (this.infoPhotoFile) {
      fd.append('photo', this.infoPhotoFile);
    }

    this.loading = true;
    try {
      await new Promise<void>((resolve, reject) => {
        this.api.postForm<{ user: AuthUser }>('/me/profile', fd).subscribe({
          next: (res) => {
            this.auth.updateUser(res.user);
            resolve();
          },
          error: (err) => reject(new Error(err?.error?.message || 'Could not save profile.')),
        });
      });
      this.step = 'success';
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.loading = false;
    }
  }

  // ── Backend exchange ─────────────────────────────────────────────

  private exchangeOtpToken(idToken: string): Promise<AuthUser> {
    const idTokenClean = normalizeFirebaseIdToken(idToken);
    return new Promise((resolve, reject) => {
      this.api
        .post<AuthExchangeResponse>('/auth/otp/verify', {
          idToken: idTokenClean,
          intent: 'customer',
        })
        .subscribe({
          next: (res) => {
            this.auth.setSession(res.token, res.user);
            void this.push.registerForUser();
            resolve(res.user);
          },
          error: (err) => reject(new Error(err?.error?.message || 'Sign-in failed')),
        });
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private isSyntheticEmail(email?: string | null): boolean {
    return !email || email.endsWith('@otp.local');
  }

  private userNeedsProfile(user: AuthUser): boolean {
    return this.isSyntheticEmail(user.email) || !user.name || user.name === 'User';
  }

  private assertFirebaseReady(): boolean {
    if (this.phoneAuth.isConfigured()) return true;
    if (this.phoneAuth.firebaseSetupStatus() === 'not-web-app') {
      this.error = 'Your Firebase appId is not a Web app (it must contain :web:). Use Developer sign-in.';
    } else {
      this.error = 'Firebase Web config is incomplete in environment.ts. Use Developer sign-in.';
    }
    return false;
  }

  private startResendTimer(): void {
    this.stopResendTimer();
    this.resendSecondsLeft = RESEND_SECONDS;
    this.resendInterval = setInterval(() => {
      this.resendSecondsLeft--;
      if (this.resendSecondsLeft <= 0) {
        this.stopResendTimer();
      }
    }, 1000);
  }

  private stopResendTimer(): void {
    if (this.resendInterval) {
      clearInterval(this.resendInterval);
      this.resendInterval = null;
    }
  }

  private resetRecaptcha(): void {
    this.phoneAuth.teardownRecaptcha();
    queueMicrotask(() => {
      try {
        if (this.phoneAuth.isConfigured()) {
          this.phoneAuth.setupInvisibleRecaptcha('recaptcha-container');
        }
      } catch { /* ignore */ }
    });
  }

  private resetRecaptchaQuiet(): void {
    this.phoneAuth.teardownRecaptcha();
    queueMicrotask(() => {
      try {
        this.phoneAuth.setupInvisibleRecaptcha('recaptcha-container');
      } catch { /* ignore */ }
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
