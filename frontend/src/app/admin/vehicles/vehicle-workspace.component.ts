import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, forkJoin } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, DrawerComponent, IconComponent, StatusPillComponent } from '../../ui';
import { ReturnToSetupComponent } from '../setup/return-to-setup.component';
import { FixedRoutesComponent } from '../fixed/fixed-routes.component';
import { VehicleBasePricingComponent } from '../settings/vehicle-base-pricing.component';
import { OutstationPackagesComponent } from '../settings/outstation-packages.component';
import { SeatGridComponent } from '../vehicle-seat-layouts/seat-grid.component';
import { VehicleSeatLayout, VehicleSeatLayoutsService } from '../vehicle-seat-layouts/vehicle-seat-layouts.service';

/** How a ride type behaves, derived from its name. Only the behaviour is
 *  inferred — every label shown to the operator comes from the database. */
type ModeKind = 'private' | 'fixed' | 'shuttle';
type CityVehicleStatus = 'all' | 'enabled' | 'disabled';

interface VehicleTypeRow { id: number; name: string; is_active: boolean; }
interface RideTypeRef { id: number; name: string; }
interface VehicleTypeRef { id: number; name: string; }

interface CityVehicleRow {
  id: number;
  city_id: number;
  ride_type_id: number | null;
  vehicle_type_id: number | null;
  vehicle_type_name?: string | null;
  ride_type_name: string | null;
  display_name: string;
  display_order: number;
  max_people: number;
  luggage_capacity: number;
  reverse_bidding_enabled: boolean;
  is_active: boolean;
  is_outstation?: boolean;
  /** Ride type ids this vehicle already has a row for — filled in locally. */
  mode_ids?: number[];
}

interface RouteLite {
  id: number;
  name: string;
  scope: string;
  origin_name: string;
  dest_name: string;
  flat_fare: number | null;
  is_active: boolean;
  city_vehicle_type_id: number | null;
}

interface GroupRow {
  id: number;
  name: string;
  is_active: boolean;
  route_ids: number[];
  driver_user_ids: number[];
}

interface DriverOpt {
  id: number;
  user_id: number;
  name: string;
  phone: string | null;
  city_vehicle_type_id: number | null;
  vehicle_type_id: number | null;
  vehicle_reg_no: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
}

interface TabDef { key: string; label: string; count?: number; }

/**
 * Vehicle Workspace — every screen for one city vehicle on a single page.
 *
 *   [ city vehicle list ]   [ Common · <ride types…> · Drivers · Seat layouts ]
 *
 * Replaces the old Fleet Setup page and the separate fare-setup page: picking a
 * vehicle on the left swaps the tabbed editor on the right, so fares, fixed
 * routes, route groups, drivers and seat layouts are reachable without
 * navigating away.
 *
 * The fare tabs are built from the `ride_types` table — one tab per row, using
 * that row's own name. Nothing is hardcoded, so renaming or adding a ride type
 * changes the tabs with no frontend edit, and a tab can never ask for a ride
 * type that doesn't exist.
 *
 * Loading is deliberately staged: the vehicle list renders as soon as its own
 * request lands, and everything else (types, layouts, routes, groups, drivers)
 * streams in behind it rather than holding the page on one combined wait.
 */
