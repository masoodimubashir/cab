import { AlertController } from '@ionic/angular';
import { locationWatchers } from './location-watcher-registry';
import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

const TOKEN_KEY = 'dreamcabs_customer_token';
const USER_KEY = 'dreamcabs_customer_user';

export type AuthUser = {
  id: number;
  name: string;
  /** Legacy field. Newer endpoints return `roles` instead; kept optional for backward compat. */
  role?: string;
  roles?: string[];
  email?: string | null;
  phone?: string | null;
  avatar_path?: string | null;
  /** Fully-qualified URL the mobile renders. Prefer this over avatar_path. */
  avatar_url?: string | null;
  /** Date of birth supplied at signup or corrected in the profile editor. */
  dob?: string | null;
  address?: string | null;
  accepted_payment_methods?: string[];
};

export type PaymentMethod = 'cash' | 'razorpay';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private logoutPending: Promise<void> | null = null;
  private cleanupWarningShown = false;

  constructor(private alerts: AlertController) {
    locationWatchers.onFailure = () => {
      if (this.cleanupWarningShown) return;
      this.cleanupWarningShown = true;
      void this.alerts.create({
        header: 'Location is still stopping',
        message: 'Your phone could not stop location tracking yet. We are retrying. You can turn off location for this app in your phone settings while we finish.',
        buttons: ['OK'],
      }).then(alert => alert.present()).catch(() => console.warn('Could not show location cleanup message'));
    };
  }

  private readonly sessionCleanup = new Set<() => void | Promise<void>>();

  registerSessionCleanup(cleanup: () => void | Promise<void>): void {
    this.sessionCleanup.add(cleanup);
  }
  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  setSession(token: string, user: AuthUser): void {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  getUser(): AuthUser | null {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  }

  updateUser(patch: Partial<AuthUser>): void {
    const u = this.getUser();
    if (!u) return;
    localStorage.setItem(USER_KEY, JSON.stringify({ ...u, ...patch }));
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  logout(): Promise<void> {
    if (this.logoutPending) return this.logoutPending;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.logoutPending = Promise.all([
      ...[...this.sessionCleanup].map(cleanup => locationWatchers.retry(cleanup)),
      locationWatchers.stopAll(),
    ]).then(() => undefined).finally(() => {
      this.logoutPending = null;
      this.cleanupWarningShown = false;
    });
    return this.logoutPending;
  }

  /**
   * Resolve the avatar URL the mobile can `<img src>`. We *always* rebuild
   * from `avatar_path` against the API host instead of trusting
   * `avatar_url` from the server payload — that field is often cached from a
   * session built before APP_URL was set correctly, so the URL lacks the
   * artisan-serve port and the browser 404s/OpaqueResponseBlocks on it.
   */
  resolveAvatarUrl(user: AuthUser | null | undefined): string | null {
    if (!user) return null;
    const path = user.avatar_path;
    if (!path) return user.avatar_url || null;
    if (/^https?:\/\//i.test(path)) return path;
    const apiBase = environment.apiUrl.replace(/\/api\/?$/i, '').replace(/\/$/, '');
    return `${apiBase}/storage/${path.replace(/^\/+/, '')}`;
  }
}
