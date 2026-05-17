import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { ViewWillEnter, ViewDidEnter, ViewWillLeave } from '@ionic/angular';
import { Geolocation } from '@capacitor/geolocation';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { ApiService } from '../../core/api.service';
import { AuthService, AuthUser } from '../../core/auth.service';
import { ApprovedDriverGuard } from '../../core/approved-driver.guard';
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
 * Driver login flow — phone OTP only.
 *
 *   method → tap "Login with phone"
 *   phone  → enter mobile number
 *   perms  → disclosure ("we use phone/SMS/contacts/device id/files") — Allow grants all
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

  countries: Array<{ name: string; code: string; flag: string; iso: string }> = [
    { name: 'India',         code: '91',  flag: '🇮🇳', iso: 'IN' },
    { name: 'United States', code: '1',   flag: '🇺🇸', iso: 'US' },
    { name: 'United Kingdom',code: '44',  flag: '🇬🇧', iso: 'GB' },
    { name: 'UAE',           code: '971', flag: '🇦🇪', iso: 'AE' },
    { name: 'Saudi Arabia',  code: '966', flag: '🇸🇦', iso: 'SA' },
    { name: 'Singapore',     code: '65',  flag: '🇸🇬', iso: 'SG' },
    { name: 'Australia',     code: '61',  flag: '🇦🇺', iso: 'AU' },
    { name: 'Canada',        code: '1',   flag: '🇨🇦', iso: 'CA' },
    { name: 'Bangladesh',    code: '880', flag: '🇧🇩', iso: 'BD' },
    { name: 'Pakistan',      code: '92',  flag: '🇵🇰', iso: 'PK' },
    { name: 'Sri Lanka',     code: '94',  flag: '🇱🇰', iso: 'LK' },
    { name: 'Nepal',         code: '977', flag: '🇳🇵', iso: 'NP' },
  ];
  country = this.countries[0];
  showCountryPicker = false;

  resendSecondsLeft = 0;
  private resendInterval: ReturnType<typeof setInterval> | null = null;

  loading = false;
  error: string | null = null;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private router: Router,
    private phoneAuth: PhoneAuthService,
    private push: PushService
  ) {}

  ionViewWillEnter(): void {
    if (this.auth.isLoggedIn()) {
      this.router.navigateByUrl('/tabs/dashboard', { replaceUrl: true });
    }
  }

  ionViewDidEnter(): void {
    if (this.phoneAuth.isConfigured()) {
      this.installRecaptchaSoon();
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
    return this.otp.trim().length >= 4;
  }

  get resendDisplay(): string {
    const s = this.resendSecondsLeft;
    return `Resend code 00:${s.toString().padStart(2, '0')}`;
  }

  // ── Step transitions ─────────────────────────────────────────────

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

  proceedToPerms(): void {
    this.error = null;
    const normalized = normalizePhoneToE164(this.phone, this.country.code);
    if (!normalized || normalized.length < 8) {
      this.error = 'Enter a valid mobile number for the selected country.';
      return;
    }
    if (!this.assertFirebaseReady()) {
      return;
    }
    this.step = 'perms';
  }

  denyPerms(): void {
    this.step = 'phone';
  }

  async allowPermsAndSendOtp(): Promise<void> {
    this.error = null;
    this.loading = true;
    try {
      try { await Geolocation.requestPermissions(); } catch { /* ignore */ }
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
      this.routeAfterAuth(user);
    } catch (e) {
      this.error = mapFirebaseAuthError(e) || 'Invalid code. Try again or request a new OTP.';
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
          intent: 'driver',
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
      // First-time signup → collect name/email/photo on /profile, which on
      // submit forwards to /driver-registration for vehicle + documents.
      ApprovedDriverGuard.setStateRegistering();
      this.router.navigateByUrl('/profile?next=registration', { replaceUrl: true });
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
