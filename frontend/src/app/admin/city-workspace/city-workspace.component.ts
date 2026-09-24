import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { of, Subscription } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { CityContextService, CityOption } from '../../core/city-context.service';
import { GoogleMapsLoaderService } from '../../core/google-maps-loader.service';
import { ToastService } from '../../core/toast.service';
import { ReturnToSetupComponent } from '../setup/return-to-setup.component';
import {
  ButtonComponent,
  DrawerComponent,
  IconComponent,
  ModalComponent,
} from '../../ui';

interface LatLng {
  lat: number;
  lng: number;
}

interface CityForm {
  name: string;
  country_code: string;
  center_lat: string;
  center_lng: string;
  is_active: boolean;
}

/**
 * City Workspace — the hub for city basics and service-area geofencing.
 */
@Component({
  selector: 'app-city-workspace',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    IconComponent,
    ButtonComponent,
    DrawerComponent,
    ModalComponent,
    ReturnToSetupComponent,
  ],
  template: `
    <div class="cw">
      <app-return-to-setup></app-return-to-setup>

      <!-- ===== Header / Hero ===== -->
      <header class="cw__head">
        <div class="cw__head-title-col">
          <div class="cw__badge-row">
            <span class="cw__badge-chip">
              <span class="cw__status-pulse"></span>
              City Operations Hub
            </span>
            <span class="cw__meta-chip">
              {{ cities.length }} Total Cities · {{ activeCitiesCount }} Active
            </span>
          </div>
          <h1 class="cw__title">City Workspace & Geofencing</h1>
          <p class="cw__sub">
            Manage operational territories, geofenced boundaries, and central dispatch coordinates across your network.
          </p>
        </div>

        <div class="cw__head-actions">
          <tm-button variant="green" (clicked)="openCreate()">
            <tm-icon name="plus" [size]="15" /> Add New City
          </tm-button>
        </div>
      </header>

      <!-- ===== Operational Cities Panel ===== -->
      <section class="cw__card cw__cities-card">
        <div class="cw__card-topbar">
          <div class="cw__card-topbar-left">
            <div class="cw__section-title">
              <tm-icon name="pin" [size]="16" class="cw__section-icon" />
              <span>Operational Cities</span>
              <span class="cw__pill-count">{{ filteredCities.length }}</span>
            </div>

            <!-- Status Filter Tabs -->
            <div class="cw__filter-tabs">
              <button
                type="button"
                class="cw__filter-tab"
                [class.is-active]="statusFilter === 'all'"
                (click)="statusFilter = 'all'"
              >
                All ({{ cities.length }})
              </button>
              <button
                type="button"
                class="cw__filter-tab"
                [class.is-active]="statusFilter === 'active'"
                (click)="statusFilter = 'active'"
              >
                Active ({{ activeCitiesCount }})
              </button>
              <button
                type="button"
                class="cw__filter-tab"
                [class.is-active]="statusFilter === 'inactive'"
                (click)="statusFilter = 'inactive'"
                *ngIf="inactiveCitiesCount > 0"
              >
                Inactive ({{ inactiveCitiesCount }})
              </button>
            </div>
          </div>

          <!-- Quick Search Filter -->
          <div class="cw__search-wrap">
            <tm-icon name="search" [size]="14" class="cw__search-icon" />
            <input
              type="text"
              class="cw__search-field"
              [(ngModel)]="searchQuery"
              placeholder="Search city by name (e.g. Bandipora, Srinagar)..."
            />
            <button
              type="button"
              class="cw__search-clear-btn"
              *ngIf="searchQuery"
              (click)="searchQuery = ''"
              title="Clear search"
            >×</button>
          </div>
        </div>

        <!-- Cities Grid Container -->
        <div class="cw__cities-viewport">
          <div class="cw__city-grid" *ngIf="filteredCities.length > 0">
            <article
              *ngFor="let c of filteredCities"
              class="city-item"
              [class.is-selected]="c.id === currentId"
              (click)="select(c.id)"
            >
              <div class="city-item__status">
                <span
                  class="city-item__dot"
                  [class.is-active]="c.is_active !== false"
                  [class.is-inactive]="c.is_active === false"
                  [class.is-selected]="c.id === currentId"
                ></span>
              </div>

              <div class="city-item__info">
                <div class="city-item__name-row">
                  <span class="city-item__name" [title]="c.name">{{ c.name }}</span>
                  <span class="city-item__country" *ngIf="c.country_code">{{ c.country_code }}</span>
                </div>
                <div class="city-item__meta">
                  <span class="city-item__status-badge" *ngIf="c.is_active === false">Inactive</span>
                  <span class="city-item__active-badge" *ngIf="c.id === currentId">Selected</span>
                </div>
              </div>

              <div class="city-item__actions" (click)="$event.stopPropagation()">
                <button
                  type="button"
                  class="city-action-btn"
                  (click)="openEdit(c, $event)"
                  title="Edit city details"
                >
                  <tm-icon name="edit" [size]="12" />
                </button>
                <button
                  type="button"
                  class="city-action-btn city-action-btn--danger"
                  (click)="askDelete(c, $event)"
                  title="Delete city"
                >
                  <tm-icon name="trash" [size]="12" />
                </button>
              </div>
            </article>
          </div>

          <!-- Empty search result -->
          <div class="cw__empty-search" *ngIf="filteredCities.length === 0">
            <div class="cw__empty-icon-wrap">
              <tm-icon name="search" [size]="20" />
            </div>
            <div class="cw__empty-text">
              <span class="cw__empty-title">No matching cities found</span>
              <span class="cw__empty-desc" *ngIf="searchQuery">
                No operational city matches "<strong>{{ searchQuery }}</strong>".
              </span>
              <span class="cw__empty-desc" *ngIf="!searchQuery && cities.length === 0">
                You have not created any operational cities yet.
              </span>
            </div>
            <div class="cw__empty-actions" *ngIf="searchQuery">
              <tm-button variant="ghost" size="sm" (clicked)="searchQuery = ''">
                Clear search filter
              </tm-button>
              <tm-button variant="green" size="sm" (clicked)="openCreateWithQuery(searchQuery)">
                <tm-icon name="plus" [size]="13" /> Add "{{ searchQuery }}"
              </tm-button>
            </div>
          </div>
        </div>
      </section>

      <!-- ===== Selected City Service Area & Geofence Map ===== -->
      <section class="cw__card cw__map-section" *ngIf="currentId != null">
        <div class="cw__map-header">
          <div class="cw__map-info-col">
            <div class="cw__map-title-row">
              <h2 class="cw__map-city-name">{{ currentCity?.name || 'Selected City' }}</h2>
              <span class="cw__map-country-tag" *ngIf="currentCity?.country_code">{{ currentCity?.country_code }}</span>
              <span
                class="cw__fence-pill"
                [class.has-fence]="hasFence"
                [class.no-fence]="!hasFence"
              >
                <tm-icon [name]="hasFence ? 'check' : 'pin'" [size]="12" />
                {{ hasFence ? 'Geofenced Service Area (' + mapCity?.boundary_polygon?.length + ' points)' : 'No Boundary Set' }}
              </span>
            </div>

            <div class="cw__map-coords-row" *ngIf="mapCity?.center_lat && mapCity?.center_lng">
              <span class="cw__coords-text">
                📍 Center: {{ (+mapCity.center_lat).toFixed(4) }}°N, {{ (+mapCity.center_lng).toFixed(4) }}°E
              </span>
              <button type="button" class="cw__recenter-link" (click)="recenterMap()">
                Center Map
              </button>
            </div>
          </div>

          <!-- Action Toolbar -->
          <div class="cw__map-toolbar">
            <!-- Normal Mode -->
            <ng-container *ngIf="!editingFence">
              <tm-button
                variant="green"
                size="sm"
                icon="edit"
                (clicked)="startFenceEdit()"
              >
                {{ hasFence ? 'Edit Geofence' : 'Draw Boundary' }}
              </tm-button>
              <tm-button
                *ngIf="hasFence"
                variant="ghost"
                size="sm"
                icon="trash"
                [disabled]="savingFence"
                (clicked)="removeFence()"
              >
                Remove Boundary
              </tm-button>
            </ng-container>

            <!-- Boundary Drawing Mode -->
            <ng-container *ngIf="editingFence">
              <span class="cw__draft-counter">
                <tm-icon name="pin" [size]="13" />
                <strong>{{ draftPolygon.length }}</strong> points
              </span>
              <tm-button
                variant="ghost"
                size="sm"
                icon="refresh"
                [disabled]="!draftPolygon.length"
                (clicked)="undoFencePoint()"
              >
                Undo
              </tm-button>
              <tm-button
                variant="ghost"
                size="sm"
                icon="trash"
                [disabled]="!draftPolygon.length"
                (clicked)="clearFence()"
              >
                Clear
              </tm-button>
              <tm-button
                variant="ghost"
                size="sm"
                (clicked)="cancelFenceEdit()"
              >
                Cancel
              </tm-button>
              <tm-button
                variant="green"
                size="sm"
                icon="check"
                [disabled]="draftPolygon.length < 3 || savingFence"
                (clicked)="saveFence()"
              >
                {{ savingFence ? 'Saving...' : 'Save Geofence' }}
              </tm-button>
            </ng-container>
          </div>
        </div>

        <!-- Floating instruction pill when editing -->
        <div class="cw__drawing-banner" *ngIf="editingFence">
          <div class="cw__drawing-banner-content">
            <tm-icon name="pin" [size]="15" class="cw__drawing-banner-icon" />
            <span>
              <strong>Boundary Editor Mode:</strong> Click anywhere on the map to place boundary perimeter points. Add at least 3 points to enclose the operational zone.
            </span>
          </div>
          <span class="cw__drawing-status" [class.is-ready]="draftPolygon.length >= 3">
            {{ draftPolygon.length >= 3 ? '✓ Ready to save' : (3 - draftPolygon.length) + ' more required' }}
          </span>
        </div>

        <!-- Map Container -->
        <div class="cw__map-viewport" #cityMap></div>
      </section>

      <!-- Empty State when no city selected -->
      <div class="cw__pick-banner" *ngIf="currentId == null && cities.length > 0">
        <div class="cw__pick-banner-icon">
          <tm-icon name="pin" [size]="24" />
        </div>
        <div class="cw__pick-banner-text">
          <h3>No City Selected</h3>
          <p>Select any operational city from the list above to view and configure its service area and geofenced boundary.</p>
        </div>
      </div>
    </div>

    <!-- ===== Create / Edit City Drawer ===== -->
    <tm-drawer
      [open]="formOpen"
      [title]="editing ? 'Edit City' : 'Add New Operational City'"
      [subtitle]="editing ? editing.name : 'Search location on Google Maps to set coordinates'"
      (closed)="onDrawerClosed()"
    >
      <div slot="body" class="cw-form">
        <!-- City Name with Places Autocomplete -->
        <div class="cw-field">
          <label class="cw-field__lbl">
            City Name <span class="cw-field__req">*</span>
          </label>
          <div class="cw-field__input-wrap">
            <tm-icon name="search" [size]="14" class="cw-field__icon" />
            <input
              #cityNameInput
              type="text"
              class="cw-field__input cw-field__input--has-icon"
              [(ngModel)]="form.name"
              (ngModelChange)="onNameTyped()"
              placeholder="Search city on Google Maps (e.g. Bandipora, Srinagar)..."
              maxlength="80"
              autocomplete="off"
              (keydown.enter)="$event.preventDefault()"
            />
          </div>
          <span class="cw-field__err" *ngIf="touched.name && !form.name.trim()">
            City name is required.
          </span>
          <div class="cw-field__geo-status" *ngIf="form.center_lat && form.center_lng">
            <tm-icon name="check" [size]="12" class="cw-field__geo-icon" />
            <span>Coordinates pinned: <strong>{{ (+form.center_lat).toFixed(4) }}, {{ (+form.center_lng).toFixed(4) }}</strong></span>
          </div>
          <span class="cw-field__hint" *ngIf="!(form.center_lat && form.center_lng)">
            Select from the Google Places suggestions to automatically pin central dispatch coordinates.
          </span>
        </div>

        <!-- Live Drawer Map Preview -->
        <div class="cw-drawer-map-wrap">
          <div class="cw-drawer-map" #drawerMap></div>
          <div class="cw-drawer-map__caption" *ngIf="form.center_lat && form.center_lng">
            Dispatch Center Point Preview
          </div>
        </div>

        <!-- Country Code -->
        <div class="cw-field">
          <label class="cw-field__lbl">
            Country ISO Code <span class="cw-field__req">*</span>
          </label>
          <input
            type="text"
            class="cw-field__input cw-field__input--short"
            [(ngModel)]="form.country_code"
            (ngModelChange)="touched.cc = true"
            placeholder="IN"
            maxlength="2"
          />
          <span class="cw-field__err" *ngIf="touched.cc && form.country_code.trim().length !== 2">
            2-letter ISO country code is required (e.g. IN).
          </span>
        </div>

        <!-- Active Status Toggle -->
        <div class="cw-toggle-card">
          <div class="cw-toggle-card__left">
            <span class="cw-toggle-card__title">Operational Status</span>
            <span class="cw-toggle-card__desc">When enabled, customers can book rides and drivers can accept bookings in this city.</span>
          </div>
          <label class="cw-switch">
            <input type="checkbox" [(ngModel)]="form.is_active" />
            <span class="cw-switch__slider"></span>
          </label>
        </div>
      </div>

      <div slot="footer" class="cw-drawer-footer">
        <tm-button variant="ghost" (clicked)="onDrawerClosed()">Cancel</tm-button>
        <tm-button variant="green" [disabled]="!formValid || saving" (clicked)="save()">
          {{ saving ? 'Saving...' : editing ? 'Save Changes' : 'Create City' }}
        </tm-button>
      </div>
    </tm-drawer>

    <!-- ===== Delete Confirmation Modal ===== -->
    <tm-modal
      [open]="!!deleteTarget"
      title="Delete City Territory"
      (closed)="deleteTarget = null"
    >
      <div slot="body" class="cw-delete-modal-body">
        <div class="cw-delete-warning-box">
          <tm-icon name="trash" [size]="20" class="cw-delete-warning-icon" />
          <div class="cw-delete-warning-text">
            <p>
              Are you sure you want to delete <strong>{{ deleteTarget?.name }}</strong>?
            </p>
            <p class="cw-delete-sub">
              This will permanently delete this operational territory and all associated vehicle pricing, scheduled slots, and geofence polygons. This action cannot be undone.
            </p>
          </div>
        </div>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="deleteTarget = null">Cancel</tm-button>
        <tm-button variant="danger" [disabled]="saving" (clicked)="confirmDelete()">
          {{ saving ? 'Deleting...' : 'Permanently Delete' }}
        </tm-button>
      </div>
    </tm-modal>
  `,
  styles: [`
    .cw {
      display: flex;
      flex-direction: column;
      gap: 18px;
      padding-bottom: 32px;
    }

    /* ===== Hero Header ===== */
    .cw__head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 20px;
      flex-wrap: wrap;
    }
    .cw__head-title-col {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .cw__badge-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .cw__badge-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 999px;
      background: var(--tm-green-soft, #dcfce7);
      color: var(--tm-green-deep, #16a34a);
      font-size: 11px;
      font-weight: 750;
      letter-spacing: 0.2px;
    }
    .cw__status-pulse {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--tm-green-deep, #16a34a);
      box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.3);
    }
    .cw__meta-chip {
      font-size: 12px;
      font-weight: 600;
      color: var(--tm-text-muted);
    }
    .cw__title {
      margin: 0;
      font-size: 24px;
      font-weight: 850;
      color: var(--tm-text);
      letter-spacing: -0.4px;
    }
    .cw__sub {
      margin: 0;
      font-size: 13.5px;
      color: var(--tm-text-muted);
      max-width: 620px;
      line-height: 1.45;
    }
    .cw__head-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    /* ===== Cards Base ===== */
    .cw__card {
      background: var(--tm-surface, #ffffff);
      border: 1px solid var(--tm-line, #eceff3);
      border-radius: 16px;
      box-shadow: 0 1px 3px rgba(15, 20, 25, 0.04);
      overflow: hidden;
    }

    /* ===== Operational Cities Section ===== */
    .cw__cities-card {
      display: flex;
      flex-direction: column;
      padding: 14px 16px;
      gap: 12px;
    }
    .cw__card-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      flex-wrap: wrap;
    }
    .cw__card-topbar-left {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    .cw__section-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13.5px;
      font-weight: 800;
      color: var(--tm-text);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .cw__section-icon {
      color: var(--tm-green-deep, #16a34a);
    }
    .cw__pill-count {
      font-size: 11px;
      font-weight: 800;
      padding: 1px 7px;
      border-radius: 999px;
      background: var(--tm-canvas-2, #eaeef4);
      color: var(--tm-text-muted);
    }
    .cw__filter-tabs {
      display: flex;
      align-items: center;
      gap: 4px;
      background: var(--tm-canvas, #f4f6fa);
      padding: 3px;
      border-radius: 9px;
      border: 1px solid var(--tm-line, #eceff3);
    }
    .cw__filter-tab {
      border: none;
      background: transparent;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 11.5px;
      font-weight: 700;
      color: var(--tm-text-muted);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .cw__filter-tab:hover {
      color: var(--tm-text);
    }
    .cw__filter-tab.is-active {
      background: #ffffff;
      color: var(--tm-green-deep, #16a34a);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    }

    .cw__search-wrap {
      position: relative;
      display: flex;
      align-items: center;
      min-width: 260px;
      max-width: 380px;
      flex: 1;
    }
    .cw__search-icon {
      position: absolute;
      left: 10px;
      color: var(--tm-text-soft, #94a0ad);
      pointer-events: none;
    }
    .cw__search-field {
      width: 100%;
      height: 34px;
      padding: 0 28px 0 30px;
      border-radius: 8px;
      border: 1.5px solid var(--tm-line, #eceff3);
      background: var(--tm-canvas, #f4f6fa);
      color: var(--tm-text);
      font-size: 12.5px;
      font-family: inherit;
      outline: none;
      transition: all 0.15s ease;
    }
    .cw__search-field:focus {
      border-color: var(--tm-green-deep, #16a34a);
      background: #ffffff;
      box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.12);
    }
    .cw__search-clear-btn {
      position: absolute;
      right: 8px;
      border: none;
      background: transparent;
      color: var(--tm-text-muted);
      font-size: 15px;
      line-height: 1;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 4px;
    }
    .cw__search-clear-btn:hover {
      background: var(--tm-line);
      color: var(--tm-text);
    }

    /* Scrollable grid area */
    .cw__cities-viewport {
      max-height: 240px;
      overflow-y: auto;
      padding: 2px 4px 4px 2px;
      border-radius: 10px;
    }
    .cw__city-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(185px, 1fr));
      gap: 7px;
    }

    /* Sleek Pill Card */
    .city-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      background: var(--tm-canvas, #f4f6fa);
      border: 1.5px solid var(--tm-line, #eceff3);
      border-radius: 10px;
      cursor: pointer;
      transition: all 0.14s ease-in-out;
      user-select: none;
    }
    .city-item:hover {
      border-color: #cbd5e1;
      background: #ffffff;
      transform: translateY(-1px);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
    }
    .city-item.is-selected {
      border-color: var(--tm-green-deep, #16a34a);
      background: #f0fdf4;
      box-shadow: 0 2px 8px rgba(22, 163, 74, 0.15);
    }

    .city-item__status {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: none;
    }
    .city-item__dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #94a3b8;
    }
    .city-item__dot.is-active {
      background: #22c55e;
    }
    .city-item__dot.is-inactive {
      background: #ef4444;
    }
    .city-item__dot.is-selected {
      box-shadow: 0 0 0 2.5px rgba(22, 163, 74, 0.25);
    }

    .city-item__info {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
      flex: 1;
    }
    .city-item__name-row {
      display: flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
    }
    .city-item__name {
      font-size: 12.5px;
      font-weight: 750;
      color: var(--tm-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .city-item.is-selected .city-item__name {
      color: #14532d;
      font-weight: 800;
    }
    .city-item__country {
      font-size: 9px;
      font-weight: 800;
      color: var(--tm-text-muted);
      background: var(--tm-canvas-2, #eaeef4);
      padding: 1px 4px;
      border-radius: 4px;
      flex: none;
    }
    .city-item__meta {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .city-item__status-badge {
      font-size: 9px;
      font-weight: 800;
      text-transform: uppercase;
      color: #b91c1c;
      background: #fee2e2;
      padding: 1px 5px;
      border-radius: 4px;
    }
    .city-item__active-badge {
      font-size: 9px;
      font-weight: 800;
      text-transform: uppercase;
      color: #15803d;
      background: #dcfce7;
      padding: 1px 5px;
      border-radius: 4px;
    }

    .city-item__actions {
      display: flex;
      align-items: center;
      gap: 2px;
      opacity: 0.5;
      transition: opacity 0.15s ease;
      flex: none;
    }
    .city-item:hover .city-item__actions {
      opacity: 1;
    }
    .city-action-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 5px;
      border: 1px solid transparent;
      background: #ffffff;
      color: var(--tm-text-muted);
      cursor: pointer;
      transition: all 0.12s;
    }
    .city-action-btn:hover {
      background: var(--tm-text);
      color: #ffffff;
    }
    .city-action-btn--danger:hover {
      background: #ef4444;
      color: #ffffff;
    }

    /* Empty search view */
    .cw__empty-search {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 24px;
      text-align: center;
      background: var(--tm-canvas, #f4f6fa);
      border: 1px dashed var(--tm-line-2, #e2e6ec);
      border-radius: 12px;
    }
    .cw__empty-icon-wrap {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: #ffffff;
      color: var(--tm-text-soft, #94a0ad);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 5px rgba(0,0,0,0.05);
    }
    .cw__empty-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .cw__empty-title {
      font-size: 13.5px;
      font-weight: 750;
      color: var(--tm-text);
    }
    .cw__empty-desc {
      font-size: 12px;
      color: var(--tm-text-muted);
    }
    .cw__empty-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
    }

    /* ===== Service Area & Map Section ===== */
    .cw__map-section {
      display: flex;
      flex-direction: column;
    }
    .cw__map-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--tm-line, #eceff3);
      flex-wrap: wrap;
    }
    .cw__map-info-col {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .cw__map-title-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .cw__map-city-name {
      margin: 0;
      font-size: 17px;
      font-weight: 850;
      color: var(--tm-text);
    }
    .cw__map-country-tag {
      font-size: 10px;
      font-weight: 800;
      background: var(--tm-canvas-2, #eaeef4);
      color: var(--tm-text-muted);
      padding: 2px 6px;
      border-radius: 5px;
    }
    .cw__fence-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 750;
    }
    .cw__fence-pill.has-fence {
      background: #dcfce7;
      color: #15803d;
    }
    .cw__fence-pill.no-fence {
      background: #fef3c7;
      color: #92400e;
    }
    .cw__map-coords-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--tm-text-muted);
    }
    .cw__recenter-link {
      background: none;
      border: none;
      color: var(--tm-green-deep, #16a34a);
      font-size: 11.5px;
      font-weight: 750;
      cursor: pointer;
      text-decoration: underline;
      padding: 0;
    }

    .cw__map-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .cw__draft-counter {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border-radius: 7px;
      background: #eff6ff;
      color: #1e40af;
      font-size: 12px;
      font-weight: 700;
    }

    /* Drawing instruction floating banner */
    .cw__drawing-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 9px 18px;
      background: #eff6ff;
      border-bottom: 1px solid #dbeafe;
      font-size: 12.5px;
      color: #1e40af;
      flex-wrap: wrap;
    }
    .cw__drawing-banner-content {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .cw__drawing-banner-icon {
      color: #2563eb;
    }
    .cw__drawing-status {
      font-size: 11.5px;
      font-weight: 800;
      padding: 2px 8px;
      border-radius: 6px;
      background: #dbeafe;
      color: #1d4ed8;
    }
    .cw__drawing-status.is-ready {
      background: #dcfce7;
      color: #15803d;
    }

    /* Map viewport */
    .cw__map-viewport {
      width: 100%;
      height: 420px;
      background: var(--tm-canvas-2, #eaeef4);
    }

    /* Empty state pick hint */
    .cw__pick-banner {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 28px;
      background: var(--tm-surface, #ffffff);
      border: 1px dashed var(--tm-line-2, #e2e6ec);
      border-radius: 16px;
      text-align: left;
    }
    .cw__pick-banner-icon {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      background: var(--tm-green-soft, #dcfce7);
      color: var(--tm-green-deep, #16a34a);
      display: flex;
      align-items: center;
      justify-content: center;
      flex: none;
    }
    .cw__pick-banner-text h3 {
      margin: 0 0 4px;
      font-size: 15px;
      font-weight: 800;
      color: var(--tm-text);
    }
    .cw__pick-banner-text p {
      margin: 0;
      font-size: 13px;
      color: var(--tm-text-muted);
    }

    /* ===== Drawer Form ===== */
    .cw-form {
      display: flex;
      flex-direction: column;
      gap: 18px;
      padding: 4px 0;
    }
    .cw-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .cw-field__lbl {
      font-size: 12.5px;
      font-weight: 750;
      color: var(--tm-text);
    }
    .cw-field__req {
      color: #ef4444;
    }
    .cw-field__input-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }
    .cw-field__icon {
      position: absolute;
      left: 11px;
      color: var(--tm-text-soft, #94a0ad);
      pointer-events: none;
    }
    .cw-field__input {
      width: 100%;
      height: 40px;
      padding: 0 12px;
      border: 1.5px solid var(--tm-line, #eceff3);
      border-radius: 9px;
      background: var(--tm-canvas, #f4f6fa);
      color: var(--tm-text);
      font-size: 13px;
      outline: none;
      transition: all 0.15s ease;
    }
    .cw-field__input--has-icon {
      padding-left: 32px;
    }
    .cw-field__input:focus {
      border-color: var(--tm-green-deep, #16a34a);
      background: #ffffff;
      box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.12);
    }
    .cw-field__input--short {
      max-width: 110px;
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    .cw-field__err {
      font-size: 11.5px;
      font-weight: 650;
      color: #ef4444;
    }
    .cw-field__geo-status {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      color: #15803d;
      background: #dcfce7;
      padding: 4px 8px;
      border-radius: 6px;
      width: fit-content;
    }
    .cw-field__hint {
      font-size: 11.5px;
      color: var(--tm-text-muted);
      line-height: 1.35;
    }

    .cw-drawer-map-wrap {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .cw-drawer-map {
      width: 100%;
      height: 190px;
      border-radius: 10px;
      border: 1.5px solid var(--tm-line, #eceff3);
      background: var(--tm-canvas-2, #eaeef4);
    }
    .cw-drawer-map__caption {
      font-size: 11px;
      font-weight: 650;
      color: var(--tm-text-muted);
      text-align: right;
    }

    .cw-toggle-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 12px 14px;
      background: var(--tm-canvas, #f4f6fa);
      border: 1.5px solid var(--tm-line, #eceff3);
      border-radius: 10px;
    }
    .cw-toggle-card__left {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .cw-toggle-card__title {
      font-size: 13px;
      font-weight: 750;
      color: var(--tm-text);
    }
    .cw-toggle-card__desc {
      font-size: 11.5px;
      color: var(--tm-text-muted);
      line-height: 1.35;
    }

    /* Switch */
    .cw-switch {
      position: relative;
      display: inline-block;
      width: 44px;
      height: 24px;
      flex: none;
    }
    .cw-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .cw-switch__slider {
      position: absolute;
      cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background-color: #cbd5e1;
      transition: 0.2s;
      border-radius: 24px;
    }
    .cw-switch__slider:before {
      position: absolute;
      content: "";
      height: 18px;
      width: 18px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: 0.2s;
      border-radius: 50%;
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    }
    .cw-switch input:checked + .cw-switch__slider {
      background-color: var(--tm-green-deep, #16a34a);
    }
    .cw-switch input:checked + .cw-switch__slider:before {
      transform: translateX(20px);
    }

    .cw-drawer-footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
    }

    /* Delete dialog */
    .cw-delete-modal-body {
      padding: 4px 0;
    }
    .cw-delete-warning-box {
      display: flex;
      gap: 12px;
      padding: 12px;
      border-radius: 10px;
      background: #fef2f2;
      border: 1px solid #fee2e2;
    }
    .cw-delete-warning-icon {
      color: #ef4444;
      flex: none;
      margin-top: 2px;
    }
    .cw-delete-warning-text p {
      margin: 0 0 6px;
      font-size: 13.5px;
      color: var(--tm-text);
      line-height: 1.4;
    }
    .cw-delete-sub {
      font-size: 12px !important;
      color: #7f1d1d !important;
      margin: 0 !important;
    }

    @media (max-width: 768px) {
      .cw__head {
        flex-direction: column;
      }
      .cw__card-topbar {
        flex-direction: column;
        align-items: stretch;
      }
      .cw__search-wrap {
        max-width: 100%;
      }
    }
  `],
})
export class CityWorkspaceComponent implements OnInit, OnDestroy {
  @ViewChild('cityMap') cityMapRef?: ElementRef<HTMLDivElement>;
  @ViewChild('drawerMap') drawerMapRef?: ElementRef<HTMLDivElement>;
  @ViewChild('cityNameInput') cityNameRef?: ElementRef<HTMLInputElement>;

