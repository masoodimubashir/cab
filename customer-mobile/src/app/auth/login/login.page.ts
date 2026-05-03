import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ViewWillEnter, ViewDidEnter, ViewWillLeave } from '@ionic/angular';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import {
  mapFirebaseAuthError,
  normalizeFirebaseIdToken,
  PhoneAuthService,
} from '../../core/phone-auth.service';
import { normalizePhoneToE164 } from '../../core/phone-normalize';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false,
})
export class LoginPage implements ViewWillEnter, ViewDidEnter, ViewWillLeave {
  /** Primary flow: phone SMS OTP via Firebase */
  step: 'phone' | 'otp' = 'phone';
  phone = '';
  otp = '';
  showDevFallback = false;
  idToken = '';

  loading = false;
  error: string | null = null;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private router: Router,
    private phoneAuth: PhoneAuthService
  ) {}

  ionViewWillEnter(): void {
    if (this.auth.isLoggedIn()) {
      this.router.navigateByUrl('/customer-tabs/book', { replaceUrl: true });
    }
  }

  ionViewDidEnter(): void {
    if (this.phoneAuth.isConfigured() && this.step === 'phone') {
      queueMicrotask(() => {
        try {
          this.phoneAuth.setupInvisibleRecaptcha('recaptcha-container');
        } catch (e) {
          this.error = (e as Error).message;
        }
      });
    }
  }

  ionViewWillLeave(): void {
    this.phoneAuth.teardownRecaptcha();
  }

  get firebaseReady(): boolean {
    return this.phoneAuth.isConfigured();
  }

  /** Exposes setup state for template (missing fields vs non-Web appId). */
  get firebaseSetup(): ReturnType<PhoneAuthService['firebaseSetupStatus']> {
    return this.phoneAuth.firebaseSetupStatus();
  }

  async sendOtp(): Promise<void> {
    this.error = null;
    const normalized = normalizePhoneToE164(this.phone);
    if (!normalized || normalized.length < 11) {
      this.error = 'Enter a valid mobile number (10 digits or full international).';
      return;
    }
    if (!this.phoneAuth.isConfigured()) {
      if (this.phoneAuth.firebaseSetupStatus() === 'not-web-app') {
        this.error =
          'Your Firebase appId is not a Web app (it must contain :web:). Add a Web app in Firebase Console and update environment.ts.';
      } else {
        this.error =
          'Firebase Web config is incomplete in environment.ts. Use Developer sign-in or paste the full Web app config from Firebase Console.';
      }
      return;
    }
    this.loading = true;
    try {
      this.phoneAuth.setupInvisibleRecaptcha('recaptcha-container');
      await this.phoneAuth.sendOtp(normalized);
      this.step = 'otp';
    } catch (e) {
      this.error = mapFirebaseAuthError(e);
      this.phoneAuth.teardownRecaptcha();
      queueMicrotask(() => {
        try {
          this.phoneAuth.setupInvisibleRecaptcha('recaptcha-container');
        } catch {
          /* ignore */
        }
      });
    } finally {
      this.loading = false;
    }
  }

  async verifyOtp(): Promise<void> {
    this.error = null;
    const code = this.otp.trim();
    if (code.length < 4) {
      this.error = 'Enter the code from your SMS.';
      return;
    }
    this.loading = true;
    try {
      const idToken = await this.phoneAuth.confirmOtp(code);
      await this.exchangeToken(idToken);
    } catch (e) {
      this.error = mapFirebaseAuthError(e) || 'Invalid code. Try again or request a new OTP.';
    } finally {
      this.loading = false;
    }
  }

  private exchangeToken(idToken: string): Promise<void> {
    const idTokenClean = normalizeFirebaseIdToken(idToken);
    return new Promise((resolve, reject) => {
      this.api
        .post<{ token: string; user: { id: number; name: string; role: string; phone?: string | null } }>(
          '/auth/otp/verify',
          { idToken: idTokenClean }
        )
        .subscribe({
          next: (res) => {
            this.auth.setSession(res.token, {
              id: res.user.id,
              name: res.user.name,
              role: res.user.role,
              phone: res.user.phone,
            });
            // Customer app: always land in customer booking flow.
            this.router.navigateByUrl('/customer-tabs/book', { replaceUrl: true });
            resolve();
          },
          error: (err) => {
            reject(new Error(err?.error?.message || 'Sign-in failed'));
          },
        });
    });
  }

  /** Optional: paste Firebase ID token (debug / CI) */
  signInWithToken(): void {
    const token = normalizeFirebaseIdToken(this.idToken);
    if (!token) {
      this.error = 'Paste an ID token.';
      return;
    }
    this.loading = true;
    this.error = null;
    this.exchangeToken(token)
      .catch((e) => {
        this.error = (e as Error).message;
      })
      .finally(() => {
        this.loading = false;
      });
  }

  backToPhone(): void {
    this.step = 'phone';
    this.otp = '';
    this.error = null;
    this.phoneAuth.resetOtpOnly();
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

  logoutDev(): void {
    this.auth.logout();
    this.error = null;
    this.step = 'phone';
    this.otp = '';
    this.phoneAuth.teardownRecaptcha();
    queueMicrotask(() => {
      if (this.phoneAuth.isConfigured()) {
        try {
          this.phoneAuth.setupInvisibleRecaptcha('recaptcha-container');
        } catch {
          /* ignore */
        }
      }
    });
  }
}
