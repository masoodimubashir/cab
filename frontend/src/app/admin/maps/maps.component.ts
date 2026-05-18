import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { GoogleMapsLoaderService } from '../../core/google-maps-loader.service';
import {
  ButtonComponent,
  IconComponent,
  StatusPillComponent,
  InputComponent,
} from '../../ui';

interface DriverRow {
  id: number;
  user_id: number;
  name: string | null;
  phone: string | null;
  vehicle_type: string | null;
  vehicle_reg_no: string | null;
  is_online: boolean;
  lat: number | null;
  lng: number | null;
  last_seen_at: string | null;
  status: 'free' | 'busy' | 'inactive';
  inactive_reason?: 'offline' | 'no_location' | 'stale_location';
}

interface TaskRow {
  id: number;
  status: string;
  pickup_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  drop_address: string | null;
  drop_lat: number | null;
  drop_lng: number | null;
  estimated_fare: number | null;
  customer: { id: number; name: string | null; phone: string | null } | null;
  driver: { id: number; name: string | null; phone: string | null } | null;
  ride_type: string | null;
  created_at: string | null;
}

interface Snapshot {
  drivers: { free: DriverRow[]; busy: DriverRow[]; inactive: DriverRow[] };
  tasks: { unassigned: TaskRow[]; assigned: TaskRow[] };
  counts: { free: number; busy: number; inactive: number; unassigned: number; assigned: number };
}

interface CityRow {
  id: number;
  name: string;
  center_lat?: number | null;
  center_lng?: number | null;
  boundary_polygon?: { lat: number; lng: number }[] | null;
}

type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const COLORS = {
  free: '#22C55E',
  busy: '#F59E0B',
  inactive: '#94A0AD',
  task: '#0F1419',
  taskAssigned: '#16A34A',
};