@Component({
  selector: 'app-vehicle-workspace',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    DrawerComponent,
    IconComponent,
    StatusPillComponent,
    ReturnToSetupComponent,
    FixedRoutesComponent,
    VehicleBasePricingComponent,
    OutstationPackagesComponent,
    SeatGridComponent,
  ],
  template: `
    <div class="ws">
      <app-return-to-setup></app-return-to-setup>

      <header class="ws__head">
        <h1>Vehicles</h1>
        <span class="ws__city" *ngIf="cityName"><tm-icon name="map-marker" [size]="13" /> {{ cityName }}</span>
        <span class="ws__grow"></span>
        <tm-button variant="outline" size="sm" icon="cog" (clicked)="openTypes()">Vehicle types</tm-button>
        <tm-button variant="green" size="sm" icon="plus" [disabled]="cityId == null || !vehicleTypeOptions.length" (clicked)="openCreate()">Add vehicle</tm-button>
      </header>

      <div class="cue" *ngIf="cityId == null">
        <tm-icon name="map-marker" [size]="22" />
        <strong>No city selected</strong>
        <span>Pick a city from the top bar to manage its vehicles.</span>
      </div>

      <div class="split" *ngIf="cityId != null">
        <!-- ─────────────── list ─────────────── -->
        <aside class="panel list" [class.is-hidden-sm]="mobileEditor">
          <div class="list__top">
            <div class="list__bar">
              <span class="search">
                <tm-icon name="search" [size]="14" />
                <input type="text" [(ngModel)]="search" (ngModelChange)="applyView()" placeholder="Search city vehicles..." aria-label="Search city vehicles" />
              </span>
              <select class="mini" [(ngModel)]="typeFilter" (ngModelChange)="applyView()" aria-label="Vehicle type filter">
                <option value="all">All types</option>
                <option *ngFor="let t of types" [value]="t.id">{{ t.name }}</option>
              </select>
            </div>
            <div class="chips">
              <button type="button" class="chip" *ngFor="let s of statusChips" [attr.aria-pressed]="status === s.value" (click)="setStatus(s.value)">{{ s.label }}</button>
            </div>
          </div>

          <div class="rows">
            <button
              type="button"
              class="row"
              *ngFor="let v of visible; trackBy: trackVehicle"
              [attr.aria-current]="v.id === selectedId"
              (click)="select(v)"
            >
              <span class="row__main">
                <span class="row__name">{{ v.display_name }}</span>
                <span class="row__sub">{{ v.vehicle_type_name || 'Vehicle type not set' }} · {{ v.max_people }} seats · {{ v.luggage_capacity }} bags</span>
                <span class="row__sub">{{ fareModesLabel(v) }}{{ driverCountLabel(v) }}</span>
              </span>
              <tm-status-pill [tone]="v.is_active ? 'success' : 'neutral'">{{ v.is_active ? 'Enabled' : 'Disabled' }}</tm-status-pill>
            </button>

            <div class="empty" *ngIf="!visible.length && !loading">
              <strong>No city vehicles</strong>
              <span>Add a city vehicle after creating vehicle types.</span>
            </div>
            <div class="skeleton" *ngIf="loading">
              <span class="sk" *ngFor="let i of [1,2,3,4]"></span>
            </div>
          </div>

          <button type="button" class="newrow" [disabled]="!vehicleTypeOptions.length" (click)="openCreate()">
            + Add vehicle
          </button>
        </aside>

        <!-- ─────────────── editor ─────────────── -->
        <section class="panel editor" [class.is-hidden-sm]="!mobileEditor">
          <div class="cue cue--flat" *ngIf="!selected">
            <tm-icon name="car" [size]="22" />
            <strong>{{ loading ? 'Loading vehicles…' : 'Pick a city vehicle' }}</strong>
            <span *ngIf="!loading">Choose one on the left to set its fares, routes, drivers and seat layouts.</span>
          </div>

          <ng-container *ngIf="selected">
            <header class="ed__head">
              <button type="button" class="backlink" (click)="mobileEditor = false"><tm-icon name="chevron-left" [size]="14" /> List</button>
              <span class="ed__title">{{ selected.display_name }}</span>
              <span class="ed__type">{{ selected.vehicle_type_name || 'Vehicle type not set' }}</span>
              <tm-status-pill [tone]="selected.is_active ? 'success' : 'neutral'">{{ selected.is_active ? 'Enabled' : 'Disabled' }}</tm-status-pill>
              <span class="ws__grow"></span>
              <tm-button variant="outline" size="sm" icon="refresh" [disabled]="loading" (clicked)="refresh()">Refresh</tm-button>
            </header>

            <nav class="tabs" role="tablist">
              <button
                type="button"
                class="tab"
                role="tab"
                *ngFor="let t of tabList; trackBy: trackTab"
                [attr.aria-selected]="tab === t.key"
                (click)="setTab(t.key)"
              >
                {{ t.label }}<span class="tab__cnt" *ngIf="t.count != null">{{ t.count }}</span>
              </button>
            </nav>

            <!-- ── Common setup ── -->
            <div class="pane" *ngIf="tab === 'common'">
              <div class="sec">
                <div class="sec__head"><h3>Common city vehicle setup</h3><span class="hint">Shared by every fare mode of this vehicle.</span></div>
                <div class="fields">
                  <label class="f f--wide"><span>Vehicle name <i>*</i></span><input type="text" [(ngModel)]="common.display_name" /></label>
                  <label class="f"><span>Max people</span><input type="number" min="1" [(ngModel)]="common.max_people" /></label>
                  <label class="f"><span>Luggage capacity</span><input type="number" min="0" [(ngModel)]="common.luggage_capacity" /></label>
                </div>
                <label class="check"><input type="checkbox" [(ngModel)]="common.is_active" /> <span>Active</span></label>
                <p class="meta">
                  Depends on type: <b>{{ selected.vehicle_type_name || 'not set' }}</b> · Fare setup: <b>{{ fareModesLabel(selected) }}</b>.
                  Saving patches every mode row that shares this name and type.
                </p>
                <div class="sec__actions">
                  <tm-button variant="green" size="sm" icon="check" [disabled]="savingCommon || !common.display_name.trim()" (clicked)="saveCommon()">
                    {{ savingCommon ? 'Saving...' : 'Save' }}
                  </tm-button>
                </div>
              </div>
            </div>

            <!-- ── a ride type that is NOT the fixed one: fare card ── -->
            <div class="pane" *ngIf="activeRideType && !activeIsFixed">
              <ng-container *ngIf="activeRow; else noFare">
                <div class="sec" *ngIf="activeKind === 'private'">
                  <div class="sec__head"><h3>{{ activeRideType.name }} unique fields</h3><span class="hint">Reverse bidding belongs only to this mode.</span></div>
                  <div class="inline">
                    <label class="check"><input type="checkbox" [(ngModel)]="reverseBidding" /> <span>Reverse bidding</span></label>
                    <tm-button variant="outline" size="sm" icon="check" [disabled]="savingUnique" (clicked)="saveUniqueFields()">
                      {{ savingUnique ? 'Saving...' : 'Save unique fields' }}
                    </tm-button>
                  </div>
                </div>
                <div class="sec" *ngIf="activeKind === 'shuttle'">
                  <div class="sec__head"><h3>{{ activeRideType.name }} unique fields</h3></div>
                  <p class="meta">No extra live vehicle-level Shuttle fields yet. Shuttle fare is prepared below; booking remains planned.</p>
                </div>

                <div class="sec">
                  <app-vehicle-base-pricing
                    *ngIf="!activeRow.is_outstation"
                    [cityId]="cityId"
                    [cityVehicleTypeId]="activeRow.id"
                    [title]="activeRideType.name + ' Fare Settings'"
                    [subtitle]="fareSubtitle"
                  ></app-vehicle-base-pricing>
                  <app-outstation-packages *ngIf="activeRow.is_outstation" [cityId]="cityId" [vehicleTypeId]="activeRow.id"></app-outstation-packages>
                </div>
              </ng-container>

              <ng-template #noFare>
                <div class="cue cue--flat">
                  <tm-icon name="rupee" [size]="22" />
                  <strong>{{ activeRideType.name }} fare is not configured yet</strong>
                  <span>Create {{ activeRideType.name }} fare setup for {{ selected.display_name }}. It will copy the common vehicle fields and then open the fare card.</span>
                  <tm-button variant="green" icon="plus" [disabled]="creatingRideTypeId === activeRideType.id" (clicked)="createFareSetup(activeRideType)">
                    {{ creatingRideTypeId === activeRideType.id ? 'Creating...' : '+ Create ' + activeRideType.name + ' fare setup' }}
                  </tm-button>
                </div>
              </ng-template>
            </div>

            <!-- ── the fixed ride type: routes + route groups ── -->
            <div class="pane" *ngIf="activeRideType && activeIsFixed">
              <div class="sec">
                <div class="sec__head">
                  <h3>{{ activeRideType.name }} routes</h3>
                  <span class="hint">Prepaid routes with mapped stops and booking controls.</span>
                  <span class="ws__grow"></span>
                  <tm-button variant="green" size="sm" icon="plus" (clicked)="newRoute()">Add route</tm-button>
                </div>
                <app-fixed-routes [cityVehicleTypeId]="selected.id" [embedded]="true" (routesChanged)="loadRoutes()"></app-fixed-routes>
              </div>

              <div class="sec">
                <div class="sec__head">
                  <h3>Route groups</h3>
                  <span class="hint">Groups grant drivers permission to run these routes.</span>
                  <span class="ws__grow"></span>
                  <tm-button variant="outline" size="sm" icon="plus" (clicked)="openGroupDrawer()">New group</tm-button>
                </div>

                <div class="grp" *ngFor="let g of selGroups; trackBy: trackGroup">
                  <div class="grp__top" *ngIf="renamingId !== g.id">
                    <span class="grp__name">{{ g.name }}</span>
                    <span class="badge">{{ g.route_ids.length }} {{ g.route_ids.length === 1 ? 'route' : 'routes' }}</span>
                    <span class="badge badge--mute">{{ g.driver_user_ids.length }} {{ g.driver_user_ids.length === 1 ? 'driver' : 'drivers' }}</span>
                    <span class="ws__grow"></span>
                    <button type="button" class="mini-btn" (click)="startRename(g)">Rename</button>
                    <button type="button" class="mini-btn mini-btn--danger" (click)="deleteGroup(g)">Delete</button>
                  </div>
                  <div class="grp__top" *ngIf="renamingId === g.id">
                    <input class="rename" type="text" [(ngModel)]="renameValue" aria-label="Group name" />
                    <button type="button" class="mini-btn mini-btn--go" (click)="saveRename(g)">Save</button>
                    <button type="button" class="mini-btn" (click)="renamingId = null">Cancel</button>
                  </div>

                  <div class="grp__routes">
                    <div class="grp__route" *ngFor="let r of routesIn(g)">
                      <span class="grp__route-name">{{ r.name }}</span>
                      <span class="tag" [attr.data-s]="r.scope">{{ r.scope }}</span>
                      <button type="button" class="x" title="Remove from group" (click)="ungroupRoute(g, r.id)">×</button>
                    </div>
                    <div class="grp__empty" *ngIf="!g.route_ids.length">Add a route from the picker below.</div>
                  </div>

                  <div class="grp__drivers">
                    <span class="drv" *ngFor="let d of driversIn(g)">
                      <span class="av">{{ initials(d.name) }}</span>{{ d.name }}
                      <button type="button" class="x" (click)="removeDriverFromGroup(g, d.user_id)">✕</button>
                    </span>
                    <button type="button" class="mini-btn" (click)="driverPickFor = driverPickFor === g.id ? null : g.id">+ driver</button>
                    <button type="button" class="mini-btn" (click)="routePickFor = routePickFor === g.id ? null : g.id">+ route</button>
                  </div>

                  <div class="picker" *ngIf="driverPickFor === g.id">
                    <button type="button" class="pick" *ngFor="let d of driverOptions(g)" (click)="addDriverToGroup(g, d.user_id)">
                      <span class="av">{{ initials(d.name) }}</span>
                      <span class="pick__main"><b>{{ d.name }}</b><small>{{ d.phone || 'No phone' }}</small></span>
                      <span class="mini-btn">+ Add</span>
                    </button>
                    <p class="meta" *ngIf="!driverOptions(g).length">No more drivers.</p>
                  </div>

                  <div class="picker" *ngIf="routePickFor === g.id">
                    <button type="button" class="pick" *ngFor="let r of ungrouped" (click)="addRouteToGroup(g, r.id)">
                      <span class="pick__main"><b>{{ r.name }}</b><small>{{ r.origin_name }} → {{ r.dest_name }}</small></span>
                      <span class="mini-btn">Move here</span>
                    </button>
                    <p class="meta" *ngIf="!ungrouped.length">All routes are grouped 🎉</p>
                  </div>
                </div>

                <div class="cue cue--flat" *ngIf="!selGroups.length">
                  <strong>No group covers this vehicle's routes</strong>
                  <span>Create one so drivers can be given permission to run them.</span>
                </div>

                <p class="meta warn" *ngIf="ungrouped.length">
                  ⚠ {{ ungrouped.length }} {{ ungrouped.length === 1 ? 'route needs' : 'routes need' }} a group city-wide.
                </p>
              </div>
            </div>

            <!-- ── Drivers ── -->
            <div class="pane" *ngIf="tab === 'drivers'">
              <div class="sec">
                <div class="sec__head">
                  <h3>Drivers on this vehicle</h3>
                  <span class="hint">The driver picks this car when they sign up, and it locks once they're approved — so moving them is an operator-only action.</span>
                </div>

                <div class="cards">
                  <article class="card" *ngFor="let d of selDrivers">
                    <header class="card__head">
                      <span class="av av--lg">{{ initials(d.name) }}</span>
                      <span class="card__id">
                        <span class="card__name">{{ d.name }}</span>
                        <span class="card__meta">{{ d.phone || 'No phone' }} · {{ d.vehicle_model || 'Model not set' }} · {{ d.vehicle_color || 'Colour not set' }} · Reg no {{ d.vehicle_reg_no || '—' }}</span>
                      </span>
                      <button type="button" class="mini-btn" [disabled]="savingDriverId === d.id" (click)="movePickFor = movePickFor === d.id ? null : d.id">
                        {{ movePickFor === d.id ? 'Cancel' : 'Change vehicle' }}
                      </button>
                    </header>

                    <div class="picker" *ngIf="movePickFor === d.id">
                      <button type="button" class="pick" *ngFor="let v of moveTargetsFor(d)" [disabled]="savingDriverId === d.id" (click)="setCar(d, v.id)">
                        <span class="pick__main"><b>{{ v.display_name }}</b><small>{{ v.max_people }} seats · {{ v.luggage_capacity }} bags</small></span>
                        <span class="mini-btn">Move here</span>
                      </button>
                      <p class="meta" *ngIf="!moveTargetsFor(d).length">
                        No other {{ selected.vehicle_type_name || 'matching' }} vehicle in this city. A driver's car must stay within their own vehicle type.
                      </p>
                    </div>

                    <div class="card__panel">
                      <div class="card__panel-head">
                        <h4>Fixed route access</h4>
                        <span class="drv drv--plain" *ngFor="let g of groupsForDriver(d.user_id)">{{ g.name }}</span>
                        <span class="meta" *ngIf="!groupsForDriver(d.user_id).length">No routes — assign a group to give this driver work.</span>
                      </div>
                      <ul class="routelist" *ngIf="effectiveRoutes(d.user_id).length">
                        <li *ngFor="let r of effectiveRoutes(d.user_id)">{{ r.origin_name }} → {{ r.dest_name }}</li>
                      </ul>
                    </div>
                  </article>
                </div>

                <div class="cue cue--flat" *ngIf="!selDrivers.length">
                  <strong>No driver has this as their car</strong>
                  <span>Move one in below — the link is stored on the driver record.</span>
                </div>
              </div>

              <div class="sec">
                <div class="sec__head">
                  <h3>Move a driver onto this vehicle</h3>
                  <span class="hint">Only {{ selected.vehicle_type_name || 'matching' }} drivers are listed — a car must match the driver's own vehicle type.</span>
                </div>
                <div class="picker">
                  <button type="button" class="pick" *ngFor="let d of otherDrivers" [disabled]="savingDriverId === d.id" (click)="setCar(d, selected.id)">
                    <span class="av">{{ initials(d.name) }}</span>
                    <span class="pick__main"><b>{{ d.name }}</b><small>{{ d.vehicle_reg_no || 'No reg no' }} · {{ carLabel(d) }}</small></span>
                    <span class="mini-btn">Move here</span>
                  </button>
                  <p class="meta" *ngIf="!otherDrivers.length">No other {{ selected.vehicle_type_name || 'matching' }} driver in this city to move.</p>
                </div>
              </div>
            </div>

            <!-- ── Seat layouts ── -->
            <div class="pane" *ngIf="tab === 'layouts'">
              <div class="sec">
                <div class="sec__head">
                  <h3>Seat layouts</h3>
                  <span class="hint">Shared by every {{ selected.vehicle_type_name || 'vehicle' }} vehicle in this city.</span>
                  <span class="ws__grow"></span>
                  <tm-button variant="green" size="sm" icon="plus" [disabled]="selected.vehicle_type_id == null" (clicked)="openDesigner()">Design layout</tm-button>
                </div>

                <div class="layout" *ngFor="let l of selLayouts">
                  <div class="layout__preview"><app-seat-grid [rows]="l.rows" [cols]="l.cols" [cells]="l.cells"></app-seat-grid></div>
                  <div class="layout__meta">
                    <span class="layout__name">{{ l.name }}</span>
                    <span class="layout__sub">{{ l.rows }}×{{ l.cols }} · {{ l.seat_count }} seats<ng-container *ngIf="l.in_use"> · in use</ng-container></span>
                  </div>
                  <div class="layout__actions">
                    <button type="button" class="mini-btn" (click)="editLayout(l)">Edit</button>
                    <button type="button" class="x" *ngIf="!l.in_use" title="Delete layout" (click)="deleteLayout(l)">×</button>
                  </div>
                </div>

                <div class="cue cue--flat" *ngIf="!selLayouts.length">
                  <strong>No {{ selected.vehicle_type_name || 'vehicle' }} layouts yet</strong>
                  <span>The seat-grid designer keeps its own page and returns here on save.</span>
                </div>
              </div>
            </div>
          </ng-container>
        </section>
      </div>
    </div>

    <!-- ─────────────── drawers ─────────────── -->
    <tm-drawer [open]="createOpen" title="Add vehicle" [width]="560" (closed)="createOpen = false">
      <div slot="body" class="form">
        <p class="note"><b>Vehicle type is required.</b> Create the type under “Vehicle types” first, then choose it here to create the city vehicle.</p>
        <label class="f"><span>Vehicle name <i>*</i></span>
          <select [(ngModel)]="create.vehicle_type_id">
            <option [ngValue]="null" disabled>Select vehicle name</option>
            <option *ngFor="let vt of vehicleTypeOptions" [ngValue]="vt.id">{{ vt.name }}</option>
          </select>
        </label>
        <label class="f"><span>Display name <i>*</i></span><input type="text" [(ngModel)]="create.display_name" placeholder="Display name shown in fare setup and apps" /></label>
        <div class="fields">
          <label class="f"><span>Max people</span><input type="number" min="1" [(ngModel)]="create.max_people" /></label>
          <label class="f"><span>Luggage capacity</span><input type="number" min="0" [(ngModel)]="create.luggage_capacity" /></label>
        </div>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="createOpen = false">Cancel</tm-button>
        <tm-button variant="green" [disabled]="creating || !createValid" (clicked)="submitCreate()">{{ creating ? 'Creating...' : 'Create vehicle' }}</tm-button>
      </div>
    </tm-drawer>

    <tm-drawer [open]="typesOpen" title="Vehicle types" subtitle="Global — shared across every city" [width]="480" (closed)="typesOpen = false">
      <div slot="body" class="form">
        <div class="typerow" *ngFor="let t of types">
          <span class="typerow__name">{{ t.name }}</span>
          <tm-status-pill [tone]="t.is_active ? 'success' : 'neutral'">{{ t.is_active ? 'Active' : 'Off' }}</tm-status-pill>
          <button type="button" class="mini-btn" (click)="startEditType(t)">Edit</button>
        </div>
        <p class="meta" *ngIf="!types.length">No vehicle types yet.</p>

        <div class="typeform">
          <label class="f"><span>{{ editingTypeId ? 'Edit vehicle type' : 'New vehicle type' }} <i>*</i></span>
            <input type="text" [(ngModel)]="typeForm.name" placeholder="Auto / Bike / Sedan / SUV" />
          </label>
          <label class="check" *ngIf="editingTypeId"><input type="checkbox" [(ngModel)]="typeForm.is_active" /> <span>Active</span></label>
          <div class="typeform__actions">
            <tm-button *ngIf="editingTypeId" variant="ghost" size="sm" (clicked)="resetTypeForm()">Cancel</tm-button>
            <tm-button variant="green" size="sm" [disabled]="!typeForm.name.trim() || typeSaving" (clicked)="saveType()">
              {{ typeSaving ? 'Saving...' : editingTypeId ? 'Save type' : '+ Add type' }}
            </tm-button>
          </div>
        </div>
      </div>
      <div slot="footer"><tm-button variant="ghost" (clicked)="typesOpen = false">Done</tm-button></div>
    </tm-drawer>

    <tm-drawer [open]="groupOpen" title="New route group" [width]="480" (closed)="groupOpen = false">
      <div slot="body" class="form">
        <label class="f"><span>Group name <i>*</i></span><input type="text" [(ngModel)]="groupName" placeholder="e.g. Sopore town" /></label>
        <p class="meta">Groups grant drivers permission to run the routes inside them. Add routes and drivers after creating it.</p>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="groupOpen = false">Cancel</tm-button>
        <tm-button variant="green" [disabled]="!groupName.trim() || groupSaving" (clicked)="createGroup()">{{ groupSaving ? 'Creating...' : 'Create group' }}</tm-button>
      </div>
    </tm-drawer>
  `,
  styles: [`
    .ws { display: flex; flex-direction: column; gap: 14px; }
    .ws__head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .ws__head h1 { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .ws__city { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border: 1px solid var(--tm-line); border-radius: 999px; background: var(--tm-surface); font-size: 12px; font-weight: 700; color: var(--tm-text-muted); }
    .ws__grow { flex: 1; }

    .cue { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 34px 20px; text-align: center; background: var(--tm-surface); border: 1px dashed var(--tm-line); border-radius: 12px; color: var(--tm-text-muted); font-size: 13px; }
    .cue strong { color: var(--tm-text); font-size: 14px; }
    .cue--flat { background: transparent; }

    .split { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 14px; align-items: start; }
    .panel { background: var(--tm-surface); border: 1px solid var(--tm-line); border-radius: 12px; overflow: hidden; }

    .list__top { display: flex; flex-direction: column; gap: 8px; padding: 11px; border-bottom: 1px solid var(--tm-line); }
    .list__bar { display: flex; gap: 8px; }
    .search { display: flex; align-items: center; gap: 7px; flex: 1; min-width: 0; padding: 0 10px; height: 34px; border: 1px solid var(--tm-line); border-radius: 9px; background: var(--tm-canvas); color: var(--tm-text-muted); }
    .search input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; color: var(--tm-text); font: inherit; font-size: 13px; }
    .mini { max-width: 118px; height: 34px; padding: 0 8px; border: 1px solid var(--tm-line); border-radius: 9px; background: var(--tm-canvas); color: var(--tm-text); font: inherit; font-size: 12.5px; outline: none; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; }
    .chip { padding: 3px 11px; border: 1px solid var(--tm-line); border-radius: 999px; background: var(--tm-surface); color: var(--tm-text-muted); font: inherit; font-size: 12px; cursor: pointer; }
    .chip[aria-pressed="true"] { border-color: transparent; background: var(--tm-green-tint, #ecfdf5); color: var(--tm-green, #16a34a); font-weight: 800; }

    .rows { display: flex; flex-direction: column; gap: 4px; padding: 7px; max-height: 560px; overflow-y: auto; }
    .row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; border: 1px solid transparent; border-radius: 10px; background: transparent; text-align: left; font: inherit; cursor: pointer; }
    .row:hover { background: var(--tm-canvas); }
    .row[aria-current="true"] { background: var(--tm-green-tint, #ecfdf5); border-color: var(--tm-green, #16a34a); }
    .row__main { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
    .row__name { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .row__sub { font-size: 11.5px; color: var(--tm-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .newrow { display: block; width: calc(100% - 14px); margin: 0 7px 8px; padding: 9px; border: 1px dashed var(--tm-line); border-radius: 10px; background: transparent; color: var(--tm-text-muted); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; }
    .newrow:hover:not(:disabled) { border-color: var(--tm-green, #16a34a); color: var(--tm-green, #16a34a); }
    .newrow:disabled { opacity: .5; cursor: default; }
    .empty { display: flex; flex-direction: column; gap: 4px; padding: 26px 14px; text-align: center; color: var(--tm-text-muted); font-size: 12.5px; }
    .empty strong { color: var(--tm-text); font-size: 13.5px; }

    /* Skeleton rows so the panel has shape while the list request is in flight. */
    .skeleton { display: flex; flex-direction: column; gap: 6px; padding: 4px; }
    .sk { height: 52px; border-radius: 10px; background: linear-gradient(90deg, var(--tm-canvas) 25%, var(--tm-canvas-2, #f3f4f6) 37%, var(--tm-canvas) 63%); background-size: 400% 100%; animation: skShine 1.2s ease-in-out infinite; }
    @keyframes skShine { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
    @media (prefers-reduced-motion: reduce) { .sk { animation: none; } }

    .ed__head { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; padding: 12px 14px; border-bottom: 1px solid var(--tm-line); }
    .ed__title { font-size: 16px; font-weight: 800; color: var(--tm-text); }
    .ed__type { font-size: 12px; color: var(--tm-text-muted); }
    .backlink { display: none; align-items: center; gap: 4px; padding: 4px 8px; border: 1px solid var(--tm-line); border-radius: 8px; background: var(--tm-surface); color: var(--tm-text-muted); font: inherit; font-size: 12px; cursor: pointer; }

    .tabs { display: flex; gap: 2px; padding: 0 10px; border-bottom: 1px solid var(--tm-line); overflow-x: auto; }
    .tab { padding: 10px 11px; border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px; background: transparent; color: var(--tm-text-muted); font: inherit; font-size: 13px; font-weight: 700; white-space: nowrap; cursor: pointer; }
    .tab:hover { color: var(--tm-text); }
    .tab[aria-selected="true"] { color: var(--tm-green, #16a34a); border-bottom-color: var(--tm-green, #16a34a); }
    .tab__cnt { margin-left: 5px; font-size: 11px; opacity: .75; }

    /* One spacing scale for the whole editor: 16 outside, 20 between sections,
       12 inside a section, 14 inside a card. Nothing is bespoke. */
    .pane { display: flex; flex-direction: column; gap: 20px; padding: 16px; }
    .sec { display: flex; flex-direction: column; gap: 12px; }

    /* Title and any actions share the first line; the hint always drops to its
       own full-width line, so a long one can never crowd the heading. */
    .sec__head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; row-gap: 4px; }
    .sec__head h3 { margin: 0; font-size: 14px; font-weight: 800; color: var(--tm-text); }
    .sec__head .hint { flex: 1 0 100%; order: 99; margin: 0; font-size: 12px; line-height: 1.45; color: var(--tm-text-muted); }
    .sec__actions { display: flex; justify-content: flex-start; }
    .inline { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }

    /* Driver cards — each one a discrete block with identical padding, two per row. */
    .cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; align-items: start; }
    .card { display: flex; flex-direction: column; gap: 12px; padding: 14px; border: 1px solid var(--tm-line); border-radius: 12px; background: var(--tm-surface); min-width: 0; }
    .card__head { display: flex; align-items: center; gap: 11px; }
    .card__id { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
    .card__name { font-size: 13.5px; font-weight: 800; color: var(--tm-text); }
    .card__meta { font-size: 11.5px; color: var(--tm-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .card__panel { display: flex; flex-direction: column; gap: 8px; padding: 11px 12px; border-radius: 10px; background: var(--tm-canvas); }
    /* Heading and the driver's group chips share one line. */
    .card__panel-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; row-gap: 6px; }
    .card__panel-head h4 { margin: 0; font-size: 12px; font-weight: 800; color: var(--tm-text); }
    .chips-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .routelist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .routelist li { padding-left: 13px; position: relative; min-width: 0; font-size: 12px; color: var(--tm-text-muted); }
    .routelist li::before { content: ''; position: absolute; left: 0; top: 7px; width: 5px; height: 5px; border-radius: 50%; background: var(--tm-green, #16a34a); }

    .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 11px; }
    .f { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .f--wide { grid-column: 1 / -1; }
    .f > span { font-size: 11.5px; font-weight: 800; color: var(--tm-text); }
    .f i { color: var(--tm-danger, #ef4444); font-style: normal; }
    .f input, .f select { width: 100%; height: 36px; padding: 0 11px; border: 1px solid var(--tm-line); border-radius: 9px; background: var(--tm-canvas); color: var(--tm-text); font: inherit; font-size: 13px; outline: none; }
    .f input:focus, .f select:focus { border-color: var(--tm-green, #16a34a); }
    .check { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: var(--tm-text); }
    .check input { width: 16px; height: 16px; accent-color: var(--tm-green, #16a34a); }
    .meta { margin: 0; font-size: 12px; color: var(--tm-text-muted); }
    .meta b { color: var(--tm-text); font-weight: 800; }
    .meta.warn { color: #9a6a11; }
    .muted { color: var(--tm-text-muted); font-size: 11.5px; }
    .note { margin: 0; padding: 10px 12px; border: 1px solid var(--tm-line); border-radius: 9px; background: var(--tm-canvas); color: var(--tm-text-muted); font-size: 12px; }
    .note b { color: var(--tm-text); }

    .grp { display: flex; flex-direction: column; gap: 12px; padding: 14px; border: 1px solid var(--tm-line); border-radius: 12px; }
    .grp__top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .grp__name { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .badge { padding: 1px 8px; border-radius: 999px; background: var(--tm-green-tint, #ecfdf5); color: var(--tm-green, #16a34a); font-size: 11px; font-weight: 800; }
    .badge--mute { background: var(--tm-canvas-2, #f3f4f6); color: var(--tm-text-muted); }
    .grp__routes { display: flex; flex-direction: column; gap: 5px; }
    .grp__route { display: flex; align-items: center; gap: 8px; padding: 6px 9px; border-radius: 8px; background: var(--tm-canvas); font-size: 12.5px; color: var(--tm-text); }
    .grp__route-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .grp__empty { padding: 6px 2px; font-size: 12px; color: var(--tm-text-muted); }
    .grp__drivers { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .drv { display: inline-flex; align-items: center; gap: 6px; padding: 2px 7px 2px 3px; border: 1px solid var(--tm-line); border-radius: 999px; font-size: 12px; color: var(--tm-text); }
    .drv--plain { padding: 3px 10px; }
    .av { display: inline-grid; place-items: center; width: 21px; height: 21px; flex: none; border-radius: 50%; background: var(--tm-green-tint, #ecfdf5); color: var(--tm-green, #16a34a); font-size: 10px; font-weight: 800; }
    .av--lg { width: 34px; height: 34px; font-size: 12px; }
    .tag { padding: 2px 8px; border-radius: 999px; background: var(--tm-canvas-2, #f3f4f6); color: var(--tm-text-muted); font-size: 10px; font-weight: 800; text-transform: capitalize; }
    .tag[data-s="outstation"] { background: #fff7ed; color: #c2410c; }

    .mini-btn { padding: 4px 9px; border: 1px solid var(--tm-line); border-radius: 8px; background: var(--tm-surface); color: var(--tm-text-muted); font: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; white-space: nowrap; }
    .mini-btn:hover:not(:disabled) { border-color: var(--tm-green, #16a34a); color: var(--tm-green, #16a34a); }
    .mini-btn:disabled { opacity: .5; cursor: default; }
    .mini-btn--danger:hover { border-color: #ef4444; color: #ef4444; }
    .mini-btn--go { border-color: var(--tm-green, #16a34a); color: var(--tm-green, #16a34a); }
    .x { padding: 0 6px; border: 0; border-radius: 6px; background: transparent; color: var(--tm-text-muted); font: inherit; font-size: 14px; line-height: 1.4; cursor: pointer; }
    .x:hover { background: #fef2f2; color: #dc2626; }
    .rename { height: 32px; max-width: 220px; padding: 0 9px; border: 1px solid var(--tm-line); border-radius: 8px; background: var(--tm-canvas); color: var(--tm-text); font: inherit; font-size: 13px; outline: none; }

    .picker { display: flex; flex-direction: column; gap: 3px; padding: 7px; border: 1px solid var(--tm-line); border-radius: 10px; max-height: 260px; overflow-y: auto; }
    .pick { display: flex; align-items: center; gap: 9px; width: 100%; padding: 6px 8px; border: 0; border-radius: 8px; background: transparent; text-align: left; font: inherit; cursor: pointer; }
    .pick:hover:not(:disabled) { background: var(--tm-canvas); }
    .pick:disabled { opacity: .5; cursor: default; }
    .pick__main { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
    .pick__main b { font-size: 12.5px; font-weight: 800; color: var(--tm-text); }
    .pick__main small { font-size: 11px; color: var(--tm-text-muted); }

    .layout { display: grid; grid-template-columns: 74px 1fr auto; gap: 12px; align-items: center; padding: 14px; border: 1px solid var(--tm-line); border-radius: 12px; }
    .layout__preview { width: 70px; height: 70px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .layout__preview :is(app-seat-grid) { transform: scale(0.4); transform-origin: top left; }
    .layout__meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .layout__name { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .layout__sub { font-size: 11px; color: var(--tm-text-muted); }
    .layout__actions { display: inline-flex; align-items: center; gap: 6px; }

    .form { display: flex; flex-direction: column; gap: 12px; }
    .typerow { display: flex; align-items: center; gap: 9px; padding: 8px 10px; border: 1px solid var(--tm-line); border-radius: 9px; }
    .typerow__name { flex: 1; min-width: 0; font-size: 13px; font-weight: 700; color: var(--tm-text); }
    .typeform { display: flex; flex-direction: column; gap: 9px; padding-top: 11px; border-top: 1px solid var(--tm-line); }
    .typeform__actions { display: flex; justify-content: flex-end; gap: 8px; }

    @media (max-width: 940px) {
      .split { grid-template-columns: 1fr; }
      .is-hidden-sm { display: none; }
      .backlink { display: inline-flex; }
    }
    @media (max-width: 860px) {
      .cards { grid-template-columns: 1fr; }
    }
  `],
})
export class VehicleWorkspaceComponent implements OnInit, OnDestroy {
  @ViewChild(FixedRoutesComponent) private fixedRoutes?: FixedRoutesComponent;

