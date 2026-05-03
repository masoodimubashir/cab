import { Component } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
  standalone: false,
})
export class DashboardPage {
  loading = false;
  toggling = false;
  error: string | null = null;
  driver: Record<string, unknown> | null = null;

  constructor(
    private api: ApiService,
    public auth: AuthService
  ) {}

  ionViewWillEnter(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading = true;
    this.error = null;
    this.api.get<{ driver: Record<string, unknown> | null; user: { role?: string } }>('/drivers/me').subscribe({
      next: (res) => {
        this.driver = res.driver;
        if (res.user?.role) {
          this.auth.updateUser({ role: res.user.role });
        }
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load driver profile';
        this.driver = null;
      },
      complete: () => {
        this.loading = false;
      },
    });
  }

  setOnline(online: boolean): void {
    this.toggling = true;
    this.error = null;
    const req = online
      ? this.api.post<{ driver: Record<string, unknown> }>('/drivers/go-online', {})
      : this.api.post<{ driver: Record<string, unknown> }>('/drivers/go-offline', {});
    req.subscribe({
      next: (res) => {
        this.driver = res.driver;
      },
      error: (err) => {
        this.error = err?.error?.message || (online ? 'Could not go online' : 'Could not go offline');
      },
      complete: () => {
        this.toggling = false;
      },
    });
  }
}