  cities: CityOption[] = [];
  currentId: number | null = null;
  searchQuery = '';
  statusFilter: 'all' | 'active' | 'inactive' = 'all';

  get filteredCities(): CityOption[] {
    const q = this.searchQuery.trim().toLowerCase();
    return this.cities.filter((c) => {
      if (this.statusFilter === 'active' && c.is_active === false) return false;
      if (this.statusFilter === 'inactive' && c.is_active !== false) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  get activeCitiesCount(): number {
    return this.cities.filter((c) => c.is_active !== false).length;
  }

  get inactiveCitiesCount(): number {
    return this.cities.filter((c) => c.is_active === false).length;
  }

  get currentCity(): CityOption | undefined {
    return this.cities.find((c) => c.id === this.currentId);
  }

  // Drawer / form state
  formOpen = false;
  editing: CityOption | null = null;
  saving = false;
  form: CityForm = this.blankForm();
  touched = { name: false, cc: false };

  // Delete state
  deleteTarget: CityOption | null = null;

  // Geofencing (boundary editing on the city map)
  editingFence = false;
  draftPolygon: LatLng[] = [];
  savingFence = false;

  // Map state
  private mapsReady = false;
  private cityMap: google.maps.Map | null = null;
  private cityMarker: google.maps.Marker | null = null;
  private cityPolygon: google.maps.Polygon | null = null;
  private vertexMarkers: google.maps.Marker[] = [];
  private fenceClickListener: google.maps.MapsEventListener | null = null;
  private drawerMapInst: google.maps.Map | null = null;
  private drawerMarker: google.maps.Marker | null = null;
  private placeAuto: google.maps.places.Autocomplete | null = null;
  private placeAutoListener: google.maps.MapsEventListener | null = null;
  mapCity: any = {};

  private subs: Subscription[] = [];

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private cityCtx: CityContextService,
    private toast: ToastService,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
    private mapsLoader: GoogleMapsLoaderService,
  ) {}

  ngOnInit(): void {
    // Load Google Maps once for the city map + Places search; non-blocking.
    this.mapsLoader.load().then(() => (this.mapsReady = true)).catch(() => {});
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.subs.push(
      this.cityCtx.cities$.subscribe((list) => {
        this.cities = list;
        this.cdr.markForCheck();
      }),
      this.cityCtx.cityId$.subscribe((id) => {
        const changed = id !== this.currentId;
        this.currentId = id;
        if (changed) {
          // Switching cities discards any in-progress boundary edit.
          this.editingFence = false;
          this.savingFence = false;
          this.loadCity();
        }
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    this.detachAutocomplete();
    this.fenceClickListener?.remove();
    this.cityMarker?.setMap(null);
    this.cityPolygon?.setMap(null);
    this.vertexMarkers.forEach((m) => m.setMap(null));
  }

  /** Whether the selected city already has a saved boundary polygon. */
  get hasFence(): boolean {
    const poly = this.mapCity?.boundary_polygon;
    return Array.isArray(poly) && poly.length >= 3;
  }

  select(id: number): void {
    this.cityCtx.setCityId(id);
  }

  recenterMap(): void {
    if (this.hasFence && this.draftPolygon.length >= 3) {
      this.fitToPolygon(this.draftPolygon);
    } else {
      const lat = this.mapCity?.center_lat != null ? Number(this.mapCity.center_lat) : null;
      const lng = this.mapCity?.center_lng != null ? Number(this.mapCity.center_lng) : null;
      if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) && this.cityMap) {
        this.cityMap.setCenter({ lat, lng });
        this.cityMap.setZoom(12);
      }
    }
  }

  // ----- City record (drives the service-area map) -----
  private loadCity(): void {
    const id = this.currentId;
    if (id == null) return;
    this.api
      .get<any>(`/admin/cities/${id}`)
      .pipe(catchError(() => of(null)))
      .subscribe((res) => {
        this.renderCityOnMap(this.cityRecord(res));
        this.cdr.markForCheck();
      });
  }

  // ----- City map + geofencing -----
  private async renderCityOnMap(city: any): Promise<void> {
    this.mapCity = city || {};
    if (!this.mapsReady) {
      try { await this.mapsLoader.load(); this.mapsReady = true; } catch { return; }
    }
    // Wait a tick so the *ngIf-gated map container is in the DOM.
    setTimeout(() => {
      const el = this.cityMapRef?.nativeElement;
      if (!el || !window.google?.maps) return;
      this.ensureCityMap(el);

      // Outside edit mode the drawn polygon mirrors the saved boundary.
      if (!this.editingFence) this.draftPolygon = this.polygonOf(city);
      this.redrawFence();

      this.cityMarker?.setMap(null); this.cityMarker = null;
      const lat = city?.center_lat != null ? Number(city.center_lat) : null;
      const lng = city?.center_lng != null ? Number(city.center_lng) : null;
      const hasCenter = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
      if (hasCenter) {
        this.cityMarker = new google.maps.Marker({
          position: { lat: lat!, lng: lng! },
          map: this.cityMap,
          title: city?.name || 'City Center',
        });
      }

      // Camera: frame the polygon if there is one, else the centre.
      if (this.draftPolygon.length >= 3) {
        this.fitToPolygon(this.draftPolygon);
      } else if (hasCenter) {
        this.cityMap!.setCenter({ lat: lat!, lng: lng! });
        this.cityMap!.setZoom(12);
      } else {
        this.cityMap!.setCenter({ lat: 20.59, lng: 78.96 });
        this.cityMap!.setZoom(4);
      }
    }, 0);
  }

  /** Creates the city map once and wires the boundary-drawing click handler. */
  private ensureCityMap(el: HTMLElement): void {
    if (this.cityMap) return;
    this.cityMap = new google.maps.Map(el, {
      center: { lat: 20.59, lng: 78.96 }, zoom: 4,
      mapTypeControl: false, streetViewControl: false,
      fullscreenControl: false, clickableIcons: false,
    });
    this.fenceClickListener = this.cityMap.addListener('click', (ev: google.maps.MapMouseEvent) => {
      if (!this.editingFence || !ev.latLng) return;
      this.zone.run(() => {
        this.draftPolygon = [
          ...this.draftPolygon,
          { lat: ev.latLng!.lat(), lng: ev.latLng!.lng() },
        ];
        this.redrawFence();
      });
    });
  }

  /** Extracts a clean {lat,lng}[] from a city's boundary_polygon field. */
  private polygonOf(city: any): LatLng[] {
    const poly = Array.isArray(city?.boundary_polygon) ? city.boundary_polygon : [];
    return poly
      .map((p: any) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
      .filter((p: LatLng) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  }

  /** Redraws the boundary polygon, plus vertex dots while editing. */
  private redrawFence(): void {
    if (!this.cityMap) return;
    this.cityPolygon?.setMap(null); this.cityPolygon = null;
    this.vertexMarkers.forEach((m) => m.setMap(null)); this.vertexMarkers = [];

    const coords = this.draftPolygon;
    if (coords.length >= 3) {
      this.cityPolygon = new google.maps.Polygon({
        paths: coords,
        strokeColor: '#16a34a',
        strokeWeight: 2.5,
        fillColor: '#22c55e',
        fillOpacity: 0.18,
        clickable: false,
      });
      this.cityPolygon.setMap(this.cityMap);
    }
    if (this.editingFence) {
      coords.forEach((p) => {
        this.vertexMarkers.push(new google.maps.Marker({
          position: p,
          map: this.cityMap!,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 6,
            fillColor: '#ffffff',
            fillOpacity: 1,
            strokeColor: '#16a34a',
            strokeWeight: 2.5,
          },
        }));
      });
    }
  }

  private fitToPolygon(coords: LatLng[]): void {
    if (!this.cityMap || !coords.length) return;
    const b = new google.maps.LatLngBounds();
    coords.forEach((p) => b.extend(p));
    this.cityMap.fitBounds(b, 35);
  }

  // ----- Geofencing edit actions -----

  startFenceEdit(): void {
    if (this.currentId == null) return;
    this.editingFence = true;
    this.draftPolygon = this.polygonOf(this.mapCity);
    this.redrawFence();
  }

  cancelFenceEdit(): void {
    this.editingFence = false;
    this.draftPolygon = this.polygonOf(this.mapCity);
    this.redrawFence();
  }

  /** Clears the saved service-area boundary (sends a null polygon). */
  removeFence(): void {
    if (this.currentId == null || !this.hasFence || this.savingFence) return;
    this.savingFence = true;
    this.api
      .patch<any>(`/admin/cities/${this.currentId}/polygon`, { boundary_polygon: null })
      .subscribe({
        next: () => {
          this.savingFence = false;
          this.editingFence = false;
          this.draftPolygon = [];
          this.mapCity = { ...this.mapCity, boundary_polygon: null };
          this.redrawFence();
          this.toast.success('Service-area boundary removed');
          this.loadCity();
        },
        error: (err) => {
          this.savingFence = false;
          this.toast.error(err?.error?.message || 'Could not remove the boundary.');
        },
      });
  }

  undoFencePoint(): void {
    this.draftPolygon = this.draftPolygon.slice(0, -1);
    this.redrawFence();
  }

  clearFence(): void {
    this.draftPolygon = [];
    this.redrawFence();
  }

  saveFence(): void {
    if (this.currentId == null || this.draftPolygon.length < 3 || this.savingFence) return;
    this.savingFence = true;
    this.api
      .patch<any>(`/admin/cities/${this.currentId}/polygon`, { boundary_polygon: this.draftPolygon })
      .subscribe({
        next: () => {
          this.savingFence = false;
          this.editingFence = false;
          this.mapCity = { ...this.mapCity, boundary_polygon: [...this.draftPolygon] };
          this.toast.success('Service-area boundary saved');
          this.loadCity(); // refresh map framing
        },
        error: (err) => {
          this.savingFence = false;
          this.toast.error(err?.error?.message || 'Could not save the boundary.');
        },
      });
  }

  // ----- Drawer map + Places search -----
  private setupDrawer(): void {
    const go = () => {
      this.attachAutocomplete();
      const el = this.drawerMapRef?.nativeElement;
      if (el && window.google?.maps) {
        this.drawerMapInst = new google.maps.Map(el, {
          center: { lat: 20.59, lng: 78.96 }, zoom: 4,
          mapTypeControl: false, streetViewControl: false,
          fullscreenControl: false, clickableIcons: false,
        });
        this.updateDrawerMarker();
      }
    };
    if (this.mapsReady) { setTimeout(go, 320); return; }
    this.mapsLoader.load()
      .then(() => { this.mapsReady = true; setTimeout(go, 320); })
      .catch(() => {});
  }

  private updateDrawerMarker(): void {
    if (!this.drawerMapInst) return;
    this.drawerMarker?.setMap(null);
    this.drawerMarker = null;
    const lat = this.form.center_lat ? Number(this.form.center_lat) : null;
    const lng = this.form.center_lng ? Number(this.form.center_lng) : null;
    if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
      this.drawerMapInst.setCenter({ lat, lng });
      this.drawerMapInst.setZoom(11);
      this.drawerMarker = new google.maps.Marker({ position: { lat, lng }, map: this.drawerMapInst });
    }
  }

  private attachAutocomplete(): void {
    const el = this.cityNameRef?.nativeElement;
    if (!el || !window.google?.maps?.places) return;
    this.detachAutocomplete();
    this.placeAuto = new google.maps.places.Autocomplete(el, {
      types: ['(cities)'],
      fields: ['name', 'geometry', 'address_components'],
    });
    this.placeAutoListener = this.placeAuto.addListener('place_changed', () => {
      const place = this.placeAuto?.getPlace();
      if (!place?.geometry?.location) return;
      this.zone.run(() => {
        this.form.name = place.name || this.form.name;
        this.form.center_lat = String(place.geometry!.location!.lat());
        this.form.center_lng = String(place.geometry!.location!.lng());
        const cc = place.address_components?.find((c) => c.types.includes('country'))?.short_name;
        if (cc) this.form.country_code = cc;
        this.touched.name = true;
        this.updateDrawerMarker();
        this.cdr.markForCheck();
      });
    });
  }

  private detachAutocomplete(): void {
    this.placeAutoListener?.remove();
    this.placeAutoListener = null;
    this.placeAuto = null;
    document.querySelectorAll('.pac-container').forEach((el) => el.remove());
  }

  onNameTyped(): void {
    this.touched.name = true;
    // Manual edits invalidate the previously-pinned coordinates.
    if (!this.form.name.trim()) {
      this.form.center_lat = '';
      this.form.center_lng = '';
      this.updateDrawerMarker();
    }
  }

  /**
   * Unwraps a single-city API payload to the bare record.
   */
  private cityRecord(res: any): any {
    return res?.city ?? res?.data ?? res ?? {};
  }

  // ----- City CRUD -----
  private blankForm(): CityForm {
    return { name: '', country_code: 'IN', center_lat: '', center_lng: '', is_active: true };
  }

  openCreate(): void {
    this.editing = null;
    this.form = this.blankForm();
    this.touched = { name: false, cc: false };
    this.formOpen = true;
    this.setupDrawer();
  }

  openCreateWithQuery(q: string): void {
    this.editing = null;
    this.form = { ...this.blankForm(), name: q };
    this.touched = { name: true, cc: false };
    this.formOpen = true;
    this.setupDrawer();
  }

  onDrawerClosed(): void {
    this.formOpen = false;
    this.detachAutocomplete();
    this.drawerMapInst = null;
    this.drawerMarker = null;
  }

  openEdit(c: CityOption, e: Event): void {
    e.stopPropagation();
    this.editing = c;
    this.touched = { name: false, cc: false };
    // Fetch full record so lat/lng/country are populated.
    this.api.get<any>(`/admin/cities/${c.id}`).subscribe({
      next: (res) => {
        const city = this.cityRecord(res);
        this.form = {
          name: city.name ?? c.name,
          country_code: city.country_code ?? 'IN',
          center_lat: city.center_lat != null ? String(city.center_lat) : '',
          center_lng: city.center_lng != null ? String(city.center_lng) : '',
          is_active: city.is_active !== false,
        };
        this.cdr.markForCheck();
        this.updateDrawerMarker();
      },
      error: () => {
        this.form = { ...this.blankForm(), name: c.name, is_active: c.is_active !== false };
      },
    });
    this.formOpen = true;
    this.setupDrawer();
  }

  get formValid(): boolean {
    return (
      !!this.form.name.trim() &&
      this.form.country_code.trim().length === 2
    );
  }

  save(): void {
    this.touched = { name: true, cc: true };
    if (!this.formValid || this.saving) return;
    this.saving = true;

    const body: Record<string, unknown> = {
      name: this.form.name.trim(),
      country_code: this.form.country_code.trim().toUpperCase(),
      is_active: this.form.is_active,
    };
    if (this.form.center_lat.trim()) body['center_lat'] = Number(this.form.center_lat);
    if (this.form.center_lng.trim()) body['center_lng'] = Number(this.form.center_lng);

    const req = this.editing
      ? this.api.patch<any>(`/admin/cities/${this.editing.id}`, body)
      : this.api.post<any>('/admin/cities', body);

    req.subscribe({
      next: (res) => {
        this.saving = false;
        this.onDrawerClosed();
        const wasEditing = !!this.editing;
        this.toast.success(wasEditing ? 'City updated' : 'City created');
        const created = this.cityRecord(res);
        this.cityCtx.ensureCitiesLoaded(true).subscribe(() => {
          if (!wasEditing && created?.id) this.cityCtx.setCityId(created.id);
          else this.loadCity();
        });
      },
      error: (err) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Could not save the city.');
      },
    });
  }

  askDelete(c: CityOption, e: Event): void {
    e.stopPropagation();
    this.deleteTarget = c;
  }

  confirmDelete(): void {
    const c = this.deleteTarget;
    if (!c || this.saving) return;
    this.saving = true;
    this.api.delete(`/admin/cities/${c.id}`).subscribe({
      next: () => {
        this.saving = false;
        this.deleteTarget = null;
        this.toast.success(`${c.name} deleted`);
        this.cityCtx.ensureCitiesLoaded(true).subscribe();
      },
      error: (err) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Could not delete the city.');
      },
    });
  }
}