  cityId: number | null = null;
  cityName = '';
  /** True only while the vehicle list itself is in flight. Everything else
   *  streams in behind the rendered list without blocking it. */
  loading = false;

  /** Raw per-mode rows straight from the API. */
  rows: CityVehicleRow[] = [];
  /** One entry per physical vehicle (mode rows merged). */
  vehicles: CityVehicleRow[] = [];
  /** Filtered view of `vehicles` — a field, not a getter, so change detection
   *  doesn't re-filter the whole list on every tick. */
  visible: CityVehicleRow[] = [];

  types: VehicleTypeRow[] = [];
  vehicleTypeOptions: VehicleTypeRef[] = [];
  /** Source of truth for the fare tabs — one tab per row, using its own name. */
  rideTypes: RideTypeRef[] = [];
  layouts: VehicleSeatLayout[] = [];
  routes: RouteLite[] = [];
  groups: GroupRow[] = [];
  cityDrivers: DriverOpt[] = [];

  selectedId: number | null = null;
  selected: CityVehicleRow | null = null;
  /** 'common' | 'drivers' | 'layouts' | 'mode:<rideTypeId>' */
  tab = 'common';
  tabList: TabDef[] = [];
  private tabByVehicle = new Map<number, string>();
  mobileEditor = false;

  // Derived slices for the selected vehicle, recomputed on data/selection change.
  activeRideType: RideTypeRef | null = null;
  activeKind: ModeKind = 'private';
  activeIsFixed = false;
  activeRow: CityVehicleRow | null = null;
  fareSubtitle = '';
  selDrivers: DriverOpt[] = [];
  otherDrivers: DriverOpt[] = [];
  selLayouts: VehicleSeatLayout[] = [];
  selGroups: GroupRow[] = [];
  ungrouped: RouteLite[] = [];

