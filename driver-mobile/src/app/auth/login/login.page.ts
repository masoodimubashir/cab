import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { ViewWillEnter, ViewDidEnter, ViewWillLeave } from '@ionic/angular';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { Geolocation } from '@capacitor/geolocation';
import { Contacts } from '@capacitor-community/contacts';
import { Camera } from '@capacitor/camera';
import { ApiService } from '../../core/api.service';
import { DriverOnboardingDraftService } from '../../core/driver-onboarding-draft.service';
import { AuthService, AuthUser } from '../../core/auth.service';
import { ApprovedDriverGuard } from '../../core/approved-driver.guard';
import { PushService } from '../../core/push.service';
import {
  mapFirebaseAuthError,
  normalizeFirebaseIdToken,
  PhoneAuthService,
} from '../../core/phone-auth.service';
import { normalizePhoneToE164 } from '../../core/phone-normalize';
import { environment } from '../../../environments/environment';

type AuthExchangeResponse = {
  token: string;
  user: AuthUser;
};

/**
 * Driver login flow — phone OTP only, premium multi-step shell mirroring the
 * customer app.
 *
 *   phone  → enter mobile number
 *   perms  → disclosure ("we use location/phone/SMS/contacts/device/files") — Allow grants all
 *   otp    → enter SMS code
 *
 * After OTP verify, new drivers go to /driver-registration which is a multistep
 * onboarding (profile → city → vehicle type → fleet → documents). Existing drivers
 * with completed profile + at least one document jump straight to /tabs/dashboard.
 */