@Component({
  selector: 'app-maps',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    IconComponent,
    StatusPillComponent,
    InputComponent,
  ],
  template: `
    <div class="dispatch-shell">
      <!-- ============================ TOPBAR ============================ -->
      <header class="hero">
        <div class="hero__left">
          <div class="hero__eyebrow">
            <span class="live-pill" [class.is-refreshing]="isRefreshing">
              <span class="live-pill__dot"></span> LIVE
            </span>
            <span class="hero__updated" *ngIf="lastUpdated">
              {{ isRefreshing ? 'Updating…' : 'Updated ' + formatTime(lastUpdated) }}
            </span>
          </div>
          <div class="hero__meta" *ngIf="snapshot">
            <span class="hero__chip">
              <span class="dot" style="background:#22C55E"></span>
              {{ totalDrivers }} drivers
            </span>
            <span class="hero__chip">
              <span class="dot" style="background:#0F1419"></span>
              {{ totalTasks }} tasks
            </span>
            <span class="hero__chip hero__chip--soft" *ngIf="selectedCityName">
              <tm-icon name="map-marker" [size]="11" /> {{ selectedCityName }}
            </span>
          </div>
        </div>

        <div class="hero__right">
          <div class="city-select">
            <tm-icon name="map-marker" [size]="16" />
            <select
              [(ngModel)]="cityId"
              (ngModelChange)="onCityChange()"
              class="city-select__input"
              aria-label="Filter by city"
            >
              <option [ngValue]="null">All cities</option>
              <option *ngFor="let c of cityOptions" [ngValue]="c.id">{{ c.name }}</option>
            </select>
            <tm-icon name="chevron-down" [size]="14" class="city-select__caret" />
          </div>

          <div class="seg" role="tablist" aria-label="View">
            <button
              type="button"
              class="seg__btn"
              [class.is-active]="view === 'map'"
              (click)="setView('map')"
              role="tab"
              [attr.aria-selected]="view === 'map'"
            >
              <tm-icon name="map" [size]="14" /> Map
            </button>
            <button
              type="button"
              class="seg__btn"
              [class.is-active]="view === 'list'"
              (click)="setView('list')"
              role="tab"
              [attr.aria-selected]="view === 'list'"
            >
              <tm-icon name="menu" [size]="14" /> List
            </button>
          </div>

          <tm-button
            variant="ink"
            size="sm"
            icon="refresh"
            [loading]="isRefreshing"
            (clicked)="fetch(true)"
          >
            Refresh
          </tm-button>
        </div>
      </header>

      <!-- ============================ GRID ============================ -->
      <div class="dispatch-grid">
        <!-- ===== TASKS PANEL ===== -->
        <section class="panel">
          <header class="panel__head">
            <div class="panel__overline">
              <tm-icon name="send" [size]="11" />
              <span>Tasks</span>
            </div>
            <div class="panel__head-row">
              <div class="panel__big">{{ totalTasks }}</div>
              <span class="panel__sub">pickups today</span>
            </div>
          </header>

          <div class="tabs" role="tablist">
            <button
              type="button"
              class="tab"
              [class.is-active]="taskTab === 'unassigned'"
              (click)="taskTab = 'unassigned'"
              role="tab"
            >
              <span class="tab__label">Unassigned</span>
              <span class="tab__count">{{ snapshot?.counts?.unassigned || 0 }}</span>
            </button>
            <button
              type="button"
              class="tab"
              [class.is-active]="taskTab === 'assigned'"
              (click)="taskTab = 'assigned'"
              role="tab"
            >
              <span class="tab__label">Assigned</span>
              <span class="tab__count">{{ snapshot?.counts?.assigned || 0 }}</span>
            </button>
          </div>

          <div class="panel__filter">
            <tm-input
              [(ngModel)]="taskFilter"
              placeholder="Search by name, phone or pickup…"
              icon="search"
            />
          </div>

          <div class="panel__body">
            <div *ngIf="!filteredTasks.length" class="empty">
              <tm-icon name="map-marker" [size]="20" />
              <span>No tasks in this bucket.</span>
            </div>

            <div
              *ngFor="let t of filteredTasks"
              class="row-card task-card"
              [class.is-selected]="selectedTaskId === t.id"
              (click)="selectTask(t)"
            >
              <div class="task-card__top">
                <div class="task-card__lead">
                  <span class="row-card__id">#{{ t.id }}</span>
                  <span class="task-card__name">{{ t.customer?.name || 'Customer' }}</span>
                </div>
                <tm-status-pill [tone]="tripTone(t.status)">{{ t.status }}</tm-status-pill>
              </div>

              <div class="route-connector" [class.has-drop]="!!t.drop_address">
                <div class="route-line">
                  <span class="pin pin--from"></span>
                  <span class="route-line__addr">
                    {{ t.pickup_address || pretty(t.pickup_lat, t.pickup_lng) }}
                  </span>
                </div>
                <div class="route-line" *ngIf="t.drop_address">
                  <span class="pin pin--to"></span>
                  <span class="route-line__addr">{{ t.drop_address }}</span>
                </div>
              </div>

              <div class="row-card__meta">
                <span class="meta-chip" *ngIf="t.ride_type">
                  <tm-icon name="car" [size]="11" /> {{ t.ride_type }}
                </span>
                <span class="meta-chip meta-chip--fare" *ngIf="t.estimated_fare">
                  ₹ {{ t.estimated_fare }}
                </span>
                <span class="meta-chip meta-chip--soft" *ngIf="t.created_at">
                  <tm-icon name="calendar" [size]="11" /> {{ timeAgo(t.created_at) }}
                </span>
              </div>
              <div class="row-card__driver" *ngIf="t.driver">
                <tm-icon name="user" [size]="12" />
                {{ t.driver.name }} · {{ t.driver.phone }}
              </div>
            </div>
          </div>
        </section>

        <!-- ===== MAP / LIST AREA ===== -->
        <!-- Keep the map mounted at all times; toggle visibility via [hidden].
             Unmounting via *ngIf would detach Google Maps from its container. -->
        <section class="map-area" [hidden]="view !== 'map'">
          <div class="map-card">
            <div class="map-shell" #mapContainer></div>

            <div class="map-loading" *ngIf="!mapsReady && !error">
              <span class="map-spinner" aria-hidden="true"></span>
              <span>Loading map…</span>
            </div>

            <!-- Map info overlay (top-left): live counts in a glass pill -->
            <div class="map-info" *ngIf="mapsReady && snapshot">
              <div class="map-info__group">
                <span class="map-info__dot" style="background:#22C55E"></span>
                <span class="map-info__num">{{ snapshot.counts.free || 0 }}</span>
                <span class="map-info__lbl">free</span>
              </div>
              <div class="map-info__group">
                <span class="map-info__dot" style="background:#F59E0B"></span>
                <span class="map-info__num">{{ snapshot.counts.busy || 0 }}</span>
                <span class="map-info__lbl">busy</span>
              </div>
              <span class="map-info__sep"></span>
              <div class="map-info__group">
                <span class="map-info__sq" style="background:#0F1419"></span>
                <span class="map-info__num">{{ snapshot.counts.unassigned || 0 }}</span>
                <span class="map-info__lbl">open</span>
              </div>
              <div class="map-info__group">
                <span class="map-info__sq" style="background:#16A34A"></span>
                <span class="map-info__num">{{ snapshot.counts.assigned || 0 }}</span>
                <span class="map-info__lbl">live</span>
              </div>
            </div>

            <!-- Floating action group (top-right) -->
            <div class="map-actions">
              <button
                type="button"
                class="map-action"
                (click)="fitAll()"
                [disabled]="!mapsReady"
                title="Fit to all markers"
                aria-label="Fit to all markers"
              >
                <tm-icon name="map" [size]="14" />
                <span>Fit all</span>
              </button>
              <button
                type="button"
                class="map-action map-action--icon"
                (click)="onCityChange()"
                [disabled]="!mapsReady"
                title="Recenter map"
                aria-label="Recenter map"
              >
                <tm-icon name="map-marker" [size]="14" />
              </button>
            </div>

            <!-- Compact horizontal legend -->
            <div class="legend">
              <span class="legend__item">
                <span class="legend__pin" style="background: #22C55E"></span> Free
              </span>
              <span class="legend__item">
                <span class="legend__pin" style="background: #F59E0B"></span> Busy
              </span>
              <span class="legend__item">
                <span class="legend__pin" style="background: #94A0AD"></span> Inactive
              </span>
              <span class="legend__divider"></span>
              <span class="legend__item">
                <span class="legend__pin legend__pin--diamond" style="background: #0F1419"></span> Unassigned
              </span>
              <span class="legend__item">
                <span class="legend__pin legend__pin--diamond" style="background: #16A34A"></span> Assigned
              </span>
            </div>
          </div>
        </section>

        <section class="map-area" [hidden]="view !== 'list'">
          <div class="list-card">
            <header class="list-card__head">
              <div class="list-card__head-text">
                <h3 class="tm-h3">All tasks</h3>
                <span class="list-card__sub">
                  {{ allTasks.length }} total ·
                  {{ snapshot?.counts?.unassigned || 0 }} unassigned ·
                  {{ snapshot?.counts?.assigned || 0 }} assigned
                </span>
              </div>
              <span class="tm-overline list-card__eyebrow">Today</span>
            </header>

            <!-- Empty state — centered in the full card body, not inside the table -->
            <div *ngIf="!allTasks.length" class="list-empty">
              <div class="list-empty__icon">
                <tm-icon name="map-marker" [size]="28" />
              </div>
              <div class="list-empty__title">No tasks yet</div>
              <div class="list-empty__hint">
                When trips are created or assigned today, they will appear here.
              </div>
              <tm-button
                variant="outline"
                size="sm"
                icon="refresh"
                [loading]="isRefreshing"
                (clicked)="fetch(true)"
              >
                Refresh now
              </tm-button>
            </div>

            <!-- Table — only when there's data -->
            <div class="table-wrap" *ngIf="allTasks.length">
              <table class="data-table">
                <thead>
                  <tr>
                    <th class="th-id">ID</th>
                    <th>Status</th>
                    <th>Customer</th>
                    <th>Driver</th>
                    <th>Pickup</th>
                    <th class="th-fare">Fare</th>
                    <th class="th-time">Created</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let t of allTasks" class="data-row">
                    <td class="cell-id">
                      <span class="mono">#{{ t.id }}</span>
                    </td>
                    <td>
                      <tm-status-pill [tone]="tripTone(t.status)">{{ t.status }}</tm-status-pill>
                    </td>
                    <td>
                      <div class="cell-stack">
                        <span class="cell-primary">{{ t.customer?.name || '—' }}</span>
                        <span class="cell-secondary" *ngIf="t.customer?.phone">
                          {{ t.customer?.phone }}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div class="cell-stack" *ngIf="t.driver; else noDriver">
                        <span class="cell-primary">{{ t.driver.name || '—' }}</span>
                        <span class="cell-secondary" *ngIf="t.driver.phone">
                          {{ t.driver.phone }}
                        </span>
                      </div>
                      <ng-template #noDriver>
                        <span class="cell-empty">Unassigned</span>
                      </ng-template>
                    </td>
                    <td class="td-truncate">
                      <div class="cell-route">
                        <span class="pin pin--from"></span>
                        <span>{{ t.pickup_address || pretty(t.pickup_lat, t.pickup_lng) }}</span>
                      </div>
                    </td>
                    <td class="cell-fare">
                      <span *ngIf="t.estimated_fare; else noFare">
                        ₹ {{ t.estimated_fare }}
                      </span>
                      <ng-template #noFare><span class="cell-empty">—</span></ng-template>
                    </td>
                    <td class="cell-time">{{ t.created_at | date:'shortTime' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- ===== DRIVERS PANEL ===== -->
        <section class="panel">
          <header class="panel__head">
            <div class="panel__overline">
              <tm-icon name="driver-helmet" [size]="11" />
              <span>Drivers</span>
            </div>
            <div class="panel__head-row">
              <div class="panel__big">{{ totalDrivers }}</div>
              <span class="panel__sub">on platform</span>
            </div>
          </header>

          <div class="tabs" role="tablist">
            <button
              type="button"
              class="tab"
              [class.is-active]="driverTab === 'free'"
              (click)="driverTab = 'free'"
              role="tab"
            >
              <span class="tab__label">Free</span>
              <span class="tab__count">{{ snapshot?.counts?.free || 0 }}</span>
            </button>
            <button
              type="button"
              class="tab"
              [class.is-active]="driverTab === 'busy'"
              (click)="driverTab = 'busy'"
              role="tab"
            >
              <span class="tab__label">Busy</span>
              <span class="tab__count">{{ snapshot?.counts?.busy || 0 }}</span>
            </button>
            <button
              type="button"
              class="tab"
              [class.is-active]="driverTab === 'inactive'"
              (click)="driverTab = 'inactive'"
              role="tab"
            >
              <span class="tab__label">Inactive</span>
              <span class="tab__count">{{ snapshot?.counts?.inactive || 0 }}</span>
            </button>
          </div>

          <div class="panel__filter">
            <tm-input
              [(ngModel)]="driverFilter"
              placeholder="Search by name, phone or reg no…"
              icon="search"
            />
          </div>

          <div class="panel__body">
            <div *ngIf="!filteredDrivers.length" class="empty">
              <tm-icon name="user" [size]="20" />
              <span>No drivers in this bucket.</span>
            </div>

            <div
              *ngFor="let d of filteredDrivers"
              class="row-card"
              [class.is-selected]="selectedDriverId === d.user_id"
              (click)="selectDriver(d)"
            >
              <div class="row-card__top">
                <div class="row-card__identity">
                  <span class="avatar avatar--{{ d.status }}">
                    {{ initials(d.name) }}
                    <span class="avatar__led" [class.is-online]="d.is_online"></span>
                  </span>
                  <div class="row-card__head">
                    <div class="row-card__name">{{ d.name || 'Unnamed' }}</div>
                    <div class="row-card__id-line">
                      <span class="row-card__id">#{{ d.id }}</span>
                      <span *ngIf="d.phone" class="row-card__phone-inline">{{ d.phone }}</span>
                    </div>
                  </div>
                </div>
                <tm-status-pill [tone]="driverTone(d.status)">{{ d.status }}</tm-status-pill>
              </div>

              <div class="row-card__meta">
                <span class="meta-chip" *ngIf="d.vehicle_type">
                  <tm-icon name="car" [size]="11" /> {{ d.vehicle_type }}
                </span>
                <span class="meta-chip meta-chip--soft" *ngIf="d.vehicle_reg_no">
                  {{ d.vehicle_reg_no }}
                </span>
                <span class="meta-chip meta-chip--warn" *ngIf="!d.lat">
                  <tm-icon name="map-marker" [size]="11" /> no location
                </span>
                <span class="meta-chip meta-chip--soft" *ngIf="d.last_seen_at">
                  <tm-icon name="calendar" [size]="11" /> {{ timeAgo(d.last_seen_at) }}
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div *ngIf="error" class="dispatch-error">
        <tm-status-pill tone="danger">Error</tm-status-pill>
        <span class="dispatch-error__msg">{{ error }}</span>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        font-family: var(--tm-font-body);
        color: var(--tm-text);
      }

      .dispatch-shell {
        display: flex;
        flex-direction: column;
        gap: var(--tm-space-3);
        height: calc(100vh - 130px);
        min-height: 620px;
      }

      /* ============================ HERO ============================ */
      .hero {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        gap: var(--tm-space-6);
        padding: var(--tm-space-2) var(--tm-space-2) var(--tm-space-4);
        flex-wrap: wrap;
      }
      .hero__left {
        display: flex;
        flex-direction: column;
        gap: var(--tm-space-2);
        min-width: 0;
      }
      .hero__right {
        display: flex;
        gap: var(--tm-space-2);
        align-items: center;
        flex-wrap: wrap;
      }

      .hero__eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 10px;
      }
      .live-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        background: var(--tm-green-tint);
        color: var(--tm-green-deep);
        border-radius: var(--tm-radius-pill);
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.12em;
      }
      .live-pill__dot {
        width: 6px; height: 6px;
        border-radius: 50%;
        background: var(--tm-green);
        position: relative;
      }
      .live-pill.is-refreshing .live-pill__dot::after {
        content: '';
        position: absolute; inset: -3px;
        border-radius: 50%;
        background: var(--tm-green);
        opacity: 0.4;
        animation: pulse 1.2s ease-out infinite;
      }
      @keyframes pulse {
        0%   { transform: scale(0.6); opacity: 0.5; }
        100% { transform: scale(1.8); opacity: 0; }
      }
      .hero__updated {
        font-size: 11px;
        font-weight: 700;
        font-family: var(--tm-font-mono);
        color: var(--tm-text-muted);
        letter-spacing: 0.02em;
      }
      .hero__title {
        margin: 0;
        font-size: 28px;
        font-weight: 800;
        letter-spacing: -0.03em;
        line-height: 1.1;
        color: var(--tm-text);
      }
      .hero__meta {
        display: inline-flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 2px;
      }
      .hero__chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        background: var(--tm-surface);
        border: 1px solid var(--tm-line);
        border-radius: var(--tm-radius-pill);
        font-size: 11px;
        font-weight: 700;
        color: var(--tm-text);
      }
      .hero__chip .dot {
        width: 7px; height: 7px;
        border-radius: 50%;
      }
      .hero__chip--soft {
        background: transparent;
        border-color: transparent;
        color: var(--tm-text-muted);
      }

      .city-select {
        display: inline-flex;
        align-items: center;
        gap: var(--tm-space-2);
        padding: 7px 28px 7px 12px;
        background: var(--tm-surface);
        border: 1px solid var(--tm-line-2);
        border-radius: var(--tm-radius-md);
        position: relative;
        color: var(--tm-text-muted);
        transition: border-color var(--tm-duration-fast) var(--tm-ease);
      }
      .city-select:focus-within { border-color: var(--tm-ink); }
      .city-select__input {
        appearance: none;
        -webkit-appearance: none;
        background: transparent;
        border: 0;
        outline: 0;
        font-family: inherit;
        font-size: 13px;
        font-weight: 600;
        color: var(--tm-text);
        min-width: 130px;
        cursor: pointer;
      }
      .city-select__caret {
        position: absolute;
        right: 10px;
        pointer-events: none;
        color: var(--tm-text-soft);
      }

      .seg {
        display: inline-flex;
        background: var(--tm-surface);
        border: 1px solid var(--tm-line-2);
        border-radius: var(--tm-radius-md);
        padding: 3px;
        gap: 2px;
      }
      .seg__btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-radius: var(--tm-radius-sm);
        font-weight: 700;
        font-size: 12px;
        color: var(--tm-text-muted);
        background: transparent;
        transition: background var(--tm-duration-fast) var(--tm-ease),
                    color var(--tm-duration-fast) var(--tm-ease);
      }
      .seg__btn:hover { color: var(--tm-text); }
      .seg__btn.is-active {
        background: var(--tm-ink);
        color: #fff;
      }

      /* ============================ GRID ============================ */
      .dispatch-grid {
        display: grid;
        grid-template-columns: 320px 1fr 320px;
        gap: var(--tm-space-3);
        flex: 1;
        min-height: 0;
      }

      .panel {
        display: flex;
        flex-direction: column;
        min-height: 0;
        background: transparent;
      }

      .panel__head {
        padding: 0 var(--tm-space-2) var(--tm-space-3);
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .panel__overline {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-family: var(--tm-font-body);
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--tm-text-muted);
      }
      .panel__head-row {
        display: flex;
        align-items: baseline;
        gap: 8px;
      }
      .panel__big {
        font-family: var(--tm-font-display);
        font-size: 32px;
        font-weight: 800;
        letter-spacing: -0.03em;
        line-height: 1;
        color: var(--tm-text);
      }
      .panel__sub {
        font-size: 11px;
        font-weight: 700;
        color: var(--tm-text-soft);
        letter-spacing: 0.02em;
      }

      .tabs {
        display: flex;
        background: var(--tm-surface);
        border: 1px solid var(--tm-line);
        padding: 3px;
        border-radius: var(--tm-radius-md);
        margin: 0 var(--tm-space-2) var(--tm-space-2);
        gap: 2px;
      }
      .tab {
        flex: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 7px 8px;
        border-radius: var(--tm-radius-sm);
        background: transparent;
        font-weight: 700;
        font-size: 12px;
        color: var(--tm-text-muted);
        transition: background var(--tm-duration-fast) var(--tm-ease),
                    color var(--tm-duration-fast) var(--tm-ease),
                    box-shadow var(--tm-duration-fast) var(--tm-ease);
      }
      .tab:hover { color: var(--tm-text); }
      .tab.is-active {
        background: var(--tm-ink);
        color: #fff;
      }
      .tab__count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        border-radius: var(--tm-radius-pill);
        background: var(--tm-canvas-2);
        color: var(--tm-text-muted);
        font-size: 10px;
        font-weight: 800;
        font-family: var(--tm-font-mono);
      }
      .tab.is-active .tab__count {
        background: rgba(255, 255, 255, 0.16);
        color: #fff;
      }

      .panel__filter {
        padding: 0 var(--tm-space-2) var(--tm-space-3);
      }

      .panel__body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 0 var(--tm-space-2) var(--tm-space-3);
        display: flex;
        flex-direction: column;
        gap: var(--tm-space-2);
      }

      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: var(--tm-space-8) var(--tm-space-3);
        color: var(--tm-text-soft);
        font-size: 13px;
        font-weight: 600;
      }

      /* ---------- Row card (task / driver) ---------- */
      .row-card {
        position: relative;
        padding: var(--tm-space-3);
        border: 1px solid var(--tm-line);
        border-radius: var(--tm-radius-md);
        background: var(--tm-surface);
        cursor: pointer;
        transition: border-color var(--tm-duration-fast) var(--tm-ease),
                    box-shadow var(--tm-duration-fast) var(--tm-ease),
                    background var(--tm-duration-fast) var(--tm-ease);
      }
      .row-card::before {
        content: '';
        position: absolute;
        left: 0; top: 12px; bottom: 12px;
        width: 3px;
        border-radius: 0 3px 3px 0;
        background: transparent;
        transition: background var(--tm-duration-fast) var(--tm-ease);
      }
      .row-card:hover {
        border-color: var(--tm-line-2);
        box-shadow: var(--tm-shadow-sm);
      }
      .row-card.is-selected {
        border-color: var(--tm-ink);
        background: var(--tm-green-tint);
      }
      .row-card.is-selected::before {
        background: var(--tm-green);
      }

      .row-card__top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
      }
      .row-card__identity {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .row-card__head {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .row-card__id {
        font-family: var(--tm-font-mono);
        font-size: 11px;
        font-weight: 700;
        color: var(--tm-text-muted);
      }
      .row-card__id-line {
        display: inline-flex;
        gap: 8px;
        align-items: center;
        font-size: 11px;
        color: var(--tm-text-muted);
      }
      .row-card__phone-inline {
        font-family: var(--tm-font-mono);
        font-size: 11px;
        font-weight: 600;
        color: var(--tm-text-muted);
      }
      .row-card__name {
        font-size: 13px;
        font-weight: 700;
        color: var(--tm-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .row-card__phone {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 12px;
        font-weight: 600;
        color: var(--tm-text-muted);
        margin-bottom: 8px;
      }

      /* ---------- Task card refinements ---------- */
      .task-card__top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 10px;
      }
      .task-card__lead {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .task-card__name {
        font-size: 14px;
        font-weight: 700;
        color: var(--tm-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* ---------- Route connector (dashed line linking pins) ---------- */
      .route-connector {
        position: relative;
        padding: 4px 0;
      }
      .route-connector.has-drop::before {
        content: '';
        position: absolute;
        left: 4px;
        top: 18px;
        bottom: 18px;
        width: 2px;
        background: repeating-linear-gradient(
          to bottom,
          var(--tm-line-2) 0 3px,
          transparent 3px 6px
        );
      }
      .route-line {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 4px 0;
        font-size: 12px;
        line-height: 1.4;
        color: var(--tm-text);
      }
      .route-line__addr {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* ---------- Driver initials avatar ---------- */
      .avatar {
        position: relative;
        width: 34px; height: 34px;
        border-radius: 50%;
        display: grid; place-items: center;
        font-family: var(--tm-font-body);
        font-size: 12px;
        font-weight: 800;
        color: #fff;
        flex-shrink: 0;
        letter-spacing: 0.02em;
        background: linear-gradient(135deg, var(--tm-ink), var(--tm-ink-3));
      }
      .avatar--free { background: linear-gradient(135deg, var(--tm-green), var(--tm-green-deep)); }
      .avatar--busy { background: linear-gradient(135deg, #F59E0B, #B45309); }
      .avatar--inactive { background: linear-gradient(135deg, #94A0AD, #6B7785); }
      .avatar__led {
        position: absolute;
        right: -1px; bottom: -1px;
        width: 10px; height: 10px;
        border-radius: 50%;
        background: var(--tm-text-soft);
        border: 2px solid var(--tm-surface);
      }
      .avatar__led.is-online { background: var(--tm-green); }

      .route {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        line-height: 1.4;
        color: var(--tm-text);
        margin: 4px 0;
      }
      .route__addr {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pin {
        width: 10px; height: 10px;
        border-radius: 50%;
        display: inline-block;
        flex-shrink: 0;
        border: 2px solid #fff;
        box-shadow: 0 0 0 1px var(--tm-line-2);
      }
      .pin--from { background: var(--tm-ink); }
      .pin--to   { background: var(--tm-green); }

      .row-card__meta {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-top: 8px;
      }
      .meta-chip {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 3px 8px;
        border-radius: var(--tm-radius-pill);
        background: var(--tm-canvas-2);
        color: var(--tm-text);
        font-size: 11px;
        font-weight: 700;
      }
      .meta-chip--fare {
        background: var(--tm-green-tint);
        color: var(--tm-green-deep);
      }
      .meta-chip--soft {
        background: transparent;
        color: var(--tm-text-soft);
        padding: 3px 0;
      }
      .meta-chip--warn {
        background: var(--tm-warning-bg);
        color: var(--tm-warning-fg);
      }

      .row-card__driver {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        color: var(--tm-text-muted);
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px dashed var(--tm-line);
      }

      /* ============================ MAP ============================ */
      .map-area {
        min-height: 0;
        position: relative;
      }
      .map-card {
        position: relative;
        height: 100%;
        overflow: hidden;
        border-radius: var(--tm-radius-lg);
        background: var(--tm-surface);
        border: 1px solid var(--tm-line);
      }
      .map-shell {
        width: 100%;
        height: 100%;
        min-height: 420px;
        background: var(--tm-canvas-2);
      }
      .map-loading {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        background: var(--tm-canvas);
        color: var(--tm-text-muted);
        font-weight: 600;
        font-size: 13px;
      }
      .map-spinner {
        width: 18px; height: 18px; border-radius: 50%;
        border: 2px solid var(--tm-line-2);
        border-top-color: var(--tm-green);
        animation: map-spin 0.7s linear infinite;
      }
      @keyframes map-spin { to { transform: rotate(360deg); } }

      /* ---------- Map info overlay (top-left, glass) ---------- */
      .map-info {
        position: absolute;
        top: var(--tm-space-3);
        left: var(--tm-space-3);
        display: inline-flex;
        align-items: center;
        gap: 14px;
        padding: 8px 14px;
        background: rgba(255, 255, 255, 0.92);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        border-radius: var(--tm-radius-pill);
        box-shadow: var(--tm-shadow-pop);
        z-index: 2;
        white-space: nowrap;
      }
      .map-info__group {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .map-info__num {
        font-family: var(--tm-font-display);
        font-size: 14px;
        font-weight: 800;
        letter-spacing: -0.01em;
        color: var(--tm-text);
      }
      .map-info__lbl {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--tm-text-muted);
      }
      .map-info__dot {
        width: 8px; height: 8px;
        border-radius: 50%;
        border: 2px solid #fff;
        box-shadow: 0 0 0 1px var(--tm-line-2);
      }
      .map-info__sq {
        width: 8px; height: 8px;
        border-radius: 2px;
        transform: rotate(45deg);
        border: 2px solid #fff;
        box-shadow: 0 0 0 1px var(--tm-line-2);
      }
      .map-info__sep {
        width: 1px;
        height: 18px;
        background: var(--tm-line);
      }

      /* ---------- Floating action group (top-right) ---------- */
      .map-actions {
        position: absolute;
        top: var(--tm-space-3);
        right: var(--tm-space-3);
        display: inline-flex;
        gap: 6px;
        z-index: 2;
      }
      .map-action {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        background: var(--tm-surface);
        color: var(--tm-text);
        border-radius: var(--tm-radius-pill);
        box-shadow: var(--tm-shadow-pop);
        font-weight: 700;
        font-size: 12px;
        cursor: pointer;
        border: 0;
        transition: transform var(--tm-duration-fast) var(--tm-ease),
                    background var(--tm-duration-fast) var(--tm-ease),
                    color var(--tm-duration-fast) var(--tm-ease);
      }
      .map-action--icon {
        width: 36px; height: 36px;
        padding: 0;
        justify-content: center;
      }
      .map-action:hover:not(:disabled) {
        background: var(--tm-ink);
        color: #fff;
      }
      .map-action:active:not(:disabled) { transform: translateY(1px); }
      .map-action:disabled { opacity: 0.5; cursor: not-allowed; }

      /* ---------- Compact horizontal legend ---------- */
      .legend {
        position: absolute;
        left: 50%;
        bottom: var(--tm-space-3);
        transform: translateX(-50%);
        background: var(--tm-surface);
        border-radius: var(--tm-radius-pill);
        padding: 8px 14px;
        box-shadow: var(--tm-shadow-pop);
        display: inline-flex;
        align-items: center;
        gap: 12px;
        font-size: 11px;
        font-weight: 700;
        color: var(--tm-text);
        z-index: 1;
        white-space: nowrap;
      }
      .legend__item {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .legend__pin {
        width: 9px; height: 9px;
        border-radius: 50%;
        border: 2px solid #fff;
        box-shadow: 0 0 0 1px var(--tm-line-2);
      }
      .legend__pin--diamond {
        transform: rotate(45deg);
        border-radius: 2px;
      }
      .legend__divider {
        width: 1px;
        height: 14px;
        background: var(--tm-line-2);
      }


      /* ============================ LIST ============================ */
      .list-card {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        background: var(--tm-surface);
        border-radius: var(--tm-radius-lg);
        border: 1px solid var(--tm-line);
        overflow: hidden;
      }
      .list-card__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--tm-space-3);
        padding: var(--tm-space-5) var(--tm-space-5) var(--tm-space-4);
        border-bottom: 1px solid var(--tm-line);
      }
      .list-card__head-text {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .list-card__sub {
        font-size: 12px;
        font-weight: 600;
        color: var(--tm-text-muted);
      }
      .list-card__eyebrow {
        padding: 4px 10px;
        background: var(--tm-canvas-2);
        border-radius: var(--tm-radius-pill);
        color: var(--tm-text-muted);
      }

      /* ---------- Centered empty state ---------- */
      .list-empty {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        gap: var(--tm-space-3);
        padding: var(--tm-space-10) var(--tm-space-6);
        min-height: 360px;
      }
      .list-empty__icon {
        width: 64px;
        height: 64px;
        border-radius: var(--tm-radius-lg);
        background: var(--tm-canvas-2);
        color: var(--tm-text-muted);
        display: grid;
        place-items: center;
        margin-bottom: var(--tm-space-2);
      }
      .list-empty__title {
        font-size: 18px;
        font-weight: 800;
        letter-spacing: -0.01em;
        color: var(--tm-text);
      }
      .list-empty__hint {
        font-size: 13px;
        font-weight: 500;
        color: var(--tm-text-muted);
        max-width: 36ch;
        line-height: 1.5;
        margin-bottom: var(--tm-space-2);
      }

      /* ---------- Table ---------- */
      .table-wrap {
        flex: 1;
        min-height: 0;
        overflow: auto;
      }
      .data-table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
        font-size: 13px;
      }
      .data-table th,
      .data-table td {
        padding: 12px 16px;
        text-align: left;
        vertical-align: middle;
      }
      .data-table thead th {
        font-family: var(--tm-font-body);
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--tm-text-muted);
        background: var(--tm-canvas);
        position: sticky;
        top: 0;
        z-index: 1;
        border-bottom: 1px solid var(--tm-line);
        white-space: nowrap;
      }
      .data-table .th-id    { width: 88px; }
      .data-table .th-fare  { width: 110px; }
      .data-table .th-time  { width: 110px; white-space: nowrap; }

      .data-row {
        transition: background var(--tm-duration-fast) var(--tm-ease);
      }
      .data-row:hover { background: var(--tm-canvas); }
      .data-row td {
        border-bottom: 1px solid var(--tm-line);
      }
      .data-row:last-child td { border-bottom: 0; }

      .cell-id .mono {
        display: inline-flex;
        align-items: center;
        padding: 3px 8px;
        border-radius: var(--tm-radius-pill);
        background: var(--tm-canvas-2);
        color: var(--tm-text);
        font-family: var(--tm-font-mono);
        font-size: 11px;
        font-weight: 700;
      }

      .cell-stack {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .cell-primary {
        font-weight: 700;
        color: var(--tm-text);
        font-size: 13px;
      }
      .cell-secondary {
        font-size: 11px;
        font-weight: 600;
        color: var(--tm-text-muted);
        font-family: var(--tm-font-mono);
      }
      .cell-empty {
        color: var(--tm-text-soft);
        font-weight: 600;
      }
      .cell-fare {
        font-family: var(--tm-font-mono);
        font-weight: 700;
        color: var(--tm-text);
        font-size: 13px;
        white-space: nowrap;
      }
      .cell-time {
        font-family: var(--tm-font-mono);
        font-size: 12px;
        font-weight: 600;
        color: var(--tm-text-muted);
        white-space: nowrap;
      }

      .cell-route {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        max-width: 320px;
      }
      .cell-route > span:last-child {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .td-truncate {
        max-width: 320px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .mono { font-family: var(--tm-font-mono); font-weight: 600; }
      .muted { color: var(--tm-text-muted); }

      /* ============================ ERROR ============================ */
      .dispatch-error {
        display: flex;
        align-items: center;
        gap: var(--tm-space-3);
        padding: var(--tm-space-3) var(--tm-space-4);
        background: var(--tm-danger-bg);
        border-radius: var(--tm-radius-md);
      }
      .dispatch-error__msg {
        color: var(--tm-danger-fg);
        font-weight: 600;
      }

      /* ============================ RESPONSIVE ============================ */
      @media (max-width: 1280px) {
        .dispatch-grid {
          grid-template-columns: 280px 1fr 280px;
        }
        .hero__title { font-size: 24px; }
      }
      @media (max-width: 1100px) {
        .dispatch-shell { height: auto; }
        .dispatch-grid {
          grid-template-columns: 1fr;
          height: auto;
        }
        .hero { flex-direction: column; align-items: flex-start; }
        .hero__right { width: 100%; }
        .panel { max-height: 420px; }
        .map-shell { height: 480px; }
        .map-info { top: auto; bottom: 60px; }
      }
    `,
  ],
})
export class MapsComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: false }) mapContainer!: ElementRef<HTMLDivElement>;

  view: 'map' | 'list' = 'map';
  cityId: number | null = null;
  cityOptions: CityRow[] = [];

  taskTab: 'unassigned' | 'assigned' = 'unassigned';
  driverTab: 'free' | 'busy' | 'inactive' = 'free';

  taskFilter = '';
  driverFilter = '';

  snapshot: Snapshot | null = null;
  error: string | null = null;

  selectedTaskId: number | null = null;
  selectedDriverId: number | null = null;

  isRefreshing = false;
  lastUpdated: Date | null = null;
  mapsReady = false;

  private map: google.maps.Map | null = null;
  private driverMarkerMap = new Map<number, google.maps.Marker>();
  private taskMarkerMap = new Map<number, google.maps.Marker>();
  private infoWindow: google.maps.InfoWindow | null = null;
  private pendingSnapshot: Snapshot | null = null;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private hasFitBounds = false;

  constructor(
    private api: ApiService,
    private zone: NgZone,
    private mapsLoader: GoogleMapsLoaderService,
  ) {}

  ngOnInit(): void {
    this.loadCities();
  }

  ngAfterViewInit(): void {
    void this.initMap();
    this.fetch(true);
    this.pollHandle = setInterval(() => this.fetch(false), 15000);
  }

  ngOnDestroy(): void {
    if (this.pollHandle) clearInterval(this.pollHandle);
    this.clearAllMarkers();
    this.infoWindow?.close();
  }

  // ----------------------------------------------------------------
  // Derived getters
  // ----------------------------------------------------------------
  get filteredTasks(): TaskRow[] {
    if (!this.snapshot) return [];
    const list = this.snapshot.tasks[this.taskTab];
    const term = this.taskFilter.trim().toLowerCase();
    if (!term) return list;
    return list.filter(
      (t) =>
        (t.customer?.name || '').toLowerCase().includes(term) ||
        (t.customer?.phone || '').toLowerCase().includes(term) ||
        (t.pickup_address || '').toLowerCase().includes(term),
    );
  }

  get filteredDrivers(): DriverRow[] {
    if (!this.snapshot) return [];
    const list = this.snapshot.drivers[this.driverTab];
    const term = this.driverFilter.trim().toLowerCase();
    if (!term) return list;
    return list.filter(
      (d) =>
        (d.name || '').toLowerCase().includes(term) ||
        (d.phone || '').toLowerCase().includes(term) ||
        (d.vehicle_reg_no || '').toLowerCase().includes(term),
    );
  }

  get allTasks(): TaskRow[] {
    if (!this.snapshot) return [];
    return [...this.snapshot.tasks.unassigned, ...this.snapshot.tasks.assigned];
  }

  get totalDrivers(): number {
    const c = this.snapshot?.counts;
    return (c?.free || 0) + (c?.busy || 0) + (c?.inactive || 0);
  }

  get totalTasks(): number {
    const c = this.snapshot?.counts;
    return (c?.unassigned || 0) + (c?.assigned || 0);
  }

  get selectedCityName(): string | null {
    if (this.cityId == null) return null;
    return this.cityOptions.find((c) => c.id === this.cityId)?.name || null;
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------
  tripTone(status: string): StatusTone {
    if (status === 'COMPLETED') return 'success';
    if (status === 'CANCELLED') return 'danger';
    if (status === 'NEGOTIATION' || status === 'REQUESTED' || status === 'CONFIRMED') return 'warning';
    return 'info';
  }

  driverTone(status: DriverRow['status']): StatusTone {
    if (status === 'free') return 'success';
    if (status === 'busy') return 'warning';
    return 'neutral';
  }

  pretty(lat: number | null, lng: number | null): string {
    if (lat == null || lng == null) return 'No location';
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }

  formatTime(d: Date): string {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  initials(name: string | null): string {
    if (!name) return '—';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '—';
    const a = parts[0][0] || '';
    const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (a + b).toUpperCase();
  }

  timeAgo(iso: string | null): string {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (isNaN(then)) return '';
    const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const days = Math.floor(hr / 24);
    return `${days}d ago`;
  }

  fitAll(): void {
    this.fitToAllMarkers();
  }

  /**
   * Switching from list → map can briefly resize the container while it was
   * hidden; Google Maps needs a `resize` nudge to repaint its tiles and the
   * camera must be re-centered (resize sometimes shifts the view).
   */
  setView(next: 'map' | 'list'): void {
    if (this.view === next) return;
    this.view = next;
    if (next !== 'map' || !this.map) return;
    const map = this.map;
    const center = map.getCenter();
    setTimeout(() => {
      google.maps.event.trigger(map, 'resize');
      if (center) map.setCenter(center);
    }, 0);
  }

  selectTask(t: TaskRow): void {
    this.selectedTaskId = t.id;
    if (t.pickup_lat != null && t.pickup_lng != null && this.map) {
      this.map.panTo({ lat: t.pickup_lat, lng: t.pickup_lng });
      if ((this.map.getZoom() ?? 0) < 14) this.map.setZoom(14);
    }
  }

  selectDriver(d: DriverRow): void {
    this.selectedDriverId = d.user_id;
    if (d.lat != null && d.lng != null && this.map) {
      this.map.panTo({ lat: d.lat, lng: d.lng });
      if ((this.map.getZoom() ?? 0) < 14) this.map.setZoom(14);
    }
  }

  onCityChange(): void {
    const city = this.cityOptions.find((c) => c.id === this.cityId) || null;
    if (this.map) {
      if (city?.boundary_polygon?.length) {
        const bounds = new google.maps.LatLngBounds();
        city.boundary_polygon.forEach((p) => bounds.extend(p));
        this.map.fitBounds(bounds, 40);
      } else if (city?.center_lat != null && city?.center_lng != null) {
        this.map.panTo({ lat: city.center_lat, lng: city.center_lng });
        this.map.setZoom(12);
      } else if (!city) {
        this.map.panTo({ lat: 33.7311, lng: 75.1487 });
        this.map.setZoom(11);
      }
    }
    // City change is a deliberate re-frame — allow auto-fit on the next snapshot
    this.hasFitBounds = !!city; // explicit city fit just happened
    this.fetch(true);
  }

  // ----------------------------------------------------------------
  // Networking
  // ----------------------------------------------------------------
  fetch(showLoading: boolean): void {
    this.error = null;
    if (showLoading) this.isRefreshing = true;
    else this.isRefreshing = true; // always show a soft indicator on poll
    const params: string[] = [];
    if (this.cityId) params.push(`city_id=${this.cityId}`);
    const qs = params.length ? `?${params.join('&')}` : '';

    this.api.get<Snapshot>(`/admin/dispatch/snapshot${qs}`).subscribe({
      next: (res) => {
        this.snapshot = res;
        this.lastUpdated = new Date();
        this.isRefreshing = false;
        if (this.mapsReady) {
          this.applySnapshotToMap();
        } else {
          this.pendingSnapshot = res;
        }
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load dispatch snapshot';
        this.isRefreshing = false;
      },
    });
  }

  private loadCities(): void {
    this.api.get<{ data: CityRow[] }>('/admin/cities').subscribe({
      next: (res) => (this.cityOptions = res?.data || []),
      error: () => {},
    });
  }

  // ----------------------------------------------------------------
  // Map lifecycle
  // ----------------------------------------------------------------
  private async initMap(): Promise<void> {
    if (!this.mapContainer?.nativeElement) return;
    try {
      await this.mapsLoader.load();
    } catch {
      this.zone.run(() => (this.error = 'Could not load Google Maps.'));
      return;
    }
    this.map = new google.maps.Map(this.mapContainer.nativeElement, {
      center: { lat: 33.7311, lng: 75.1487 },
      zoom: 11,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
      gestureHandling: 'greedy',
    });
    this.infoWindow = new google.maps.InfoWindow();
    this.mapsReady = true;
    if (this.pendingSnapshot) {
      this.applySnapshotToMap();
      this.pendingSnapshot = null;
    }
  }

  private clearAllMarkers(): void {
    this.driverMarkerMap.forEach((m) => m.setMap(null));
    this.taskMarkerMap.forEach((m) => m.setMap(null));
    this.driverMarkerMap.clear();
    this.taskMarkerMap.clear();
  }

  /**
   * Diff-update markers in place so subsequent polls don't flicker
   * or shift the map. Only fits bounds on first successful snapshot.
   */
  private applySnapshotToMap(): void {
    if (!this.map || !this.snapshot) return;

    const driverIcon = (color: string): google.maps.Symbol => ({
      path: google.maps.SymbolPath.CIRCLE,
      scale: 8,
      fillColor: color,
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2,
    });

    const taskIcon = (color: string): google.maps.Symbol => ({
      path: 'M 0 -10 L 10 0 L 0 10 L -10 0 Z',
      scale: 1,
      fillColor: color,
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2,
    });

    // ---------- Drivers ----------
    const presentDriverIds = new Set<number>();
    const upsertDriver = (d: DriverRow, color: string) => {
      if (d.lat == null || d.lng == null) return;
      presentDriverIds.add(d.id);
      const position = { lat: d.lat, lng: d.lng };
      let marker = this.driverMarkerMap.get(d.id);
      if (marker) {
        marker.setPosition(position);
        marker.setIcon(driverIcon(color));
        marker.setTitle(d.name || 'Driver');
      } else {
        marker = new google.maps.Marker({
          position,
          map: this.map!,
          icon: driverIcon(color),
          title: d.name || 'Driver',
          optimized: true,
        });
        marker.addListener('click', () => {
          this.infoWindow?.setContent(
            `<div style="font-family: 'Plus Jakarta Sans', sans-serif; min-width:160px">
               <div style="font-weight:800; font-size:13px; color:#0F1419">${d.name || 'Driver'}</div>
               <div style="font-size:12px; color:#6B7785; margin-top:2px">${d.phone || ''}</div>
               <div style="font-size:12px; color:#0F1419; margin-top:4px">${d.vehicle_type || ''} ${d.vehicle_reg_no || ''}</div>
               <div style="font-size:11px; font-weight:800; letter-spacing:0.06em; text-transform:uppercase; color:#16A34A; margin-top:6px">${d.status}</div>
             </div>`,
          );
          this.infoWindow?.open({ map: this.map!, anchor: marker! });
        });
        this.driverMarkerMap.set(d.id, marker);
      }
    };

    this.snapshot.drivers.free.forEach((d) => upsertDriver(d, COLORS.free));
    this.snapshot.drivers.busy.forEach((d) => upsertDriver(d, COLORS.busy));
    this.snapshot.drivers.inactive.forEach((d) => upsertDriver(d, COLORS.inactive));

    for (const [id, marker] of this.driverMarkerMap) {
      if (!presentDriverIds.has(id)) {
        marker.setMap(null);
        this.driverMarkerMap.delete(id);
      }
    }

    // ---------- Tasks ----------
    const presentTaskIds = new Set<number>();
    const upsertTask = (t: TaskRow, color: string) => {
      if (t.pickup_lat == null || t.pickup_lng == null) return;
      presentTaskIds.add(t.id);
      const position = { lat: t.pickup_lat, lng: t.pickup_lng };
      let marker = this.taskMarkerMap.get(t.id);
      if (marker) {
        marker.setPosition(position);
        marker.setIcon(taskIcon(color));
        marker.setTitle(`Trip #${t.id}`);
      } else {
        marker = new google.maps.Marker({
          position,
          map: this.map!,
          icon: taskIcon(color),
          title: `Trip #${t.id}`,
          optimized: true,
        });
        marker.addListener('click', () => {
          this.infoWindow?.setContent(
            `<div style="font-family: 'Plus Jakarta Sans', sans-serif; min-width:180px">
               <div style="font-weight:800; font-size:13px; color:#0F1419">Trip #${t.id}</div>
               <div style="font-size:12px; color:#6B7785; margin-top:2px">${t.customer?.name || ''}</div>
               <div style="font-size:12px; color:#0F1419; margin-top:4px">${t.pickup_address || ''}</div>
               <div style="font-size:11px; font-weight:800; letter-spacing:0.06em; text-transform:uppercase; color:#16A34A; margin-top:6px">${t.status}</div>
             </div>`,
          );
          this.infoWindow?.open({ map: this.map!, anchor: marker! });
        });
        this.taskMarkerMap.set(t.id, marker);
      }
    };

    this.snapshot.tasks.unassigned.forEach((t) => upsertTask(t, COLORS.task));
    this.snapshot.tasks.assigned.forEach((t) => upsertTask(t, COLORS.taskAssigned));

    for (const [id, marker] of this.taskMarkerMap) {
      if (!presentTaskIds.has(id)) {
        marker.setMap(null);
        this.taskMarkerMap.delete(id);
      }
    }

    // ---------- Fit bounds only on first snapshot ----------
    if (!this.hasFitBounds) {
      this.fitToAllMarkers();
      this.hasFitBounds = true;
    }
  }

  private fitToAllMarkers(): void {
    if (!this.map || !this.snapshot) return;
    const bounds = new google.maps.LatLngBounds();
    let any = false;
    [
      ...this.snapshot.drivers.free,
      ...this.snapshot.drivers.busy,
      ...this.snapshot.drivers.inactive,
    ].forEach((d) => {
      if (d.lat != null && d.lng != null) {
        bounds.extend({ lat: d.lat, lng: d.lng });
        any = true;
      }
    });
    [...this.snapshot.tasks.unassigned, ...this.snapshot.tasks.assigned].forEach((t) => {
      if (t.pickup_lat != null && t.pickup_lng != null) {
        bounds.extend({ lat: t.pickup_lat, lng: t.pickup_lng });
        any = true;
      }
    });
    if (!any) return;
    this.map.fitBounds(bounds, 40);
    google.maps.event.addListenerOnce(this.map, 'idle', () => {
      if (this.map && (this.map.getZoom() ?? 0) > 14) this.map.setZoom(14);
    });
  }
}
