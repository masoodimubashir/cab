import { Component, HostListener, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import {
  ButtonComponent,
  ColumnComponent,
  DataTableComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  StatusPillComponent,
} from '../../ui';

interface CustomerProfile {
  id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  dob: string | null;
  address: string | null;
  avatar_path?: string | null;
  avatar_url?: string | null;
  date_registered: string;
  last_login_at: string | null;
  app_version: string | null;
  os_version: string | null;
  device_type: string | null;
  is_suspended: boolean;
  suspended_reason: string | null;
  duplicate_registration: boolean;
  email_unsubscribed: boolean;
  sms_unsubscribed: boolean;
  push_unsubscribed: boolean;
  referral_code: string | null;
  referrer: { id: number; name: string; referral_code: string } | null;
  wallet_balance: number;
  remaining_coupons: number;
  used_subscribed: boolean;
  cancellation_charge_policy: string;
  current_lat?: number | null;
  current_lng?: number | null;
  current_location_updated_at?: string | null;
}

type TabKey = 'rides' | 'wallet' | 'cancelled' | 'referrals';

const WALLET_TYPES = [
  { value: 'credit', label: 'Credit', icon: 'plus' as const,  desc: 'Add to balance' },
  { value: 'debit',  label: 'Debit',  icon: 'trash' as const, desc: 'Deduct from balance' },
];

const BLOCK_REASONS = [
  'Spam / fraud',
  'Abusive behaviour',
  'Payment dispute',
  'Other',
];

@Component({
  selector: 'app-customer-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DatePipe,
    RouterLink,
    ButtonComponent,
    ColumnComponent,
    DataTableComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    StatusPillComponent,
  ],
  template: `
    <div class="page" *ngIf="profile; else loading">
      <!-- ============= Back link ============= -->
      <a routerLink="/customers" class="back-link">
        <tm-icon name="chevron-left" [size]="14" /> Back to customers
      </a>

      <!-- ============= Profile cover ============= -->
      <header class="cover">
        <div class="cover__banner" aria-hidden="true"></div>
        <div class="cover__inner">
          <span
            class="cover__avatar"
            [class.cover__avatar--photo]="profile.avatar_url || profile.avatar_path"
            [style.backgroundImage]="(profile.avatar_url || profile.avatar_path) ? 'url(' + (profile.avatar_url || profile.avatar_path) + ')' : null"
          >
            <ng-container *ngIf="!(profile.avatar_url || profile.avatar_path)">{{ initials(profile.name) }}</ng-container>
          </span>
          <div class="cover__body">
            <div class="cover__title-row">
              <h1 class="cover__name">{{ profile.name || 'Unnamed customer' }}</h1>
              <tm-status-pill *ngIf="profile.is_suspended" tone="danger">Blocked</tm-status-pill>
              <tm-status-pill *ngIf="!profile.is_suspended" tone="success">Active</tm-status-pill>
              <tm-status-pill *ngIf="profile.duplicate_registration" tone="warning">Duplicate</tm-status-pill>
            </div>
            <div class="cover__handle">
              <span class="mono">#{{ profile.id }}</span>
              <span class="cover__handle-sep">·</span>
              <span>Member since {{ profile.date_registered | date:'MMMM y' }}</span>
            </div>
            <div class="cover__contacts">
              <!-- Phone -->
              <ng-container *ngIf="profile.phone; else phoneEmpty">
                <a [href]="'tel:' + profile.phone" class="contact">
                  <span class="contact__icon"><tm-icon name="phone" [size]="13" /></span>
                  <span class="contact__k">Phone</span>
                  <span class="contact__text mono">{{ profile.phone }}</span>
                </a>
              </ng-container>
              <ng-template #phoneEmpty>
                <span class="contact contact--static contact--empty">
                  <span class="contact__icon"><tm-icon name="phone" [size]="13" /></span>
                  <span class="contact__k">Phone</span>
                  <span class="contact__text mono">—</span>
                </span>
              </ng-template>

              <!-- Email -->
              <ng-container *ngIf="profile.email; else emailEmpty">
                <a [href]="'mailto:' + profile.email" class="contact">
                  <span class="contact__icon"><tm-icon name="envelope" [size]="13" /></span>
                  <span class="contact__k">Email</span>
                  <span class="contact__text">{{ profile.email }}</span>
                </a>
              </ng-container>
              <ng-template #emailEmpty>
                <span class="contact contact--static contact--empty">
                  <span class="contact__icon"><tm-icon name="envelope" [size]="13" /></span>
                  <span class="contact__k">Email</span>
                  <span class="contact__text">—</span>
                </span>
              </ng-template>

              <!-- Address -->
              <span class="contact contact--static" [class.contact--empty]="!profile.address">
                <span class="contact__icon"><tm-icon name="map-marker" [size]="13" /></span>
                <span class="contact__k">Address</span>
                <span class="contact__text">{{ profile.address || '—' }}</span>
              </span>

              <!-- Current latitude / longitude pinged by the mobile app -->
              <ng-container *ngIf="profile.current_lat != null && profile.current_lng != null; else liveLocEmpty">
                <a
                  class="contact contact--live"
                  [href]="'https://www.google.com/maps?q=' + profile.current_lat + ',' + profile.current_lng"
                  target="_blank"
                  rel="noopener"
                  title="Open in Google Maps"
                >
                  <span class="contact__icon"><tm-icon name="pin" [size]="13" /></span>
                  <span class="contact__k">Location</span>
                  <span class="contact__text mono">
                    {{ profile.current_lat | number:'1.4-4' }}, {{ profile.current_lng | number:'1.4-4' }}
                  </span>
                  <span
                    *ngIf="profile.current_location_updated_at"
                    class="contact__age"
                    [class.is-stale]="isLocationStale"
                  >
                    {{ timeAgo(profile.current_location_updated_at) }}
                  </span>
                </a>
              </ng-container>
              <ng-template #liveLocEmpty>
                <span class="contact contact--static contact--empty">
                  <span class="contact__icon"><tm-icon name="pin" [size]="13" /></span>
                  <span class="contact__k">Location</span>
                  <span class="contact__text mono">—</span>
                </span>
              </ng-template>
            </div>
          </div>

          <div class="cover__actions">
            <tm-button variant="outline" size="sm" icon="key" (clicked)="sendOtp()" [loading]="otpSending">
              Send OTP
            </tm-button>
            <tm-button variant="ink" size="sm" icon="tag" (clicked)="openWallet()">
              Wallet
            </tm-button>
            <button
              type="button"
              class="more-btn"
              (click)="toggleMoreMenu($event)"
              [class.is-open]="moreMenuOpen"
              aria-label="More actions"
            >
              <tm-icon name="more-horizontal" [size]="16" />
            </button>
            <div class="more-menu" *ngIf="moreMenuOpen" (click)="$event.stopPropagation()">
              <button type="button" class="more-menu__item" (click)="closeMore(); openUnsub()">
                <tm-icon name="bell" [size]="14" />
                <span>Subscription preferences</span>
              </button>
              <button type="button" class="more-menu__item more-menu__item--danger"
                      (click)="closeMore(); openBlockDelete()">
                <tm-icon [name]="profile.is_suspended ? 'check' : 'shield'" [size]="14" />
                <span>{{ profile.is_suspended ? 'Manage access' : 'Block or delete' }}</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <!-- ============= Stat row ============= -->
      <section class="stats">
        <div class="stat-card">
          <span class="stat-card__icon stat-card__icon--green">
            <tm-icon name="tag" [size]="14" />
          </span>
          <span class="stat-card__value">₹ {{ (profile.wallet_balance || 0) | number:'1.2-2' }}</span>
          <span class="stat-card__label">Wallet balance</span>
        </div>
        <div class="stat-card">
          <span class="stat-card__icon">
            <tm-icon name="car" [size]="14" />
          </span>
          <span class="stat-card__value">{{ totalRidesAggregate }}</span>
          <span class="stat-card__label">Total rides</span>
        </div>
        <div class="stat-card">
          <span class="stat-card__icon">
            <tm-icon name="gift" [size]="14" />
          </span>
          <span class="stat-card__value">{{ profile.remaining_coupons || 0 }}</span>
          <span class="stat-card__label">Coupons</span>
        </div>
        <div class="stat-card">
          <span class="stat-card__icon">
            <tm-icon name="calendar" [size]="14" />
          </span>
          <span class="stat-card__value">{{ profile.last_login_at ? timeAgo(profile.last_login_at) : '—' }}</span>
          <span class="stat-card__label">Last login</span>
        </div>
      </section>

      <!-- ============= About + meta cards ============= -->
      <section class="about">
        <article class="about__main">
          <h2 class="about__heading">About</h2>
          <p class="about__text">
            <strong>{{ profile.name || 'This customer' }}</strong>
            joined TaxiMode on
            <strong>{{ profile.date_registered | date:'MMMM d, y' }}</strong>
            and lives at <strong>{{ profile.address || '—' }}</strong>.
            They use the app version <span class="mono">{{ profile.app_version || '—' }}</span>
            on a {{ profile.device_type || '—' }} running {{ profile.os_version || '—' }}.
            Referred by
            <strong>{{ profile.referrer?.name || '—' }}</strong>
            (<span class="mono">{{ profile.referrer?.referral_code || '—' }}</span>).
            <ng-container *ngIf="profile.is_suspended">
              <br />
              <span class="about__warn">⚠ Blocked: {{ profile.suspended_reason || '—' }}</span>
            </ng-container>
          </p>

          <div class="about__tags">
            <span class="tag-pill tag-pill--ink">
              <tm-icon name="user" [size]="11" />
              <span class="tag-pill__k">User ID</span>
              <span class="tag-pill__v mono">#{{ profile.id }}</span>
            </span>
            <span class="tag-pill">
              <tm-icon name="calendar" [size]="11" />
              <span class="tag-pill__k">DOB</span>
              <span class="tag-pill__v">{{ profile.dob || '—' }}</span>
            </span>
            <span class="tag-pill">
              <tm-icon name="gift" [size]="11" />
              <span class="tag-pill__k">Referral</span>
              <span class="tag-pill__v mono">{{ profile.referral_code || '—' }}</span>
            </span>
            <span class="tag-pill">
              <tm-icon [name]="profile.used_subscribed ? 'check' : 'x'" [size]="11" />
              <span class="tag-pill__k">Subscription</span>
              <span class="tag-pill__v">{{ profile.used_subscribed ? 'Active' : 'Free' }}</span>
            </span>
            <span class="tag-pill">
              <tm-icon name="shield" [size]="11" />
              <span class="tag-pill__k">Policy</span>
              <span class="tag-pill__v">{{ profile.cancellation_charge_policy || '—' }}</span>
            </span>
            <span class="tag-pill">
              <tm-icon name="phone" [size]="11" />
              <span class="tag-pill__k">App ver</span>
              <span class="tag-pill__v mono">{{ profile.app_version || '—' }}</span>
            </span>
            <span class="tag-pill">
              <tm-icon name="phone" [size]="11" />
              <span class="tag-pill__k">OS</span>
              <span class="tag-pill__v mono">{{ profile.os_version || '—' }}</span>
            </span>
            <span class="tag-pill">
              <tm-icon name="phone" [size]="11" />
              <span class="tag-pill__k">Device</span>
              <span class="tag-pill__v">{{ profile.device_type || '—' }}</span>
            </span>
            <ng-container *ngIf="profile.current_lat != null && profile.current_lng != null; else locEmpty">
              <a
                class="tag-pill tag-pill--link"
                [href]="'https://www.google.com/maps?q=' + profile.current_lat + ',' + profile.current_lng"
                target="_blank"
                rel="noopener"
              >
                <tm-icon name="pin" [size]="11" />
                <span class="tag-pill__k">Location</span>
                <span class="tag-pill__v mono">
                  {{ profile.current_lat | number:'1.4-4' }}, {{ profile.current_lng | number:'1.4-4' }}
                </span>
                <span
                  *ngIf="profile.current_location_updated_at"
                  class="tag-pill__age"
                  [class.is-stale]="isLocationStale"
                  [title]="profile.current_location_updated_at"
                >
                  {{ timeAgo(profile.current_location_updated_at) }}
                </span>
              </a>
            </ng-container>
            <ng-template #locEmpty>
              <span class="tag-pill">
                <tm-icon name="pin" [size]="11" />
                <span class="tag-pill__k">Location</span>
                <span class="tag-pill__v mono">—</span>
              </span>
            </ng-template>
            <span class="tag-pill">
              <tm-icon [name]="profile.duplicate_registration ? 'x' : 'check'" [size]="11" />
              <span class="tag-pill__k">Duplicate reg</span>
              <span class="tag-pill__v">{{ profile.duplicate_registration ? 'Yes' : 'No' }}</span>
            </span>
            <span class="tag-pill">
              <tm-icon name="gift" [size]="11" />
              <span class="tag-pill__k">Referrer code</span>
              <span class="tag-pill__v mono">
                {{ profile.referrer?.referral_code || '—' }}
              </span>
            </span>
          </div>
        </article>

        <article class="about__side">
          <h3 class="about__side-heading">Notifications</h3>
          <p class="about__side-sub">Channels this customer accepts</p>
          <div class="channels">
            <div class="channel" [class.is-off]="profile.email_unsubscribed">
              <span class="channel__icon"><tm-icon name="envelope" [size]="14" /></span>
              <div class="channel__body">
                <span class="channel__title">Email</span>
                <span class="channel__sub">
                  {{ profile.email_unsubscribed ? 'Opted out' : 'Subscribed' }}
                </span>
              </div>
              <span class="channel__led"></span>
            </div>
            <div class="channel" [class.is-off]="profile.sms_unsubscribed">
              <span class="channel__icon"><tm-icon name="phone" [size]="14" /></span>
              <div class="channel__body">
                <span class="channel__title">SMS</span>
                <span class="channel__sub">
                  {{ profile.sms_unsubscribed ? 'Opted out' : 'Subscribed' }}
                </span>
              </div>
              <span class="channel__led"></span>
            </div>
            <div class="channel" [class.is-off]="profile.push_unsubscribed">
              <span class="channel__icon"><tm-icon name="bell" [size]="14" /></span>
              <div class="channel__body">
                <span class="channel__title">Push</span>
                <span class="channel__sub">
                  {{ profile.push_unsubscribed ? 'Opted out' : 'Subscribed' }}
                </span>
              </div>
              <span class="channel__led"></span>
            </div>
          </div>
        </article>
      </section>

      <!-- ============= Activity feed ============= -->
      <section class="feed">
        <header class="feed__head">
          <div class="feed__title">
            <h2 class="feed__heading">Activity</h2>
            <p class="feed__sub">Recent rides, wallet changes and invites.</p>
          </div>

          <div class="feed__nav-wrap">
            <nav class="feed__nav" role="tablist" aria-label="Activity">
              <button
                *ngFor="let t of historyTabs"
                type="button"
                class="feed-tab"
                [class.is-active]="activeTab === t.key"
                (click)="setTab(t.key)"
                role="tab"
                [attr.aria-selected]="activeTab === t.key"
              >
                <tm-icon [name]="t.icon" [size]="13" />
                <span class="feed-tab__label">{{ t.label }}</span>
                <span class="feed-tab__count">{{ tabCount(t.key) }}</span>
              </button>
            </nav>

            <select
              class="feed__select"
              [(ngModel)]="activeTab"
              (ngModelChange)="setTab($event)"
              aria-label="Section"
            >
              <option *ngFor="let t of historyTabs" [ngValue]="t.key">
                {{ t.label }} ({{ tabCount(t.key) }})
              </option>
            </select>
          </div>
        </header>

        <div class="feed__search">
          <tm-input
            icon="search"
            [placeholder]="searchPlaceholder"
            [(ngModel)]="tabSearch"
          />
        </div>

        <!-- Loading skeleton -->
        <div *ngIf="loadingTab" class="feed__loading">
          <div class="feed__skel" *ngFor="let _ of [0,1,2]"></div>
        </div>

        <!-- Empty state -->
        <div *ngIf="!loadingTab && !currentActivity.length" class="feed__empty">
          <span class="feed__empty-icon"><tm-icon [name]="currentTabIcon" [size]="24" /></span>
          <div class="feed__empty-title">{{ emptyTitleFor(activeTab) }}</div>
          <div class="feed__empty-hint">{{ emptyHintFor(activeTab) }}</div>
        </div>

        <!-- ============= RIDES feed ============= -->
        <div *ngIf="!loadingTab && activeTab === 'rides'" class="feed__list">
          <article *ngFor="let r of currentActivity" class="post post--ride">
            <div class="post__leading">
              <span class="post__icon post__icon--ride">
                <tm-icon name="car" [size]="14" />
              </span>
            </div>
            <div class="post__body">
              <header class="post__head">
                <span class="post__who">
                  <span class="post__role">Driver</span>
                  <strong class="post__title">{{ r.driver?.name || 'Unassigned' }}</strong>
                </span>
                <span class="ride-status" [attr.data-s]="statusBucket(r.status)">{{ statusDisplay(r.status) }}</span>
              </header>
              <div class="route-mini">
                <div class="route-mini__line"><span class="pin pin--from"></span>
                  <span class="route-mini__addr">{{ r.pickup_address || pretty(r.pickup_lat, r.pickup_lng) }}</span>
                </div>
                <div class="route-mini__line"><span class="pin pin--to"></span>
                  <span class="route-mini__addr">{{ r.drop_address || pretty(r.drop_lat, r.drop_lng) }}</span>
                </div>
              </div>
              <div class="ride-meta">
                <span class="ride-meta__item" *ngIf="r.ride_type?.name"><tm-icon name="road" [size]="11" /> {{ r.ride_type.name }}</span>
                <span class="ride-meta__item" *ngIf="r.distance_km"><tm-icon name="pin" [size]="11" /> {{ r.distance_km }} km</span>
                <span class="ride-meta__item" *ngIf="r.duration_min"><tm-icon name="calendar" [size]="11" /> {{ r.duration_min }} min</span>
                <span class="ride-meta__item mono" *ngIf="r.payment_method">{{ r.payment_method | uppercase }}</span>
              </div>
              <footer class="post__foot">
                <span class="post__meta mono">#{{ r.id }}</span>
                <span class="post__meta">
                  {{ r.created_at | date:'MMM d, HH:mm' }}<ng-container *ngIf="r.completed_at"> → {{ r.completed_at | date:'HH:mm' }}</ng-container>
                </span>
              </footer>
            </div>
            <div class="post__trailing">
              <div class="ride-fare">
                <span class="post__amount post__amount--credit">₹ {{ r.final_fare ?? r.estimated_fare ?? 0 }}</span>
                <span class="ride-fare__est"
                      *ngIf="r.final_fare != null && r.estimated_fare != null && r.final_fare !== r.estimated_fare">
                  est ₹{{ r.estimated_fare }}
                </span>
              </div>
            </div>
          </article>
        </div>

        <!-- ============= WALLET feed ============= -->
        <div *ngIf="!loadingTab && activeTab === 'wallet'" class="feed__list">
          <article *ngFor="let t of currentActivity" class="post">
            <div class="post__leading">
              <span class="post__icon" [class.post__icon--ride]="t.type === 'credit'"
                                     [class.post__icon--debit]="t.type === 'debit'"
                                     [class.post__icon--warn]="t.type === 'cashback'">
                <tm-icon [name]="t.type === 'debit' ? 'trash' : 'plus'" [size]="14" />
              </span>
            </div>
            <div class="post__body">
              <header class="post__head">
                <strong class="post__title">{{ t.type | titlecase }}</strong>
                <span class="post__time">{{ t.created_at | date:'MMM d, HH:mm' }}</span>
              </header>
              <p class="post__text" [class.muted]="!t.reason">
                {{ t.reason || 'No note attached.' }}
              </p>
              <footer class="post__foot" *ngIf="t.engagement_id">
                <span class="post__meta mono">Engagement #{{ t.engagement_id }}</span>
              </footer>
            </div>
            <div class="post__trailing">
              <span class="post__amount"
                    [class.post__amount--credit]="t.type !== 'debit'"
                    [class.post__amount--debit]="t.type === 'debit'">
                {{ t.type === 'debit' ? '−' : '+' }} ₹ {{ t.amount }}
              </span>
            </div>
          </article>
        </div>

        <!-- ============= CANCELLED feed ============= -->
        <div *ngIf="!loadingTab && activeTab === 'cancelled'" class="feed__list">
          <article *ngFor="let c of currentActivity" class="post">
            <div class="post__leading">
              <span class="post__icon post__icon--debit">
                <tm-icon name="x" [size]="14" />
              </span>
            </div>
            <div class="post__body">
              <header class="post__head">
                <strong class="post__title">Ride cancelled</strong>
                <span class="post__time">{{ c.created_at | date:'MMM d, HH:mm' }}</span>
              </header>
              <p class="post__text" [class.muted]="!c.cancelled_reason">
                {{ c.cancelled_reason || 'No reason recorded.' }}
              </p>
              <footer class="post__foot">
                <span class="post__meta mono">#{{ c.id }}</span>
              </footer>
            </div>
          </article>
        </div>

        <!-- ============= REFERRALS feed ============= -->
        <div *ngIf="!loadingTab && activeTab === 'referrals'" class="feed__list">
          <article *ngFor="let p of currentActivity" class="post">
            <div class="post__leading">
              <span class="post__avatar">{{ initials(p.name) }}</span>
            </div>
            <div class="post__body">
              <header class="post__head">
                <strong class="post__title">{{ p.name || 'Unnamed user' }}</strong>
                <span class="post__time">joined {{ p.created_at | date:'MMM d, y' }}</span>
              </header>
              <footer class="post__foot">
                <span class="post__meta mono" *ngIf="p.phone">{{ p.phone }}</span>
                <span class="post__meta" *ngIf="p.email">{{ p.email }}</span>
                <span class="post__meta mono">#{{ p.id }}</span>
              </footer>
            </div>
          </article>
        </div>
      </section>
    </div>

    <ng-template #loading>
      <div class="page-loading">
        <span class="spinner" aria-hidden="true"></span>
        <span>Loading customer…</span>
      </div>
    </ng-template>

    <!-- =================== Block / Delete modal =================== -->
    <tm-modal
      [open]="blockDeleteOpen"
      [title]="profile?.is_suspended ? 'Manage user access' : 'Restrict this user'"
      (closed)="blockDeleteOpen = false"
    >
      <div slot="body">
        <p class="hint hint--top">
          Pick an action below. Blocking can be reversed later — deletion cannot.
        </p>

        <!-- Action selector -->
        <div class="action-toggle">
          <button
            type="button"
            class="action-toggle__btn"
            [class.is-active]="blockMode === 'block'"
          [class.is-warn]="blockMode === 'block'"
            (click)="blockMode = 'block'"
          >
            <span class="action-toggle__icon">
              <tm-icon [name]="profile?.is_suspended ? 'check' : 'shield'" [size]="14" />
            </span>
            <span class="action-toggle__title">
              {{ profile?.is_suspended ? 'Unblock' : 'Block' }}
            </span>
            <span class="action-toggle__sub">Reversible</span>
          </button>
          <button
            type="button"
            class="action-toggle__btn"
            [class.is-active]="blockMode === 'delete'"
            [class.is-danger]="blockMode === 'delete'"
            (click)="blockMode = 'delete'"
          >
            <span class="action-toggle__icon">
              <tm-icon name="trash" [size]="14" />
            </span>
            <span class="action-toggle__title">Delete</span>
            <span class="action-toggle__sub">Permanent</span>
          </button>
        </div>

        <!-- Block path -->
        <ng-container *ngIf="blockMode === 'block' && !profile?.is_suspended">
          <label class="lbl"><span class="req">*</span> Reason for blocking</label>
          <select class="form-input" [(ngModel)]="blockReason">
            <option value="">Select a reason…</option>
            <option *ngFor="let r of blockReasons" [value]="r">{{ r }}</option>
          </select>
        </ng-container>

        <div class="notice notice--info" *ngIf="blockMode === 'block' && profile?.is_suspended">
          <tm-icon name="check" [size]="14" />
          <span>
            Unblocking will restore the user's full access immediately.
            They will be able to log in and book rides again.
          </span>
        </div>

        <!-- Delete path -->
        <ng-container *ngIf="blockMode === 'delete'">
          <div class="notice notice--danger">
            <tm-icon name="trash" [size]="14" />
            <span>
              This action <strong>cannot be undone</strong>. The user's records
              will be permanently deleted.
            </span>
          </div>
          <label class="lbl">
            <span class="req">*</span> Reason for deletion
            <span class="hint">{{ deleteReason.length }} / 50</span>
          </label>
          <textarea
            class="form-input form-textarea"
            rows="3"
            maxlength="50"
            [(ngModel)]="deleteReason"
            placeholder="Why is this user being deleted?"
          ></textarea>
        </ng-container>
      </div>

      <ng-container slot="footer">
        <tm-button variant="ghost" (clicked)="blockDeleteOpen = false">Cancel</tm-button>

        <tm-button
          *ngIf="blockMode === 'block'"
          [variant]="profile?.is_suspended ? 'green' : 'ink'"
          [icon]="profile?.is_suspended ? 'check' : 'shield'"
          [loading]="blockSaving"
          [disabled]="!profile?.is_suspended && !blockReason"
          (clicked)="submitBlock()"
        >
          {{ profile?.is_suspended ? 'Unblock user' : 'Block user' }}
        </tm-button>

        <tm-button
          *ngIf="blockMode === 'delete'"
          variant="danger"
          icon="trash"
          [loading]="deleteSaving"
          [disabled]="!deleteReason.trim()"
          (clicked)="submitDelete()"
        >
          Delete permanently
        </tm-button>
      </ng-container>
    </tm-modal>

    <!-- =================== Unsubscribe modal =================== -->
    <tm-modal
      [open]="unsubOpen"
      title="Subscription preferences"
      (closed)="unsubOpen = false"
    >
      <div slot="body">
        <p class="hint">
          Toggle which channels this customer is unsubscribed from. Changes are saved when you submit.
        </p>
        <div class="check-list">
          <label class="check" [class.is-on]="unsubEmail">
            <input type="checkbox" [(ngModel)]="unsubEmail" />
            <span class="check__box"><tm-icon name="check" [size]="11" /></span>
            <span class="check__body">
              <span class="check__title">Unsubscribe email</span>
              <span class="check__sub">Promotional + transactional emails</span>
            </span>
          </label>
          <label class="check" [class.is-on]="unsubSms">
            <input type="checkbox" [(ngModel)]="unsubSms" />
            <span class="check__box"><tm-icon name="check" [size]="11" /></span>
            <span class="check__body">
              <span class="check__title">Unsubscribe SMS</span>
              <span class="check__sub">Trip updates, OTPs (except security)</span>
            </span>
          </label>
          <label class="check" [class.is-on]="unsubPush">
            <input type="checkbox" [(ngModel)]="unsubPush" />
            <span class="check__box"><tm-icon name="check" [size]="11" /></span>
            <span class="check__body">
              <span class="check__title">Unsubscribe push</span>
              <span class="check__sub">App notifications</span>
            </span>
          </label>
        </div>
      </div>
      <ng-container slot="footer">
        <tm-button variant="ghost" (clicked)="unsubOpen = false">Cancel</tm-button>
        <tm-button variant="green" icon="check" [loading]="unsubSaving" (clicked)="submitUnsub()">
          Save preferences
        </tm-button>
      </ng-container>
    </tm-modal>

    <!-- =================== Wallet modal =================== -->
    <tm-modal
      [open]="walletOpen"
      title="Adjust wallet balance"
      (closed)="walletOpen = false"
    >
      <div slot="body">
        <div class="balance-row">
          <span class="balance-row__lbl">Current balance</span>
          <span class="balance-row__val">₹ {{ (profile?.wallet_balance || 0) | number:'1.2-2' }}</span>
        </div>

        <div class="action-toggle">
          <button
            *ngFor="let t of walletTypes"
            type="button"
            class="action-toggle__btn"
            [class.is-active]="walletType === t.value"
            [class.is-credit]="t.value === 'credit'"
            [class.is-debit]="t.value === 'debit'"
            (click)="walletType = t.value"
          >
            <span class="action-toggle__icon">
              <tm-icon [name]="t.icon" [size]="14" />
            </span>
            <span class="action-toggle__title">{{ t.label }}</span>
            <span class="action-toggle__sub">{{ t.desc }}</span>
          </button>
        </div>

        <label class="lbl">Amount (₹)</label>
        <input
          class="form-input"
          type="number"
          min="1"
          [(ngModel)]="walletAmount"
          placeholder="e.g. 250"
        />

        <label class="lbl">Reason</label>
        <textarea
          class="form-input form-textarea"
          rows="3"
          [(ngModel)]="walletReason"
          placeholder="Internal note for this adjustment"
        ></textarea>
      </div>
      <ng-container slot="footer">
        <tm-button variant="ghost" (clicked)="walletOpen = false">Cancel</tm-button>
        <tm-button
          [variant]="walletType === 'debit' ? 'danger' : 'green'"
          icon="check"
          [loading]="walletSaving"
          [disabled]="!walletAmount || walletAmount <= 0"
          (clicked)="submitWallet()"
        >
          {{ walletType === 'debit' ? 'Debit wallet' : 'Credit wallet' }}
        </tm-button>
      </ng-container>
    </tm-modal>
  `,
  styles: [`
    :host { display: block; }
    .page {
      display: flex;
      flex-direction: column;
      gap: var(--tm-space-5);
    }

    /* -------------------- Back link -------------------- */
    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      align-self: flex-start;
      padding: 6px 12px 6px 8px;
      border-radius: var(--tm-radius-pill);
      background: var(--tm-canvas-2);
      color: var(--tm-text-muted);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      text-decoration: none;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .back-link:hover { background: var(--tm-ink); color: #fff; }

    /* -------------------- Profile cover -------------------- */
    .cover {
      position: relative;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg);
      overflow: hidden;
    }
    .cover__banner {
      height: 120px;
      background:
        radial-gradient(circle at 30% 50%, rgba(34, 197, 94, 0.45), transparent 60%),
        radial-gradient(circle at 80% 30%, rgba(255, 255, 255, 0.18), transparent 60%),
        linear-gradient(135deg, var(--tm-ink), var(--tm-ink-3));
    }
    .cover__inner {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: var(--tm-space-4);
      align-items: flex-start;
      padding: 0 var(--tm-space-5) var(--tm-space-5);
      margin-top: -48px;
    }
    .cover__avatar {
      width: 96px; height: 96px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--tm-green), var(--tm-green-deep));
      color: #fff;
      display: grid; place-items: center;
      font-size: 30px;
      font-weight: 800;
      letter-spacing: 0.02em;
      flex-shrink: 0;
      border: 4px solid var(--tm-surface);
      box-shadow: var(--tm-shadow-card);
    }
    /* Photo variant — must come AFTER the base rule to win specificity. */
    .cover__avatar--photo {
      background-color: var(--tm-canvas-2);
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
    }
    .cover__body {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
      padding-top: 56px;
    }
    .cover__title-row {
      display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
    }
    .cover__name {
      margin: 0;
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: var(--tm-text);
      line-height: 1.1;
    }
    .cover__handle {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 600;
      color: var(--tm-text-muted);
    }
    .cover__handle .mono {
      font-family: var(--tm-font-mono);
      color: var(--tm-text);
      font-weight: 700;
    }
    .cover__handle-sep { color: var(--tm-text-soft); }

    .cover__contacts {
      display: flex; flex-wrap: wrap; gap: 6px;
      margin-top: 4px;
    }
    .contact {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 10px;
      border-radius: var(--tm-radius-pill);
      background: var(--tm-canvas);
      border: 1px solid var(--tm-line);
      color: var(--tm-text);
      font-size: 12px;
      font-weight: 600;
      text-decoration: none;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .contact:not(.contact--static):hover {
      background: var(--tm-ink);
      color: #fff;
      border-color: var(--tm-ink);
    }
    .contact--static { cursor: default; }
    .contact--empty {
      background: transparent;
      color: var(--tm-text-soft);
      border-style: dashed;
    }
    .contact--empty .contact__icon { color: var(--tm-text-soft); }

    /* Live location pill — sits among the contact pills with a green
       accent so it's instantly distinguishable from static info. */
    .contact--live {
      background: var(--tm-green-tint);
      border-color: var(--tm-green-deep);
      color: var(--tm-green-deep);
    }
    .contact--live .contact__icon { color: var(--tm-green-deep); }
    .contact--live:hover {
      background: var(--tm-green);
      border-color: var(--tm-green-deep);
      color: #fff;
    }
    .contact--live:hover .contact__icon { color: #fff; }
    .contact__age {
      display: inline-flex;
      align-items: center;
      padding: 1px 6px;
      border-radius: var(--tm-radius-pill);
      background: rgba(22, 163, 74, 0.12);
      color: var(--tm-green-deep);
      font-family: var(--tm-font-mono);
      font-size: 10px;
      font-weight: 800;
      margin-left: 4px;
    }
    .contact__age.is-stale {
      background: var(--tm-canvas-2);
      color: var(--tm-text-soft);
    }
    .contact--live:hover .contact__age {
      background: rgba(255, 255, 255, 0.22);
      color: #fff;
    }
    .contact__icon { display: inline-flex; color: var(--tm-text-muted); }
    .contact:not(.contact--static):hover .contact__icon { color: #fff; }
    .contact__k {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--tm-text-muted);
    }
    .contact--empty .contact__k { color: var(--tm-text-soft); }
    .contact--live .contact__k { color: var(--tm-green-deep); }
    .contact:not(.contact--static):hover .contact__k,
    .contact--live:hover .contact__k { color: rgba(255, 255, 255, 0.7); }
    .contact__text.mono { font-family: var(--tm-font-mono); }

    .cover__actions {
      display: flex; align-items: center; gap: 8px;
      padding-top: 56px;
      position: relative;
    }
    .more-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 34px; height: 34px;
      border-radius: var(--tm-radius-md);
      border: 1px solid var(--tm-line-2);
      background: var(--tm-surface);
      color: var(--tm-text-muted);
      cursor: pointer;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .more-btn:hover { background: var(--tm-canvas-2); color: var(--tm-text); }
    .more-btn.is-open { background: var(--tm-ink); color: #fff; border-color: var(--tm-ink); }

    .more-menu {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      box-shadow: var(--tm-shadow-pop);
      min-width: 220px;
      padding: 4px;
      z-index: 60;
      animation: mm-in 160ms var(--tm-ease) both;
    }
    @keyframes mm-in {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .more-menu__item {
      display: flex; align-items: center; gap: 10px;
      width: 100%;
      padding: 9px 12px;
      border-radius: var(--tm-radius-sm);
      background: transparent;
      color: var(--tm-text);
      font-size: 13px;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
      transition: background var(--tm-duration-fast) var(--tm-ease);
    }
    .more-menu__item:hover { background: var(--tm-canvas); }
    .more-menu__item--danger { color: var(--tm-danger-fg); }
    .more-menu__item--danger:hover { background: var(--tm-danger-bg); }

    /* -------------------- Stat row -------------------- */
    .stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: var(--tm-space-3);
    }
    .stat-card {
      padding: var(--tm-space-4);
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-md);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .stat-card__icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px; height: 30px;
      border-radius: var(--tm-radius-sm);
      background: var(--tm-canvas-2);
      color: var(--tm-text-muted);
      margin-bottom: 2px;
    }
    .stat-card__icon--green { background: var(--tm-green-tint); color: var(--tm-green-deep); }
    .stat-card__value {
      font-family: var(--tm-font-display);
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: var(--tm-text);
      line-height: 1.1;
    }
    .stat-card__label {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--tm-text-muted);
    }

    /* -------------------- About section -------------------- */
    .about {
      display: grid;
      grid-template-columns: 1.8fr 1fr;
      gap: var(--tm-space-3);
    }
    .about__main,
    .about__side {
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg);
      padding: var(--tm-space-5);
    }
    .about__heading,
    .about__side-heading {
      margin: 0 0 8px;
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--tm-text-muted);
    }
    .about__text {
      margin: 0;
      font-size: 14px;
      font-weight: 500;
      line-height: 1.7;
      color: var(--tm-text);
    }
    .about__text strong { font-weight: 700; }
    .about__warn { color: var(--tm-danger-fg); font-weight: 700; }

    .about__tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: var(--tm-space-4);
    }
    .tag-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background: var(--tm-canvas);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-pill);
      font-size: 11px;
      font-weight: 700;
      color: var(--tm-text);
    }
    .tag-pill__k {
      color: var(--tm-text-muted);
      font-size: 10px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .tag-pill__v { color: var(--tm-text); }
    .tag-pill__v.mono { font-family: var(--tm-font-mono); font-size: 11px; }
    .tag-pill--ink {
      background: var(--tm-ink);
      border-color: var(--tm-ink);
      color: #fff;
    }
    .tag-pill--ink .tag-pill__k { color: rgba(255, 255, 255, 0.6); }
    .tag-pill--ink .tag-pill__v { color: #fff; }
    .tag-pill--link {
      text-decoration: none;
      cursor: pointer;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease),
                  border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .tag-pill--link:hover {
      background: var(--tm-green);
      border-color: var(--tm-green-deep);
      color: #fff;
    }
    .tag-pill--link:hover .tag-pill__k,
    .tag-pill--link:hover .tag-pill__v { color: #fff; }

    /* Age chip appended to the location pill */
    .tag-pill__age {
      display: inline-flex;
      align-items: center;
      padding: 1px 6px;
      border-radius: var(--tm-radius-pill);
      background: var(--tm-green-tint);
      color: var(--tm-green-deep);
      font-family: var(--tm-font-mono);
      font-size: 10px;
      font-weight: 800;
      margin-left: 2px;
    }
    .tag-pill__age.is-stale {
      background: var(--tm-canvas-2);
      color: var(--tm-text-soft);
    }
    .tag-pill--link:hover .tag-pill__age {
      background: rgba(255, 255, 255, 0.18);
      color: #fff;
    }

    .about__side-heading { margin-bottom: 4px; }
    .about__side-sub {
      margin: 0 0 var(--tm-space-3);
      font-size: 12px;
      color: var(--tm-text-muted);
      font-weight: 500;
    }
    .channels { display: flex; flex-direction: column; gap: 8px; }
    .channel {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      background: var(--tm-green-tint);
      border: 1px solid var(--tm-green-deep);
      border-radius: var(--tm-radius-md);
    }
    .channel.is-off {
      background: var(--tm-canvas);
      border-color: var(--tm-line);
    }
    .channel__icon {
      width: 32px; height: 32px;
      border-radius: 50%;
      background: var(--tm-green);
      color: #fff;
      display: grid; place-items: center;
      flex-shrink: 0;
    }
    .channel.is-off .channel__icon {
      background: var(--tm-canvas-2);
      color: var(--tm-text-soft);
    }
    .channel__body { flex: 1; display: flex; flex-direction: column; gap: 1px; }
    .channel__title { font-size: 13px; font-weight: 700; color: var(--tm-text); }
    .channel__sub { font-size: 11px; font-weight: 600; color: var(--tm-text-muted); }
    .channel__led {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: var(--tm-green);
    }
    .channel.is-off .channel__led { background: var(--tm-text-soft); }

    .mono { font-family: var(--tm-font-mono); font-weight: 600; font-size: 12px; }
    .muted { color: var(--tm-text-soft); }

    /* -------------------- Activity feed -------------------- */
    .feed {
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg);
      padding: var(--tm-space-5);
      display: flex;
      flex-direction: column;
      gap: var(--tm-space-4);
    }
    .feed__head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--tm-space-3);
      flex-wrap: wrap;
    }
    .feed__title { display: flex; flex-direction: column; gap: 4px; }
    .feed__heading {
      margin: 0;
      font-size: 18px;
      font-weight: 800;
      letter-spacing: -0.01em;
      color: var(--tm-text);
    }
    .feed__sub {
      margin: 0;
      font-size: 12px;
      color: var(--tm-text-muted);
      font-weight: 500;
    }
    .feed__nav-wrap { display: flex; align-items: center; }
    .feed__nav {
      display: flex;
      gap: 4px;
      padding: 4px;
      background: var(--tm-canvas);
      border-radius: var(--tm-radius-md);
      max-width: 100%;
    }
    .feed-tab {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 12px;
      border-radius: var(--tm-radius-sm);
      font-weight: 700;
      font-size: 12px;
      color: var(--tm-text-muted);
      background: transparent;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .feed-tab:hover { color: var(--tm-text); }
    .feed-tab.is-active {
      background: var(--tm-ink);
      color: #fff;
    }
    .feed-tab__count {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 20px;
      height: 18px;
      padding: 0 6px;
      border-radius: var(--tm-radius-pill);
      font-family: var(--tm-font-mono);
      font-size: 10px;
      font-weight: 800;
      background: rgba(15, 20, 25, 0.08);
      color: var(--tm-text-muted);
    }
    .feed-tab.is-active .feed-tab__count {
      background: rgba(255, 255, 255, 0.18);
      color: #fff;
    }
    .feed__select {
      display: none;
      appearance: none;
      -webkit-appearance: none;
      padding: 10px 32px 10px 14px;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      background: var(--tm-surface);
      font-family: inherit;
      font-size: 13px;
      font-weight: 700;
      color: var(--tm-text);
      width: 100%;
      background-image:
        linear-gradient(45deg, transparent 50%, var(--tm-text-soft) 50%),
        linear-gradient(135deg, var(--tm-text-soft) 50%, transparent 50%);
      background-position:
        calc(100% - 18px) center,
        calc(100% - 12px) center;
      background-size: 6px 6px, 6px 6px;
      background-repeat: no-repeat;
    }

    .feed__search { max-width: 380px; }

    /* Feed loading skeleton */
    .feed__loading { display: flex; flex-direction: column; gap: 12px; }
    .feed__skel {
      height: 80px;
      border-radius: var(--tm-radius-md);
      background: linear-gradient(
        90deg,
        var(--tm-canvas) 0%,
        var(--tm-canvas-2) 50%,
        var(--tm-canvas) 100%
      );
      background-size: 200% 100%;
      animation: feed-shimmer 1.2s linear infinite;
    }
    @keyframes feed-shimmer {
      0%   { background-position: 100% 0; }
      100% { background-position: -100% 0; }
    }

    /* Feed empty state */
    .feed__empty {
      display: flex; flex-direction: column; align-items: center;
      text-align: center;
      gap: 8px;
      padding: var(--tm-space-10) var(--tm-space-4);
    }
    .feed__empty-icon {
      width: 60px; height: 60px;
      border-radius: var(--tm-radius-lg);
      background: var(--tm-canvas-2);
      color: var(--tm-text-muted);
      display: grid; place-items: center;
      margin-bottom: var(--tm-space-2);
    }
    .feed__empty-title {
      font-size: 16px;
      font-weight: 800;
      color: var(--tm-text);
    }
    .feed__empty-hint {
      font-size: 13px;
      color: var(--tm-text-muted);
      font-weight: 500;
      max-width: 32ch;
    }

    /* Feed posts */
    .feed__list { display: flex; flex-direction: column; gap: 10px; }
    .post {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: flex-start;
      gap: 14px;
      padding: 16px;
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-md);
      background: var(--tm-surface);
      transition: border-color var(--tm-duration-fast) var(--tm-ease),
                  box-shadow var(--tm-duration-fast) var(--tm-ease);
    }
    .post:hover {
      border-color: var(--tm-line-2);
      box-shadow: var(--tm-shadow-sm);
    }
    .post__leading { display: flex; }
    .post__icon {
      width: 36px; height: 36px;
      border-radius: 50%;
      background: var(--tm-canvas-2);
      color: var(--tm-text-muted);
      display: grid; place-items: center;
      flex-shrink: 0;
    }
    .post__icon--ride { background: var(--tm-green-tint); color: var(--tm-green-deep); }
    .post__icon--debit { background: var(--tm-danger-bg); color: var(--tm-danger-fg); }
    .post__icon--warn { background: var(--tm-warning-bg); color: var(--tm-warning-fg); }
    .post__avatar {
      width: 36px; height: 36px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--tm-ink), var(--tm-ink-3));
      color: #fff;
      display: grid; place-items: center;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.02em;
      flex-shrink: 0;
    }

    .post__body { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    .post__head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
    }
    .post__title {
      font-size: 14px;
      font-weight: 700;
      color: var(--tm-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .post__time {
      font-family: var(--tm-font-mono);
      font-size: 11px;
      font-weight: 600;
      color: var(--tm-text-muted);
      white-space: nowrap;
    }
    .post__text {
      margin: 0;
      font-size: 13px;
      font-weight: 500;
      color: var(--tm-text);
      line-height: 1.5;
    }
    .post__foot {
      display: flex; flex-wrap: wrap; gap: 8px;
      font-size: 11px;
      font-weight: 600;
      color: var(--tm-text-muted);
    }
    .post__meta {
      display: inline-flex; align-items: center; gap: 4px;
    }
    .post__meta.mono { font-family: var(--tm-font-mono); }

    .post__trailing { display: flex; align-items: flex-start; }
    .post__amount {
      display: inline-flex;
      align-items: center;
      padding: 4px 10px;
      border-radius: var(--tm-radius-pill);
      font-family: var(--tm-font-mono);
      font-size: 13px;
      font-weight: 800;
    }
    .post__amount--credit {
      background: var(--tm-green-tint);
      color: var(--tm-green-deep);
    }
    .post__amount--debit {
      background: var(--tm-danger-bg);
      color: var(--tm-danger-fg);
    }

    /* Rich ride card */
    .post--ride .post__head { align-items: flex-start; }
    .post__who { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .post__role {
      font-size: 9px; font-weight: 800; letter-spacing: 0.1em;
      text-transform: uppercase; color: var(--tm-text-soft);
    }
    .ride-status {
      display: inline-flex; align-items: center;
      padding: 3px 9px;
      border-radius: var(--tm-radius-pill);
      font-size: 10px; font-weight: 800; letter-spacing: 0.04em;
      text-transform: capitalize; white-space: nowrap;
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
    }
    .ride-status[data-s="completed"] { background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .ride-status[data-s="cancelled"] { background: var(--tm-danger-bg);  color: var(--tm-danger-fg); }
    .ride-status[data-s="ongoing"]   { background: var(--tm-warning-bg); color: var(--tm-warning-fg); }
    .ride-status[data-s="pending"]   { background: var(--tm-info-bg);    color: var(--tm-info-fg); }
    .ride-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
    .ride-meta__item {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 8px; border-radius: var(--tm-radius-pill);
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
      font-size: 11px; font-weight: 700;
    }
    .ride-meta__item.mono { font-family: var(--tm-font-mono); }
    .ride-fare { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .ride-fare__est {
      font-size: 10px; font-weight: 700;
      color: var(--tm-text-soft); font-family: var(--tm-font-mono);
    }

    /* Mini route in ride posts */
    .route-mini {
      position: relative;
      padding-left: 4px;
    }
    .route-mini::before {
      content: '';
      position: absolute;
      left: 9px;
      top: 16px;
      bottom: 16px;
      width: 2px;
      background: repeating-linear-gradient(
        to bottom,
        var(--tm-line-2) 0 3px,
        transparent 3px 6px
      );
    }
    .route-mini__line {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 2px 0;
      font-size: 12px;
      color: var(--tm-text);
    }
    .route-mini__addr {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pin {
      width: 10px; height: 10px;
      border-radius: 50%;
      border: 2px solid #fff;
      box-shadow: 0 0 0 1px var(--tm-line-2);
      flex-shrink: 0;
    }
    .pin--from { background: var(--tm-ink); }
    .pin--to   { background: var(--tm-green); }

    /* -------------------- Cell helpers -------------------- */
    .cell-stack { display: flex; flex-direction: column; gap: 2px; }
    .cell-primary { font-size: 13px; font-weight: 700; color: var(--tm-text); }
    .cell-secondary { font-size: 11px; font-weight: 600; color: var(--tm-text-muted); }
    .chip-mono {
      display: inline-flex; align-items: center;
      padding: 3px 8px;
      border-radius: var(--tm-radius-pill);
      background: var(--tm-canvas-2);
      font-family: var(--tm-font-mono);
      font-size: 11px;
      font-weight: 700;
      color: var(--tm-text);
    }
    .fare-chip {
      display: inline-flex; align-items: center;
      padding: 3px 8px;
      border-radius: var(--tm-radius-pill);
      background: var(--tm-green-tint);
      color: var(--tm-green-deep);
      font-family: var(--tm-font-mono);
      font-size: 12px;
      font-weight: 800;
    }
    .fare-chip.is-debit {
      background: var(--tm-danger-bg);
      color: var(--tm-danger-fg);
    }
    .meta-chip {
      display: inline-flex; align-items: center;
      padding: 3px 8px;
      border-radius: var(--tm-radius-pill);
      background: var(--tm-canvas-2);
      color: var(--tm-text);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.06em;
    }

    /* -------------------- Page loading -------------------- */
    .page-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: var(--tm-space-10);
      color: var(--tm-text-muted);
      font-weight: 600;
    }
    .spinner {
      width: 18px; height: 18px;
      border-radius: 50%;
      border: 2px solid var(--tm-line-2);
      border-top-color: var(--tm-green);
      animation: cd-spin 0.7s linear infinite;
    }
    @keyframes cd-spin { to { transform: rotate(360deg); } }

    /* -------------------- Modal form pieces -------------------- */
    .lbl {
      display: block;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--tm-text-muted);
      margin: 14px 0 6px;
    }
    .lbl:first-child { margin-top: 0; }
    .req { color: var(--tm-danger); margin-right: 2px; }
    .hint {
      font-weight: 600;
      font-size: 11px;
      color: var(--tm-text-soft);
      letter-spacing: 0;
      text-transform: none;
      margin-left: 6px;
    }
    .form-input {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      font-family: inherit;
      font-size: 14px;
      outline: none;
      background: var(--tm-surface);
      color: var(--tm-text);
      transition: border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .form-input:focus { border-color: var(--tm-ink); }
    .form-input:disabled {
      background: var(--tm-canvas);
      color: var(--tm-text-muted);
      cursor: not-allowed;
    }
    .form-textarea { resize: vertical; min-height: 64px; font-family: inherit; }

    /* Two-pane block/delete modal */
    .modal-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--tm-space-3);
    }
    .modal-pane {
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-md);
      overflow: hidden;
      display: flex; flex-direction: column;
    }
    .pane-head {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 14px;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #fff;
    }
    .pane-head--block { background: var(--tm-ink); }
    .pane-head--delete { background: var(--tm-danger); }
    .pane-body { padding: var(--tm-space-4); display: flex; flex-direction: column; }

    /* Subscription check list */
    .check-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
    .check {
      display: flex; align-items: center; gap: 12px;
      padding: 12px;
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-md);
      cursor: pointer;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .check:hover { background: var(--tm-canvas); }
    .check.is-on {
      background: var(--tm-green-tint);
      border-color: var(--tm-green-deep);
    }
    .check input { display: none; }
    .check__box {
      width: 20px; height: 20px;
      border-radius: 6px;
      background: var(--tm-canvas-2);
      color: transparent;
      display: grid; place-items: center;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .check.is-on .check__box { background: var(--tm-green); color: #fff; }
    .check__body { display: flex; flex-direction: column; gap: 1px; }
    .check__title { font-size: 13px; font-weight: 700; color: var(--tm-text); }
    .check__sub { font-size: 11px; font-weight: 500; color: var(--tm-text-muted); }

    /* Action toggle (used in wallet + block/delete modal) */
    .action-toggle {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin: 4px 0 6px;
    }
    .action-toggle__btn {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      padding: 12px 14px;
      border-radius: var(--tm-radius-md);
      border: 1px solid var(--tm-line-2);
      background: var(--tm-surface);
      text-align: left;
      cursor: pointer;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease),
                  border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .action-toggle__btn:hover { border-color: var(--tm-text-soft); }
    .action-toggle__icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px; height: 28px;
      border-radius: var(--tm-radius-sm);
      background: var(--tm-canvas-2);
      color: var(--tm-text-muted);
      margin-bottom: 2px;
    }
    .action-toggle__title {
      font-size: 14px;
      font-weight: 800;
      color: var(--tm-text);
      letter-spacing: -0.01em;
    }
    .action-toggle__sub {
      font-size: 11px;
      font-weight: 600;
      color: var(--tm-text-muted);
    }
    .action-toggle__btn.is-active {
      background: var(--tm-canvas);
      border-color: var(--tm-ink);
    }
    .action-toggle__btn.is-credit.is-active {
      background: var(--tm-green-tint);
      border-color: var(--tm-green-deep);
    }
    .action-toggle__btn.is-credit.is-active .action-toggle__icon {
      background: var(--tm-green);
      color: #fff;
    }
    .action-toggle__btn.is-debit.is-active,
    .action-toggle__btn.is-danger.is-active {
      background: var(--tm-danger-bg);
      border-color: var(--tm-danger);
    }
    .action-toggle__btn.is-debit.is-active .action-toggle__icon,
    .action-toggle__btn.is-danger.is-active .action-toggle__icon {
      background: var(--tm-danger);
      color: #fff;
    }
    .action-toggle__btn.is-warn.is-active {
      background: var(--tm-warning-bg);
      border-color: var(--tm-warning);
    }
    .action-toggle__btn.is-warn.is-active .action-toggle__icon {
      background: var(--tm-warning);
      color: #fff;
    }

    /* Wallet balance highlight inside modal */
    .balance-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      background: var(--tm-canvas);
      border-radius: var(--tm-radius-md);
      margin-bottom: 4px;
    }
    .balance-row__lbl {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--tm-text-muted);
    }
    .balance-row__val {
      font-family: var(--tm-font-mono);
      font-size: 16px;
      font-weight: 800;
      color: var(--tm-text);
    }

    /* Notice banners inside modals */
    .notice {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 12px;
      border-radius: var(--tm-radius-md);
      font-size: 12px;
      font-weight: 500;
      line-height: 1.5;
      margin: 8px 0 0;
    }
    .notice--info {
      background: var(--tm-green-tint);
      color: var(--tm-green-deep);
    }
    .notice--danger {
      background: var(--tm-danger-bg);
      color: var(--tm-danger-fg);
    }
    .hint--top { margin: 0 0 14px; }

    /* -------------------- Responsive -------------------- */
    @media (max-width: 1100px) {
      .about { grid-template-columns: 1fr; }
      .stats { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 820px) {
      .cover__inner {
        grid-template-columns: 1fr;
        margin-top: -56px;
      }
      .cover__avatar { width: 84px; height: 84px; font-size: 26px; }
      .cover__body { padding-top: 0; }
      .cover__actions {
        padding-top: 0;
        justify-content: flex-start;
        flex-wrap: wrap;
      }
      .feed__head {
        flex-direction: column;
        align-items: stretch;
      }
      .feed__nav-wrap { width: 100%; }
    }
    @media (max-width: 640px) {
      .stats { grid-template-columns: 1fr 1fr; }
      .cover__name { font-size: 22px; }
      .action-toggle { grid-template-columns: 1fr; }
      .feed__nav { display: none; }
      .feed__select { display: block; }
      .post {
        grid-template-columns: auto 1fr;
        row-gap: 4px;
      }
      .post__trailing {
        grid-column: 1 / -1;
        justify-content: flex-end;
      }
    }
  `],
})
export class CustomerDetailComponent implements OnInit {
  customerId!: number;
  profile: CustomerProfile | null = null;

