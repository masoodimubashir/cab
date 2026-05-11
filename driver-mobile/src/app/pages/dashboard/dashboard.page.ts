import { Component, OnDestroy } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DriverPresenceService } from '../../core/driver-presence.service';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
  standalone: false,
})
export class DashboardPage implements OnDestroy {
  loading = false;
  toggling = false;
  error: string | null = null;
  driver: Record<string, unknown> | null = null;

  constructor(
    private api: ApiService,
    public auth: AuthService,
    private presence: DriverPresenceService
  ) {
    this.presence.onError((err) => {
      // Surface location problems to the driver — without this they go online
      // but never appear as "Free" on the dispatch console.
      this.error = err.message;
    });
  }

  ionViewWillEnter(): void {
    this.refresh();
  }

  ngOnDestroy(): void {
    // Leave the watcher running across page transitions inside the app — only
    // tear it down explicitly on logout / go-offline. Nothing to do here.
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
        // App might have been reloaded while online — ensure the location
        // watcher resumes so the dispatcher continues to see us as Free.
        if (this.driver?.['is_online'] && !this.presence.isStreaming()) {
          void this.presence.start();
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
        if (online) {
          // Start streaming location *after* the server confirms online so we
          // don't push pings the backend would reject as offline noise.
          void this.presence.start();
        } else {
          void this.presence.stop();
        }
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
