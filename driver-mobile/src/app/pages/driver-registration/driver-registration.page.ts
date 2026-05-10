import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

type DocType = 'DL' | 'RC' | 'INSURANCE' | 'ID';
type DocStatus = 'idle' | 'uploading' | 'done' | 'error';

interface DocSlot {
  type: DocType;
  label: string;
  file: File | null;
  status: DocStatus;
  error?: string;
}

@Component({
  selector: 'app-driver-registration',
  templateUrl: './driver-registration.page.html',
  styleUrls: ['./driver-registration.page.scss'],
  standalone: false,
})
export class DriverRegistrationPage implements OnInit {
  step: 1 | 2 = 1;

  vehicle_type = '';
  vehicle_brand = '';
  vehicle_model = '';
  vehicle_color = '';
  vehicle_reg_no = '';

  docs: DocSlot[] = [
    { type: 'DL', label: 'Driving licence', file: null, status: 'idle' },
    { type: 'RC', label: 'RC book', file: null, status: 'idle' },
    { type: 'INSURANCE', label: 'Insurance', file: null, status: 'idle' },
    { type: 'ID', label: 'Government ID', file: null, status: 'idle' },
  ];

  busy = false;
  uploadBusy = false;
  initLoading = true;
  message: string | null = null;
  error: string | null = null;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.api
      .get<{ driver: Record<string, unknown> | null }>('/drivers/me')
      .subscribe({
        next: (res) => {
          const d = res?.driver as Record<string, string | null> | null;
          if (d) {
            this.vehicle_type = (d['vehicle_type'] as string) ?? '';
            this.vehicle_brand = (d['vehicle_brand'] as string) ?? '';
            this.vehicle_model = (d['vehicle_model'] as string) ?? '';
            this.vehicle_color = (d['vehicle_color'] as string) ?? '';
            this.vehicle_reg_no = (d['vehicle_reg_no'] as string) ?? '';
            this.step = 2;
          }
        },
        complete: () => {
          this.initLoading = false;
        },
        error: () => {
          this.initLoading = false;
        },
      });
  }

  submitRegistration(): void {
    if (!this.vehicle_type.trim() || !this.vehicle_reg_no.trim()) {
      this.error = 'Vehicle type and registration number are required.';
      return;
    }
    this.busy = true;
    this.error = null;
    this.message = null;
    this.api
      .post<{ user?: { roles?: string[] }; driver?: unknown }>('/drivers/register', {
        vehicle_type: this.vehicle_type.trim(),
        vehicle_brand: this.vehicle_brand.trim() || null,
        vehicle_model: this.vehicle_model.trim() || null,
        vehicle_color: this.vehicle_color.trim() || null,
        vehicle_reg_no: this.vehicle_reg_no.trim(),
      })
      .subscribe({
        next: (res) => {
          const roles = res?.user?.roles;
          if (roles?.length) {
            this.auth.updateUser({ roles });
          }
          this.message = 'Vehicle saved. Now upload your documents.';
          this.step = 2;
        },
        error: (err) => {
          this.error = err?.error?.message || 'Registration failed';
        },
        complete: () => {
          this.busy = false;
        },
      });
  }

  onDocFileChange(slot: DocSlot, ev: Event): void {
    const input = ev.target as HTMLInputElement;
    slot.file = input.files?.[0] ?? null;
    slot.status = 'idle';
    slot.error = undefined;
  }

  hasSelection(): boolean {
    return this.docs.some((d) => !!d.file);
  }

  uploadSelected(): void {
    const pending = this.docs.filter((d) => !!d.file);
    if (pending.length === 0) {
      this.error = 'Pick at least one document file.';
      return;
    }
    this.uploadBusy = true;
    this.error = null;
    this.message = null;
    pending.forEach((d) => {
      d.status = 'uploading';
      d.error = undefined;
    });

    const uploads = pending.map((slot) => {
      const fd = new FormData();
      fd.append('document_type', slot.type);
      fd.append('file', slot.file as File, (slot.file as File).name);
      return this.api.postForm<{ document?: unknown }>('/drivers/documents', fd).pipe(
        map(() => {
          slot.status = 'done';
          slot.file = null;
          return { type: slot.type, ok: true };
        }),
        catchError((err) => {
          slot.status = 'error';
          slot.error = err?.error?.message || 'Upload failed';
          return of({ type: slot.type, ok: false });
        })
      );
    });

    forkJoin(uploads).subscribe({
      next: (results) => {
        const okCount = results.filter((r) => r.ok).length;
        const failCount = results.length - okCount;
        if (failCount === 0) {
          this.message = `${okCount} document${okCount === 1 ? '' : 's'} uploaded. Wait for admin approval before going online.`;
        } else if (okCount === 0) {
          this.error = 'All uploads failed. Check each document and try again.';
        } else {
          this.message = `${okCount} uploaded, ${failCount} failed. Retry the failed ones.`;
        }
      },
      complete: () => {
        this.uploadBusy = false;
      },
    });
  }

  goToStep(s: 1 | 2): void {
    this.step = s;
    this.error = null;
    this.message = null;
  }

  back(): void {
    this.router.navigateByUrl('/tabs/more');
  }
}