  // Tabs
  activeTab: TabKey = 'rides';
  loadingTab = false;
  rides: any[] = [];
  walletTxns: any[] = [];
  cancelledRides: any[] = [];
  referrals: any[] = [];
  tabSearch = '';

  // Send OTP
  otpSending = false;

  // Block / Delete modal
  blockDeleteOpen = false;
  blockMode: 'block' | 'delete' = 'block';
  blockReason = '';
  deleteReason = '';
  blockSaving = false;
  deleteSaving = false;
  readonly blockReasons = BLOCK_REASONS;

  readonly historyTabs: { key: TabKey; label: string; icon: 'car' | 'tag' | 'x' | 'users' }[] = [
    { key: 'rides',     label: 'Rides',     icon: 'car' },
    { key: 'wallet',    label: 'Wallet',    icon: 'tag' },
    { key: 'cancelled', label: 'Cancelled', icon: 'x' },
    { key: 'referrals', label: 'Referrals', icon: 'users' },
  ];

  /** "More" actions dropdown in the cover. */
  moreMenuOpen = false;

  tabCount(key: TabKey): number {
    switch (key) {
      case 'rides':     return this.rides.length;
      case 'wallet':    return this.walletTxns.length;
      case 'cancelled': return this.cancelledRides.length;
      case 'referrals': return this.referrals.length;
    }
  }