  search = '';
  status: CityVehicleStatus = 'all';
  typeFilter = 'all';
  readonly statusChips: { label: string; value: CityVehicleStatus }[] = [
    { label: 'All statuses', value: 'all' },
    { label: 'Enabled', value: 'enabled' },
    { label: 'Disabled', value: 'disabled' },
  ];

  common = { display_name: '', max_people: 1, luggage_capacity: 0, is_active: true };
  savingCommon = false;
  reverseBidding = false;
  savingUnique = false;
  creatingRideTypeId: number | null = null;

  createOpen = false;
  creating = false;
  create = this.blankCreate();

  typesOpen = false;
  typeSaving = false;
  editingTypeId: number | null = null;
  typeForm = { name: '', is_active: true };

  groupOpen = false;
  groupSaving = false;
  groupName = '';
  renamingId: number | null = null;
  renameValue = '';
  driverPickFor: number | null = null;
  routePickFor: number | null = null;
  movePickFor: number | null = null;
  savingDriverId: number | null = null;

  private subs: Subscription[] = [];
  private deepLinkId: number | null = null;
  /** Guards against the city stream re-emitting the same id and refetching. */
  private loadedCityId: number | null = null;

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private toast: ToastService,
    private router: Router,
    private route: ActivatedRoute,
    private layoutsSvc: VehicleSeatLayoutsService,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.subs.push(
      this.route.paramMap.subscribe((p) => {
        const raw = p.get('vehicleRowId');
        this.deepLinkId = raw ? Number(raw) : null;
        if (this.deepLinkId != null && this.vehicles.length) { this.applyDeepLink(); this.applyView(); }
      }),
      this.cityCtx.cities$.subscribe((list) => {
        this.cityName = list.find((c) => c.id === this.cityId)?.name ?? '';
      }),
      this.cityCtx.cityId$.subscribe((id) => {
        this.cityId = id;
        if (id == null) { this.loadedCityId = null; this.resetData(); return; }
        if (id === this.loadedCityId) return;
        this.loadedCityId = id;
        this.selectedId = null;
        this.load();
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  // ── loading ────────────────────────────────────────────────
  /**
   * Staged load. The vehicle list is the only thing the page waits on; the
   * five supporting requests fire alongside it and patch their own slice in
   * when they land, so the list is usable while they're still arriving.
   */
  private load(): void {
    const cityId = this.cityId;
    if (cityId == null) return;

    this.loading = true;
    this.api.get<{
      data: CityVehicleRow[];
      available_ride_types?: RideTypeRef[];
      available_vehicle_types?: VehicleTypeRef[];
    }>(`/admin/cities/${cityId}/vehicle-types`).subscribe({
      next: (res) => {
        this.rows = res.data ?? [];
        this.rideTypes = res.available_ride_types ?? [];
        this.vehicleTypeOptions = res.available_vehicle_types ?? [];
        this.vehicles = this.groupRows(this.rows);
        this.loading = false;
        this.applyDeepLink();
        this.applyView();
      },
      error: () => { this.loading = false; this.toast.error('Failed to load vehicles'); },
    });

    this.api.get<{ data: VehicleTypeRow[] }>('/admin/vehicle-types-global').subscribe({
      next: (res) => { this.types = res.data ?? []; },
      error: () => { this.types = []; },
    });
    this.layoutsSvc.list(cityId).subscribe({
      next: (res) => { this.layouts = res.data ?? []; this.recompute(); },
      error: () => { this.layouts = []; },
    });
    this.loadRoutes();
    this.loadGroups();
    this.loadDrivers();
  }

  /** Full reload after a mutation. Same staging as the initial load. */
  refresh(): void { this.load(); }

  private resetData(): void {
    this.rows = []; this.vehicles = []; this.visible = [];
    this.routes = []; this.groups = []; this.cityDrivers = []; this.layouts = [];
    this.selectedId = null; this.recompute();
  }

  loadRoutes(): void {
    if (this.cityId == null) { this.routes = []; return; }
    this.api.get<{ data: RouteLite[] }>(`/admin/cities/${this.cityId}/fixed-routes`).subscribe({
      next: (res) => { this.routes = res?.data ?? []; this.recompute(); },
      error: () => { this.routes = []; },
    });
  }

  loadGroups(): void {
    if (this.cityId == null) { this.groups = []; return; }
    this.api.get<{ data: GroupRow[] }>(`/admin/cities/${this.cityId}/route-groups`).subscribe({
      next: (res) => {
        this.groups = (res?.data ?? []).map((g) => ({ ...g, route_ids: [...(g.route_ids ?? [])], driver_user_ids: [...(g.driver_user_ids ?? [])] }));
        this.recompute();
      },
      error: () => { this.groups = []; },
    });
  }

  loadDrivers(): void {
    if (this.cityId == null) { this.cityDrivers = []; return; }
    this.api.get<{ data: DriverOpt[] }>(`/admin/cities/${this.cityId}/route-group-drivers`).subscribe({
      next: (res) => { this.cityDrivers = res?.data ?? []; this.recompute(); },
      error: () => { this.cityDrivers = []; },
    });
  }

  private applyDeepLink(): void {
    if (this.deepLinkId == null) return;
    const raw = this.rows.find((r) => r.id === this.deepLinkId);
    if (!raw) return;
    const key = this.groupKey(raw);
    const match = this.vehicles.find((v) => this.groupKey(v) === key);
    if (match) this.selectedId = match.id;
    this.deepLinkId = null;
  }

  // ── filtering & derived state ──────────────────────────────
  applyView(): void {
    const q = this.search.trim().toLowerCase();
    this.visible = this.vehicles.filter((v) => {
      if (this.status === 'enabled' && !v.is_active) return false;
      if (this.status === 'disabled' && v.is_active) return false;
      if (this.typeFilter !== 'all' && v.vehicle_type_id !== Number(this.typeFilter)) return false;
      if (!q) return true;
      return `${v.display_name} ${v.vehicle_type_name ?? ''} ${this.fareModesLabel(v)}`.toLowerCase().includes(q);
    });

    if (this.selectedId == null || !this.vehicles.some((v) => v.id === this.selectedId)) {
      this.selectedId = (this.visible[0] ?? this.vehicles[0])?.id ?? null;
      this.loadSelectedForms();
    }
    this.recompute();
  }

  setStatus(value: CityVehicleStatus): void { this.status = value; this.applyView(); }

  /** Rebuilds every per-selection slice in one pass. */
  private recompute(): void {
    const v = this.vehicles.find((x) => x.id === this.selectedId) ?? null;
    this.selected = v;

    const covered = new Set<number>(this.groups.flatMap((g) => g.route_ids));
    this.ungrouped = this.routes.filter((r) => !covered.has(r.id));

    if (!v) {
      this.tabList = []; this.activeRideType = null; this.activeRow = null;
      this.selDrivers = []; this.otherDrivers = []; this.selLayouts = []; this.selGroups = [];
      return;
    }

    const myRoutes = this.routes.filter((r) => r.city_vehicle_type_id === v.id);
    const myRouteIds = new Set(myRoutes.map((r) => r.id));
    this.selGroups = this.groups.filter((g) => g.route_ids.some((id) => myRouteIds.has(id)));
    this.selDrivers = this.cityDrivers.filter((d) => d.city_vehicle_type_id === v.id);
    this.otherDrivers = this.cityDrivers.filter((d) =>
      d.city_vehicle_type_id !== v.id && (d.vehicle_type_id == null || d.vehicle_type_id === v.vehicle_type_id));
    this.selLayouts = v.vehicle_type_id == null ? [] : this.layouts.filter((l) => l.vehicle_type_id === v.vehicle_type_id);

    // Tabs: Common, then one per ride type using its DB name, then Drivers + layouts.
    this.tabList = [
      { key: 'common', label: 'Common setup' },
      ...this.rideTypes.map((rt) => ({
        key: 'mode:' + rt.id,
        label: rt.name,
        count: this.kindOf(rt.name) === 'fixed' ? myRoutes.length : undefined,
      })),
      { key: 'drivers', label: 'Drivers', count: this.selDrivers.length },
      { key: 'layouts', label: 'Seat layouts', count: this.selLayouts.length },
    ];

    // A tab remembered for this vehicle may no longer exist (ride type removed).
    if (!this.tabList.some((t) => t.key === this.tab)) this.tab = 'common';

    this.syncActiveMode();
  }

  /** Resolves the currently open ride-type tab into the row that backs it. */
  private syncActiveMode(): void {
    if (!this.tab.startsWith('mode:') || !this.selected) {
      this.activeRideType = null; this.activeRow = null; this.activeIsFixed = false;
      return;
    }
    const id = Number(this.tab.slice(5));
    this.activeRideType = this.rideTypes.find((rt) => rt.id === id) ?? null;
    if (!this.activeRideType) { this.activeRow = null; this.activeIsFixed = false; return; }

    this.activeKind = this.kindOf(this.activeRideType.name);
    this.activeIsFixed = this.activeKind === 'fixed';
    const key = this.groupKey(this.selected);
    this.activeRow = this.rows.find((r) => this.groupKey(r) === key && r.ride_type_id === id) ?? null;
    this.reverseBidding = !!this.activeRow?.reverse_bidding_enabled;
    this.fareSubtitle = this.activeKind === 'shuttle'
      ? 'Prepared Shuttle fare card. Customer and driver Shuttle booking is not active yet.'
      : 'Fare card used by the current customer and driver flow.';
  }

  select(v: CityVehicleRow): void {
    this.selectedId = v.id;
    this.mobileEditor = true;
    this.driverPickFor = null;
    this.routePickFor = null;
    this.movePickFor = null;
    this.renamingId = null;
    this.tab = this.tabByVehicle.get(v.id) ?? 'common';
    this.loadSelectedForms();
    this.recompute();
  }

  setTab(key: string): void {
    this.tab = key;
    if (this.selectedId != null) this.tabByVehicle.set(this.selectedId, key);
    this.syncActiveMode();
  }

  trackVehicle = (_: number, v: CityVehicleRow) => v.id;
  trackGroup = (_: number, g: GroupRow) => g.id;
  trackTab = (_: number, t: TabDef) => t.key;

  private loadSelectedForms(): void {
    const v = this.vehicles.find((x) => x.id === this.selectedId) ?? null;
    this.common = v
      ? { display_name: v.display_name, max_people: v.max_people, luggage_capacity: v.luggage_capacity, is_active: !!v.is_active }
      : { display_name: '', max_people: 1, luggage_capacity: 0, is_active: true };
  }

  // ── labels & lookups ───────────────────────────────────────
  /** Behaviour only. Every label the operator sees is the database's own name. */
  private kindOf(name: string | null): ModeKind {
    const lower = (name ?? '').toLowerCase();
    if (lower.includes('shuttle')) return 'shuttle';
    if (lower.includes('fixed')) return 'fixed';
    return 'private';
  }

  fareModesLabel(row: CityVehicleRow): string {
    const ids = row.mode_ids ?? [];
    const names = this.rideTypes.filter((rt) => ids.includes(rt.id)).map((rt) => rt.name);
    return names.length ? names.join(', ') : 'Not configured';
  }

  driverCountLabel(v: CityVehicleRow): string {
    const n = this.cityDrivers.filter((d) => d.city_vehicle_type_id === v.id).length;
    return n ? ` · ${n} ${n === 1 ? 'driver' : 'drivers'}` : '';
  }

  initials(name: string): string {
    return (name || '?').split(' ').filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  }

  moveTargetsFor(d: DriverOpt): CityVehicleRow[] {
    return this.vehicles.filter((v) =>
      v.id !== d.city_vehicle_type_id && (d.vehicle_type_id == null || v.vehicle_type_id === d.vehicle_type_id));
  }

  carLabel(d: DriverOpt): string {
    if (d.city_vehicle_type_id == null) return 'No car set';
    const v = this.vehicles.find((x) => x.id === d.city_vehicle_type_id)
      ?? this.rows.find((x) => x.id === d.city_vehicle_type_id);
    return v ? `Car: ${v.display_name}` : 'Car set elsewhere';
  }

  // ── common setup ───────────────────────────────────────────
  saveCommon(): void {
    const v = this.selected;
    if (!v || this.cityId == null || this.savingCommon) return;
    const payload = {
      display_name: this.common.display_name.trim(),
      max_people: this.common.max_people,
      luggage_capacity: this.common.luggage_capacity,
      is_active: this.common.is_active,
    };
    const key = this.groupKey(v);
    const siblings = this.rows.filter((r) => this.groupKey(r) === key);
    this.savingCommon = true;
    forkJoin(siblings.map((r) => this.api.patch(`/admin/cities/${this.cityId}/vehicle-types/${r.id}`, payload))).subscribe({
      next: () => { this.savingCommon = false; this.toast.success('City vehicle saved'); this.load(); },
      error: (err) => { this.savingCommon = false; this.toast.error(err?.error?.message || 'Failed to save city vehicle'); },
    });
  }

  saveUniqueFields(): void {
    if (!this.activeRow || this.cityId == null || this.savingUnique) return;
    this.savingUnique = true;
    this.api.patch(`/admin/cities/${this.cityId}/vehicle-types/${this.activeRow.id}`, {
      reverse_bidding_enabled: this.reverseBidding,
    }).subscribe({
      next: () => { this.savingUnique = false; this.toast.success('Unique fields saved'); this.load(); },
      error: (err) => { this.savingUnique = false; this.toast.error(err?.error?.message || 'Failed to save unique fields'); },
    });
  }

  /**
   * Creates the fare row for the open ride-type tab. The id comes straight from
   * the tab, so this can never fail on a missing ride type — the tab only
   * exists because the row does.
   */
  createFareSetup(rt: RideTypeRef): void {
    const v = this.selected;
    if (!v || this.cityId == null || this.creatingRideTypeId != null) return;
    this.creatingRideTypeId = rt.id;
    this.api.post<{ vehicle_type: CityVehicleRow; message?: string }>(`/admin/cities/${this.cityId}/vehicle-types`, {
      ride_type_id: rt.id,
      vehicle_type_id: v.vehicle_type_id,
      display_name: v.display_name,
      max_people: v.max_people,
      luggage_capacity: v.luggage_capacity,
      reverse_bidding_enabled: this.kindOf(rt.name) === 'private' ? !!v.reverse_bidding_enabled : false,
    }).subscribe({
      next: (res) => {
        this.creatingRideTypeId = null;
        this.toast.success(res.message || `${rt.name} fare setup created`);
        this.load();
      },
      error: (err) => {
        this.creatingRideTypeId = null;
        this.toast.error(err?.error?.message || `Failed to create ${rt.name} fare setup`);
      },
    });
  }

  // ── add vehicle ────────────────────────────────────────────
  openCreate(): void { this.create = this.blankCreate(); this.createOpen = true; }

  get createValid(): boolean {
    return this.create.vehicle_type_id != null && this.create.display_name.trim().length > 0;
  }

  submitCreate(): void {
    if (!this.createValid || this.creating || this.cityId == null) return;
    this.creating = true;
    this.api.post<{ vehicle_type: CityVehicleRow }>(`/admin/cities/${this.cityId}/vehicle-types`, {
      vehicle_type_id: this.create.vehicle_type_id,
      display_name: this.create.display_name.trim(),
      max_people: this.create.max_people,
      luggage_capacity: this.create.luggage_capacity,
      is_active: true,
    }).subscribe({
      next: (res) => {
        this.creating = false;
        this.createOpen = false;
        this.selectedId = res?.vehicle_type?.id ?? this.selectedId;
        this.toast.success('City vehicle created');
        this.load();
      },
      error: (err) => { this.creating = false; this.toast.error(err?.error?.message || 'Failed to create city vehicle'); },
    });
  }

  // ── global vehicle types ───────────────────────────────────
  openTypes(): void { this.resetTypeForm(); this.typesOpen = true; }
  startEditType(t: VehicleTypeRow): void { this.editingTypeId = t.id; this.typeForm = { name: t.name, is_active: t.is_active }; }
  resetTypeForm(): void { this.editingTypeId = null; this.typeForm = { name: '', is_active: true }; }

  saveType(): void {
    if (!this.typeForm.name.trim() || this.typeSaving) return;
    this.typeSaving = true;
    const payload: { name: string; is_active?: boolean } = { name: this.typeForm.name.trim() };
    if (this.editingTypeId) payload.is_active = this.typeForm.is_active;
    const req = this.editingTypeId
      ? this.api.patch(`/admin/vehicle-types-global/${this.editingTypeId}`, payload)
      : this.api.post('/admin/vehicle-types-global', payload);
    req.subscribe({
      next: () => {
        this.typeSaving = false;
        this.toast.success(this.editingTypeId ? 'Vehicle type updated' : 'Vehicle type created');
        this.resetTypeForm();
        this.load();
      },
      error: (err) => { this.typeSaving = false; this.toast.error(err?.error?.message || 'Failed to save vehicle type'); },
    });
  }

  // ── fixed routes ───────────────────────────────────────────
  newRoute(): void { this.fixedRoutes?.openCreate(); }

  // ── route groups ───────────────────────────────────────────
  routesIn(g: GroupRow): RouteLite[] { return this.routes.filter((r) => g.route_ids.includes(r.id)); }
  driversIn(g: GroupRow): DriverOpt[] { return this.cityDrivers.filter((d) => g.driver_user_ids.includes(d.user_id)); }
  driverOptions(g: GroupRow): DriverOpt[] { return this.cityDrivers.filter((d) => !g.driver_user_ids.includes(d.user_id)); }
  groupsForDriver(userId: number): GroupRow[] { return this.groups.filter((g) => g.driver_user_ids.includes(userId)); }

  effectiveRoutes(userId: number): RouteLite[] {
    const ids = new Set<number>(this.groupsForDriver(userId).flatMap((g) => g.route_ids));
    return this.routes.filter((r) => ids.has(r.id));
  }

  openGroupDrawer(): void { this.groupName = ''; this.groupOpen = true; }

  createGroup(): void {
    if (!this.groupName.trim() || this.cityId == null || this.groupSaving) return;
    this.groupSaving = true;
    this.api.post(`/admin/cities/${this.cityId}/route-groups`, { name: this.groupName.trim() }).subscribe({
      next: () => { this.groupSaving = false; this.groupOpen = false; this.toast.success('Route group created'); this.loadGroups(); },
      error: (err) => { this.groupSaving = false; this.toast.error(err?.error?.message || 'Could not create group'); },
    });
  }

  startRename(g: GroupRow): void { this.renamingId = g.id; this.renameValue = g.name; }

  saveRename(g: GroupRow): void {
    const name = this.renameValue.trim();
    if (!name || this.cityId == null) { this.toast.error('Group name is required'); return; }
    this.api.patch(`/admin/cities/${this.cityId}/route-groups/${g.id}`, { name, route_ids: g.route_ids }).subscribe({
      next: () => { this.renamingId = null; this.toast.success('Route group renamed'); this.loadGroups(); },
      error: (err) => this.toast.error(err?.error?.message || 'Could not rename group'),
    });
  }

  deleteGroup(g: GroupRow): void {
    if (this.cityId == null) return;
    if (!confirm(`Delete "${g.name}"? Its routes go back to needing a group.`)) return;
    this.api.delete(`/admin/cities/${this.cityId}/route-groups/${g.id}`).subscribe({
      next: () => { this.toast.success('Route group deleted'); this.loadGroups(); },
      error: (err) => this.toast.error(err?.error?.message || 'Could not delete group'),
    });
  }

  addRouteToGroup(g: GroupRow, routeId: number): void {
    this.saveGroupRoutes(g, [...g.route_ids, routeId], 'Route added to ' + g.name);
  }

  ungroupRoute(g: GroupRow, routeId: number): void {
    this.saveGroupRoutes(g, g.route_ids.filter((id) => id !== routeId), 'Route removed from ' + g.name);
  }

  private saveGroupRoutes(g: GroupRow, routeIds: number[], message: string): void {
    if (this.cityId == null) return;
    this.routePickFor = null;
    this.api.patch(`/admin/cities/${this.cityId}/route-groups/${g.id}`, { name: g.name, route_ids: routeIds }).subscribe({
      next: () => { this.toast.success(message); this.loadGroups(); },
      error: (err) => { this.toast.error(err?.error?.message || 'Could not save group'); this.loadGroups(); },
    });
  }

  addDriverToGroup(g: GroupRow, userId: number): void { this.saveGroupDrivers(g, [...g.driver_user_ids, userId]); }
  removeDriverFromGroup(g: GroupRow, userId: number): void { this.saveGroupDrivers(g, g.driver_user_ids.filter((id) => id !== userId)); }

  private saveGroupDrivers(g: GroupRow, driverIds: number[]): void {
    if (this.cityId == null) return;
    this.driverPickFor = null;
    this.api.put(`/admin/cities/${this.cityId}/route-groups/${g.id}/drivers`, { driver_user_ids: driverIds }).subscribe({
      next: () => this.loadGroups(),
      error: (err) => { this.toast.error(err?.error?.message || 'Could not update drivers'); this.loadGroups(); },
    });
  }

  // ── drivers ────────────────────────────────────────────────
  /**
   * Moves a driver's car. The link lives on the driver record, so this patches
   * the driver. There is deliberately no "clear" — the field is mandatory at
   * signup and locked for the driver after approval, so emptying it would
   * strand them in a state neither they nor the app can repair.
   */
  setCar(d: DriverOpt, cityVehicleTypeId: number): void {
    if (this.savingDriverId != null) return;
    const target = this.vehicles.find((v) => v.id === cityVehicleTypeId);
    this.savingDriverId = d.id;
    this.api.patch(`/admin/drivers/${d.id}`, { city_vehicle_type_id: cityVehicleTypeId }).subscribe({
      next: () => {
        this.savingDriverId = null;
        this.movePickFor = null;
        this.toast.success(`${d.name} moved to ${target?.display_name ?? 'the selected vehicle'}`);
        this.loadDrivers();
      },
      error: (err) => { this.savingDriverId = null; this.toast.error(err?.error?.message || 'Could not update driver'); },
    });
  }

  // ── seat layouts ───────────────────────────────────────────
  openDesigner(): void {
    const v = this.selected;
    if (!v || v.vehicle_type_id == null) return;
    this.router.navigate(['/vehicle-seat-layouts/new'], { queryParams: { vehicle_type_id: v.vehicle_type_id, from: 'fleet' } });
  }

  editLayout(l: VehicleSeatLayout): void {
    this.router.navigate([`/vehicle-seat-layouts/${l.id}`], { queryParams: { from: 'fleet' } });
  }

  deleteLayout(l: VehicleSeatLayout): void {
    if (this.cityId == null || l.in_use) return;
    if (!confirm(`Delete layout "${l.name}"? This cannot be undone.`)) return;
    this.layoutsSvc.destroy(this.cityId, l.id).subscribe({
      next: () => { this.toast.success('Layout deleted'); this.load(); },
      error: (err) => this.toast.error(err?.error?.message || 'Failed to delete layout'),
    });
  }

  // ── helpers ────────────────────────────────────────────────
  private blankCreate() {
    return { vehicle_type_id: null as number | null, display_name: '', max_people: 4, luggage_capacity: 0 };
  }

  private groupKey(row: CityVehicleRow): string {
    return `${row.vehicle_type_id ?? 'none'}:${row.display_name.trim().toLowerCase()}`;
  }

  /** Collapses the per-mode API rows into one row per physical vehicle. */
  private groupRows(rows: CityVehicleRow[]): CityVehicleRow[] {
    const buckets = new Map<string, CityVehicleRow[]>();
    rows.forEach((row) => {
      const key = this.groupKey(row);
      buckets.set(key, [...(buckets.get(key) ?? []), row]);
    });
    const order = this.rideTypes.map((rt) => rt.id);
    return Array.from(buckets.values()).map((bucket) => {
      const rep = bucket.find((r) => this.kindOf(r.ride_type_name) === 'private') ?? bucket[0];
      const mode_ids = order.filter((id) => bucket.some((row) => row.ride_type_id === id));
      return { ...rep, mode_ids };
    });
  }
}
