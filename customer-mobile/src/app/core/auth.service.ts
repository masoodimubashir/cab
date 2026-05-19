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
  /** Stored once during signup; surfaced read-only on the edit profile screen. */
  dob?: string | null;
  city?: string | null;
  accepted_payment_methods?: string[];
};

export type PaymentMethod = 'cash' | 'upi' | 'qr';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
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

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
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
