import { Injectable } from '@angular/core';

const TOKEN_KEY = 'dreamcabs_driver_token';
const USER_KEY = 'dreamcabs_driver_user';

export type AuthUser = {
  id: number;
  name: string;
  role: string;
  phone?: string | null;
};

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
}
