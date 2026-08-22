import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import {
  ButtonComponent,
  InputComponent,
  BrandMarkComponent,
} from '../ui';

@Component({
  selector: 'app-signin',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonComponent, InputComponent, BrandMarkComponent,
  ],
  styleUrl: './signin.component.scss',
  template: `
    <div class="auth">
      <div class="auth__card">
        <!-- Brand / hero panel (hidden on small screens) -->
        <aside class="auth__hero">
          <div class="auth__hero-top">
            <tm-brand-mark tone="inverse" />
          </div>

          <div class="auth__hero-body">
            <h2 class="auth__hero-title">Run your fleet<br />with confidence.</h2>
            <p class="auth__hero-text">
              Bookings, drivers, pricing and payouts — managed from one console.
            </p>
          </div>

          <ul class="auth__hero-points">
            <li><span class="dot"></span> Live ride &amp; driver tracking</li>
            <li><span class="dot"></span> Fares, zones &amp; settlements</li>
            <li><span class="dot"></span> Reports that actually add up</li>
          </ul>
        </aside>

        <!-- Sign-in form -->
        <div class="auth__panel">
          <div class="auth__brand">
            <tm-brand-mark size="lg" />
          </div>

          <header class="auth__head">
            <span class="tm-overline auth__eyebrow">Admin Console</span>
            <h1 class="tm-h1 auth__title">Welcome back</h1>
            <p class="auth__subtitle">Sign in to start your session.</p>
          </header>

          <form class="auth__form" (ngSubmit)="login()" autocomplete="on">
            <tm-input
              label="Email"
              type="email"
              placeholder="admin@example.com"
              icon="envelope"
              [(ngModel)]="email"
              name="email"
            />

            <tm-input
              label="Password"
              type="password"
              placeholder="Enter password"
              icon="shield"
              [(ngModel)]="password"
              name="password"
            />

            <tm-button
              variant="green"
              size="lg"
              type="submit"
              [loading]="loading"
              [disabled]="!email || !password"
              iconTrail="arrow-right"
              block
            >
              {{ loading ? 'Signing in…' : 'Sign In' }}
            </tm-button>
          </form>

          <p class="auth__foot">© {{ year }} DreamCabs · Admin Console</p>
        </div>
      </div>
    </div>
  `,
})
export class SigninComponent {
  private get apiBase(): string {
    if (typeof window !== 'undefined' && window.location && window.location.origin) {
      if (window.location.port === '4200') {
        return 'http://localhost:8000/api';
      }
      return `${window.location.origin}/api`;
    }
    return 'http://localhost:8000/api';
  }
  email = '';
  password = '';
  remember = true;
  loading = false;
  year = new Date().getFullYear();

  constructor(
    private router: Router,
    private http: HttpClient,
    private auth: AuthService,
    private toast: ToastService,
  ) {}

  login(): void {
    if (!this.email || !this.password || this.loading) return;
    this.loading = true;
    const url = `${this.apiBase}/admin/login`;

    this.http.post<any>(url, { email: this.email.trim(), password: this.password }).subscribe({
      next: (res) => {
        localStorage.setItem('dreamcabs_token', res?.token);
        if (res?.user) this.auth.setProfile(res.user);
        this.router.navigateByUrl(this.auth.landingRoute()).then((ok) => {
          if (ok) {
            const name = res?.user?.name?.split(' ')[0];
            this.toast.success(
              name ? `Welcome back, ${name}.` : 'Signed in successfully.',
              { title: 'Welcome' },
            );
          }
        });
      },
      error: (err) => {
        const message = err?.error?.message || 'Login failed. Check your credentials and try again.';
        this.toast.error(message, { title: 'Sign in failed' });
        this.loading = false;
      },
      complete: () => {
        this.loading = false;
      },
    });
  }
}
