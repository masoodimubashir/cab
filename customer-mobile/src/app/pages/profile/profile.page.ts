import { dateOfBirthError, latestAdultBirthDate } from '../../core/date-of-birth';
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
  /** Date of birth can be corrected here and is validated by the server. */
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

  get maxDob(): string { return latestAdultBirthDate(); }
  dobError: string | null = null;
  validateDob(): void { this.dobError = dateOfBirthError(this.dob); }

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

    this.validateDob();
    if (this.dobError) return;

    const fd = new FormData();
    fd.append('dob', this.dob);
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
        this.dobError = err?.error?.errors?.dob?.[0] ?? null;
        this.error = this.dobError ? null : err?.error?.message || 'Could not save profile.';
        this.busy = false;
      },
    });
  }

  back(): void { this.router.navigateByUrl('/customer-tabs/go'); }
}
