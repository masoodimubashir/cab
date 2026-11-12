import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { RealtimeService } from '../../core/realtime.service';
import { Subscription } from 'rxjs';
import { carOutline, checkmarkCircleOutline, closeCircleOutline, giftOutline, keypadOutline, notificationsOutline, ticketOutline, walletOutline } from 'ionicons/icons';

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
 * Customer notification inbox — backed by GET /me/notifications.
 * Tapping a notification marks it read and, when it carries a trip_id, opens
 * the relevant trip.
 */
@Component({
  selector: 'app-notifications',
  templateUrl: './notifications.page.html',
  styleUrls: ['./notifications.page.scss'],
  standalone: false,
})
export class NotificationsPage implements OnDestroy {
  loading = false;
  error: string | null = null;
  notifications: AppNotification[] = [];
  unreadCount = 0;
  filter: 'all' | 'unread' = 'all';
  loadingMore = false;
  markingAll = false;
  actionError = '';
  nextPage: number | null = null;
  private stopLive?: () => void;
  private listSub?: Subscription;
  private listRequest = 0;
  private readingIds = new Set<number>();
  private pageActive = false;

  constructor(
    private api: ApiService,
    private router: Router,
    private auth: AuthService,
    private realtime: RealtimeService,
  ) {}

  ionViewWillEnter(): void {
    this.pageActive = true;
    this.refresh();
    this.bindLive();
  }

  ionViewWillLeave(): void {
    this.pageActive = false;
    ++this.listRequest;
    this.listSub?.unsubscribe();
    this.stopLive?.();
    this.stopLive = undefined;
  }

  ngOnDestroy(): void {
    this.ionViewWillLeave();
  }

  refresh(): void {
    this.fetchPage(1);
  }

  setFilter(filter: 'all' | 'unread'): void {
    if (this.filter === filter) return;
    this.filter = filter;
    this.notifications = [];
    this.refresh();
  }

  loadMore(): void {
    if (this.nextPage && !this.loading && !this.loadingMore) this.fetchPage(this.nextPage);
  }

  private fetchPage(page: number): void {
    const requestId = ++this.listRequest;
    this.listSub?.unsubscribe();
    this.loading = page === 1;
    this.loadingMore = page > 1;
    this.error = null;
    this.actionError = '';
    const path = `/me/notifications?page=${page}&per_page=20${this.filter === 'unread' ? '&unread=1' : ''}`;
    this.listSub = this.api.get<{ data: { data?: AppNotification[]; current_page?: number; last_page?: number }; unread_count: number }>(path).subscribe({
      next: (res) => {
        if (requestId !== this.listRequest) return;
        const rows = res?.data?.data ?? [];
        const combined = page === 1 ? rows : [...this.notifications, ...rows];
        this.notifications = combined.filter((row, index) => combined.findIndex(item => item.id === row.id) === index);
        this.unreadCount = res?.unread_count ?? 0;
        const current = res?.data?.current_page ?? page;
        this.nextPage = current < (res?.data?.last_page ?? current) ? current + 1 : null;
        this.loading = false;
        this.loadingMore = false;
      },
      error: (err) => {
        if (requestId !== this.listRequest) return;
        if (page === 1) {
          this.error = err?.error?.message || 'Could not load notifications. Please try again.';
          this.notifications = [];
          this.nextPage = null;
        } else this.actionError = 'Couldn’t load more notifications. Please try again.';
        this.loading = false;
        this.loadingMore = false;
      },
    });
  }

  private bindLive(): void {
    if (this.stopLive) return;
    const userId = this.auth.getUser()?.id;
    if (!userId) return;
    this.stopLive = this.realtime.subscribeAppNotifications(userId, (payload) => {
      const note = payload.notification;
      if (this.notifications.some((n) => n.id === note.id)) return;
      if (this.filter === 'all' || !note.read_at) this.notifications = [note, ...this.notifications];
      if (!note.read_at) this.unreadCount += 1;
    });
  }

  markAllRead(): void {
    if (!this.unreadCount || this.markingAll) return;
    this.markingAll = true;
    this.actionError = '';
    this.api.post('/me/notifications/read-all', {}).subscribe({
      next: () => {
        this.markingAll = false;
        this.notifications = this.notifications.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() }));
        this.unreadCount = 0;
        if (this.filter === 'unread') this.notifications = [];
        if (this.pageActive) this.refresh();
      },
      error: () => { this.markingAll = false; this.actionError = 'Couldn’t mark notifications as read. Please try again.'; },
    });
  }

  open(n: AppNotification): void {
    if (!n.read_at && !this.readingIds.has(n.id)) {
      this.readingIds.add(n.id);
      this.actionError = '';
      this.api.post(`/me/notifications/${n.id}/read`, {}).subscribe({
        next: () => {
          this.readingIds.delete(n.id);
          // Mark-all may already have accounted for this row while the request was pending.
          const current = this.notifications.find(item => item.id === n.id);
          if (current && !current.read_at) {
            current.read_at = new Date().toISOString();
            this.unreadCount = Math.max(0, this.unreadCount - 1);
          }
          if (this.filter === 'unread') {
            this.notifications = this.notifications.filter(item => item.id !== n.id);
            if (this.pageActive) this.refresh();
          }
        },
        error: () => {
          this.readingIds.delete(n.id);
          this.actionError = 'Couldn’t mark this notification as read. Please try again.';
        },
      });
    }
    const routeId = Number(n.data?.['route_id']);
    if (n.type === 'fixed_route_available' && Number.isSafeInteger(routeId) && routeId > 0) {
      void this.router.navigate(['/customer-tabs/go/fixed'], { queryParams: { routeId } });
      return;
    }
    const tripId = n.data?.['trip_id'];
    if (tripId != null) {
      this.router.navigateByUrl(`/customer-tabs/trip/${tripId}`);
    }
  }

  back(): void {
    this.router.navigateByUrl('/customer-tabs/go');
  }

  iconFor(n: AppNotification): string {
    const type = n.type.toLowerCase();
    if (type.includes('otp') || type.includes('code')) return keypadOutline;
    if (type.includes('cancel') || type.includes('reject')) return closeCircleOutline;
    if (type.includes('payment') || type.includes('refund') || type.includes('wallet')) return walletOutline;
    if (type.includes('offer') || type.includes('coupon')) return giftOutline;
    if (type.includes('accept') || type.includes('confirm') || type.includes('complete')) return checkmarkCircleOutline;
    if (type.includes('booking') || type.includes('seat')) return ticketOutline;
    if (type.includes('trip') || type.includes('ride') || type.includes('route')) return carOutline;
    return notificationsOutline;
  }

  trackByNotification = (_: number, notification: AppNotification): number => notification.id;
}
