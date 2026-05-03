import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-driver-registration',
  templateUrl: './driver-registration.page.html',
  styleUrls: ['./driver-registration.page.scss'],
  standalone: false,
})
export class DriverRegistrationPage {
  vehicle_type = '';
  vehicle_brand = '';
  vehicle_model = '';
  vehicle_color = '';
  vehicle_reg_no = '';

  docType: 'DL' | 'RC' | 'INSURANCE' | 'ID' = 'DL';
  file: File | null = null;

  busy = false;
  uploadBusy = false;
  message: string | null = null;
  error: string | null = null;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private router: Router
  ) {}

  get isCustomer(): boolean {
    return this.auth.getUser()?.role === 'customer';
  }

  submitRegistration(): void {
    if (!this.isCustomer) {
      this.error = 'Registration is only available when your account role is customer. If you are already a driver, use document upload below.';
      return;
    }
    if (!this.vehicle_type.trim() || !this.vehicle_reg_no.trim()) {
      this.error = 'Vehicle type and registration number are required.';
      return;
    }
    this.busy = true;
    this.error = null;
    this.message = null;
    this.api
      .post<{ user?: { role: string }; driver?: unknown }>('/drivers/register', {
        vehicle_type: this.vehicle_type.trim(),
        vehicle_brand: this.vehicle_brand.trim() || null,
        vehicle_model: this.vehicle_model.trim() || null,
        vehicle_color: this.vehicle_color.trim() || null,
        vehicle_reg_no: this.vehicle_reg_no.trim(),
      })
      .subscribe({
        next: (res) => {
          const role = (res as { user?: { role?: string } }).user?.role;
          if (role) {
            this.auth.updateUser({ role });
          } else {
            this.auth.updateUser({ role: 'driver' });
          }
          this.message = 'Driver profile saved. Upload documents next.';
        },
        error: (err) => {
          this.error = err?.error?.message || 'Registration failed';
        },
        complete: () => {
          this.busy = false;
        },
      });
  }

  onFileChange(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    this.file = input.files?.[0] ?? null;
  }

  uploadDocument(): void {
    if (!this.file) {
      this.error = 'Choose a file first.';
      return;
    }
    this.uploadBusy = true;
    this.error = null;
    this.message = null;
    const fd = new FormData();
    fd.append('document_type', this.docType);
    fd.append('file', this.file, this.file.name);
    this.api.postForm<{ document?: unknown }>('/drivers/documents', fd).subscribe({
      next: () => {
        this.message = 'Document uploaded. Wait for admin approval before going online.';
        this.file = null;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Upload failed';
      },
      complete: () => {
        this.uploadBusy = false;
      },
    });
  }

  back(): void {
    this.router.navigateByUrl('/tabs/more');
  }
}
