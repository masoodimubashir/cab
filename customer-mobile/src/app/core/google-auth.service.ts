import { Injectable } from '@angular/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { environment } from '../../environments/environment';

export class GoogleSignInCancelledError extends Error {
  constructor() {
    super('Google sign-in was cancelled.');
    this.name = 'GoogleSignInCancelledError';
  }
}

export interface GoogleSignInResult {
  /** Firebase ID token (NOT the Google OAuth token). Sent to backend for verification. */
  idToken: string;
  /** Profile fields used to prefill the "Confirm your information" screen. */
  name: string | null;
  email: string | null;
  photoUrl: string | null;
}

@Injectable({ providedIn: 'root' })
export class GoogleAuthService {
  /**
   * On web the Capacitor plugin delegates to the Firebase JS SDK, which requires the
   * default app to exist. PhoneAuthService initialises a *named* app on purpose, so we
   * also need to bootstrap the default app here. On native Android/iOS this is a no-op
   * — the plugin uses google-services.json / GoogleService-Info.plist directly.
   */
  private ensureDefaultFirebaseApp(): void {
    try {
      getApp();
    } catch {
      const c = environment.firebase;
      if (!c?.apiKey || !c?.authDomain || !c?.projectId || !c?.appId) {
        throw new Error(
          'Firebase Web config is incomplete in environment.ts (apiKey / authDomain / projectId / appId).'
        );
      }
      if (!getApps().some((a) => a.name === '[DEFAULT]')) {
        initializeApp({
          apiKey: c.apiKey,
          authDomain: c.authDomain,
          projectId: c.projectId,
          storageBucket: c.storageBucket,
          messagingSenderId: c.messagingSenderId,
          appId: c.appId,
        });
      }
    }
  }

  /**
   * Triggers the native Google account picker (Credential Manager bottom sheet on Android,
   * the system Google sheet on iOS). Returns the Firebase ID token + profile fields used
   * to prefill the "Confirm your information" screen.
   */
  async signIn(): Promise<GoogleSignInResult> {
    this.ensureDefaultFirebaseApp();
    const result = await FirebaseAuthentication.signInWithGoogle();
    if (!result?.user) {
      throw new GoogleSignInCancelledError();
    }
    const { token } = await FirebaseAuthentication.getIdToken();
    if (!token) {
      throw new Error('Could not retrieve Firebase ID token after Google sign-in.');
    }
    return {
      idToken: token,
      name: result.user.displayName ?? null,
      email: result.user.email ?? null,
      photoUrl: result.user.photoUrl ?? null,
    };
  }

  async signOut(): Promise<void> {
    try {
      await FirebaseAuthentication.signOut();
    } catch {
      /* ignore — sign-out best-effort */
    }
  }
}
