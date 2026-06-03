import { Component } from '@angular/core';
import { NavController } from '@ionic/angular';
import { ApiService } from '../../core/api.service';

interface AppNotification {
  id: number;
  type: string;
  title: string;
  body?: string | null;
  data?: Record<string, unknown> | null;
  icon?: string | null;
  read_at?: string | null;
  created_at?: string | null;
}

/**
 * Driver notification inbox — GET /me/notifications. Tapping a notification
 * marks it read and, when it carries a trip_id, opens the Rides screen for it.
 */
@Component({
  selector: 'app-driver-notifications',
  templateUrl: './notifications.page.html',
  styleUrls: ['./notifications.page.scss'],
  standalone: false,
})
export class NotificationsPage {
  loading = false;
  error: string | null = null;
  notifications: AppNotification[] = [];
  unreadCount = 0;

  constructor(
    private api: ApiService,
    private nav: NavController,
  ) {}

  ionViewWillEnter(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading = true;
    this.error = null;
    this.api.get<{ data: { data?: AppNotification[] }; unread_count: number }>('/me/notifications').subscribe({
      next: (res) => {
        this.notifications = res?.data?.data ?? [];
        this.unreadCount = res?.unread_count ?? 0;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load notifications';
        this.notifications = [];
      },
      complete: () => {
        this.loading = false;
      },
    });
  }

  markAllRead(): void {
    if (!this.unreadCount) return;
    this.api.post('/me/notifications/read-all', {}).subscribe({
      next: () => {
        this.notifications = this.notifications.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() }));
        this.unreadCount = 0;
      },
      error: () => { /* silent */ },
    });
  }

  open(n: AppNotification): void {
    if (!n.read_at) {
      this.api.post(`/me/notifications/${n.id}/read`, {}).subscribe({ next: () => {}, error: () => {} });
      n.read_at = new Date().toISOString();
      this.unreadCount = Math.max(0, this.unreadCount - 1);
    }
    const tripId = n.data?.['trip_id'];
    if (tripId != null) {
      this.nav.navigateForward('/tabs/rides', { queryParams: { trip: tripId } });
    }
  }

  iconFor(n: AppNotification): string {
    return n.icon || 'notifications-outline';
  }
}
