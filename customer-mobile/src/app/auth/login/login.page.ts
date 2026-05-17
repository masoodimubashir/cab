import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { ViewWillEnter, ViewDidEnter, ViewWillLeave } from '@ionic/angular';
import { Geolocation } from '@capacitor/geolocation';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { ApiService } from '../../core/api.service';
import { AuthService, AuthUser } from '../../core/auth.service';
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

  // Country prefix (default India). The picker on the phone-entry step writes
  // here; sendOtp passes country.code to normalizePhoneToE164 as the default.
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
  country = this.countries[0]; // India by default
  showCountryPicker = false;

  infoName = '';
  infoEmail = '';
  infoPhotoFile: File | null = null;
  infoPhotoPreview: string | null = null;

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
      this.router.navigateByUrl('/customer-tabs/book', { replaceUrl: true });
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
      return !this.firebaseReady || !this.phone || this.phone.trim().length < 8;
    }
    if (this.step === 'perms') {
      return false;
    }
    if (this.step === 'otp') {
      return !this.otpReady;
    }
    if (this.step === 'info') {
      return !this.infoName.trim() || !this.infoEmail.trim();
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

  // Permissions step: Deny sends the user back to phone entry.
  denyPerms(): void {
    this.step = 'phone';
  }

  // Permissions step: Allow grants what we can request, then sends the OTP.
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
      if (this.userNeedsProfile(user)) {
        this.infoName = user.name && user.name !== 'User' ? user.name : '';
        this.infoEmail = this.isSyntheticEmail(user.email) ? '' : user.email ?? '';
        this.step = 'info';
        this.stopResendTimer();
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

    const fd = new FormData();
    fd.append('name', name);
    fd.append('email', email);
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
