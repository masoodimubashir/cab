import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import {
  ButtonComponent,
  FilterPillComponent,
  FilterSelectComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  StatusPillComponent,
} from '../../ui';

interface DriverProfile {
  id: number;
  user_id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  avatar_path?: string | null;
  avatar_url?: string | null;
  dob: string | null;
  address: string | null;
  date_registered: string;
  last_login_at: string | null;
  app_version: string | null;
  os_version: string | null;
  device_type: string | null;
  ride_type_name: string | null;
  vehicle_type_name: string | null;
  city_vehicle_type_id: number | null;
  city_vehicle_type_name: string | null;
  vehicle_type: string | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  vehicle_reg_no: string | null;
  city_name: string | null;
  approval_status: 'approved' | 'rejected' | 'pending' | string;
  is_online: boolean;
  is_suspended: boolean;
  suspended_reason: string | null;
  is_active: boolean;
  deactivated_at: string | null;
  deactivated_reason: string | null;
  rating_avg: number | null;
  rating_count: number | null;
  wallet_balance: number;
  total_rides: number;
  current_lat?: number | null;
  current_lng?: number | null;
  current_location_updated_at?: string | null;
  push_unsubscribed: boolean;
}

type TabKey = 'rides' | 'wallet' | 'cancelled';

const BLOCK_REASONS = [
  'Spam / fraud',
  'Abusive behaviour',
  'Payment dispute',
  'Other',
];

