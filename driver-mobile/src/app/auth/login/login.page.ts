import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { ViewWillEnter, ViewDidEnter, ViewWillLeave } from '@ionic/angular';
import { ApiService } from '../../core/api.service';
import { AuthService, AuthUser } from '../../core/auth.service';
import {
  mapFirebaseAuthError,
  normalizeFirebaseIdToken,
  PhoneAuthService,
} from '../../core/phone-auth.service';
import { normalizePhoneToE164 } from '../../core/phone-normalize';
import {
  GoogleAuthService,
  GoogleSignInCancelledError,
  GoogleSignInResult,
} from '../../core/google-auth.service';

type AuthExchangeResponse = {
  token: string;
  user: AuthUser;
};

type Step = 'method' | 'phone' | 'otp' | 'phone-info' | 'google-info' | 'google-otp';

const RESEND_SECONDS = 60;

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false,
})
export class LoginPage implements ViewWillEnter, ViewDidEnter, ViewWillLeave, OnDestroy {
  step: Step = 'method';
  phone = '';
  otp = '';
  showDevFallback = false;
  idToken = '';

  google: GoogleSignInResult | null = null;
  googleName = '';
  googlePhone = '';
  googleOtp = '';

  phoneInfoName = '';
  phoneInfoEmail = '';
  phoneInfoPhotoFile: File | null = null;
  phoneInfoPhotoPreview: string | null = null;

  resendSecondsLeft = 0;
  private resendInterval: ReturnType<typeof setInterval> | null = null;