type Step = 'phone' | 'perms' | 'otp';

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

  resendSecondsLeft = 0;
  private resendInterval: ReturnType<typeof setInterval> | null = null;

  loading = false;
  error: string | null = null;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private draft: DriverOnboardingDraftService,
    private router: Router,
    private phoneAuth: PhoneAuthService,
    private push: PushService,
  ) {}

  ionViewWillEnter(): void {
    if (this.auth.isLoggedIn()) {
      this.router.navigateByUrl('/tabs/dashboard', { replaceUrl: true });
    }
  }

  ionViewDidEnter(): void {
    // Firebase reCAPTCHA is only needed for the Firebase OTP path.
    if (!this.useServerOtp && this.phoneAuth.isConfigured()) {
      this.installRecaptchaSoon();
    }
  }

  /** When true, login uses the server-side MSG91 OTP instead of Firebase. */
  get useServerOtp(): boolean {
    return (environment as { useServerOtp?: boolean }).useServerOtp === true;
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
    // Server OTP doesn't need Firebase, so the phone step is always "ready" then.
    return this.useServerOtp || this.phoneAuth.isConfigured();
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
    return true;
  }

  handlePrimaryAction(): void {
    if (this.step === 'phone') {
      this.proceedToPerms();
    } else if (this.step === 'perms') {
      void this.allowPermsAndSendOtp();
    } else if (this.step === 'otp') {
      void this.verifyOtp();
    }
  }

  // ── Step transitions ─────────────────────────────────────────────

  goBack(): void {
    if (this.step === 'perms') {
      this.denyPerms();
    } else if (this.step === 'otp') {
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
  // Each request is isolated so one denial/failure never blocks the rest or the OTP.
  async allowPermsAndSendOtp(): Promise<void> {
    this.error = null;
    this.loading = true;
    try {
      await this.requestAllPermissions();
      localStorage.setItem('dreamcabs_permissions_granted', '1');
      await this.sendOtp();
    } finally {
      this.loading = false;
    }
  }

  // Sequentially prompts for every permission surfaced on the disclosure cards.
  // Native-only plugins are wrapped so they silently no-op on the web build, and
  // each request is isolated so one denial never blocks the next or the OTP.
  private async requestAllPermissions(): Promise<void> {
    // Location — "Receive nearby trips".
    // We hit the Geolocation plugin DIRECTLY (not GeolocationService) on purpose:
    // that service returns a mocked "granted" in non-production builds, which
    // would suppress the real OS prompt during onboarding. requestPermissions()
    // throws when the device's location toggle is OFF (it can't prompt then), so
    // we surface that as a warning rather than swallowing it silently.
    try {
      await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
    } catch (e) {
      console.warn('[perms] location request skipped (is the device location/GPS toggle on?)', e);
    }

    // Phone / Notifications — "Verify your identity" (Android 13+ shows a prompt;
    // older Android auto-grants POST_NOTIFICATIONS with no dialog).
    try { await FirebaseMessaging.requestPermissions(); } catch (e) { console.warn('[perms] notifications', e); }

    // Contacts — "Reach your riders".
    try { await Contacts.requestPermissions(); } catch (e) { console.warn('[perms] contacts', e); }

    // Storage / Camera — "Upload your documents" (license, RC, insurance, ID).
    // The Android Photo Picker itself is permission-less; this grants the camera
    // capture path used when adding documents.
    try { await Camera.requestPermissions({ permissions: ['camera', 'photos'] }); } catch (e) { console.warn('[perms] camera', e); }
  }

  private async sendOtp(): Promise<void> {
    const normalized = normalizePhoneToE164(this.phone, this.country.code);
    if (!normalized) return;
    if (this.useServerOtp) {
      await this.sendServerOtp(normalized);
      return;
    }
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

  /** Server-side OTP request (MSG91). In mock mode the code comes back and is auto-filled. */
  private async sendServerOtp(normalized: string): Promise<void> {
    try {
      const res = await this.api
        .post<{ ok: boolean; resend_in?: number; dev_code?: string }>('/auth/otp/sms/start', {
          phone: normalized,
        })
        .toPromise();
      this.step = 'otp';
      this.startResendTimer();
      if (res?.dev_code) {
        // Mock mode only — no real SMS was sent, so prefill the code for testing.
        this.otp = res.dev_code;
      }
    } catch (e: unknown) {
      this.error = (e as { error?: { message?: string } })?.error?.message || 'Could not send the code. Try again.';
      this.step = 'phone';
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
      const user = this.useServerOtp
        ? await this.verifyServerOtp()
        : await this.exchangeOtpToken(await this.phoneAuth.confirmOtp(this.otp.trim()));
      this.routeAfterAuth(user);
    } catch (e) {
      this.error = mapFirebaseAuthError(e) || 'Invalid code. Try again or request a new OTP.';
    } finally {
      this.loading = false;
    }
  }

  // ── Backend exchange ─────────────────────────────────────────────

  /** Verify the OTP server-side (MSG91 path) and start the driver session. */
  private verifyServerOtp(): Promise<AuthUser> {
    const normalized = normalizePhoneToE164(this.phone, this.country.code);
    return new Promise((resolve, reject) => {
      this.api
        .post<AuthExchangeResponse>('/auth/otp/sms/verify', {
          phone: normalized,
          code: this.otp.trim(),
          intent: 'driver',
        })
        .subscribe({
          next: (res) => {
            this.auth.setSession(res.token, res.user);
            void this.push.reportDeviceInfo();
            void this.push.registerForUser();
            resolve(res.user);
          },
          error: (err) => reject(new Error(err?.error?.message || 'Sign-in failed')),
        });
    });
  }

  private exchangeOtpToken(idToken: string): Promise<AuthUser> {
    const idTokenClean = normalizeFirebaseIdToken(idToken);
    return new Promise((resolve, reject) => {
      this.api
        .post<AuthExchangeResponse>('/auth/otp/verify', {
          idToken: idTokenClean,
          intent: 'driver',
        })
        .subscribe({
          next: (res) => {
            this.auth.setSession(res.token, res.user);
            void this.push.reportDeviceInfo();
            void this.push.registerForUser();
            resolve(res.user);
          },
          error: (err) => reject(new Error(err?.error?.message || 'Sign-in failed')),
        });
    });
  }

  /**
   * Decide where to send the driver after successful auth by asking the
   * backend for their current approval / document state.
   *
   * - No profile yet  → /driver-registration step 1
   * - No documents    → /driver-registration step 2
   * - Pending review  → /driver-pending-review (locked)
   * - Approved        → /tabs/dashboard
   *
   * The same /drivers/me snapshot also primes ApprovedDriverGuard's cache so
   * the very next navigation doesn't trigger another round-trip.
   */
  private routeAfterAuth(user: AuthUser): void {
    const needsProfile = this.isSyntheticEmail(user.email) || !user.name || user.name === 'User';
    if (needsProfile) {
      ApprovedDriverGuard.setStateRegistering();
      const profileDraft = this.draft.getProfile();
      this.router.navigateByUrl(profileDraft ? '/driver-registration' : '/profile?next=registration', { replaceUrl: true });
      return;
    }

    this.api.get<{
      driver: { approval_status?: string } | null;
      documents: { status: string }[];
    }>('/drivers/me').subscribe({
      next: (res) => {
        const status = res.driver?.approval_status ?? null;
        const hasDocs = (res.documents ?? []).length > 0;
        if (status === 'approved') {
          ApprovedDriverGuard.setStateApproved();
          this.router.navigateByUrl('/tabs/dashboard', { replaceUrl: true });
        } else if (hasDocs) {
          ApprovedDriverGuard.setStatePending();
          this.router.navigateByUrl('/driver-pending-review', { replaceUrl: true });
        } else {
          ApprovedDriverGuard.setStateRegistering();
          this.router.navigateByUrl('/driver-registration', { replaceUrl: true });
        }
      },
      error: () => {
        ApprovedDriverGuard.setStateRegistering();
        this.router.navigateByUrl('/profile?next=registration', { replaceUrl: true });
      },
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private isSyntheticEmail(email?: string | null): boolean {
    return !email || email.endsWith('@otp.local');
  }

  private assertFirebaseReady(): boolean {
    if (this.useServerOtp) return true; // server OTP path doesn't use Firebase
    if (this.phoneAuth.isConfigured()) return true;
    if (this.phoneAuth.firebaseSetupStatus() === 'not-web-app') {
      this.error = 'Your Firebase appId is not a Web app. Use Developer sign-in.';
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
