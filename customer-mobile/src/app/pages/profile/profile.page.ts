import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService, AuthUser } from '../../core/auth.service';

/**
 * Customer profile editor — photo, name, email. Mirrors the driver profile
 * page; same backend endpoint (POST /me/profile).
 */
@Component({
  selector: 'app-customer-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  standalone: false,
})
export class CustomerProfilePage implements OnInit {
  photoFile: File | null = null;
  photoPreview: string | null = null;
  name = '';
  email = '';
  phone = '';
  /** Captured once at signup, surfaced read-only here. */
  dob = '';
  address = '';

  busy = false;
  error: string | null = null;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    const me = this.auth.getUser();
    if (me) {
      this.name = me.name && me.name !== 'User' ? me.name : '';
      this.email = me.email && !me.email.endsWith('@otp.local') ? me.email : '';
      this.phone = me.phone ?? '';
      this.photoPreview = this.auth.resolveAvatarUrl(me);
      this.dob = me.dob ?? '';
      this.address = me.address ?? '';
    }
  }

  get dobDisplay(): string {
    if (!this.dob) return '';
    const d = new Date(this.dob);
    if (Number.isNaN(d.getTime())) return this.dob;
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
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
        this.router.navigateByUrl('/customer-tabs/go');
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not save profile.';
        this.busy = false;
      },
    });
  }

  back(): void { this.router.navigateByUrl('/customer-tabs/go'); }
}