  get currentTabIcon(): 'car' | 'tag' | 'x' | 'users' {
    return this.historyTabs.find((t) => t.key === this.activeTab)?.icon ?? 'car';
  }

  get currentActivity(): any[] {
    switch (this.activeTab) {
      case 'rides':     return this.filteredRides;
      case 'wallet':    return this.filteredWallet;
      case 'cancelled': return this.filteredCancelled;
      case 'referrals': return this.filteredReferrals;
    }
  }

  get searchPlaceholder(): string {
    switch (this.activeTab) {
      case 'rides':     return 'Search by driver, engagement or fare…';
      case 'wallet':    return 'Search by reason, engagement or amount…';
      case 'cancelled': return 'Search cancelled rides…';
      case 'referrals': return 'Search by name, phone or email…';
    }
  }

  emptyTitleFor(tab: TabKey): string {
    switch (tab) {
      case 'rides':     return 'No rides yet';
      case 'wallet':    return 'No wallet activity';
      case 'cancelled': return 'No cancellations';
      case 'referrals': return 'No referrals';
    }
  }

  emptyHintFor(tab: TabKey): string {
    switch (tab) {
      case 'rides':     return "When this customer takes a trip, it'll appear here.";
      case 'wallet':    return 'Credits and debits will show up here as soon as they happen.';
      case 'cancelled': return 'Cancelled trips will show up in this feed.';
      case 'referrals': return 'Friends invited by this customer will show up here.';
    }
  }

