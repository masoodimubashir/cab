import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';

@Component({
  selector: 'app-signin',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, InputTextModule, ButtonModule],
  styleUrl: './signin.component.scss',
  template: `
    <div class="auth-page">
      <div class="auth-card-wrap">
        <p-card class="auth-card">
          <div class="auth-header">
            <div class="auth-badge">DreamCabs</div>
            <h2 class="auth-title">Admin Sign In</h2>
            <p class="auth-subtitle">Sign in to manage rides, drivers, and pricing.</p>
          </div>

          <div class="auth-form">
            <div class="field">
              <label>Email</label>
              <input
                pInputText
                [(ngModel)]="email"
                placeholder="admin@example.com"
                autocomplete="email"
              />
            </div>

            <div class="field">
              <label>Password</label>
              <input
                pInputText
                type="password"
                [(ngModel)]="password"
                placeholder="Enter password"
                autocomplete="current-password"
              />
            </div>

            <button
              pButton
              type="button"
              class="auth-button"
              label="{{ loading ? 'Signing in...' : 'Sign In' }}"
              (click)="login()"
              [disabled]="loading || !email || !password"
            ></button>

            <div *ngIf="error" class="auth-error">
              {{ error }}
            </div>
          </div>
        </p-card>
      </div>
    </div>
  `,
})
export class SigninComponent {
  private readonly apiBase = 'http://localhost:8000/api';
  email = '';
  password = '';
  error: string | null = null;
  loading = false;

  constructor(private router: Router, private http: HttpClient) {}

  login(): void {
    this.error = null;
    this.loading = true;
    const url = `${this.apiBase}/admin/login`;

    this.http.post<any>(url, { email: this.email.trim(), password: this.password }).subscribe({
      next: (res) => {
        localStorage.setItem('dreamcabs_token', res?.token);
        this.router.navigateByUrl('/dashboard');
      },
      error: (err) => {
        this.error = err?.error?.message || 'Login failed';
        this.loading = false;
      },
      complete: () => {
        this.loading = false;
      },
    });
  }
}