  loading = false;
  error: string | null = null;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private router: Router,
    private phoneAuth: PhoneAuthService,
    private googleAuth: GoogleAuthService
  ) {}

  ionViewWillEnter(): void {
    if (this.auth.isLoggedIn()) {
      this.router.navigateByUrl('/tabs/dashboard', { replaceUrl: true });
    }
  }

  ionViewDidEnter(): void {
    if (this.phoneAuth.isConfigured() && (this.step === 'phone' || this.step === 'google-info')) {
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

  get googleOtpReady(): boolean {
    return this.googleOtp.trim().length >= 4;
  }

  get resendDisplay(): string {
    const s = this.resendSecondsLeft;
    return `Resend code 00:${s.toString().padStart(2, '0')}`;
  }

  // ---------- method picker ----------

  choosePhone(): void {
    this.error = null;
    this.step = 'phone';
    if (this.phoneAuth.isConfigured()) {
      this.installRecaptchaSoon();
    }
  }

  backToMethod(): void {
    this.error = null;
    this.step = 'method';
    this.phone = '';
    this.otp = '';
    this.google = null;
    this.googleName = '';
    this.googlePhone = '';
    this.googleOtp = '';
    this.phoneInfoName = '';
    this.phoneInfoEmail = '';
    this.phoneInfoPhotoFile = null;
    this.phoneInfoPhotoPreview = null;
    this.stopResendTimer();
    this.phoneAuth.resetOtpOnly();
    this.phoneAuth.teardownRecaptcha();
  }

  // ---------- phone-only flow ----------

  async sendOtp(): Promise<void> {
    this.error = null;
    const normalized = normalizePhoneToE164(this.phone);
    if (!normalized || normalized.length < 11) {
      this.error = 'Enter a valid mobile number (10 digits or full international).';
      return;
    }
    if (!this.assertFirebaseReady()) {
      return;
    }
    this.loading = true;
    try {
      this.phoneAuth.setupInvisibleRecaptcha('recaptcha-container');
      await this.phoneAuth.sendOtp(normalized);
      this.step = 'otp';
      this.startResendTimer();
    } catch (e) {
      this.error = mapFirebaseAuthError(e);
      this.resetRecaptchaQuiet();
    } finally {
      this.loading = false;
    }
  }

  async resendOtp(): Promise<void> {
    if (this.resendSecondsLeft > 0 || this.loading) return;
    await this.sendOtp();
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
        this.phoneInfoName = user.name && user.name !== 'User' ? user.name : '';
        this.phoneInfoEmail = this.isSyntheticEmail(user.email) ? '' : user.email ?? '';
        this.step = 'phone-info';
        this.stopResendTimer();
      } else {
        this.router.navigateByUrl('/tabs/dashboard', { replaceUrl: true });
      }
    } catch (e) {
      this.error = mapFirebaseAuthError(e) || 'Invalid code. Try again or request a new OTP.';
    } finally {
      this.loading = false;
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

  // ---------- phone-info ----------

  onPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) return;
    this.phoneInfoPhotoFile = file;
    const reader = new FileReader();
    reader.onload = () => {
      this.phoneInfoPhotoPreview = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  async submitPhoneInfo(): Promise<void> {
    this.error = null;
    const name = this.phoneInfoName.trim();
    const email = this.phoneInfoEmail.trim();
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
    if (this.phoneInfoPhotoFile) {
      fd.append('photo', this.phoneInfoPhotoFile);
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
      this.router.navigateByUrl('/tabs/dashboard', { replaceUrl: true });
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.loading = false;
    }
  }

  // ---------- Google + phone flow ----------

  async signInWithGoogle(): Promise<void> {
    this.error = null;
    this.loading = true;
    try {
      const result = await this.googleAuth.signIn();
      this.google = result;
      this.googleName = result.name ?? '';
      this.googlePhone = '';
      this.googleOtp = '';
      this.step = 'google-info';
      if (this.phoneAuth.isConfigured()) {
        this.installRecaptchaSoon();
      }
    } catch (e) {
      if (e instanceof GoogleSignInCancelledError) {
        return;
      }
      this.error = mapFirebaseAuthError(e) || (e as Error)?.message || 'Google sign-in failed.';
    } finally {
      this.loading = false;
    }
  }

  async sendGoogleOtp(): Promise<void> {
    this.error = null;
    if (!this.google) {
      this.error = 'Google session expired. Please sign in again.';
      this.step = 'method';
      return;
    }
    if (!this.googleName.trim()) {
      this.error = 'Please enter your name.';
      return;
    }
    const normalized = normalizePhoneToE164(this.googlePhone);
    if (!normalized || normalized.length < 11) {
      this.error = 'Enter a valid mobile number (10 digits or full international).';
      return;
    }
    if (!this.assertFirebaseReady()) {
      return;
    }
    this.loading = true;
    try {
      this.phoneAuth.setupInvisibleRecaptcha('recaptcha-container');
      await this.phoneAuth.sendOtp(normalized);
      this.step = 'google-otp';
      this.startResendTimer();
    } catch (e) {
      this.error = mapFirebaseAuthError(e);
      this.resetRecaptchaQuiet();
    } finally {
      this.loading = false;
    }
  }

  async resendGoogleOtp(): Promise<void> {
    if (this.resendSecondsLeft > 0 || this.loading) return;
    const normalized = normalizePhoneToE164(this.googlePhone);
    if (!normalized) return;
    this.loading = true;
    try {
      this.phoneAuth.setupInvisibleRecaptcha('recaptcha-container');
      await this.phoneAuth.sendOtp(normalized);
      this.startResendTimer();
    } catch (e) {
      this.error = mapFirebaseAuthError(e);
      this.resetRecaptchaQuiet();
    } finally {
      this.loading = false;
    }
  }

  async verifyGoogleOtp(): Promise<void> {
    this.error = null;
    if (!this.google) {
      this.error = 'Google session expired. Please sign in again.';
      this.step = 'method';
      return;
    }
    if (!this.googleOtpReady) {
      this.error = 'Enter the code from your SMS.';
      return;
    }
    this.loading = true;
    try {
      const phoneIdToken = await this.phoneAuth.confirmOtp(this.googleOtp.trim());
      await this.exchangeGoogleAndPhoneTokens(phoneIdToken);
    } catch (e) {
      this.error = mapFirebaseAuthError(e) || 'Invalid code. Try again or request a new OTP.';
    } finally {
      this.loading = false;
    }
  }

  backToGoogleInfo(): void {
    this.step = 'google-info';
    this.googleOtp = '';
    this.error = null;
    this.stopResendTimer();
    this.phoneAuth.resetOtpOnly();
    this.resetRecaptcha();
  }

  // ---------- backend exchanges ----------

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
            resolve(res.user);
          },
          error: (err) => reject(new Error(err?.error?.message || 'Sign-in failed')),
        });
    });
  }

  private exchangeGoogleAndPhoneTokens(phoneIdToken: string): Promise<void> {
    const phoneIdTokenClean = normalizeFirebaseIdToken(phoneIdToken);
    const googleIdTokenClean = normalizeFirebaseIdToken(this.google?.idToken ?? '');
    return new Promise((resolve, reject) => {
      this.api
        .post<AuthExchangeResponse>('/auth/google/verify', {
          google_id_token: googleIdTokenClean,
          phone_id_token: phoneIdTokenClean,
          intent: 'driver',
          name: this.googleName.trim() || undefined,
        })
        .subscribe({
          next: (res) => {
            this.auth.setSession(res.token, res.user);
            this.router.navigateByUrl('/tabs/dashboard', { replaceUrl: true });
            resolve();
          },
          error: (err) => reject(new Error(err?.error?.message || 'Sign-up failed')),
        });
    });
  }

  // ---------- helpers ----------

  private isSyntheticEmail(email?: string | null): boolean {
    return !email || email.endsWith('@otp.local');
  }

  private userNeedsProfile(user: AuthUser): boolean {
    return (
      this.isSyntheticEmail(user.email) ||
      !user.name ||
      user.name === 'User'
    );
  }

  private assertFirebaseReady(): boolean {
    if (this.phoneAuth.isConfigured()) return true;
    if (this.phoneAuth.firebaseSetupStatus() === 'not-web-app') {
      this.error =
        'Your Firebase appId is not a Web app (it must contain :web:). Add a Web app in Firebase Console and update environment.ts.';
    } else {
      this.error =
        'Firebase Web config is incomplete in environment.ts. Use Developer sign-in or paste the full Web app config from Firebase Console.';
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
      } catch {
        /* ignore */
      }
    });
  }

  private resetRecaptchaQuiet(): void {
    this.phoneAuth.teardownRecaptcha();
    queueMicrotask(() => {
      try {
        this.phoneAuth.setupInvisibleRecaptcha('recaptcha-container');
      } catch {
        /* ignore */
      }
    });
  }

  signInWithToken(): void {
    const token = normalizeFirebaseIdToken(this.idToken);
    if (!token) {
      this.error = 'Paste an ID token.';
      return;
    }
    this.loading = true;
    this.error = null;
    this.exchangeOtpToken(token)
      .then((user) => {
        if (this.userNeedsProfile(user)) {
          this.phoneInfoName = user.name && user.name !== 'User' ? user.name : '';
          this.phoneInfoEmail = this.isSyntheticEmail(user.email) ? '' : user.email ?? '';
          this.step = 'phone-info';
        } else {
          this.router.navigateByUrl('/tabs/dashboard', { replaceUrl: true });
        }
      })
      .catch((e) => {
        this.error = (e as Error).message;
      })
      .finally(() => {
        this.loading = false;
      });
  }

  logoutDev(): void {
    this.auth.logout();
    this.error = null;
    this.step = 'method';
    this.otp = '';
    this.phoneAuth.teardownRecaptcha();
  }
}