  timeAgo(iso: string | null): string {
    if (!iso) return '—';
    const then = new Date(iso).getTime();
    if (isNaN(then)) return '—';
    const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const days = Math.floor(hr / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  }

  pretty(lat: number | null | undefined, lng: number | null | undefined): string {
    if (lat == null || lng == null) return 'Unknown location';
    return `${(+lat).toFixed(3)}, ${(+lng).toFixed(3)}`;
  }

  statusBucket(s: string | null | undefined): string {
    switch (s) {
      case 'COMPLETED': return 'completed';
      case 'CANCELLED': return 'cancelled';
      case 'NEGOTIATION':
      case 'REQUESTED':
      case 'CONFIRMED':  return 'pending';
      default:           return 'ongoing';
    }
  }

  statusDisplay(s: string | null | undefined): string {
    return (s || '').replace(/_/g, ' ').toLowerCase() || '—';
  }

  /** Considered "stale" when the last location ping is older than 30 minutes. */
  get isLocationStale(): boolean {
    const iso = this.profile?.current_location_updated_at;
    if (!iso) return false;
    const then = new Date(iso).getTime();
    if (isNaN(then)) return false;
    return Date.now() - then > 30 * 60 * 1000;
  }

  toggleMoreMenu(event: Event): void {
    event.stopPropagation();
    this.moreMenuOpen = !this.moreMenuOpen;
  }

  closeMore(): void {
    this.moreMenuOpen = false;
  }

  @HostListener('document:click')
  onDocClick(): void {
    if (this.moreMenuOpen) this.moreMenuOpen = false;
  }

  @HostListener('document:keydown.escape')
  onDocEsc(): void {
    if (this.moreMenuOpen) this.moreMenuOpen = false;
  }

  // Subscribe modal
  unsubOpen = false;
  unsubEmail = false;
  unsubSms = false;
  unsubPush = false;
  unsubSaving = false;

  // Wallet modal
  walletOpen = false;
  walletType = 'credit';
  walletAmount: number | null = null;
  walletReason = '';
  walletSaving = false;
  readonly walletTypes = WALLET_TYPES;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe((p) => {
      this.customerId = parseInt(p.get('id') || '0', 10);
      this.loadProfile();
      this.loadTab('rides');
    });
  }