@Component({
  selector: 'app-driver-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DatePipe,
    RouterLink,
    ButtonComponent,
    FilterPillComponent,
    FilterSelectComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    StatusPillComponent,
  ],
  template: `
    <div class="page" *ngIf="profile; else loading">
      <!-- ============= Back link ============= -->
      <a routerLink="/drivers" class="back-link">
        <tm-icon name="chevron-left" [size]="14" /> Back to drivers
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
              <h1 class="cover__name">{{ profile.name || 'Unnamed driver' }}</h1>
              <tm-status-pill [tone]="approvalTone">{{ profile.approval_status | titlecase }}</tm-status-pill>
              <tm-status-pill *ngIf="profile.is_online" tone="success">Online</tm-status-pill>
              <tm-status-pill *ngIf="!profile.is_active" tone="danger">Deactivated</tm-status-pill>
              <tm-status-pill *ngIf="profile.is_suspended" tone="danger">Blocked</tm-status-pill>
            </div>
            <div class="cover__handle">
              <span class="mono">#{{ profile.id }}</span>
              <span class="cover__handle-sep">·</span>
              <span>Registered {{ profile.date_registered | date:'MMMM y' }}</span>
            </div>
          </div>

          <div class="cover__actions">
            <tm-button variant="outline" size="sm" icon="key" (clicked)="sendOtp()" [loading]="otpSending" [disabled]="!profile.phone">
              Send OTP
            </tm-button>
            <tm-button variant="green" size="sm" icon="rupee" (clicked)="openPayout()">
              Record payout
            </tm-button>
            <tm-button variant="outline" size="sm" [icon]="profile.is_suspended ? 'check' : 'shield'" (clicked)="openBlockDelete()">
              {{ profile.is_suspended ? 'Manage access' : 'Block or delete' }}
            </tm-button>
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
          <span class="stat-card__value">{{ profile.total_rides || 0 }}</span>
          <span class="stat-card__label">Completed rides</span>
        </div>
        <div class="stat-card">
          <span class="stat-card__icon">
            <tm-icon name="star" [size]="14" />
          </span>
          <span class="stat-card__value">
            {{ profile.rating_count ? (profile.rating_avg | number:'1.1-1') : '—' }}
          </span>
          <span class="stat-card__label">Rating ({{ profile.rating_count || 0 }})</span>
        </div>
        <div class="stat-card">
          <span class="stat-card__icon" [class.stat-card__icon--green]="profile.is_online">
            <tm-icon name="pin" [size]="14" />
          </span>
          <span class="stat-card__value">{{ profile.is_online ? 'Online' : 'Offline' }}</span>
          <span class="stat-card__label">Status</span>
        </div>
      </section>

      <!-- ============= Overview ============= -->
      <section class="overview">
        <article class="overview__main">
          <header class="section-head">
            <div class="section-head__copy">
              <h2 class="section-head__title">Overview</h2>
              <p class="section-head__sub">Driver identity, vehicle registration, and system state in a single view.</p>
            </div>
            <div class="section-head__meta">
              <span class="meta-chip meta-chip--strong">#{{ profile.id }}</span>
              <span class="meta-chip">{{ profile.date_registered | date:'MMMM d, y' }}</span>
              <tm-status-pill [tone]="approvalTone">{{ profile.approval_status | titlecase }}</tm-status-pill>
              <tm-status-pill *ngIf="profile.is_online" tone="success">Online</tm-status-pill>
              <tm-status-pill *ngIf="!profile.is_active" tone="danger">Deactivated</tm-status-pill>
              <tm-status-pill *ngIf="profile.is_suspended" tone="danger">Blocked</tm-status-pill>
            </div>
          </header>

          <div class="overview-grid">
            <section class="detail-card detail-card--wide">
              <div class="detail-card__head">
                <h3 class="detail-card__title">Identity</h3>
                <span class="detail-card__hint">Core person data</span>
              </div>
              <div class="kv-list">
                <div class="kv-row"><span>Name</span><strong>{{ profile.name || 'Unnamed driver' }}</strong></div>
                <div class="kv-row"><span>Phone</span><strong class="mono">{{ profile.phone || '—' }}</strong></div>
                <div class="kv-row"><span>Email</span><strong>{{ profile.email || '—' }}</strong></div>
                <div class="kv-row"><span>DOB</span><strong>{{ profile.dob || '—' }}</strong></div>
                <div class="kv-row"><span>Address</span><strong>{{ profile.address || '—' }}</strong></div>
              </div>
            </section>

            <section class="detail-card">
              <div class="detail-card__head">
                <h3 class="detail-card__title">Vehicle</h3>
                <span class="detail-card__hint">Registration and type</span>
              </div>
              <div class="kv-list">
                <div class="kv-row"><span>Brand</span><strong>{{ profile.vehicle_brand || '—' }}</strong></div>
                <div class="kv-row"><span>Model</span><strong>{{ profile.vehicle_model || '—' }}</strong></div>
                <div class="kv-row"><span>Colour</span><strong>{{ profile.vehicle_color || '—' }}</strong></div>
                <div class="kv-row"><span>Reg no</span><strong class="mono">{{ profile.vehicle_reg_no || '—' }}</strong></div>
                <div class="kv-row"><span>Vehicle type</span><strong>{{ profile.vehicle_type_name || profile.vehicle_type || '—' }}</strong></div>
                <div class="kv-row"><span>Car</span><strong>{{ profile.city_vehicle_type_name || '—' }}</strong></div>
                <div class="kv-row"><span>Ride type</span><strong>{{ profile.ride_type_name || '—' }}</strong></div>
                <div class="kv-row"><span>City</span><strong>{{ profile.city_name || '—' }}</strong></div>
              </div>
            </section>

            <section class="detail-card">
              <div class="detail-card__head">
                <h3 class="detail-card__title">System</h3>
                <span class="detail-card__hint">App and live state</span>
              </div>
              <div class="kv-list">
                <div class="kv-row"><span>App version</span><strong class="mono">{{ profile.app_version || '—' }}</strong></div>
                <div class="kv-row"><span>OS version</span><strong class="mono">{{ profile.os_version || '—' }}</strong></div>
                <div class="kv-row"><span>Device</span><strong>{{ profile.device_type || '—' }}</strong></div>
                <div class="kv-row"><span>Last login</span><strong>{{ profile.last_login_at ? timeAgo(profile.last_login_at) : '—' }}</strong></div>
                <div class="kv-row"><span>Rating</span><strong>{{ profile.rating_count ? (profile.rating_avg | number:'1.1-1') : '—' }}</strong></div>
                <div class="kv-row"><span>Trips</span><strong>{{ profile.total_rides || 0 }}</strong></div>
                <div class="kv-row"><span>Location</span><strong *ngIf="profile.current_lat != null && profile.current_lng != null; else driverLocEmpty">{{ profile.current_lat | number:'1.4-4' }}, {{ profile.current_lng | number:'1.4-4' }}</strong></div>
                <ng-template #driverLocEmpty><div class="kv-row"><span>Location</span><strong>—</strong></div></ng-template>
                <div class="kv-row"><span>Ping</span><strong [class.is-stale]="isLocationStale">{{ profile.current_location_updated_at ? timeAgo(profile.current_location_updated_at) : '—' }}</strong></div>
              </div>
            </section>
          </div>
        </article>

        <aside class="overview__side">
          <section class="detail-card">
            <div class="detail-card__head">
              <h3 class="detail-card__title">Status</h3>
              <span class="detail-card__hint">Current approval and account state</span>
            </div>
            <div class="kv-list">
              <div class="kv-row"><span>Driver ID</span><strong class="mono">#{{ profile.id }}</strong></div>
              <div class="kv-row"><span>Approval</span><strong>{{ profile.approval_status | titlecase }}</strong></div>
              <div class="kv-row"><span>Online</span><strong>{{ profile.is_online ? 'Yes' : 'No' }}</strong></div>
              <div class="kv-row"><span>Account</span><strong>{{ profile.is_active ? 'Active' : 'Inactive' }}</strong></div>
              <div class="kv-row" *ngIf="!profile.is_active"><span>Reason</span><strong>{{ profile.deactivated_reason || '—' }}</strong></div>
              <div class="kv-row"><span>Registered</span><strong>{{ profile.date_registered | date:'MMMM d, y' }}</strong></div>
            </div>
          </section>

          <section class="detail-card">
            <div class="detail-card__head">
              <h3 class="detail-card__title">Notification preferences</h3>
              <span class="detail-card__hint">App channels</span>
            </div>
            <div class="kv-list">
              <div class="kv-row"><span>Push</span><strong>{{ profile.push_unsubscribed ? 'Opted out' : 'Subscribed' }}</strong></div>
            </div>
            <tm-button variant="outline" size="sm" icon="bell" (clicked)="openUnsub()">
              Manage preferences
            </tm-button>
          </section>
        </aside>
      </section>
      <!-- ============= Activity feed ============= -->
      <section class="feed">
        <header class="feed__head">
          <div class="feed__title">
            <h2 class="feed__heading">Activity</h2>
            <p class="feed__sub">Recent rides, wallet activity and cancellations in one timeline.</p>
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

        <div class="feed__toolbar">
          <div class="feed__toolbar-main">
            <div class="feed__search">
              <tm-input icon="search" [placeholder]="searchPlaceholder" [(ngModel)]="tabSearch" />
            </div>

            <div *ngIf="activeTab === 'rides'" class="feed__filters">
              <div class="feed__filters-main">
                <tm-filter-select
                  icon="car"
                  ariaLabel="Ride mode filter"
                  allLabel="All rides"
                  [includeAll]="true"
                  [options]="rideModeOptions"
                  [value]="rideMode"
                  (valueChange)="rideMode = $event"
                />
                <label class="date-range">
                  <span>From</span>
                  <input type="date" [(ngModel)]="rideDateFrom" />
                </label>
                <label class="date-range">
                  <span>To</span>
                  <input type="date" [(ngModel)]="rideDateTo" />
                </label>
              </div>
              <tm-button variant="ghost" size="sm" icon="x" (clicked)="clearRideFilters()">Clear rides</tm-button>
            </div>
          </div>

          <div class="feed__pills">
            <tm-filter-pill *ngIf="tabSearch.trim()" icon="search" label="Search" [value]="tabSearch" (clear)="tabSearch = ''" />
            <tm-filter-pill *ngIf="activeTab === 'rides' && rideMode !== 'all'" icon="car" label="Ride mode" [value]="rideModeText(rideMode)" (clear)="rideMode = 'all'" />
            <tm-filter-pill *ngIf="activeTab === 'rides' && (rideDateFrom || rideDateTo)" icon="calendar" label="Ride date" [value]="(rideDateFrom || '…') + ' → ' + (rideDateTo || '…')" (clear)="clearRideFilters()" />
          </div>
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
                  <span class="post__role">Rider</span>
                  <strong class="post__title">{{ r.customer?.name || 'Unknown rider' }}</strong>
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
                <span class="ride-meta__item ride-meta__item--mode">{{ rideModeLabel(r) }}</span>
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
      </section>

    </div>

    <ng-template #loading>
      <div class="page-loading">
        <span class="spinner" aria-hidden="true"></span>
        <span>Loading driver…</span>
      </div>
    </ng-template>

    <!-- =================== Block / Delete modal =================== -->
    <tm-modal
      [open]="blockDeleteOpen"
      [title]="profile?.is_suspended ? 'Manage driver access' : 'Restrict this driver'"
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
            Unblocking will restore the driver's full access immediately.
            They will be able to log in and take rides again.
          </span>
        </div>

        <!-- Delete path -->
        <ng-container *ngIf="blockMode === 'delete'">
          <div class="notice notice--danger">
            <tm-icon name="trash" [size]="14" />
            <span>
              This action <strong>cannot be undone</strong>. The driver's account
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
            placeholder="Why is this driver being deleted?"
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
          {{ profile?.is_suspended ? 'Unblock driver' : 'Block driver' }}
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

    <!-- =================== Record payout modal =================== -->
    <tm-modal
      [open]="payoutOpen"
      title="Record a payout"
      (closed)="payoutOpen = false"
    >
      <div slot="body">
        <p class="hint hint--top">
          The money moves by GPay/bank outside the app — this only records it,
          so the wallet balance stays true.
        </p>

        <div class="payout-summary" *ngIf="payoutSummary; else payoutLoadingTpl">
          <div class="payout-summary__row">
            <span>Total in wallet</span>
            <strong>₹ {{ payoutSummary.balance | number:'1.2-2' }}</strong>
          </div>
          <div class="payout-summary__row payout-summary__row--pay">
            <span>He earned — pay this</span>
            <strong>₹ {{ payoutSummary.earned_remaining | number:'1.2-2' }}</strong>
          </div>
          <div class="payout-summary__row">
            <span>He deposited — leave this</span>
            <strong>₹ {{ payoutSummary.deposits_remaining | number:'1.2-2' }}</strong>
          </div>
          <div class="payout-summary__row payout-summary__row--muted">
            <span>Paid out so far</span>
            <strong>₹ {{ payoutSummary.total_paid_out | number:'1.2-2' }}</strong>
          </div>
        </div>
        <ng-template #payoutLoadingTpl>
          <p class="hint">Loading wallet summary…</p>
        </ng-template>

        <label class="lbl"><span class="req">*</span> Amount paid (₹)</label>
        <input
          class="form-input"
          type="number"
          min="1"
          [(ngModel)]="payoutAmount"
          placeholder="0.00"
        />

        <label class="lbl"><span class="req">*</span> Paid via</label>
        <select class="form-input" [(ngModel)]="payoutMethod">
          <option value="gpay">GPay / UPI</option>
          <option value="bank">Bank transfer</option>
          <option value="cash">Cash</option>
          <option value="other">Other</option>
        </select>

        <label class="lbl">Reference (UPI/UTR number)</label>
        <input
          class="form-input"
          type="text"
          maxlength="120"
          [(ngModel)]="payoutReference"
          placeholder="e.g. UPI ref 338245…"
        />

        <label class="lbl">Note</label>
        <input
          class="form-input"
          type="text"
          maxlength="300"
          [(ngModel)]="payoutNote"
          placeholder="e.g. week 28 earnings"
        />

        <div class="notice notice--danger" *ngIf="payoutError">
          <tm-icon name="shield" [size]="14" />
          <span>{{ payoutError }}</span>
        </div>
      </div>
      <ng-container slot="footer">
        <tm-button variant="ghost" (clicked)="payoutOpen = false">Cancel</tm-button>
        <tm-button
          variant="green"
          icon="check"
          [loading]="payoutSaving"
          [disabled]="!payoutAmount || payoutAmount <= 0"
          (clicked)="submitPayout()"
        >
          Record payout
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
        <p class="hint">This per-user setting controls only app push notifications. Email and SMS are controlled from Operator Settings.</p>
        <div class="check-list">
          <label class="check" [class.is-on]="unsubPush">
            <input type="checkbox" [(ngModel)]="unsubPush" />
            <span class="check__box"><tm-icon name="check" [size]="11" /></span>
            <span class="check__body">
              <span class="check__title">Unsubscribe push</span>
              <span class="check__sub">Firebase app push notifications</span>
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
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: var(--tm-space-4);
      align-items: stretch;
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
    .cover__avatar--photo {
      background-color: var(--tm-canvas-2);
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
    }
    .cover__body {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 8px;
      min-width: 0;
      padding-top: 56px;
    }
    .cover__title-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      row-gap: 8px;
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
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 8px;
      margin-top: 4px;
    }
    .contact {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      border-radius: var(--tm-radius-md);
      background: var(--tm-canvas);
      border: 1px solid var(--tm-line);
      color: var(--tm-text);
      font-size: 12px;
      font-weight: 600;
      text-decoration: none;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  border-color var(--tm-duration-fast) var(--tm-ease),
                  box-shadow var(--tm-duration-fast) var(--tm-ease),
                  transform var(--tm-duration-fast) var(--tm-ease);
    }
    .contact:not(.contact--static):hover {
      background: var(--tm-ink);
      color: #fff;
      border-color: var(--tm-ink);
      box-shadow: var(--tm-shadow-sm);
      transform: translateY(-1px);
    }
    .contact--static { cursor: default; }
    .contact--empty {
      background: transparent;
      color: var(--tm-text-soft);
      border-style: dashed;
    }
    .contact--empty .contact__icon { color: var(--tm-text-soft); }
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

    /* -------------------- Overview section -------------------- */
    .overview {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 340px;
      gap: var(--tm-space-3);
      align-items: start;
    }
    .overview__main,
    .overview__side {
      min-width: 0;
    }
    .section-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--tm-space-3);
      flex-wrap: wrap;
      margin-bottom: var(--tm-space-3);
    }
    .section-head__copy { min-width: 0; }
    .section-head__title {
      margin: 0;
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--tm-text-muted);
    }
    .section-head__sub {
      margin: 4px 0 0;
      font-size: 13px;
      font-weight: 500;
      line-height: 1.55;
      color: var(--tm-text-muted);
      max-width: 68ch;
    }
    .section-head__meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }
    .meta-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 32px;
      padding: 0 12px;
      border-radius: var(--tm-radius-md);
      border: 1px solid var(--tm-line);
      background: var(--tm-canvas);
      color: var(--tm-text);
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }
    .meta-chip--strong {
      background: var(--tm-ink);
      border-color: var(--tm-ink);
      color: #fff;
    }
    .detail-card {
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg);
      padding: var(--tm-space-4);
      box-shadow: var(--tm-shadow-sm);
      min-width: 0;
    }
    .detail-card--wide { grid-column: 1 / -1; }
    .detail-card__head {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: baseline;
      margin-bottom: 12px;
    }
    .detail-card__title {
      margin: 0;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--tm-text);
    }
    .detail-card__hint {
      font-size: 11px;
      font-weight: 600;
      color: var(--tm-text-muted);
      white-space: nowrap;
    }
    .overview-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--tm-space-3);
    }
    .kv-list {
      display: grid;
      gap: 8px;
    }
    .kv-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
      padding: 10px 12px;
      border-radius: var(--tm-radius-md);
      background: var(--tm-canvas);
      border: 1px solid var(--tm-line);
    }
    .kv-row span {
      flex: 0 0 auto;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--tm-text-muted);
    }
    .kv-row strong {
      flex: 1 1 auto;
      text-align: right;
      min-width: 0;
      font-size: 13px;
      font-weight: 700;
      color: var(--tm-text);
      overflow-wrap: anywhere;
    }
    .kv-row strong.mono { font-family: var(--tm-font-mono); }
    .overview__side {
      display: grid;
      gap: var(--tm-space-3);
    }
    .is-stale { color: var(--tm-text-soft); }

    /* -------------------- Activity feed -------------------- */

    .feed {
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg);
      padding: var(--tm-space-5);
      display: flex;
      flex-direction: column;
      gap: var(--tm-space-4);
      box-shadow: var(--tm-shadow-sm);
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
      border: 1px solid var(--tm-line);
      max-width: 100%;
      overflow-x: auto;
    }
    .feed-tab {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 12px;
      border: 0;
      cursor: pointer;
      border-radius: var(--tm-radius-sm);
      font-weight: 700;
      font-size: 12px;
      color: var(--tm-text-muted);
      background: transparent;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease),
                  box-shadow var(--tm-duration-fast) var(--tm-ease);
      white-space: nowrap;
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

    .feed__toolbar { display: grid; gap: 12px; }
    .feed__toolbar-main {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 12px;
    }
    .feed__search {
      flex: 1 1 320px;
      max-width: none;
    }
    .feed__filters {
      flex: 0 0 auto;
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: 12px;
    }
    .feed__filters-main {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 10px;
    }
    .feed__pills { display: flex; flex-wrap: wrap; gap: 8px; }
    .date-range {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--tm-text-muted);
    }
    .date-range input {
      width: 150px;
      padding: 9px 12px;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      background: var(--tm-surface);
      color: var(--tm-text);
      font: inherit;
      font-size: 13px;
      font-weight: 600;
    }

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
    .ride-meta__item--mode { background: var(--tm-ink); color: #fff; }
    .ride-meta__item.mono { font-family: var(--tm-font-mono); }
    .ride-fare { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .ride-fare__est {
      font-size: 10px; font-weight: 700;
      color: var(--tm-text-soft); font-family: var(--tm-font-mono);
    }

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
      animation: dd-spin 0.7s linear infinite;
    }
    @keyframes dd-spin { to { transform: rotate(360deg); } }

    /* -------------------- Payout modal -------------------- */
    .payout-summary {
      display: flex;
      flex-direction: column;
      gap: 6px;
      background: var(--tm-canvas-2);
      border: 1px solid var(--tm-border);
      border-radius: var(--tm-radius-md);
      padding: 12px 14px;
      margin-bottom: 14px;
    }
    .payout-summary__row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-size: 12.5px;
      color: var(--tm-text-muted);
    }
    .payout-summary__row strong { font-variant-numeric: tabular-nums; color: var(--tm-text); }
    .payout-summary__row--pay { font-weight: 700; }
    .payout-summary__row--pay span { color: var(--tm-green); }
    .payout-summary__row--pay strong { color: var(--tm-green); font-size: 14px; }
    .payout-summary__row--muted { opacity: 0.75; }

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
    .form-textarea { resize: vertical; min-height: 64px; font-family: inherit; }
    .hint { margin: 0 0 12px; color: var(--tm-text-muted); font-size: 13px; line-height: 1.5; }
    .check-list { display: flex; flex-direction: column; gap: 10px; }
    .check { display: flex; gap: 10px; align-items: flex-start; padding: 12px; border: 1px solid var(--tm-line); border-radius: var(--tm-radius-md); cursor: pointer; background: var(--tm-surface); }
    .check input { position: absolute; opacity: 0; pointer-events: none; }
    .check__box { width: 18px; height: 18px; border-radius: 5px; border: 1px solid var(--tm-line-2); display: inline-flex; align-items: center; justify-content: center; color: transparent; flex: none; margin-top: 1px; }
    .check.is-on .check__box { background: var(--tm-green); border-color: var(--tm-green); color: #fff; }
    .check__body { display: flex; flex-direction: column; gap: 2px; }
    .check__title { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .check__sub { font-size: 12px; color: var(--tm-text-muted); line-height: 1.35; }

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
    .action-toggle__btn.is-credit.is-active {
      background: var(--tm-green-tint);
      border-color: var(--tm-green-deep);
    }
    .action-toggle__btn.is-credit.is-active .action-toggle__icon {
      background: var(--tm-green);
      color: #fff;
    }
    .action-toggle__btn.is-debit.is-active {
      background: var(--tm-danger-bg);
      border-color: var(--tm-danger);
    }
    .action-toggle__btn.is-debit.is-active .action-toggle__icon {
      background: var(--tm-danger);
      color: #fff;
    }
    .action-toggle__btn.is-active {
      background: var(--tm-canvas);
      border-color: var(--tm-ink);
    }
    .action-toggle__btn.is-warn.is-active {
      background: var(--tm-warning-bg);
      border-color: var(--tm-warning);
    }
    .action-toggle__btn.is-warn.is-active .action-toggle__icon {
      background: var(--tm-warning);
      color: #fff;
    }
    .action-toggle__btn.is-danger.is-active {
      background: var(--tm-danger-bg);
      border-color: var(--tm-danger);
    }
    .action-toggle__btn.is-danger.is-active .action-toggle__icon {
      background: var(--tm-danger);
      color: #fff;
    }

    .req { color: var(--tm-danger); margin-right: 2px; }
    .hint--top { margin: 0 0 14px; }

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

    /* -------------------- Responsive -------------------- */
    @media (max-width: 1100px) {
      .overview { grid-template-columns: 1fr; }
      .stats { grid-template-columns: repeat(2, 1fr); }
      .cover__inner { grid-template-columns: 1fr; }
      .cover__actions { padding-top: 0; }
      .overview-grid { grid-template-columns: 1fr; }
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
      .section-head__meta { justify-content: flex-start; }
      .feed__toolbar-main {
        flex-direction: column;
        align-items: stretch;
      }
      .feed__search {
        flex: 1 1 auto;
        width: 100%;
      }
      .feed__filters {
        width: 100%;
        justify-content: space-between;
      }
      .feed__filters-main {
        width: 100%;
      }
      .date-range input {
        width: 100%;
        min-width: 0;
      }
      .feed__nav { display: flex; }
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
export class DriverDetailComponent implements OnInit {
  driverId!: number;
  profile: DriverProfile | null = null;

  // Tabs
  activeTab: TabKey = 'rides';
  loadingTab = false;
  rides: any[] = [];
  walletTxns: any[] = [];
  cancelledRides: any[] = [];
  tabSearch = '';
  rideMode = 'all';
  rideDateFrom = '';
  rideDateTo = '';

  readonly rideModeOptions = [
    { label: 'Private', value: 'private' },
    { label: 'Fixed', value: 'fixed' },
    { label: 'Shuttle', value: 'shuttle' },
  ];


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

  // Notification preferences modal
  unsubOpen = false;
  unsubPush = false;
  unsubSaving = false;

  // Record payout modal — logs an outside-the-app GPay/bank payment as a
  // wallet debit so the ledger keeps matching reality.
  payoutOpen = false;
  payoutSummary: { balance: number; earned_remaining: number; deposits_remaining: number; total_paid_out: number } | null = null;
  payoutAmount: number | null = null;
  payoutMethod: 'gpay' | 'bank' | 'cash' | 'other' = 'gpay';
  payoutReference = '';
  payoutNote = '';
  payoutSaving = false;
  payoutError: string | null = null;


  readonly historyTabs: { key: TabKey; label: string; icon: 'car' | 'tag' | 'x' }[] = [
    { key: 'rides',     label: 'Rides',     icon: 'car' },
    { key: 'wallet',    label: 'Wallet',    icon: 'tag' },
    { key: 'cancelled', label: 'Cancelled', icon: 'x' },
  ];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe((p) => {
      this.driverId = parseInt(p.get('id') || '0', 10);
      this.loadProfile();
      this.loadTab('rides');
    });
  }

  // -------------------- Derived view state --------------------
  get approvalTone(): 'success' | 'danger' | 'warning' | 'neutral' {
    switch (this.profile?.approval_status) {
      case 'approved': return 'success';
      case 'rejected': return 'danger';
      case 'pending':  return 'warning';
      default:         return 'neutral';
    }
  }

  get vehicleDescription(): string {
    const parts = [this.profile?.vehicle_brand, this.profile?.vehicle_model]
      .filter((x) => !!x)
      .join(' ');
    const colour = this.profile?.vehicle_color ? ` (${this.profile.vehicle_color})` : '';
    return (parts || 'vehicle') + colour;
  }

  tabCount(key: TabKey): number {
    switch (key) {
      case 'rides':     return this.rides.length;
      case 'wallet':    return this.walletTxns.length;
      case 'cancelled': return this.cancelledRides.length;
    }
  }

  get currentTabIcon(): 'car' | 'tag' | 'x' {
    return this.historyTabs.find((t) => t.key === this.activeTab)?.icon ?? 'car';
  }

  get currentActivity(): any[] {
    switch (this.activeTab) {
      case 'rides':     return this.filteredRides;
      case 'wallet':    return this.filteredWallet;
      case 'cancelled': return this.filteredCancelled;
    }
  }

  get searchPlaceholder(): string {
    switch (this.activeTab) {
      case 'rides':     return 'Search by rider, engagement or fare…';
      case 'wallet':    return 'Search by reason, engagement or amount…';
      case 'cancelled': return 'Search cancelled rides…';
    }
  }

  emptyTitleFor(tab: TabKey): string {
    switch (tab) {
      case 'rides':     return 'No rides yet';
      case 'wallet':    return 'No wallet activity';
      case 'cancelled': return 'No cancellations';
    }
  }

  emptyHintFor(tab: TabKey): string {
    switch (tab) {
      case 'rides':     return "When this driver completes a trip, it'll appear here.";
      case 'wallet':    return 'Credits and debits will show up here as soon as they happen.';
      case 'cancelled': return 'Cancelled trips will show up in this feed.';
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

  private inDateRange(iso: string | null | undefined, from: string, to: string): boolean {
    if (!iso) return false;
    const day = iso.slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  }

  rideModeOf(row: any): 'private' | 'fixed' | 'shuttle' {
    if (!row?.route_departure_id) return 'private';
    const mode = row?.route_departure?.route?.mode || row?.route?.mode;
    return mode === 'fixed' ? 'fixed' : 'shuttle';
  }

  rideModeLabel(row: any): string {
    return this.rideModeText(this.rideModeOf(row));
  }

  rideModeText(mode: string): string {
    switch (mode) {
      case 'private': return 'Private';
      case 'fixed': return 'Fixed';
      case 'shuttle': return 'Shuttle';
      default: return 'All rides';
    }
  }

  clearRideFilters(): void {
    this.rideMode = 'all';
    this.rideDateFrom = '';
    this.rideDateTo = '';
  }

  get isLocationStale(): boolean {
    const iso = this.profile?.current_location_updated_at;
    if (!iso) return false;
    const then = new Date(iso).getTime();
    if (isNaN(then)) return false;
    return Date.now() - then > 30 * 60 * 1000;
  }

  sendOtp(): void {
    if (!this.driverId) return;
    this.otpSending = true;
    this.api.post(`/admin/drivers/${this.driverId}/send-otp`, {}).subscribe({
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
    this.api.post(`/admin/drivers/${this.driverId}/${action}`, body).subscribe({
      next: () => {
        this.toast.success(this.profile?.is_suspended ? 'Driver unblocked' : 'Driver blocked');
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
      .delete(`/admin/drivers/${this.driverId}?reason=${encodeURIComponent(this.deleteReason)}`)
      .subscribe({
        next: () => {
          this.toast.success('Driver deleted');
          this.deleteSaving = false;
          this.blockDeleteOpen = false;
          this.router.navigate(['/drivers']);
        },
        error: (err) => {
          this.toast.error(err?.error?.message || 'Delete failed');
          this.deleteSaving = false;
        },
      });
  }

  openUnsub(): void {
    this.unsubPush = this.profile?.push_unsubscribed ?? false;
    this.unsubOpen = true;
  }

  submitUnsub(): void {
    if (!this.profile || this.unsubSaving) return;
    this.unsubSaving = true;
    this.api.post<any>(`/admin/drivers/${this.driverId}/unsubscribe`, {
      push: this.unsubPush,
    }).subscribe({
      next: () => {
        if (this.profile) {
          this.profile = {
            ...this.profile,
            push_unsubscribed: this.unsubPush,
          };
        }
        this.unsubOpen = false;
        this.unsubSaving = false;
        this.toast.success("Push preference updated");
      },
      error: (err) => {
        this.unsubSaving = false;
        this.toast.error(err?.error?.message || "Could not update push preference");
      },
    });
  }

  // -------------------- Tab filtered getters --------------------
  get filteredRides() {
    const q = this.tabSearch.trim().toLowerCase();
    return this.rides.filter((r) => {
      const mode = this.rideModeOf(r);
      const matchesMode = this.rideMode === 'all' || mode === this.rideMode;
      const matchesDate = this.inDateRange(r.created_at, this.rideDateFrom, this.rideDateTo);
      const matchesSearch = !q || [r.customer?.name, r.id, r.payment_method, r.final_fare, r.estimated_fare, mode, r.ride_type?.name, r.route?.name, r.route_departure?.route?.name]
        .map((x) => String(x ?? '').toLowerCase())
        .some((s) => s.includes(q));
      return matchesMode && matchesDate && matchesSearch;
    });
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
      [r.id, r.cancelled_reason, r.customer?.name]
        .map((x) => String(x ?? '').toLowerCase())
        .some((s) => s.includes(q)),
    );
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

  // -------------------- Data loading --------------------
  // -------------------- Record payout --------------------
  openPayout(): void {
    this.payoutOpen = true;
    this.payoutSummary = null;
    this.payoutAmount = null;
    this.payoutMethod = 'gpay';
    this.payoutReference = '';
    this.payoutNote = '';
    this.payoutError = null;
    this.api.get<any>(`/admin/drivers/${this.driverId}/wallet/payout-summary`).subscribe({
      next: (res) => {
        this.payoutSummary = res;
        // Pre-fill with the payable amount (earnings only, float untouched).
        this.payoutAmount = res?.earned_remaining > 0 ? res.earned_remaining : null;
      },
      error: (err) => {
        this.payoutError = err?.error?.message || 'Could not load the wallet summary.';
      },
    });
  }

  submitPayout(): void {
    if (!this.payoutAmount || this.payoutAmount <= 0 || this.payoutSaving) return;
    this.payoutSaving = true;
    this.payoutError = null;
    this.api.post<any>(`/admin/drivers/${this.driverId}/wallet/payout`, {
      amount: this.payoutAmount,
      method: this.payoutMethod,
      reference: this.payoutReference.trim() || null,
      note: this.payoutNote.trim() || null,
    }).subscribe({
      next: (res) => {
        this.payoutSaving = false;
        this.payoutOpen = false;
        this.toast.success(`Payout of ₹${Number(this.payoutAmount).toFixed(2)} recorded`);
        this.loadProfile();
        this.loadTab('wallet');
        this.activeTab = 'wallet';
      },
      error: (err) => {
        this.payoutSaving = false;
        this.payoutError = err?.error?.message || 'Could not record the payout.';
      },
    });
  }

  loadProfile(): void {
    this.api.get<any>(`/admin/drivers/${this.driverId}/profile`).subscribe({
      next: (res) => {
        this.profile = res.driver;
        this.unsubPush = this.profile?.push_unsubscribed ?? false;
      },
      error: (err) =>
        this.toast.error(
          err?.error?.message || 'Could not load driver',
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
    if (!this.driverId) return;
    this.loadingTab = true;
    const pathMap: Record<TabKey, string> = {
      rides:     `/admin/drivers/${this.driverId}/rides`,
      wallet:    `/admin/drivers/${this.driverId}/wallet/transactions`,
      cancelled: `/admin/drivers/${this.driverId}/cancelled-rides`,
    };
    this.api.get<any>(pathMap[tab]).subscribe({
      next: (res) => {
        const data = res?.data?.data ?? [];
        if (tab === 'rides')          this.rides = data;
        else if (tab === 'wallet')    this.walletTxns = data;
        else if (tab === 'cancelled') this.cancelledRides = data;
        this.loadingTab = false;
      },
      error: () => {
        this.loadingTab = false;
      },
    });
  }

}
