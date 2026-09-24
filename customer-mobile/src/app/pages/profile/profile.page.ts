import { dateOfBirthError, latestAdultBirthDate } from '../../core/date-of-birth';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService, AuthUser } from '../../core/auth.service';

/**
 * Customer profile editor — photo, name, email, verified phone change.
 */
@Component({
  selector: 'app-customer-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  standalone: false,
})
export class CustomerProfilePage implements OnInit, OnDestroy {
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

  // Phone Change Modal State
  showPhoneModal = false;
  phoneStep: 'input' | 'otp' = 'input';
  newPhone = '';
  otpCode = '';
  phoneBusy = false;
  phoneError: string | null = null;
  resendCountdown = 0;
  private resendTimer: any = null;

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

  ngOnDestroy(): void {
    if (this.resendTimer) {
      clearInterval(this.resendTimer);
      this.resendTimer = null;
    }
  }

  openPhoneModal(): void {
    this.showPhoneModal = true;
    this.phoneStep = 'input';
    this.newPhone = '';
    this.otpCode = '';
    this.phoneError = null;
    this.phoneBusy = false;
  }

  closePhoneModal(): void {
    if (this.phoneBusy) return;
    this.showPhoneModal = false;
    this.phoneError = null;
    if (this.resendTimer) {
      clearInterval(this.resendTimer);
      this.resendTimer = null;
    }
  }

  sendPhoneOtp(): void {
    const phone = this.newPhone.trim();
    if (!phone) {
      this.phoneError = 'Please enter a valid phone number.';
      return;
    }
    this.phoneError = null;
    this.phoneBusy = true;

    this.api.post<{ ok: boolean; resend_in?: number; dev_code?: string; message?: string }>('/me/phone/change/start', { phone }).subscribe({
      next: (res) => {
        this.phoneBusy = false;
        this.phoneStep = 'otp';
        this.otpCode = '';
        this.startResendCountdown(res.resend_in || 30);
      },
      error: (err) => {
        this.phoneBusy = false;
        this.phoneError = err?.error?.message || 'Could not send verification code.';
      },
    });
  }

  verifyPhoneOtp(): void {
    const code = this.otpCode.trim();
    if (!code) {
      this.phoneError = 'Please enter the verification code.';
      return;
    }
    this.phoneError = null;
    this.phoneBusy = true;

    this.api.post<{ ok: boolean; user: AuthUser; message?: string }>('/me/phone/change/verify', {
      phone: this.newPhone.trim(),
      code,
    }).subscribe({
      next: (res) => {
        this.phoneBusy = false;
        if (res.user) {
          this.auth.updateUser(res.user);
          this.phone = res.user.phone || this.newPhone.trim();
        }
        this.closePhoneModal();
      },
      error: (err) => {
        this.phoneBusy = false;
        this.phoneError = err?.error?.message || 'Verification failed. Please check the code.';
      },
    });
  }

  private startResendCountdown(sec: number): void {
    this.resendCountdown = sec;
    if (this.resendTimer) clearInterval(this.resendTimer);
    this.resendTimer = setInterval(() => {
      if (this.resendCountdown > 0) {
        this.resendCountdown--;
      } else {
        clearInterval(this.resendTimer);
        this.resendTimer = null;
      }
    }, 1000);
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