  // -------------------- Tab filtered getters --------------------
  get filteredRides() {
    const q = this.tabSearch.trim().toLowerCase();
    if (!q) return this.rides;
    return this.rides.filter((r) =>
      [r.driver?.name, r.id, r.payment_method, r.final_fare, r.estimated_fare]
        .map((x) => String(x ?? '').toLowerCase())
        .some((s) => s.includes(q)),
    );
  }

  get filteredWallet() {
    const q = this.tabSearch.trim().toLowerCase();
    if (!q) return this.walletTxns;
    return this.walletTxns.filter((r) =>
      [r.type, r.reason, r.amount, r.engagement_id]
        .map((x) => String(x ?? '').toLowerCase())
        .some((s) => s.includes(q)),
    );
  }

  get filteredCancelled() {
    const q = this.tabSearch.trim().toLowerCase();
    if (!q) return this.cancelledRides;
    return this.cancelledRides.filter((r) =>
      [r.id, r.cancelled_reason]
        .map((x) => String(x ?? '').toLowerCase())
        .some((s) => s.includes(q)),
    );
  }

  get filteredReferrals() {
    const q = this.tabSearch.trim().toLowerCase();
    if (!q) return this.referrals;
    return this.referrals.filter((r) =>
      [r.name, r.phone, r.email]
        .map((x) => String(x ?? '').toLowerCase())
        .some((s) => s.includes(q)),
    );
  }

