import { Injectable } from '@angular/core';
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  type Auth,
  type ConfirmationResult,
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from 'firebase/auth';
import { environment } from '../../environments/environment';

/** Dedicated app name so we never reuse a misconfigured default `[DEFAULT]` instance. */
const DRIVER_WEB_APP_NAME = 'dreamcabs-driver-web';

export type FirebasePhoneSetup = 'ok' | 'missing' | 'not-web-app';

/**
 * Firebase Phone Auth (SMS OTP) for web / browser.
 * For Capacitor native builds, consider @capacitor-firebase/authentication or similar.
 */
@Injectable({
  providedIn: 'root',
})
export class PhoneAuthService {
  private app: FirebaseApp | null = null;
  private auth: Auth | null = null;
  private recaptchaVerifier: RecaptchaVerifier | null = null;
  private confirmationResult: ConfirmationResult | null = null;

  /**
   * JS SDK requires a **Web** app from Firebase Console. Android/iOS `appId` values
   * (e.g. `:android:…`, `:ios:…`) cause auth/configuration-not-found.
   */
  firebaseSetupStatus(): FirebasePhoneSetup {
    const c = environment.firebase;
    if (!c?.apiKey || !c?.authDomain || !c?.projectId || !c?.appId) {
      return 'missing';
    }
    if (!c.appId.includes(':web:')) {
      return 'not-web-app';
    }
    if (!c.messagingSenderId || !c.storageBucket) {
      return 'missing';
    }
    return 'ok';
  }

  isConfigured(): boolean {
    return this.firebaseSetupStatus() === 'ok';
  }

  private firebaseConfig(): Record<string, string> {
    const c = environment.firebase;
    return {
      apiKey: c.apiKey,
      authDomain: c.authDomain,
      projectId: c.projectId,
      storageBucket: c.storageBucket,
      messagingSenderId: c.messagingSenderId,
      appId: c.appId,
    };
  }

  private ensureApp(): Auth {
    const status = this.firebaseSetupStatus();
    if (status === 'missing') {
      throw new Error(
        'Firebase Web config is incomplete. Copy all fields from Firebase Console → Project settings → Your apps → Web app.'
      );
    }
    if (status === 'not-web-app') {
      throw new Error(
        'Firebase appId must be for a Web app (contains :web:). Android/iOS app IDs do not work with the browser SDK. Add a Web app in Firebase Console and paste that config.'
      );
    }
    if (!this.app) {
      const existing = getApps().find((a) => a.name === DRIVER_WEB_APP_NAME);
      this.app = existing ?? initializeApp(this.firebaseConfig(), DRIVER_WEB_APP_NAME);
    }
    if (!this.auth) {
      this.auth = getAuth(this.app);
    }
    return this.auth!;
  }

  /**
   * Call after the element with `containerId` exists (e.g. ionViewDidEnter).
   */
  setupInvisibleRecaptcha(containerId: string): void {
    this.teardownRecaptcha();
    const auth = this.ensureApp();
    this.recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
      size: 'invisible',
    });
  }

  teardownRecaptcha(): void {
    try {
      this.recaptchaVerifier?.clear();
    } catch {
      /* ignore */
    }
    this.recaptchaVerifier = null;
    this.confirmationResult = null;
  }

  async sendOtp(e164Phone: string): Promise<void> {
    const auth = this.ensureApp();
    if (!this.recaptchaVerifier) {
      throw new Error('reCAPTCHA not ready. Try again in a moment.');
    }
    this.confirmationResult = null;
    this.confirmationResult = await signInWithPhoneNumber(auth, e164Phone, this.recaptchaVerifier);
  }

  /** Firebase ID token for POST /auth/otp/verify */
  async confirmOtp(smsCode: string): Promise<string> {
    if (!this.confirmationResult) {
      throw new Error('No active OTP session. Request a new code.');
    }
    const cred = await this.confirmationResult.confirm(smsCode.trim());
    return cred.user.getIdToken();
  }

  resetOtpOnly(): void {
    this.confirmationResult = null;
  }
}

/**
 * Matches backend `FirebaseAuthService::normalizeIdToken` so pasted dev tokens
 * (line breaks, "Bearer ") still verify.
 */
export function normalizeFirebaseIdToken(raw: string): string {
  let t = raw.trim();
  if (/^bearer\s+/i.test(t)) {
    t = t.slice(7).trim();
  }
  return t.replace(/\s+/g, '');
}

/** User-facing text for common Firebase Auth web errors */
export function mapFirebaseAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code;
  const msg = (err as Error)?.message || 'Firebase error';
  if (code === 'auth/configuration-not-found') {
    return (
      'Firebase auth/configuration-not-found: use config from a Web app (appId must contain :web:), not Android/iOS. ' +
      'Firebase Console → Project settings → Your apps → add Web app → copy config into environment.ts. ' +
      'Enable Phone sign-in, add localhost to authorized domains, and enable Identity Toolkit API in Google Cloud if needed.'
    );
  }
  if (
    code === 'auth/invalid-app-credential' ||
    msg.toUpperCase().includes('INVALID_APP_CREDENTIAL')
  ) {
    return (
      'Firebase Phone Auth INVALID_APP_CREDENTIAL (reCAPTCHA/Identity Toolkit): ' +
      'this usually means your web API key / Identity Toolkit API key is restricted or your app origin is not authorized. ' +
      'Fix: Firebase Console → Authentication → Settings → Authorized domains: add the exact origin your Ionic app runs on (e.g. http://localhost:8101). ' +
      'Also ensure Google Cloud → Identity Toolkit API is enabled for the same Firebase project and the API key is valid/allowed for it.'
    );
  }
  return msg;
}
