import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService, AuthUser } from '../../core/auth.service';

/**
 * Driver profile page — photo, name, email (optional).
 *
 * Used in two contexts:
 *   1. First-time onboarding: a brand-new driver lands here straight after OTP
 *      and on Continue is forwarded to /driver-registration to set up their
 *      vehicle + upload documents.
 *   2. From the More tab: existing drivers edit their profile and return.
 *
 * The `?next=registration` query param flag is set by login.routeAfterAuth so
 * we know to forward on Continue instead of bouncing back to /tabs/more.
 */
@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  standalone: false,
})
export class ProfilePage implements OnInit {
  photoFile: File | null = null;
  photoPreview: string | null = null;
  name = '';
  email = '';
  phone = '';

  busy = false;
  error: string | null = null;

  // True when we're inside the onboarding flow — affects header copy and the
  // destination on Continue.
  onboarding = false;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.onboarding = window.location.search.includes('next=registration');
    const me = this.auth.getUser();
    if (me) {
      this.name = me.name && me.name !== 'User' ? me.name : '';
      this.email = me.email && !me.email.endsWith('@otp.local') ? me.email : '';
      this.phone = me.phone ?? '';
      this.photoPreview = me.avatar_path || null;
    }
  }

  onPhotoChange(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) return;
    this.photoFile = file;
    const reader = new FileReader();
    reader.onload = () => { this.photoPreview = reader.result as string; };
    reader.readAsDataURL(file);
  }

  submit(): void {
    this.error = null;
    const name = this.name.trim();
    if (!name) { this.error = 'Please enter your name.'; return; }

    const fd = new FormData();
    fd.append('name', name);
    if (this.email.trim()) fd.append('email', this.email.trim());
    if (this.photoFile) fd.append('photo', this.photoFile);

    this.busy = true;
    this.api.postForm<{ user: AuthUser }>('/me/profile', fd).subscribe({
      next: (res) => {
        this.auth.updateUser(res.user);
        this.busy = false;
        // First-time onboarding → move on to vehicle + documents.
        // Otherwise → back to the More tab.
        if (this.onboarding) {
          this.router.navigateByUrl('/driver-registration', { replaceUrl: true });
        } else {
          this.router.navigateByUrl('/tabs/more');
        }
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not save profile.';
        this.busy = false;
      },
    });
  }

  back(): void {
    this.router.navigateByUrl('/tabs/more');
  }
}