  /** Used in the stat strip — sums completed + cancelled where available. */
  get totalRidesAggregate(): number {
    return (this.rides?.length || 0) + (this.cancelledRides?.length || 0);
  }

  // -------------------- Helpers --------------------
  initials(name: string | null | undefined): string {
    if (!name) return '—';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '—';
    const a = parts[0][0] || '';
    const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (a + b).toUpperCase();
  }

  walletTone(type: string): 'success' | 'danger' | 'warning' | 'info' | 'neutral' {
    switch (type) {
      case 'credit':   return 'success';
      case 'debit':    return 'danger';
      case 'cashback': return 'warning';
      default:         return 'info';
    }
  }

  // -------------------- Data loading --------------------
  loadProfile(): void {
    this.api.get<any>(`/admin/customers/${this.customerId}`).subscribe({
      next: (res) => {
        this.profile = res.customer;
        this.unsubEmail = this.profile?.email_unsubscribed ?? false;
        this.unsubSms = this.profile?.sms_unsubscribed ?? false;
        this.unsubPush = this.profile?.push_unsubscribed ?? false;
      },
      error: (err) =>
        this.toast.error(
          err?.error?.message || 'Could not load customer',
          { title: 'Load failed' },
        ),
    });
  }

  setTab(tab: TabKey): void {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.tabSearch = '';
    this.loadTab(tab);
  }

