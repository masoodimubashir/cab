import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../core/api.service';
import { IconComponent, IconName } from '../../ui';

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
 * Admin notification inbox — GET /me/notifications for the signed-in admin.
 * Surfaces scheduled-ride events (booked, assigned, cancelled, expired) so the
 * operator has an in-panel feed alongside the live Rides tables.
 */
@Component({
  selector: 'app-admin-notifications',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="ntf">
      <div class="ntf__head">
        <div>
          <h2 class="ntf__title">Notifications</h2>
          <p class="ntf__sub">{{ unreadCount ? unreadCount + ' unread' : 'All caught up.' }}</p>
        </div>
        <div class="ntf__actions">
          <button class="ntf__btn" (click)="refresh()" [disabled]="loading">
            <tm-icon name="refresh" [size]="14" /> Refresh
          </button>
          <button class="ntf__btn ntf__btn--primary" (click)="markAllRead()" [disabled]="!unreadCount">
            Mark all read
          </button>
        </div>
      </div>

      <div class="cue" *ngIf="loading">
        <tm-icon name="refresh" [size]="20" /><p>Loading notifications…</p>
      </div>

      <div class="cue cue--error" *ngIf="error && !loading">
        <tm-icon name="shield" [size]="20" /><p>{{ error }}</p>
      </div>

      <div class="ntf__list" *ngIf="!loading && notifications.length">
        <button
          *ngFor="let n of notifications"
          class="ntf__item"
          [class.is-unread]="!n.read_at"
          (click)="markRead(n)"
        >
          <span class="ntf__icon"><tm-icon [name]="iconFor(n)" [size]="16" /></span>
          <span class="ntf__body">
            <span class="ntf__item-title">{{ n.title }}</span>
            <span class="ntf__item-text" *ngIf="n.body">{{ n.body }}</span>
            <span class="ntf__item-time">{{ n.created_at | date:'d MMM y, h:mm a' }}</span>
          </span>
          <span class="ntf__dot" *ngIf="!n.read_at" aria-hidden="true"></span>
        </button>
      </div>

      <div class="cue" *ngIf="!loading && !notifications.length && !error">
        <tm-icon name="calendar" [size]="24" />
        <p class="cue__title">No notifications</p>
        <p>Scheduled-ride updates will appear here.</p>
      </div>
    </div>
  `,
  styles: [`
    .ntf { display: flex; flex-direction: column; gap: 16px; }
    .ntf__head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .ntf__title { margin: 0; font-size: 20px; font-weight: 800; color: var(--tm-text); }
    .ntf__sub { margin: 2px 0 0; font-size: 13px; color: var(--tm-text-muted); }
    .ntf__actions { display: flex; gap: 8px; }
    .ntf__btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 14px; border-radius: var(--tm-radius-sm, 10px);
      border: 1px solid var(--tm-line); background: var(--tm-surface); color: var(--tm-text);
      font-size: 13px; font-weight: 700; cursor: pointer;
      &[disabled] { opacity: 0.5; cursor: default; }
    }
    .ntf__btn--primary { background: var(--tm-green-tint, #ECFDF3); border-color: var(--tm-green); color: var(--tm-green-deep, #16A34A); }

    .cue {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 48px 24px; text-align: center;
      background: var(--tm-surface); border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px); color: var(--tm-text-muted);
    }
    .cue--error { color: var(--tm-danger-fg, #B42318); border-color: var(--tm-danger-fg, #B42318); }
    .cue__title { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }

    .ntf__list {
      display: flex; flex-direction: column;
      background: var(--tm-surface); border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px); overflow: hidden;
    }
    .ntf__item {
      display: flex; align-items: flex-start; gap: 12px; text-align: left;
      padding: 14px 16px; background: transparent; border: 0; cursor: pointer; width: 100%;
      border-bottom: 1px solid var(--tm-line); position: relative;
      transition: background var(--tm-duration-fast, 0.15s) var(--tm-ease, ease);
      &:last-child { border-bottom: 0; }
      &:hover { background: var(--tm-canvas); }
      &.is-unread { background: var(--tm-green-tint, #ECFDF3); }
    }
    .ntf__icon {
      width: 34px; height: 34px; border-radius: 9px; flex: none;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--tm-green-tint, #ECFDF3); color: var(--tm-green);
    }
    .ntf__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .ntf__item-title { font-size: 13.5px; font-weight: 800; color: var(--tm-text); }
    .ntf__item-text { font-size: 13px; color: var(--tm-text-muted); line-height: 1.4; }
    .ntf__item-time { font-size: 11.5px; font-weight: 600; color: var(--tm-text-soft); margin-top: 2px; }
    .ntf__dot {
      position: absolute; top: 16px; right: 16px;
      width: 8px; height: 8px; border-radius: 50%; background: var(--tm-green);
    }
  `],
})
export class AdminNotificationsComponent implements OnInit {
  loading = false;
  error: string | null = null;
  notifications: AppNotification[] = [];
  unreadCount = 0;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading = true;
    this.error = null;
    this.api.get<{ data: { data?: AppNotification[] }; unread_count: number }>('/me/notifications').subscribe({
      next: (res) => {
        this.notifications = res?.data?.data ?? [];
        this.unreadCount = res?.unread_count ?? 0;
        this.loading = false;
      },
      error: () => {
        this.error = 'Could not load notifications.';
        this.loading = false;
      },
    });
  }

  markRead(n: AppNotification): void {
    if (n.read_at) return;
    this.api.post(`/me/notifications/${n.id}/read`, {}).subscribe({ next: () => {}, error: () => {} });
    n.read_at = new Date().toISOString();
    this.unreadCount = Math.max(0, this.unreadCount - 1);
  }

  markAllRead(): void {
    if (!this.unreadCount) return;
    this.api.post('/me/notifications/read-all', {}).subscribe({
      next: () => {
        this.notifications = this.notifications.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() }));
        this.unreadCount = 0;
      },
      error: () => {},
    });
  }

  /** Map the notification to one of the admin design-system icons. */
  iconFor(n: AppNotification): IconName {
    if (n.type?.startsWith('scheduled_ride')) return 'calendar';
    return 'pin';
  }
}