  loadTab(tab: TabKey): void {
    if (!this.customerId) return;
    this.loadingTab = true;
    const pathMap: Record<TabKey, string> = {
      rides:     `/admin/customers/${this.customerId}/rides`,
      wallet:    `/admin/customers/${this.customerId}/wallet/transactions`,
      cancelled: `/admin/customers/${this.customerId}/cancelled-rides`,
      referrals: `/admin/customers/${this.customerId}/referrals`,
    };
    this.api.get<any>(pathMap[tab]).subscribe({
      next: (res) => {
        const data = res?.data?.data ?? [];
        if (tab === 'rides')          this.rides = data;
        else if (tab === 'wallet')    this.walletTxns = data;
        else if (tab === 'cancelled') this.cancelledRides = data;
        else if (tab === 'referrals') this.referrals = data;
        this.loadingTab = false;
      },
      error: () => {
        this.loadingTab = false;
      },
    });
  }

  // -------------------- Actions --------------------
  sendOtp(): void {
    if (!this.customerId) return;
    this.otpSending = true;
    this.api.post(`/admin/customers/${this.customerId}/send-otp`, {}).subscribe({
      next: () => {
        this.toast.success('OTP sent successfully');
        this.otpSending = false;
      },
      error: (err) => {
        this.toast.error(err?.error?.message || 'Could not send OTP', { title: 'OTP failed' });
        this.otpSending = false;
      },
    });
  }

  openBlockDelete(): void {
    this.blockMode = 'block';
    this.blockReason = '';
    this.deleteReason = '';
    this.blockDeleteOpen = true;
  }

  submitBlock(): void {
    if (!this.profile) return;
    this.blockSaving = true;
    const action = this.profile.is_suspended ? 'unblock' : 'block';
    const body = this.profile.is_suspended ? {} : { reason: this.blockReason };
    this.api.post(`/admin/customers/${this.customerId}/${action}`, body).subscribe({
      next: () => {
        this.toast.success(this.profile?.is_suspended ? 'User unblocked' : 'User blocked');
        this.blockSaving = false;
        this.blockDeleteOpen = false;
        this.loadProfile();
      },
      error: (err) => {
        this.toast.error(err?.error?.message || 'Action failed');
        this.blockSaving = false;
      },
    });
  }

  submitDelete(): void {
    this.deleteSaving = true;
    this.api
      .delete(`/admin/customers/${this.customerId}?reason=${encodeURIComponent(this.deleteReason)}`)
      .subscribe({
        next: () => {
          this.toast.success('User deleted');
          this.deleteSaving = false;
          this.blockDeleteOpen = false;
          this.router.navigate(['/customers']);
        },
        error: (err) => {
          this.toast.error(err?.error?.message || 'Delete failed');
          this.deleteSaving = false;
        },
      });
  }

  openUnsub(): void {
    this.unsubOpen = true;
  }

  submitUnsub(): void {
    this.unsubSaving = true;
    this.api
      .post(`/admin/customers/${this.customerId}/unsubscribe`, {
        email: this.unsubEmail,
        sms: this.unsubSms,
        push: this.unsubPush,
      })
      .subscribe({
        next: () => {
          this.toast.success('Subscription preferences updated');
          this.unsubSaving = false;
          this.unsubOpen = false;
          this.loadProfile();
        },
        error: (err) => {
          this.toast.error(err?.error?.message || 'Failed to update preferences');
          this.unsubSaving = false;
        },
      });
  }

  openWallet(): void {
    this.walletType = 'credit';
    this.walletAmount = null;
    this.walletReason = '';
    this.walletOpen = true;
  }

  submitWallet(): void {
    this.walletSaving = true;
    this.api
      .post(`/admin/customers/${this.customerId}/wallet/transactions`, {
        type: this.walletType,
        amount: this.walletAmount,
        reason: this.walletReason || null,
      })
      .subscribe({
        next: () => {
          this.toast.success('Wallet transaction recorded');
          this.walletSaving = false;
          this.walletOpen = false;
          this.loadProfile();
          if (this.activeTab === 'wallet') this.loadTab('wallet');
        },
        error: (err) => {
          this.toast.error(err?.error?.message || 'Transaction failed');
          this.walletSaving = false;
        },
      });
  }
}
