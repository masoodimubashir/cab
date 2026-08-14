import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, forkJoin } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, DrawerComponent, IconComponent, StatusPillComponent } from '../../ui';
import { ModalComponent } from '../../ui/modal/modal.component';
import { ReturnToSetupComponent } from '../setup/return-to-setup.component';
import { FixedRoutesComponent, ImportedRouteDraft } from '../fixed/fixed-routes.component';
import { VehicleBasePricingComponent } from '../settings/vehicle-base-pricing.component';
import { OutstationPackagesComponent } from '../settings/outstation-packages.component';
import { SeatGridComponent } from '../vehicle-seat-layouts/seat-grid.component';
import { SeatLayoutDesignerComponent } from '../vehicle-seat-layouts/seat-layout-designer.component';
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
  max_seats_per_booking: number | null;
  booking_window_hours: number | null;
  stops?: { id: number }[];
  is_active: boolean;
  city_vehicle_type_id: number | null;
}

interface GroupRow {
  id: number;
  name: string;
  is_active: boolean;
  /** The city vehicle this group belongs to. null = legacy/unbound group. */
  city_vehicle_type_id: number | null;
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
    ModalComponent,
    StatusPillComponent,
    ReturnToSetupComponent,
    FixedRoutesComponent,
    VehicleBasePricingComponent,
    OutstationPackagesComponent,
    SeatGridComponent,
    SeatLayoutDesignerComponent,
  ],
  template: `
    <div class="ws">
      <app-return-to-setup></app-return-to-setup>

      <header class="ws__head">
        <span class="ws__grow"></span>
        <tm-button variant="outline" size="sm" icon="cog" (clicked)="openTypes()">Vehicle types</tm-button>
        <tm-button variant="green" size="sm" icon="plus" [disabled]="cityId == null || !vehicleTypeOptions.length" (clicked)="openCreate()">Add vehicle</tm-button>
      </header>

      <div class="cue" *ngIf="cityId == null">
        <tm-icon name="map-marker" [size]="22" />
        <strong>No city selected</strong>
        <span>Pick a city from the top bar to manage its vehicles.</span>
      </div>

      <div class="grid" *ngIf="cityId != null">
        <!-- ─────────────── spreadsheet ─────────────── -->
        <!-- controls -->
        <div class="controls">
          <span class="search">
            <tm-icon name="search" [size]="14" />
            <input type="text" [(ngModel)]="search" (ngModelChange)="applyView()" placeholder="Search vehicles..." aria-label="Search vehicles" />
          </span>
          <div class="seg" role="tablist" aria-label="Status filter">
            <button type="button" class="seg__btn" *ngFor="let s of statusChips" [class.on]="status === s.value" [attr.aria-pressed]="status === s.value" (click)="setStatus(s.value)">{{ s.label }}</button>
          </div>
          <!-- Type filter — custom dropdown (matches the Drivers page state-select) -->
          <div class="fsel" [class.has-value]="typeFilter !== 'all'" [class.is-open]="filterOpen === 'type'">
            <button type="button" class="fsel__trigger" (click)="toggleFilter('type', $event)" [attr.aria-expanded]="filterOpen === 'type'" aria-haspopup="listbox" aria-label="Vehicle type filter">
              <span class="fsel__icon"><tm-icon name="filter" [size]="14" /></span>
              <span class="fsel__value">{{ typeFilterLabel }}</span>
              <tm-icon name="chevron-down" [size]="12" class="fsel__caret" />
            </button>
            <ul class="fsel__menu" *ngIf="filterOpen === 'type'" role="listbox" (click)="$event.stopPropagation()">
              <li class="fsel__option" [class.is-selected]="typeFilter === 'all'" role="option" [attr.aria-selected]="typeFilter === 'all'" (click)="setTypeFilter('all')">
                <tm-icon *ngIf="typeFilter === 'all'" name="check" [size]="12" class="fsel__check" /><span class="fsel__olabel">All types</span>
              </li>
              <li *ngFor="let t of types" class="fsel__option" [class.is-selected]="typeFilter === (t.id + '')" role="option" [attr.aria-selected]="typeFilter === (t.id + '')" (click)="setTypeFilter(t.id + '')">
                <tm-icon *ngIf="typeFilter === (t.id + '')" name="check" [size]="12" class="fsel__check" /><span class="fsel__olabel">{{ t.name }}</span>
              </li>
            </ul>
          </div>

          <!-- Vehicle filter — custom dropdown -->
          <div class="fsel" [class.has-value]="vehicleFilter !== 'all'" [class.is-open]="filterOpen === 'vehicle'">
            <button type="button" class="fsel__trigger" (click)="toggleFilter('vehicle', $event)" [attr.aria-expanded]="filterOpen === 'vehicle'" aria-haspopup="listbox" aria-label="Vehicle filter">
              <span class="fsel__icon"><tm-icon name="car" [size]="14" /></span>
              <span class="fsel__value">{{ vehicleFilterLabel }}</span>
              <tm-icon name="chevron-down" [size]="12" class="fsel__caret" />
            </button>
            <ul class="fsel__menu" *ngIf="filterOpen === 'vehicle'" role="listbox" (click)="$event.stopPropagation()">
              <li class="fsel__option" [class.is-selected]="vehicleFilter === 'all'" role="option" [attr.aria-selected]="vehicleFilter === 'all'" (click)="setVehicleFilter('all')">
                <tm-icon *ngIf="vehicleFilter === 'all'" name="check" [size]="12" class="fsel__check" /><span class="fsel__olabel">All vehicles</span>
              </li>
              <li *ngFor="let name of vehicleNames" class="fsel__option" [class.is-selected]="vehicleFilter === name" role="option" [attr.aria-selected]="vehicleFilter === name" (click)="setVehicleFilter(name)">
                <tm-icon *ngIf="vehicleFilter === name" name="check" [size]="12" class="fsel__check" /><span class="fsel__olabel">{{ name }}</span>
              </li>
            </ul>
          </div>
          <button type="button" class="clearall" *ngIf="hasActiveFilters" (click)="clearAllFilters()">
            <tm-icon name="x" [size]="13" /> Clear all
          </button>
          <span class="count-note"><b>{{ visible.length }}</b> of <b>{{ vehicles.length }}</b> vehicles · click a cell to edit</span>
        </div>

        <!-- bulk bar -->
        <div class="bulk" *ngIf="selectedIds.size">
          <b>{{ selectedIds.size }} selected</b>
          <span class="bulk__sep"></span>
          <button type="button" class="bbtn" (click)="bulkSetActive(true)">Enable</button>
          <button type="button" class="bbtn" (click)="bulkSetActive(false)">Disable</button>
          <button type="button" class="bbtn" (click)="bulkExport()">Export CSV</button>
          <button type="button" class="bulk__x" (click)="clearSel()" aria-label="Clear selection"><tm-icon name="x" [size]="16" /></button>
        </div>

        <!-- spreadsheet -->
        <div class="sheetwrap">
          <table class="sheet">
            <thead>
              <tr>
                <th class="col-gut"><span class="chk" [class.on]="allSelected" (click)="toggleSelectAll()"><tm-icon *ngIf="allSelected" name="check" [size]="11" /></span></th>
                <th class="col-veh">Vehicle</th>
                <th>Type</th>
                <th class="center">Seats</th>
                <th class="center">Bags</th>
                <th class="center" *ngFor="let rt of fareRideTypes">{{ rt.name }}</th>
                <th>Fixed groups</th>
                <th>Seat layout</th>
                <th>Drivers</th>
                <th class="center">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <ng-container *ngFor="let v of visible; let i = index; trackBy: trackVehicle">
                <tr class="srow" [class.sel]="isSel(v)" [class.off]="!v.is_active" [attr.aria-current]="v.id === selectedId">
                  <td class="col-gut">
                    <span class="chk" [class.on]="isSel(v)" (click)="toggleSel(v, $event)">
                      <tm-icon *ngIf="isSel(v)" name="check" [size]="11" />
                      <span class="rownum" *ngIf="!isSel(v)">{{ i + 1 }}</span>
                    </span>
                  </td>
                  <td class="col-veh">
                    <div class="veh">
                      <button type="button" class="expcaret" [class.open]="isExpanded(v)" title="Fixed-route groups" (click)="toggleExpand(v, $event)"><tm-icon name="chevron-right" [size]="14" /></button>
                      <span class="veh-ic"><tm-icon name="car" [size]="15" /></span>
                      <span *ngIf="!isEditing(v, 'name')" class="veh-name ecell" (click)="startCellEdit(v, 'name', $event)">{{ v.display_name }}</span>
                      <input *ngIf="isEditing(v, 'name')" class="cin" [(ngModel)]="editValue" (keydown.enter)="commitCellEdit(v)" (keydown.escape)="cancelCellEdit()" (blur)="commitCellEdit(v)" />
                    </div>
                  </td>
                  <td><span class="tbadge">{{ v.vehicle_type_name || 'Not set' }}</span></td>
                  <td class="center ecell" (click)="startCellEdit(v, 'seats', $event)">
                    <b *ngIf="!isEditing(v, 'seats')">{{ v.max_people }}</b>
                    <input *ngIf="isEditing(v, 'seats')" class="cin" type="number" [(ngModel)]="editValue" (keydown.enter)="commitCellEdit(v)" (keydown.escape)="cancelCellEdit()" (blur)="commitCellEdit(v)" />
                  </td>
                  <td class="center ecell" (click)="startCellEdit(v, 'bags', $event)">
                    <b *ngIf="!isEditing(v, 'bags')">{{ v.luggage_capacity }}</b>
                    <input *ngIf="isEditing(v, 'bags')" class="cin" type="number" [(ngModel)]="editValue" (keydown.enter)="commitCellEdit(v)" (keydown.escape)="cancelCellEdit()" (blur)="commitCellEdit(v)" />
                  </td>
                  <td class="center" *ngFor="let rt of fareRideTypes"><button type="button" class="farelink" [class.set]="fareConfigured(v, rt)" (click)="openFareDrawer(v, rt, $event)">{{ fareConfigured(v, rt) ? 'Edit' : 'Set up' }}</button></td>
                  <td>
                    <span class="gchips" *ngIf="groupsForVehicle(v).length; else noGrp">
                      <button type="button" class="gchip" *ngFor="let g of groupsForVehicle(v).slice(0, 2)" (click)="toggleExpand(v, $event)">{{ g.name }}</button>
                      <button type="button" class="gchip more" *ngIf="groupsForVehicle(v).length > 2" (click)="toggleExpand(v, $event)">+{{ groupsForVehicle(v).length - 2 }}</button>
                    </span>
                    <ng-template #noGrp><button type="button" class="addlink" (click)="toggleExpand(v, $event)">+ Group</button></ng-template>
                  </td>
                  <td>
                    <button type="button" class="linkcell" (click)="openLayoutsList(v, $event)">
                      <span *ngIf="layoutCountFor(v)">{{ layoutCountFor(v) }} {{ layoutCountFor(v) === 1 ? 'layout' : 'layouts' }}</span>
                      <span *ngIf="!layoutCountFor(v)" class="muted-link">Design</span>
                    </button>
                  </td>
                  <td>
                    <span class="avstack" [title]="driversFor(v).length + ' drivers'" *ngIf="driversFor(v).length; else noDrv">
                      <span class="av2" *ngFor="let d of driversFor(v).slice(0, 3)">{{ initials(d.name) }}</span>
                      <span class="av2 more" *ngIf="driversFor(v).length > 3">+{{ driversFor(v).length - 3 }}</span>
                    </span>
                    <ng-template #noDrv><span class="muted-link">None</span></ng-template>
                  </td>
                  <td class="center"><button type="button" class="pill" [class.success]="v.is_active" [class.neutral]="!v.is_active" (click)="toggleActiveFor(v, $event)"><span class="led"></span>{{ v.is_active ? 'Enabled' : 'Disabled' }}</button></td>
                  <td class="center"><button type="button" class="kebab" (click)="openRowMenu(v, $event)"><tm-icon name="more-horizontal" [size]="16" /></button></td>
                </tr>

                <tr class="detailrow" *ngIf="isExpanded(v)">
                  <td class="col-gut"></td>
                  <td [attr.colspan]="detailColspan">
                    <div class="detailwrap">
                      <div class="detailhead">
                        <span class="ovl">Fixed-route groups · {{ v.display_name }}</span>
                        <span class="ws__grow"></span>
                        <tm-button variant="green" size="sm" icon="plus" (clicked)="openUnifiedGroupDrawer(v)">Manage Routes & Groups</tm-button>
                        <tm-button variant="outline" size="sm" icon="plus" (clicked)="newRouteFor(v)">Add route</tm-button>
                        <tm-button variant="outline" size="sm" icon="upload" [disabled]="importingKml" (clicked)="openImportChoice(v)">{{ importingKml ? 'Reading…' : 'Import from My Maps' }}</tm-button>
                      </div>

                      <div class="gline" *ngFor="let g of groupsForVehicle(v); trackBy: trackGroup">
                        <div class="gline__head">
                          <span class="gname">{{ g.name }}</span>
                          <span class="gmeta">{{ g.route_ids.length }} {{ g.route_ids.length === 1 ? 'route' : 'routes' }} · {{ g.driver_user_ids.length }} {{ g.driver_user_ids.length === 1 ? 'driver' : 'drivers' }}</span>
                          <span class="gline__acts">
                            <button type="button" class="mini-btn mini-btn--go" (click)="openUnifiedGroupDrawer(v, g)"><tm-icon name="edit" [size]="12" /> Edit group</button>
                            <button type="button" class="mini-btn mini-btn--danger" (click)="deleteGroup(g)">Delete</button>
                          </span>
                        </div>
                        <div class="gcol">
                          <span class="gcol__lbl">Routes</span>
                          <div class="gcol__body">
                            <span class="rchip2" *ngFor="let r of routesIn(g)" title="Locked while in a group — remove it from the group to edit the route">
                              <tm-icon name="lock" [size]="11" />
                              <b>{{ r.name }}</b>
                              <button type="button" class="rx" title="Remove route" (click)="ungroupRoute(g, r.id)">×</button>
                            </span>
                            <span class="gcol__empty" *ngIf="!routesIn(g).length">No routes in this group yet.</span>
                          </div>
                        </div>
                        <div class="gcol">
                          <span class="gcol__lbl">Drivers</span>
                          <div class="gcol__body">
                            <span class="dpill" *ngFor="let d of driversIn(g)">
                              <span class="av">{{ initials(d.name) }}</span>
                              {{ d.name }}
                              <button type="button" class="rx" title="Remove driver" (click)="removeDriverFromGroup(g, d.user_id)">×</button>
                            </span>
                            <span class="gcol__empty" *ngIf="!driversIn(g).length">No drivers assigned to this group yet.</span>
                          </div>
                        </div>
                      </div>

                      <div class="gline gline--orphan" *ngIf="ungroupedForVehicle(v).length">
                        <div class="gline__head">
                          <span class="gname">Ungrouped routes</span>
                          <span class="gmeta">{{ ungroupedForVehicle(v).length }} not in any group · editable</span>
                        </div>
                        <div class="gcol">
                          <span class="gcol__lbl">Routes</span>
                          <div class="gcol__body">
                            <span class="rchip2 rchip2--edit" [class.rchip2--nopr]="r.flat_fare == null" *ngFor="let r of ungroupedForVehicle(v)">
                              <button type="button" class="rchip2__edit" [title]="r.flat_fare == null ? 'Add a price to finish this route' : 'Edit this route on the map'" (click)="editRouteFor(v, r.id)">
                                <tm-icon name="edit" [size]="11" />
                                <b>{{ r.name }}</b>
                                <span class="npbadge" *ngIf="r.flat_fare == null">⚠ Needs pricing</span>
                              </button>
                              <button type="button" class="rx add" [title]="r.flat_fare == null ? 'Add a price before grouping this route' : 'Add to a group'" (click)="openAssignDrawer(r)">+</button>
                            </span>
                          </div>
                        </div>
                      </div>

                      <div class="emptybox" *ngIf="!groupsForVehicle(v).length && !ungroupedForVehicle(v).length">No route groups yet. Click Manage Routes & Groups to create a group and assign routes and drivers all at once.</div>
                    </div>
                  </td>
                </tr>
              </ng-container>
            </tbody>
            <tfoot>
              <tr class="addrow"><td [attr.colspan]="detailColspan + 1"><button type="button" class="addbtn" [disabled]="!vehicleTypeOptions.length" (click)="openCreate()"><tm-icon name="plus" [size]="16" /> Add vehicle</button></td></tr>
            </tfoot>
          </table>

          <div class="empty" *ngIf="!visible.length && !loading"><strong>No city vehicles</strong><span>Add a city vehicle after creating vehicle types.</span></div>
          <div class="skeleton" *ngIf="loading"><span class="sk" *ngFor="let i of [1,2,3,4]"></span></div>
        </div>

        <!-- Map route editor: hidden table, opens as a drawer via Add route / edit route. -->
        <app-fixed-routes *ngIf="selected" [cityVehicleTypeId]="selected.id" [embedded]="true" [hideTable]="true" [drawerMode]="true" (routesChanged)="loadRoutes()" (editorClosed)="onRouteEditorClosed()"></app-fixed-routes>

        <!-- Hidden picker for "Import from My Maps" (KML/KMZ upload) — creates. -->
        <input #kmlInput type="file" accept=".kml,.kmz" hidden (change)="onKmlFileSelected($event)" />
        <!-- Hidden picker for "Edit → Update from My Maps" — updates one route. -->
        <input #editKmlInput type="file" accept=".kml,.kmz" hidden (change)="onEditKmlFileSelected($event)" />

        <!-- (The old tabbed editor is gone — its fares, routes, groups, layouts
             and drivers are reached from the spreadsheet cells + drawers above.) -->
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

    <tm-drawer
      [open]="commonDrawerOpen"
      [title]="(commonDrawerVehicle?.display_name || 'Vehicle') + ' — edit vehicle'"
      subtitle="Shared by every fare mode of this vehicle"
      [width]="440"
      (closed)="closeCommonDrawer()"
    >
      <div slot="body" class="form">
        <div class="fields">
          <label class="f f--wide"><span>Vehicle name <i>*</i></span><input type="text" [(ngModel)]="common.display_name" /></label>
          <label class="f"><span>Max people</span><input type="number" min="1" [(ngModel)]="common.max_people" /></label>
          <label class="f"><span>Luggage capacity</span><input type="number" min="0" [(ngModel)]="common.luggage_capacity" /></label>
        </div>
        <p class="meta" *ngIf="commonDrawerVehicle" style="margin-top: 12px;">
          Depends on type: <b>{{ commonDrawerVehicle.vehicle_type_name || 'not set' }}</b> · Fare setup: <b>{{ fareModesLabel(commonDrawerVehicle) }}</b>.
          Saving patches every mode row that shares this name and type.
        </p>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="closeCommonDrawer()">Cancel</tm-button>
        <tm-button variant="green" icon="check" [disabled]="savingCommon || !common.display_name.trim()" (clicked)="saveCommon()">
          {{ savingCommon ? 'Saving...' : 'Save' }}
        </tm-button>
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

    <!-- Unified Multi-Group, Multi-Route, Multi-Driver Drawer -->
    <tm-drawer
      [open]="unifiedDrawerOpen"
      [title]="editingGroup ? ('Edit group · ' + editingGroup.name) : 'Manage Route Groups & Permissions'"
      subtitle="Assign routes and drivers to multiple groups at once"
      [width]="580"
      (closed)="unifiedDrawerOpen = false"
    >
      <div slot="body" class="form">
        <!-- Rename Group Input Field (shown when editing a group) -->
        <label class="f" *ngIf="editingGroup">
          <span>Rename Group <i>*</i></span>
          <input type="text" [(ngModel)]="unifiedForm.edit_group_name" placeholder="Group name" />
        </label>

        <!-- 1. Groups Selection (shown when batch-managing via top button, hidden when editing a specific group) -->
        <div class="f" *ngIf="!editingGroup">
          <div class="f__head-row">
            <span>Select Target Group(s)</span>
            <button
              type="button"
              class="mini-btn mini-btn--go"
              (click)="unifiedForm.is_creating_group = !unifiedForm.is_creating_group"
            >
              <tm-icon [name]="unifiedForm.is_creating_group ? 'x' : 'plus'" [size]="12" />
              {{ unifiedForm.is_creating_group ? 'Cancel New Group' : 'New Group' }}
            </button>
          </div>

          <label class="f" *ngIf="unifiedForm.is_creating_group" style="margin-top: 6px;">
            <span>New Group Name <i>*</i></span>
            <input type="text" [(ngModel)]="unifiedForm.new_group_name" placeholder="e.g. Sopore Morning Express" />
          </label>

          <div class="chip-grid" *ngIf="availableGroupsForUnifiedDrawer.length; else noUnifiedGroups">
            <button
              *ngFor="let g of availableGroupsForUnifiedDrawer"
              type="button"
              class="multi-chip"
              [class.is-selected]="unifiedForm.group_ids.includes(g.id)"
              (click)="toggleUnifiedGroup(g.id)"
            >
              <tm-icon [name]="unifiedForm.group_ids.includes(g.id) ? 'check' : 'plus'" [size]="12" />
              <span>{{ g.name }}</span>
            </button>
          </div>
          <ng-template #noUnifiedGroups>
            <p class="meta" *ngIf="!unifiedForm.is_creating_group">No groups created yet. Click <b>+ New Group</b> above to create one.</p>
          </ng-template>
        </div>

        <!-- 2. Routes Selection (Chips) -->
        <div class="f">
          <span>Assign Routes</span>
          <div class="chip-grid" *ngIf="availableRoutesForUnifiedDrawer.length; else noUnifiedRoutes">
            <button
              *ngFor="let r of availableRoutesForUnifiedDrawer"
              type="button"
              class="multi-chip"
              [class.is-selected]="unifiedForm.route_ids.includes(r.id)"
              [class.multi-chip--nopr]="r.flat_fare == null"
              [title]="r.flat_fare == null ? 'Add a price before grouping this route' : ''"
              (click)="toggleUnifiedRoute(r.id)"
            >
              <tm-icon [name]="unifiedForm.route_ids.includes(r.id) ? 'check' : 'plus'" [size]="12" />
              <span>{{ r.name }}</span>
              <span class="npbadge npbadge--xs" *ngIf="r.flat_fare == null">⚠ Needs pricing</span>
            </button>
          </div>
          <ng-template #noUnifiedRoutes>
            <p class="meta">No pre-existing routes created for this vehicle yet.</p>
          </ng-template>
        </div>

        <!-- 3. Drivers Selection (Chips) -->
        <div class="f">
          <span>Assign Drivers</span>
          <div class="chip-grid" *ngIf="availableDriversForUnifiedDrawer.length; else noUnifiedDrivers">
            <button
              *ngFor="let d of availableDriversForUnifiedDrawer"
              type="button"
              class="multi-chip"
              [class.is-selected]="unifiedForm.driver_user_ids.includes(d.user_id)"
              (click)="toggleUnifiedDriver(d.user_id)"
            >
              <tm-icon [name]="unifiedForm.driver_user_ids.includes(d.user_id) ? 'check' : 'plus'" [size]="12" />
              <span class="av-mini">{{ initials(d.name) }}</span>
              <span>{{ d.name }}</span>
            </button>
          </div>
          <ng-template #noUnifiedDrivers>
            <p class="meta">No pre-existing drivers registered for this vehicle type.</p>
          </ng-template>
        </div>
      </div>

      <div slot="footer">
        <tm-button variant="ghost" (clicked)="unifiedDrawerOpen = false">Cancel</tm-button>
        <tm-button
          variant="green"
          [disabled]="(!unifiedForm.group_ids.length && (!unifiedForm.is_creating_group || !unifiedForm.new_group_name.trim())) || savingUnifiedGroup"
          (clicked)="saveUnifiedGroup()"
        >
          {{ savingUnifiedGroup ? 'Saving…' : 'Save Assignments' }}
        </tm-button>
      </div>
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

    <!-- Assign an ungrouped route into a group. -->
    <tm-drawer [open]="!!assignDrawerRoute" title="Assign route to a group" [subtitle]="assignDrawerRoute?.name || ''" [width]="480" (closed)="assignDrawerRouteId = null">
      <div slot="body" class="form" *ngIf="assignDrawerRoute as r">
        <p class="meta">Adding this route to a group lets that group's drivers run it.</p>
        <button type="button" class="pick pick--bd" *ngFor="let g of groups" (click)="assignRouteToGroup(r.id, g)">
          <span class="pick__main">
            <b>{{ g.name }}</b>
            <span class="pick__row">
              <span class="pick__lbl">Routes</span>
              <span class="chip" *ngFor="let rt of routesIn(g)">{{ rt.name }}</span>
              <span class="meta" *ngIf="!routesIn(g).length">None yet</span>
            </span>
            <span class="pick__row">
              <span class="pick__lbl">Drivers</span>
              <span class="drv drv--xs" *ngFor="let d of driversIn(g)"><span class="av">{{ initials(d.name) }}</span>{{ d.name }}</span>
              <span class="meta" *ngIf="!driversIn(g).length">None yet</span>
            </span>
          </span>
          <span class="mini-btn">Add here</span>
        </button>
        <p class="meta" *ngIf="!groups.length">No groups yet — create one below to assign this route.</p>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="assignDrawerRouteId = null">Cancel</tm-button>
        <tm-button variant="green" icon="plus" (clicked)="assignDrawerRouteId = null; openGroupDrawer()">New group</tm-button>
      </div>
    </tm-drawer>

    <!-- Add an existing route into this group. -->
    <tm-drawer [open]="!!routeDrawerGroup" title="Add a route to this group" [subtitle]="routeDrawerGroup?.name || ''" [width]="480" (closed)="routeDrawerId = null">
      <div slot="body" class="form" *ngIf="routeDrawerGroup as g">
        <button type="button" class="pick pick--bd" [class.pick--nopr]="r.flat_fare == null" *ngFor="let r of routesForRouteDrawer" (click)="addRouteToGroup(g, r.id)">
          <span class="pick__main"><b>{{ r.name }}</b><small>{{ r.origin_name }} → {{ r.dest_name }}</small></span>
          <span class="npbadge npbadge--xs" *ngIf="r.flat_fare == null">⚠ Needs pricing</span>
          <span class="mini-btn" *ngIf="r.flat_fare != null">Add here</span>
        </button>
        <p class="meta" *ngIf="!routesForRouteDrawer.length">All vehicle routes are already in this group.</p>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="routeDrawerId = null">Done</tm-button>
        <tm-button variant="green" icon="plus" (clicked)="routeDrawerId = null; newRoute()">New route</tm-button>
      </div>
    </tm-drawer>

    <!-- Add drivers to this group — pick several, then Save once. -->
    <tm-drawer [open]="!!driverDrawerGroup" title="Group drivers" [subtitle]="driverDrawerGroup?.name || ''" [width]="480" (closed)="driverDrawerId = null">
      <div slot="body" class="form" *ngIf="driverDrawerGroup">
        <p class="meta">Tick the drivers who can run every route in this group, then Save.</p>
        <label class="pickrow" *ngFor="let d of cityDrivers" [class.is-on]="pendingDriverIds.includes(d.user_id)">
          <input type="checkbox" [checked]="pendingDriverIds.includes(d.user_id)" (change)="togglePendingDriver(d.user_id)" />
          <span class="av">{{ initials(d.name) }}</span>
          <span class="pick__main"><b>{{ d.name }}</b><small>{{ d.phone || 'No phone' }}</small></span>
        </label>
        <p class="meta" *ngIf="!cityDrivers.length">No drivers in this city yet.</p>
      </div>
      <div slot="footer">
        <span class="drawer-count">{{ pendingDriverIds.length }} selected</span>
        <span class="ws__grow"></span>
        <tm-button variant="ghost" (clicked)="driverDrawerId = null">Cancel</tm-button>
        <tm-button variant="green" icon="check" [disabled]="savingGroupDrivers" (clicked)="commitDrawerDrivers()">{{ savingGroupDrivers ? 'Saving...' : 'Save' }}</tm-button>
      </div>
    </tm-drawer>

    <!-- Fare editor — opens the real fare form for one vehicle + ride type. -->
    <tm-drawer [open]="fareDrawerOpen" [title]="(selected?.display_name || 'Vehicle') + ' — ' + (activeRideType?.name || 'fare')" [subtitle]="fareSubtitle" [width]="620" (closed)="closeFareDrawer()">
      <div slot="body" class="form" *ngIf="activeRideType && !activeIsFixed">
        <ng-container *ngIf="activeRow; else preparingFare">
          <div class="sec" *ngIf="activeKind === 'private'">
            <div class="sec__head"><h3>{{ activeRideType.name }} unique fields</h3></div>
            <div class="inline">
              <label class="check"><input type="checkbox" [(ngModel)]="reverseBidding" /> <span>Reverse bidding</span></label>
              <tm-button variant="outline" size="sm" icon="check" [disabled]="savingUnique" (clicked)="saveUniqueFields()">{{ savingUnique ? 'Saving...' : 'Save unique fields' }}</tm-button>
            </div>
          </div>
          <div class="sec">
            <app-vehicle-base-pricing *ngIf="!activeRow.is_outstation" [cityId]="cityId" [cityVehicleTypeId]="activeRow.id" [title]="activeRideType.name + ' Fare Settings'" [subtitle]="fareSubtitle"></app-vehicle-base-pricing>
            <app-outstation-packages *ngIf="activeRow.is_outstation" [cityId]="cityId" [vehicleTypeId]="activeRow.id"></app-outstation-packages>
          </div>
        </ng-container>
        <ng-template #preparingFare>
          <div class="cue cue--flat"><tm-icon name="rupee" [size]="22" /><strong>Preparing {{ activeRideType.name }} fare form…</strong><span>Setting up {{ activeRideType.name }} fare for {{ selected?.display_name }}.</span></div>
        </ng-template>
      </div>
      <div slot="footer"><tm-button variant="ghost" (clicked)="closeFareDrawer()">Done</tm-button></div>
    </tm-drawer>

    <!-- Seat layouts list for the selected vehicle's type. -->
    <tm-drawer [open]="layoutsListOpen" [title]="(selected?.display_name || 'Vehicle') + ' — seat layouts'" [subtitle]="'Shared by every ' + (selected?.vehicle_type_name || 'vehicle') + ' in this city'" [width]="560" (closed)="closeLayoutsList()">
      <div slot="body" class="form" *ngIf="selected">
        <div class="layout" *ngFor="let l of selLayouts">
          <div class="layout__preview"><app-seat-grid [rows]="l.rows" [cols]="l.cols" [cells]="l.cells" [frame]="true" [showWheel]="false" [showLegend]="false"></app-seat-grid></div>
          <div class="layout__meta"><span class="layout__name">{{ l.name }}</span><span class="layout__sub">{{ l.rows }}×{{ l.cols }} · {{ l.seat_count }} seats<ng-container *ngIf="l.in_use"> · in use</ng-container></span></div>
          <div class="layout__actions"><button type="button" class="mini-btn" (click)="editLayout(l)">Edit</button><button type="button" class="x" *ngIf="!l.in_use" title="Delete layout" (click)="deleteLayout(l)">×</button></div>
        </div>
        <div class="cue cue--flat" *ngIf="!selLayouts.length"><strong>No {{ selected.vehicle_type_name || 'vehicle' }} layouts yet</strong><span>A seat layout is the seat map a passenger taps to pick a seat.</span></div>
      </div>
      <div slot="footer"><tm-button variant="ghost" (clicked)="closeLayoutsList()">Done</tm-button><tm-button variant="green" icon="plus" [disabled]="selected?.vehicle_type_id == null" (clicked)="openDesigner()">Design layout</tm-button></div>
    </tm-drawer>

    <!-- Row kebab menu. -->
    <div class="menu-scrim" *ngIf="menuId != null" (click)="closeRowMenu()"></div>
    <div class="rowmenu" *ngIf="menuVehicle as v" [style.left.px]="menuX" [style.top.px]="menuY">
      <button type="button" (click)="closeRowMenu(); openCommonDrawer(v)"><tm-icon name="edit" [size]="15" /> Edit vehicle</button>
      <button type="button" (click)="closeRowMenu(); openLayoutsList(v)"><tm-icon name="grid" [size]="15" /> Seat layouts</button>
      <button type="button" (click)="closeRowMenu(); toggleExpand(v)"><tm-icon name="road" [size]="15" /> Route groups</button>
      <div class="rowmenu__div"></div>
      <button type="button" (click)="closeRowMenu(); toggleActiveFor(v)"><tm-icon name="refresh" [size]="15" /> {{ v.is_active ? 'Disable' : 'Enable' }}</button>
    </div>

    <!-- Seat-layout designer — wide side drawer, opens over the workspace. -->
    <div class="ldr-scrim" *ngIf="layoutDrawerOpen" (click)="closeLayoutDrawer()"></div>
    <div class="ldr" *ngIf="layoutDrawerOpen && selected">
      <app-seat-layout-designer
        [embedded]="true"
        [embeddedCityId]="cityId"
        [embeddedVehicleTypeId]="selected.vehicle_type_id"
        [embeddedVehicleTypeName]="selected.vehicle_type_name || ''"
        [embeddedLayoutId]="editingLayoutId"
        [editLayoutData]="editingLayout"
        [existingLayouts]="selLayouts"
        (saved)="onLayoutSaved()"
        (cancelled)="closeLayoutDrawer()"
      ></app-seat-layout-designer>
    </div>

    <!-- Edit an ungrouped route: choose to edit by hand or replace from My Maps. -->
    <tm-modal [open]="editChoiceOpen" title="Edit route" (closed)="editChoiceOpen = false">
      <ng-container slot="body">
        <p class="echoice__lead">How do you want to edit <b>{{ editChoiceName }}</b>?</p>
        <div class="echoice">
          <button type="button" class="echoice__opt" (click)="chooseManualEdit()">
            <span class="echoice__ic"><tm-icon name="edit" [size]="18" /></span>
            <span class="echoice__txt">
              <span class="echoice__t">Edit manually</span>
              <span class="echoice__d">Open the map editor and adjust the line, stops, fare and settings by hand.</span>
            </span>
          </button>
          <button type="button" class="echoice__opt" [disabled]="importingKml" (click)="chooseMyMapsEdit()">
            <span class="echoice__ic"><tm-icon name="map" [size]="18" /></span>
            <span class="echoice__txt">
              <span class="echoice__t">{{ importingKml ? 'Reading…' : 'Update from Google My Maps' }}</span>
              <span class="echoice__d">Upload the edited KML/KMZ — the line &amp; stops are replaced, fare &amp; settings kept.</span>
            </span>
          </button>
        </div>
      </ng-container>
    </tm-modal>

    <!-- Import from My Maps: single (review each) or bulk (many, no price). -->
    <tm-modal [open]="importChoiceOpen" title="Import from Google My Maps" (closed)="importChoiceOpen = false">
      <ng-container slot="body">
        <p class="echoice__lead">Importing to <b>{{ importChoiceVehicle?.display_name || 'this vehicle' }}</b>.</p>
        <div class="echoice">
          <button type="button" class="echoice__opt" (click)="chooseSingleImport()">
            <span class="echoice__ic"><tm-icon name="edit" [size]="18" /></span>
            <span class="echoice__txt">
              <span class="echoice__t">Single — review each</span>
              <span class="echoice__d">Open each route on the map to set its stops, fare and settings before saving.</span>
            </span>
          </button>
          <button type="button" class="echoice__opt" [disabled]="importingKml" (click)="chooseBulkImport()">
            <span class="echoice__ic"><tm-icon name="upload" [size]="18" /></span>
            <span class="echoice__txt">
              <span class="echoice__t">{{ importingKml ? 'Importing…' : 'Bulk — import all now' }}</span>
              <span class="echoice__d">Pick one or more My Maps files; every route in them is added at once (name &amp; line only). They land as “Needs pricing” to finish later.</span>
            </span>
          </button>
        </div>
      </ng-container>
    </tm-modal>

    <!-- Hidden picker for "Bulk" import — creates Needs-pricing routes. Multiple files allowed. -->
    <input #bulkKmlInput type="file" accept=".kml,.kmz" multiple hidden (change)="onBulkKmlFileSelected($event)" />
  `,
  styles: [`
    .ws { display: flex; flex-direction: column; gap: 14px; }
    .echoice__lead { margin: 0 0 14px; color: var(--tm-text-muted); }
    .rchip2--nopr { border-color: #ffe2a8; background: #fff7e6; }
    .npbadge { margin-left: 6px; font-size: 10px; font-weight: 800; color: #9a6700; white-space: nowrap; }
    .npbadge--xs { margin-left: 4px; font-size: 9px; }
    .multi-chip--nopr { border-color: #ffe2a8 !important; background: #fff7e6; color: #9a6700; }
    .pick--nopr { border-color: #ffe2a8 !important; background: #fff7e6; }
    .rx.add[disabled] { opacity: .4; cursor: not-allowed; }
    .echoice { display: flex; flex-direction: column; gap: 10px; }
    .echoice__opt { display: flex; align-items: flex-start; gap: 12px; width: 100%; text-align: left; padding: 14px; border: 1px solid var(--tm-line); border-radius: var(--tm-radius-lg, 12px); background: var(--tm-surface); cursor: pointer; transition: border-color .15s, background .15s, transform .05s; }
    .echoice__opt:hover:not([disabled]) { border-color: var(--tm-green, #0f7a3f); background: var(--tm-canvas-2, #eef1f5); }
    .echoice__opt:active:not([disabled]) { transform: translateY(1px); }
    .echoice__opt[disabled] { opacity: .6; cursor: default; }
    .echoice__ic { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; flex: none; border-radius: 10px; background: var(--tm-canvas-2, #eef1f5); color: var(--tm-green, #0f7a3f); }
    .echoice__txt { display: flex; flex-direction: column; gap: 3px; }
    .echoice__t { font-weight: 800; color: var(--tm-text); }
    .echoice__d { font-size: 12.5px; color: var(--tm-text-muted); line-height: 1.4; }
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
    .row { display: flex; align-items: center; gap: 4px; width: 100%; padding: 0 6px 0 0; border: 1px solid transparent; border-radius: 10px; background: transparent; }
    .row:hover { background: var(--tm-canvas); }
    .row[aria-current="true"] { background: var(--tm-green-tint, #ecfdf5); border-color: var(--tm-green, #16a34a); }
    /* Disabled vehicles read dimmer instead of carrying a status pill. */
    .row.is-off .row__name { color: var(--tm-text-muted); }
    .row.is-off .row__name::after { content: ' · disabled'; font-weight: 600; font-size: 11px; color: var(--tm-text-muted); }
    .row__hit { flex: 1; min-width: 0; display: flex; padding: 9px 4px 9px 10px; border: 0; background: transparent; text-align: left; font: inherit; cursor: pointer; }
    /* Pen sits on the same line as the name; visible on hover / when selected. */
    .row__edit { flex: none; width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 8px; background: transparent; color: var(--tm-text-muted); cursor: pointer; opacity: 0; transition: opacity .12s, background .12s, color .12s; }
    .row:hover .row__edit, .row[aria-current="true"] .row__edit { opacity: 1; }
    .row__edit:hover { background: var(--tm-surface); color: var(--tm-green, #16a34a); }
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

    /* Clickable enabled/disabled pill — same look as the ENABLED status pill in
       the header, so this vehicle's on/off state reads identically wherever shown. */
    .statustoggle { display: inline-flex; align-items: center; gap: 7px; height: 26px; padding: 0 12px; border: 0; border-radius: 999px; background: var(--tm-green-tint, #ecfdf5); color: var(--tm-green, #16a34a); font: inherit; font-size: 11px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; cursor: pointer; transition: background .12s, color .12s; }
    .statustoggle__dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    .statustoggle:hover:not(:disabled) { filter: brightness(.97); }
    .statustoggle:disabled { opacity: .6; cursor: default; }
    .statustoggle.is-off { background: var(--tm-canvas-2, #f3f4f6); color: var(--tm-text-muted); }
    .meta { margin: 0; font-size: 12px; color: var(--tm-text-muted); }
    .meta b { color: var(--tm-text); font-weight: 800; }
    .meta.warn { color: #9a6a11; }
    .muted { color: var(--tm-text-muted); font-size: 11.5px; }
    .note { margin: 0; padding: 10px 12px; border: 1px solid var(--tm-line); border-radius: 9px; background: var(--tm-canvas); color: var(--tm-text-muted); font-size: 12px; }
    .note b { color: var(--tm-text); }

    .chip-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
    .multi-chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 7px 12px; border-radius: 20px; border: 1.5px solid var(--tm-line);
      background: var(--tm-canvas); color: var(--tm-text); font-size: 12px; font-weight: 600;
      cursor: pointer; transition: all .15s ease;
    }
    .multi-chip:hover { border-color: var(--tm-text-muted); }
    .multi-chip.is-selected {
      background: var(--tm-success-bg, #ecfdf5); border-color: var(--tm-green, #16a34a);
      color: var(--tm-green-deep, #15803d); font-weight: 700;
    }
    .av-mini {
      display: inline-flex; align-items: center; justify-content: center;
      width: 18px; height: 18px; border-radius: 50%; background: var(--tm-canvas-2, #e5e7eb);
      font-size: 10px; font-weight: 700; color: var(--tm-text-muted);
    }

    .mini-select {
      padding: 2px 6px; border-radius: 6px; border: 1px solid var(--tm-line);
      background: var(--tm-canvas); color: var(--tm-text); font-size: 11px; font-weight: 700;
      cursor: pointer; outline: none;
    }
    .mini-select:focus { border-color: var(--tm-green); }
    .gcol__empty { font-size: 11.5px; color: var(--tm-text-muted); padding: 2px 0; }
    .f__head-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 2px; }

    /* Shared search + pagination chrome for the route-groups section. */
    .toolbar { display: flex; align-items: center; gap: 10px; }
    .toolbar__count { font-size: 12px; font-weight: 700; color: var(--tm-text-muted); white-space: nowrap; }
    .pager { display: flex; align-items: center; justify-content: center; gap: 12px; padding-top: 2px; }
    .pager__label { font-size: 12px; font-weight: 700; color: var(--tm-text-muted); }

    .grp { display: flex; flex-direction: column; gap: 12px; padding: 14px; border: 1px solid var(--tm-line); border-radius: 12px; }
    .grp--orphan { border-color: #fce4a6; background: var(--tm-canvas); }
    .grp__top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .grp__name { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .badge { padding: 1px 8px; border-radius: 999px; background: var(--tm-green-tint, #ecfdf5); color: var(--tm-green, #16a34a); font-size: 11px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .badge--mute { background: var(--tm-canvas-2, #f3f4f6); color: var(--tm-text-muted); }
    .badge--warn { background: #fef3c7; color: #b45309; }
    .grp__empty { padding: 6px 2px; font-size: 12px; color: var(--tm-text-muted); }
    .grp__drivers { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding-top: 11px; border-top: 1px solid var(--tm-line); }
    .dlabel { font-size: 11px; font-weight: 800; letter-spacing: .03em; text-transform: uppercase; color: var(--tm-text-muted); }

    /* Route row — carries the columns the old routes table showed. */
    .routes { display: flex; flex-direction: column; gap: 6px; }
    .rt { display: grid; grid-template-columns: 1fr auto auto auto auto; align-items: center; gap: 12px; padding: 9px 11px; border-radius: 9px; background: var(--tm-canvas); }
    .rt__nm { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .rt__nm b { font-size: 12.5px; font-weight: 700; color: var(--tm-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rt__nm small { font-size: 11px; color: var(--tm-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rt__col { font-variant-numeric: tabular-nums; font-size: 12px; font-weight: 700; color: var(--tm-text); white-space: nowrap; text-align: right; }
    .rt__col small { display: block; font-size: 10px; font-weight: 600; color: var(--tm-text-muted); letter-spacing: .03em; text-transform: uppercase; }
    .rt__acts { display: flex; align-items: center; gap: 6px; }
    .icon { width: 28px; height: 28px; border-radius: 7px; border: 0; background: transparent; display: grid; place-items: center; color: var(--tm-text-muted); font-size: 13px; cursor: pointer; }
    .icon:hover { background: var(--tm-canvas-2, #f3f4f6); color: var(--tm-text); }
    .icon--del:hover { background: #fef2f2; color: #dc2626; }
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
    .pick__row { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; margin-top: 5px; }
    .pick__lbl { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .03em; color: var(--tm-text-muted); margin-right: 2px; }
    .chip { padding: 2px 8px; border: 1px solid var(--tm-line); border-radius: 999px; background: var(--tm-canvas-2, #f3f4f6); font-size: 11px; color: var(--tm-text); }
    .drv--xs { padding: 1px 7px 1px 2px; gap: 5px; font-size: 11px; }
    .drv--xs .av { width: 17px; height: 17px; font-size: 8.5px; }
    /* Bordered pick rows for use inside a drawer (no wrapping .picker box). */
    .pick--bd { border: 1px solid var(--tm-line); border-radius: 10px; padding: 10px; }
    .pick--bd:hover { border-color: var(--tm-green, #16a34a); background: var(--tm-canvas); }
    /* Multi-select checklist row inside a drawer. */
    .pickrow { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border: 1px solid var(--tm-line); border-radius: 10px; cursor: pointer; }
    .pickrow:hover { border-color: var(--tm-text-muted); }
    .pickrow.is-on { border-color: var(--tm-green, #16a34a); background: var(--tm-green-tint, #ecfdf5); }
    .pickrow input { width: 16px; height: 16px; accent-color: var(--tm-green, #16a34a); flex: none; }
    .drawer-count { font-size: 12px; font-weight: 700; color: var(--tm-text-muted); }

    .layout { display: grid; grid-template-columns: 92px 1fr auto; gap: 12px; align-items: center; padding: 14px; border: 1px solid var(--tm-line); border-radius: 12px; }
    .layout__preview { width: 88px; height: 96px; display: flex; align-items: flex-start; justify-content: center; overflow: hidden; }
    .layout__preview :is(app-seat-grid) { transform: scale(0.34); transform-origin: top center; }
    .layout__meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .layout__name { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .layout__sub { font-size: 11px; color: var(--tm-text-muted); }
    .layout__actions { display: inline-flex; align-items: center; gap: 6px; }

    /* Seat-layout designer drawer */
    .ldr-scrim { position: fixed; inset: 0; background: rgba(15, 23, 42, .38); z-index: 60; animation: ldr-fade 140ms ease-out; }
    .ldr { position: fixed; top: 0; right: 0; bottom: 0; width: 92vw; max-width: 1500px; z-index: 61; background: var(--tm-canvas, #fff); box-shadow: -16px 0 40px rgba(15,23,42,.18); overflow-y: auto; padding: 22px 26px; animation: ldr-slide 180ms cubic-bezier(.22,.61,.36,1); }
    @keyframes ldr-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes ldr-slide { from { transform: translateX(24px); opacity: .6; } to { transform: translateX(0); opacity: 1; } }
    @media (max-width: 760px) { .ldr { width: 100vw; padding: 16px; } }

    .form { display: flex; flex-direction: column; gap: 12px; }
    .typerow { display: flex; align-items: center; gap: 9px; padding: 8px 10px; border: 1px solid var(--tm-line); border-radius: 9px; }
    .typerow__name { flex: 1; min-width: 0; font-size: 13px; font-weight: 700; color: var(--tm-text); }
    .typeform { display: flex; flex-direction: column; gap: 9px; padding-top: 11px; border-top: 1px solid var(--tm-line); }
    .typeform__actions { display: flex; justify-content: flex-end; gap: 8px; }

    /* ─────────────── full-width spreadsheet ─────────────── */
    .grid { display: flex; flex-direction: column; gap: 12px; }
    .controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .controls .search { flex: 0 1 300px; height: 38px; border-radius: 10px; }
    .controls .mini { height: 38px; max-width: 160px; border-radius: 10px; padding: 0 12px; }
    .seg { display: inline-flex; padding: 3px; gap: 2px; background: var(--tm-canvas-2, #eaeef4); border-radius: 10px; }
    .seg__btn { padding: 7px 13px; border: 0; border-radius: 8px; background: transparent; color: var(--tm-text-muted); font: inherit; font-size: 12.5px; font-weight: 700; white-space: nowrap; cursor: pointer; transition: background .15s, color .15s; }
    .seg__btn:hover { color: var(--tm-text); }
    .seg__btn.on { background: var(--tm-surface); color: var(--tm-green, #16a34a); box-shadow: var(--tm-shadow-sm, 0 1px 2px rgba(15,20,25,.05)); }

    /* Custom filter dropdown — same look as the Drivers page state-select. */
    .fsel { position: relative; display: inline-block; }
    .fsel__trigger { display: inline-flex; align-items: center; gap: 8px; height: 38px; padding: 0 12px; border: 1px solid var(--tm-line-2, #e2e6ec); border-radius: 10px; background: var(--tm-surface); font: inherit; font-size: 13px; font-weight: 700; color: var(--tm-text); cursor: pointer; line-height: 1.2; transition: border-color .15s, background .15s; }
    .fsel__trigger:hover { border-color: var(--tm-ink, #0f1419); }
    .fsel.is-open .fsel__trigger { border-color: var(--tm-ink, #0f1419); }
    .fsel.has-value .fsel__trigger { background: var(--tm-green-tint, #ecfdf5); border-color: var(--tm-green-deep, #16a34a); }
    .fsel__icon { display: inline-flex; color: var(--tm-text-muted); }
    .fsel.has-value .fsel__icon { color: var(--tm-green-deep, #16a34a); }
    .fsel__value { min-width: 84px; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
    .fsel__caret { color: var(--tm-text-soft, #94a0ad); transition: transform .15s; }
    .fsel.is-open .fsel__caret { transform: rotate(180deg); }
    .fsel.has-value .fsel__caret { color: var(--tm-green-deep, #16a34a); }
    .fsel__menu { position: absolute; top: calc(100% + 6px); left: 0; min-width: 100%; width: max-content; max-width: 260px; max-height: 320px; overflow-y: auto; margin: 0; padding: 6px; list-style: none; background: var(--tm-surface); border: 1px solid var(--tm-line-2, #e2e6ec); border-radius: 12px; box-shadow: var(--tm-shadow-pop, 0 12px 40px -16px rgba(15,20,25,.25)); z-index: 60; animation: fsel-in .14s var(--tm-ease, cubic-bezier(.4,0,.2,1)) both; }
    @keyframes fsel-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
    .fsel__option { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; font-size: 12.5px; font-weight: 600; color: var(--tm-text); cursor: pointer; transition: background .15s, color .15s; }
    .fsel__option:hover { background: var(--tm-canvas-2, #eaeef4); }
    .fsel__option.is-selected { background: var(--tm-green-tint, #ecfdf5); color: var(--tm-green-deep, #16a34a); font-weight: 700; }
    .fsel__option:not(.is-selected) .fsel__olabel { margin-left: 20px; }
    .fsel__check { color: var(--tm-green-deep, #16a34a); flex: none; }
    .fsel__olabel { flex: 1; white-space: nowrap; }

    .clearall { display: inline-flex; align-items: center; gap: 5px; height: 38px; padding: 0 12px; border: 1px solid var(--tm-line-2, #e2e6ec); border-radius: 10px; background: var(--tm-surface); color: var(--tm-text-muted); font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; transition: border-color .15s, color .15s, background .15s; }
    .clearall:hover { border-color: var(--tm-danger, #ef4444); color: var(--tm-danger, #ef4444); background: var(--tm-danger-bg, #fee2e2); }
    .count-note { margin-left: auto; font-size: 12.5px; color: var(--tm-text-muted); font-weight: 600; }
    .count-note b { color: var(--tm-text); }

    .bulk { display: flex; align-items: center; gap: 12px; padding: 9px 14px; background: var(--tm-ink, #0f1419); color: #fff; border-radius: 11px; }
    .bulk b { font-weight: 800; }
    .bulk__sep { width: 1px; height: 18px; background: rgba(255,255,255,.2); }
    .bbtn { padding: 6px 11px; border: 0; border-radius: 8px; background: rgba(255,255,255,.12); color: #fff; font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; }
    .bbtn:hover { background: rgba(255,255,255,.22); }
    .bulk__x { margin-left: auto; display: inline-flex; padding: 4px; border: 0; background: transparent; color: rgba(255,255,255,.7); cursor: pointer; }
    .bulk__x:hover { color: #fff; }

    .sheetwrap { overflow: auto; background: var(--tm-surface); border: 1px solid var(--tm-line); border-radius: var(--tm-radius-lg, 16px); }
    table.sheet { border-collapse: separate; border-spacing: 0; width: 100%; min-width: 900px; --frz1: 44px; --frz2: 236px; font-variant-numeric: tabular-nums; }
    .sheet th, .sheet td { border-right: 1px solid var(--tm-line); border-bottom: 1px solid var(--tm-line); padding: 0 12px; height: 46px; text-align: left; white-space: nowrap; background: var(--tm-surface); }
    .sheet thead th { position: sticky; top: 0; z-index: 6; background: var(--tm-canvas); color: var(--tm-text-muted); font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .sheet th.center, .sheet td.center { text-align: center; }
    .col-gut { position: sticky; left: 0; z-index: 7; width: var(--frz1); min-width: var(--frz1); text-align: center; padding: 0; }
    .col-veh { position: sticky; left: var(--frz1); z-index: 7; width: calc(var(--frz2) - var(--frz1)); min-width: calc(var(--frz2) - var(--frz1)); box-shadow: 6px 0 12px -10px rgba(15,20,25,.18); }
    .sheet thead .col-gut, .sheet thead .col-veh { z-index: 9; }
    .sheet tbody tr.srow:hover td { background: var(--tm-canvas); }
    .sheet tbody tr.srow.sel td { background: var(--tm-green-tint, #ecfdf5); }
    .sheet tbody tr.srow.off .veh-name { color: var(--tm-text-muted); }

    .chk { width: 18px; height: 18px; margin: 0 auto; border-radius: 5px; border: 1.6px solid var(--tm-line-2, #e2e6ec); display: inline-grid; place-items: center; background: var(--tm-surface); color: #fff; cursor: pointer; vertical-align: middle; }
    .chk.on { background: var(--tm-green, #16a34a); border-color: var(--tm-green, #16a34a); }
    .rownum { font-size: 11px; color: var(--tm-text-soft, #94a0ad); font-weight: 700; }

    .veh { display: flex; align-items: center; gap: 8px; }
    .expcaret { width: 22px; height: 22px; flex: none; border: 0; border-radius: 7px; display: grid; place-items: center; background: transparent; color: var(--tm-text-soft, #94a0ad); cursor: pointer; transition: transform .15s, background .15s, color .15s; }
    .expcaret:hover { background: var(--tm-canvas-2, #eaeef4); color: var(--tm-text); }
    .expcaret.open { transform: rotate(90deg); color: var(--tm-green, #16a34a); }
    .veh-ic { width: 28px; height: 28px; flex: none; border-radius: 8px; background: var(--tm-canvas-2, #eaeef4); color: var(--tm-text-muted); display: grid; place-items: center; }
    .veh-name { font-size: 13px; font-weight: 800; color: var(--tm-text); cursor: text; }
    .ecell { cursor: text; }
    .ecell:hover { background: var(--tm-green-tint, #ecfdf5) !important; box-shadow: inset 0 0 0 1.5px var(--tm-green-soft, #dcfce7); }
    .ecell b { font-weight: 700; }
    .cin { width: 100%; height: 30px; border: 1px solid var(--tm-green, #16a34a); border-radius: 6px; padding: 0 8px; background: var(--tm-surface); color: var(--tm-text); font: inherit; font-weight: 700; font-size: 13px; outline: none; }
    .tbadge { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .03em; color: var(--tm-text-muted); padding: 2px 7px; border-radius: 6px; background: var(--tm-canvas-2, #eaeef4); }

    .pill { display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border: 0; border-radius: 999px; font-size: 10.5px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; cursor: pointer; }
    .pill .led { width: 6px; height: 6px; border-radius: 50%; }
    .pill.success { background: var(--tm-green-tint, #ecfdf5); color: var(--tm-green, #16a34a); } .pill.success .led { background: var(--tm-green, #16a34a); }
    .pill.neutral { background: var(--tm-canvas-2, #eaeef4); color: var(--tm-text-muted); } .pill.neutral .led { background: var(--tm-text-soft, #94a0ad); }

    .farelink { padding: 4px 10px; border: 1px dashed var(--tm-line-2, #e2e6ec); border-radius: 8px; background: var(--tm-surface); color: var(--tm-text-soft, #94a0ad); font: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; }
    .farelink:hover { border-color: var(--tm-green, #16a34a); color: var(--tm-green, #16a34a); border-style: solid; }
    .farelink.set { border-style: solid; border-color: var(--tm-line); color: var(--tm-text); }
    .farelink.set:hover { border-color: var(--tm-green, #16a34a); color: var(--tm-green, #16a34a); }

    .gchips { display: inline-flex; gap: 5px; flex-wrap: wrap; }
    .gchip { padding: 3px 9px; border: 0; border-radius: 999px; background: var(--tm-info-bg, #dbeafe); color: var(--tm-info-fg, #1e40af); font: inherit; font-size: 11px; font-weight: 800; cursor: pointer; }
    .gchip.more { background: var(--tm-canvas-2, #eaeef4); color: var(--tm-text-muted); }
    .addlink { padding: 3px 4px; border: 0; background: transparent; color: var(--tm-text-soft, #94a0ad); font: inherit; font-size: 12px; font-weight: 700; font-style: italic; cursor: pointer; }
    .addlink:hover { color: var(--tm-green, #16a34a); }
    .linkcell { border: 0; background: transparent; color: var(--tm-green, #16a34a); font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; }
    .linkcell:hover { text-decoration: underline; }
    .muted-link { color: var(--tm-text-soft, #94a0ad); font-style: italic; }

    .avstack { display: inline-flex; align-items: center; }
    .av2 { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: var(--tm-green-tint, #ecfdf5); color: var(--tm-green, #16a34a); font-size: 9px; font-weight: 800; border: 2px solid var(--tm-surface); margin-left: -7px; }
    .av2:first-child { margin-left: 0; }
    .av2.more { background: var(--tm-canvas-2, #eaeef4); color: var(--tm-text-muted); }

    .setup { display: flex; align-items: center; gap: 8px; justify-content: center; }
    .setup .bar { width: 56px; height: 6px; border-radius: 999px; background: var(--tm-canvas-2, #eaeef4); overflow: hidden; }
    .setup .bar i { display: block; height: 100%; border-radius: 999px; background: var(--tm-green, #16a34a); }
    .setup .pc { font-size: 12px; font-weight: 800; color: var(--tm-text); }
    .kebab { width: 30px; height: 30px; border: 0; border-radius: 8px; background: transparent; display: grid; place-items: center; color: var(--tm-text-soft, #94a0ad); cursor: pointer; }
    .kebab:hover { background: var(--tm-canvas-2, #eaeef4); color: var(--tm-text); }

    .addrow td { padding: 0; }
    .addbtn { display: flex; align-items: center; gap: 8px; width: 100%; padding: 12px 16px; border: 0; background: var(--tm-surface); color: var(--tm-text-muted); font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
    .addbtn:hover:not(:disabled) { background: var(--tm-green-tint, #ecfdf5); color: var(--tm-green, #16a34a); }
    .addbtn:disabled { opacity: .5; cursor: default; }

    /* detail row */
    .detailrow td { background: var(--tm-canvas) !important; padding: 0; }
    .detailwrap { position: sticky; left: var(--frz1); width: calc(100vw - var(--tm-sidebar-w, 264px) - 120px); max-width: 1160px; padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 10px; }
    .detailhead { display: flex; align-items: center; gap: 8px; }
    .ovl { font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: var(--tm-text-soft, #94a0ad); }
    .gline { display: grid; grid-template-columns: 210px 1fr; gap: 8px 18px; align-items: start; padding: 14px 16px; background: var(--tm-surface); border: 1px solid var(--tm-line); border-radius: 12px; }
    .gline--orphan { border-color: #fce4a6; }
    .gline__head { grid-column: 1; grid-row: 1 / span 2; display: flex; flex-direction: column; gap: 4px; padding-right: 16px; border-right: 1px solid var(--tm-line); }
    .gline__acts { display: flex; gap: 6px; margin-top: 4px; }
    .gname { font-size: 14px; font-weight: 800; color: var(--tm-text); }
    .gmeta { font-size: 11px; color: var(--tm-text-muted); font-weight: 600; }
    .gmeta.warn { color: #9a6a11; }
    .gcol { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
    .gcol__lbl { flex: none; width: 52px; padding-top: 5px; font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: var(--tm-text-soft, #94a0ad); }
    .gcol__body { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-width: 0; }
    .rchip2 { display: inline-flex; align-items: center; gap: 5px; padding: 4px 5px 4px 9px; border-radius: 8px; background: var(--tm-green-tint, #ecfdf5); color: var(--tm-green, #16a34a); font-size: 12px; font-weight: 700; }
    .rchip2 b { font-weight: 700; }
    .rchip2.warn { background: #fef3c7; color: #b45309; padding: 4px 8px; }
    .rchip2 .rx { width: 16px; height: 16px; border: 0; border-radius: 5px; display: grid; place-items: center; background: transparent; color: inherit; font-size: 14px; line-height: 1; cursor: pointer; opacity: .55; }
    .rchip2 .rx:hover { opacity: 1; background: rgba(0,0,0,.08); }
    .rchip2 .rx.add { font-size: 15px; }
    .rchip2--edit { padding-left: 4px; background: var(--tm-canvas-2, #eef1f5); color: var(--tm-text); }
    .rchip2__edit { display: inline-flex; align-items: center; gap: 5px; border: 0; background: transparent; color: inherit; font: inherit; font-size: 12px; font-weight: 700; padding: 2px 5px; border-radius: 6px; cursor: pointer; }
    .rchip2__edit b { font-weight: 700; }
    .rchip2__edit:hover { background: rgba(0,0,0,.06); color: var(--tm-green, #16a34a); }
    .dpill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 6px 3px 3px; border-radius: 999px; background: var(--tm-canvas-2, #eaeef4); font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .dpill .rx { width: 15px; height: 15px; border: 0; border-radius: 5px; background: transparent; color: var(--tm-text-muted); font-size: 13px; line-height: 1; cursor: pointer; opacity: .6; }
    .dpill .rx:hover { opacity: 1; background: rgba(0,0,0,.08); }
    .addroutebtn { display: inline-flex; align-items: center; gap: 5px; padding: 5px 11px; border: 1px dashed var(--tm-line-2, #e2e6ec); border-radius: 8px; background: var(--tm-surface); color: var(--tm-text-muted); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
    .addroutebtn:hover { border-color: var(--tm-green, #16a34a); color: var(--tm-green, #16a34a); background: var(--tm-green-tint, #ecfdf5); border-style: solid; }
    .emptybox { padding: 16px; border: 1px dashed var(--tm-line-2, #e2e6ec); border-radius: 12px; background: var(--tm-surface); color: var(--tm-text-muted); font-size: 12.5px; text-align: center; }

    /* row kebab menu */
    .menu-scrim { position: fixed; inset: 0; z-index: 70; }
    .rowmenu { position: fixed; z-index: 71; min-width: 210px; padding: 6px; background: var(--tm-surface); border: 1px solid var(--tm-line); border-radius: 12px; box-shadow: var(--tm-shadow-pop, 0 12px 40px -16px rgba(15,20,25,.25)); display: flex; flex-direction: column; gap: 2px; }
    .rowmenu button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 11px; border: 0; border-radius: 9px; background: transparent; color: var(--tm-text); font: inherit; font-size: 13px; font-weight: 600; text-align: left; cursor: pointer; }
    .rowmenu button:hover { background: var(--tm-canvas); }
    .rowmenu__div { height: 1px; margin: 5px 0; background: var(--tm-line); }

    @media (max-width: 940px) {
      .split { grid-template-columns: 1fr; }
      .is-hidden-sm { display: none; }
      .backlink { display: inline-flex; }
    }
    @media (max-width: 860px) {
      .cards { grid-template-columns: 1fr; }
    }
    @media (max-width: 620px) {
      .rt { grid-template-columns: 1fr auto auto; }
      .rt__col--sm { display: none; }
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
  // Seat-layout designer drawer (opens over the workspace, no page nav).
  layoutDrawerOpen = false;
  editingLayoutId: number | null = null;
  editingLayout: VehicleSeatLayout | null = null;
  selGroups: GroupRow[] = [];
  ungrouped: RouteLite[] = [];
  // Route-group search + pagination, derived from selGroups in recompute().
  filteredGroups: GroupRow[] = [];
  pagedGroups: GroupRow[] = [];
  groupSearch = '';
  groupPage = 1;
  readonly groupPageSize = 6;
  groupPages = 1;

  search = '';
  status: CityVehicleStatus = 'all';
  typeFilter = 'all';
  /** Filter to a single vehicle by display name ('all' = every vehicle). */
  vehicleFilter = 'all';
  /** Which custom filter dropdown is open (drivers-page style). */
  filterOpen: 'type' | 'vehicle' | null = null;
  readonly statusChips: { label: string; value: CityVehicleStatus }[] = [
    { label: 'All statuses', value: 'all' },
    { label: 'Enabled', value: 'enabled' },
    { label: 'Disabled', value: 'disabled' },
  ];

  common = { display_name: '', max_people: 1, luggage_capacity: 0, is_active: true };
  savingCommon = false;
  savingActive = false;
  reverseBidding = false;
  savingUnique = false;
  creatingRideTypeId: number | null = null;
  /** vehicle+ride-type keys we've already tried to auto-create, so a failed
   *  create can never loop into duplicate rows on the next recompute. */
  private autoFareAttempted = new Set<string>();

  createOpen = false;
  creating = false;
  create = this.blankCreate();

  typesOpen = false;
  typeSaving = false;
  editingTypeId: number | null = null;
  typeForm = { name: '', is_active: true };

  // Common setup now lives in a right-side drawer opened by the row pen icon.
  commonDrawerOpen = false;
  commonDrawerVehicle: CityVehicleRow | null = null;

  // ── spreadsheet UI state ───────────────────────────────────
  /** Vehicles whose route-group detail row is expanded. */
  expanded: Record<number, boolean> = {};
  /** Checked rows for the bulk action bar. */
  selectedIds = new Set<number>();
  /** In-place cell edit (name / seats / bags). */
  editId: number | null = null;
  editField: '' | 'name' | 'seats' | 'bags' = '';
  editValue = '';
  savingCell = false;
  /** Floating row kebab menu. */
  menuId: number | null = null;
  menuX = 0;
  menuY = 0;
  /** Fare editor drawer — hosts app-vehicle-base-pricing for one vehicle+ride type. */
  fareDrawerOpen = false;
  /** Seat-layouts list drawer. */
  layoutsListOpen = false;

  /** Ride types that own a fare column (everything except the fixed one). */
  get fareRideTypes(): RideTypeRef[] { return this.rideTypes.filter((rt) => this.kindOf(rt.name) !== 'fixed'); }
  /** Columns after the gutter — used for the detail row + footer colspans. */
  get detailColspan(): number { return 9 + this.fareRideTypes.length; }
  /** Distinct vehicle names for the vehicle filter dropdown. */
  get vehicleNames(): string[] {
    return Array.from(new Set(this.vehicles.map((v) => v.display_name))).sort((a, b) => a.localeCompare(b));
  }
  get menuVehicle(): CityVehicleRow | null { return this.vehicles.find((v) => v.id === this.menuId) ?? null; }

  groupOpen = false;
  groupSaving = false;
  groupName = '';
  renamingId: number | null = null;
  renameValue = '';

  // ── Unified Group Drawer state & methods ──────────────────────────
  unifiedDrawerOpen = false;
  editingGroup: GroupRow | null = null;
  targetVehicleForGroup: CityVehicleRow | null = null;
  unifiedForm: {
    group_ids: number[];
    edit_group_name: string;
    new_group_name: string;
    is_creating_group: boolean;
    route_ids: number[];
    driver_user_ids: number[];
  } = {
    group_ids: [],
    edit_group_name: '',
    new_group_name: '',
    is_creating_group: false,
    route_ids: [],
    driver_user_ids: [],
  };
  savingUnifiedGroup = false;

  openUnifiedGroupDrawer(v: CityVehicleRow, g?: GroupRow): void {
    this.targetVehicleForGroup = v;
    this.editingGroup = g ?? null;
    const vGroups = this.groupsForVehicle(v);

    if (g) {
      this.unifiedForm = {
        group_ids: [g.id],
        edit_group_name: g.name,
        new_group_name: '',
        is_creating_group: false,
        route_ids: [...g.route_ids],
        driver_user_ids: [...g.driver_user_ids],
      };
    } else {
      const allGroupIds = vGroups.map((x) => x.id);
      const allRouteIds = Array.from(new Set(vGroups.flatMap((x) => x.route_ids)));
      const allDriverIds = Array.from(new Set(vGroups.flatMap((x) => x.driver_user_ids)));
      this.unifiedForm = {
        group_ids: allGroupIds,
        edit_group_name: '',
        new_group_name: '',
        is_creating_group: !vGroups.length,
        route_ids: allRouteIds,
        driver_user_ids: allDriverIds,
      };
    }
    this.unifiedDrawerOpen = true;
  }

  toggleUnifiedGroup(groupId: number): void {
    const idx = this.unifiedForm.group_ids.indexOf(groupId);
    if (idx >= 0) {
      this.unifiedForm.group_ids.splice(idx, 1);
    } else {
      this.unifiedForm.group_ids.push(groupId);
    }
    const selectedGroups = this.groups.filter((g) => this.unifiedForm.group_ids.includes(g.id));
    if (selectedGroups.length > 0) {
      this.unifiedForm.route_ids = Array.from(new Set(selectedGroups.flatMap((g) => g.route_ids)));
      this.unifiedForm.driver_user_ids = Array.from(new Set(selectedGroups.flatMap((g) => g.driver_user_ids)));
    }
  }

  toggleUnifiedRoute(routeId: number): void {
    const idx = this.unifiedForm.route_ids.indexOf(routeId);
    if (idx >= 0) {
      this.unifiedForm.route_ids.splice(idx, 1); // removing is always allowed
    } else {
      if (!this.routeIsGroupable(routeId)) return;
      this.unifiedForm.route_ids.push(routeId);
    }
  }

  toggleUnifiedDriver(userId: number): void {
    const idx = this.unifiedForm.driver_user_ids.indexOf(userId);
    if (idx >= 0) {
      this.unifiedForm.driver_user_ids.splice(idx, 1);
    } else {
      this.unifiedForm.driver_user_ids.push(userId);
    }
  }

  get availableGroupsForUnifiedDrawer(): GroupRow[] {
    const v = this.targetVehicleForGroup;
    if (!v) return [];
    const forVehicle = this.groupsForVehicle(v);
    // Also surface stray legacy groups (unbound + route-less) so they stay
    // reachable to rebind or delete — saving here binds them to this vehicle.
    const seen = new Set(forVehicle.map((g) => g.id));
    const strays = this.groups.filter(
      (g) => g.city_vehicle_type_id == null && !g.route_ids.length && !seen.has(g.id),
    );
    return [...forVehicle, ...strays];
  }

  get availableRoutesForUnifiedDrawer(): RouteLite[] {
    const v = this.targetVehicleForGroup;
    if (!v) return this.routes;
    return this.routesForVehicle(v);
  }

  get availableDriversForUnifiedDrawer(): DriverOpt[] {
    const v = this.targetVehicleForGroup;
    if (!v) return this.cityDrivers;
    // Match by the car's vehicle TYPE, not the exact per-service row. One physical
    // car (e.g. Swift Dzire) is stored as separate Private/Shuttle/Fixed rows, so a
    // driver bound to any of them must still be assignable to this car's route
    // groups — otherwise a Fixed driver bound to the Private row is invisible here.
    return this.cityDrivers.filter((d) =>
      d.city_vehicle_type_id === v.id ||
      (d.vehicle_type_id != null && d.vehicle_type_id === v.vehicle_type_id));
  }

  saveUnifiedGroup(): void {
    if (this.cityId == null || this.savingUnifiedGroup) return;

    const targetGroupIds = [...this.unifiedForm.group_ids];
    const newName = this.unifiedForm.new_group_name.trim();

    if (!targetGroupIds.length && (!this.unifiedForm.is_creating_group || !newName)) {
      this.toast.error('Select at least one group or enter a new group name');
      return;
    }

    this.savingUnifiedGroup = true;

    const syncGroups = (gIds: number[]) => {
      if (!gIds.length) {
        this.savingUnifiedGroup = false;
        this.unifiedDrawerOpen = false;
        this.toast.success('Saved successfully');
        this.loadGroups();
        return;
      }

      let done = 0;
      gIds.forEach((id) => {
        const existingGroup = this.groups.find((g) => g.id === id);
        let name = existingGroup ? existingGroup.name : newName;
        if (this.editingGroup && this.editingGroup.id === id && this.unifiedForm.edit_group_name.trim()) {
          name = this.unifiedForm.edit_group_name.trim();
        }
        this.api.patch(`/admin/cities/${this.cityId}/route-groups/${id}`, {
          name,
          route_ids: this.unifiedForm.route_ids,
          // Managing a group under a vehicle binds it to that vehicle — this also
          // rescues stray/legacy unbound groups the moment they're saved here.
          city_vehicle_type_id: this.targetVehicleForGroup?.id ?? null,
        }).subscribe({
          next: () => {
            this.api.put(`/admin/cities/${this.cityId}/route-groups/${id}/drivers`, {
              driver_user_ids: this.unifiedForm.driver_user_ids,
            }).subscribe({
              next: () => {
                done++;
                if (done === gIds.length) {
                  this.savingUnifiedGroup = false;
                  this.unifiedDrawerOpen = false;
                  this.toast.success('Assignments saved');
                  this.loadGroups();
                }
              },
              error: () => {
                done++;
                if (done === gIds.length) {
                  this.savingUnifiedGroup = false;
                  this.unifiedDrawerOpen = false;
                  this.loadGroups();
                }
              },
            });
          },
          error: () => {
            done++;
            if (done === gIds.length) {
              this.savingUnifiedGroup = false;
              this.unifiedDrawerOpen = false;
              this.loadGroups();
            }
          },
        });
      });
    };

    if (this.unifiedForm.is_creating_group && newName) {
      this.api.post<{ route_group: GroupRow }>(`/admin/cities/${this.cityId}/route-groups`, {
        name: newName,
        route_ids: this.unifiedForm.route_ids,
        city_vehicle_type_id: this.targetVehicleForGroup?.id ?? null,
      }).subscribe({
        next: (res) => {
          const newId = res?.route_group?.id;
          if (newId) {
            targetGroupIds.push(newId);
          }
          syncGroups(targetGroupIds);
        },
        error: (err) => {
          this.savingUnifiedGroup = false;
          this.toast.error(err?.error?.message || 'Could not create new group');
        },
      });
    } else {
      syncGroups(targetGroupIds);
    }
  }

  quickAssignRoute(routeId: number, event: Event): void {
    const select = event.target as HTMLSelectElement;
    const groupId = Number(select.value);
    if (!groupId) return;
    const g = this.groups.find((x) => x.id === groupId);
    if (!g) return;
    this.assignRouteToGroup(routeId, g);
    select.value = '';
  }

  // Route-group pickers now open as side drawers. Each holds the id of its
  // target so the drawer content stays live across a reload (the group/route
  // objects are replaced on every load; ids are stable).
  driverDrawerId: number | null = null;
  routeDrawerId: number | null = null;
  assignDrawerRouteId: number | null = null;
  movePickFor: number | null = null;
  savingDriverId: number | null = null;
  /** Staged driver selection for the group-drivers drawer (committed on Save). */
  pendingDriverIds: number[] = [];
  savingGroupDrivers = false;

  get driverDrawerGroup(): GroupRow | null { return this.groups.find((g) => g.id === this.driverDrawerId) ?? null; }
  get routeDrawerGroup(): GroupRow | null { return this.groups.find((g) => g.id === this.routeDrawerId) ?? null; }
  get assignDrawerRoute(): RouteLite | null { return this.routes.find((r) => r.id === this.assignDrawerRouteId) ?? null; }

  get routesForRouteDrawer(): RouteLite[] {
    const g = this.routeDrawerGroup;
    if (!g) return [];
    const sampleRoute = this.routes.find((r) => g.route_ids.includes(r.id));
    const vehicleId = sampleRoute?.city_vehicle_type_id ?? this.selectedId;
    const vRoutes = vehicleId
      ? this.routes.filter((r) => r.city_vehicle_type_id === vehicleId)
      : this.routes;
    const alreadyInThisGroup = new Set<number>(g.route_ids);
    return vRoutes.filter((r) => !alreadyInThisGroup.has(r.id));
  }

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
      if (this.vehicleFilter !== 'all' && v.display_name !== this.vehicleFilter) return false;
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

  // ── custom filter dropdowns (match the Drivers page's state-select) ─────────
  get typeFilterLabel(): string {
    if (this.typeFilter === 'all') return 'All types';
    return this.types.find((t) => String(t.id) === this.typeFilter)?.name ?? 'All types';
  }
  get vehicleFilterLabel(): string { return this.vehicleFilter === 'all' ? 'All vehicles' : this.vehicleFilter; }

  toggleFilter(which: 'type' | 'vehicle', ev: Event): void {
    ev.stopPropagation();
    this.menuId = null;
    this.filterOpen = this.filterOpen === which ? null : which;
  }
  setTypeFilter(value: string): void { this.typeFilter = value; this.filterOpen = null; this.applyView(); }
  setVehicleFilter(value: string): void { this.vehicleFilter = value; this.filterOpen = null; this.applyView(); }

  /** True when any of search / status / type / vehicle is narrowing the list. */
  get hasActiveFilters(): boolean {
    return this.search.trim() !== '' || this.status !== 'all' || this.typeFilter !== 'all' || this.vehicleFilter !== 'all';
  }
  /** Reset every filter to its default and re-render the full list. */
  clearAllFilters(): void {
    this.search = '';
    this.status = 'all';
    this.typeFilter = 'all';
    this.vehicleFilter = 'all';
    this.filterOpen = null;
    this.applyView();
  }

  /** Close the open filter dropdown on any outside click. */
  @HostListener('document:click')
  onDocumentClick(): void { this.filterOpen = null; }

  /** Rebuilds every per-selection slice in one pass. */
  private recompute(): void {
    const v = this.vehicles.find((x) => x.id === this.selectedId) ?? null;
    this.selected = v;

    const covered = new Set<number>(this.groups.flatMap((g) => g.route_ids));
    this.ungrouped = this.routes.filter((r) => !covered.has(r.id));

    if (!v) {
      this.tabList = []; this.activeRideType = null; this.activeRow = null;
      this.selDrivers = []; this.otherDrivers = []; this.selLayouts = []; this.selGroups = [];
      this.applyGroupView();
      return;
    }

    const myRoutes = this.routes.filter((r) => r.city_vehicle_type_id === v.id);
    const myRouteIds = new Set(myRoutes.map((r) => r.id));
    this.selGroups = this.groups.filter((g) => g.route_ids.some((id) => myRouteIds.has(id)));
    this.applyGroupView();
    this.selDrivers = this.cityDrivers.filter((d) => d.city_vehicle_type_id === v.id);
    this.otherDrivers = this.cityDrivers.filter((d) =>
      d.city_vehicle_type_id !== v.id && (d.vehicle_type_id == null || d.vehicle_type_id === v.vehicle_type_id));
    this.selLayouts = v.vehicle_type_id == null ? [] : this.layouts.filter((l) => l.vehicle_type_id === v.vehicle_type_id);

    // Tabs: one per ride type using its DB name, then Seat layouts. (Common
    // setup moved to a per-row drawer opened by the pen icon in the list.)
    this.tabList = [
      ...this.rideTypes.map((rt) => ({
        key: 'mode:' + rt.id,
        label: rt.name,
        count: this.kindOf(rt.name) === 'fixed' ? myRoutes.length : undefined,
      })),
      { key: 'layouts', label: 'Seat layouts', count: this.selLayouts.length },
    ];

    // A tab remembered for this vehicle may no longer exist (ride type removed).
    if (!this.tabList.some((t) => t.key === this.tab)) this.tab = this.tabList[0]?.key ?? '';

    this.syncActiveMode();
  }

  /** Filter + page the route groups for the current search and page. */
  private applyGroupView(): void {
    const q = this.groupSearch.trim().toLowerCase();
    this.filteredGroups = q
      ? this.selGroups.filter((g) => g.name.toLowerCase().includes(q))
      : this.selGroups;

    this.groupPages = Math.max(1, Math.ceil(this.filteredGroups.length / this.groupPageSize));
    if (this.groupPage > this.groupPages) this.groupPage = this.groupPages;
    const start = (this.groupPage - 1) * this.groupPageSize;
    this.pagedGroups = this.filteredGroups.slice(start, start + this.groupPageSize);
  }

  onGroupSearch(): void { this.groupPage = 1; this.applyGroupView(); }
  setGroupPage(p: number): void { this.groupPage = Math.min(Math.max(1, p), this.groupPages); this.applyGroupView(); }

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
      ? ''
      : 'Fare card used by the current customer and driver flow.';

    // A non-fixed ride type with no fare row yet: create it automatically so the
    // fare form is shown directly instead of a "create fare" button. Guarded so
    // it runs at most once per vehicle+ride-type and never while data is loading.
    if (!this.activeIsFixed && !this.activeRow && !this.loading && this.creatingRideTypeId == null) {
      const attemptKey = key + ':' + id;
      if (!this.autoFareAttempted.has(attemptKey)) {
        this.autoFareAttempted.add(attemptKey);
        this.createFareSetup(this.activeRideType, true);
      }
    }
  }

  select(v: CityVehicleRow): void {
    this.selectedId = v.id;
    this.mobileEditor = true;
    this.driverDrawerId = null;
    this.routeDrawerId = null;
    this.assignDrawerRouteId = null;
    this.movePickFor = null;
    this.renamingId = null;
    this.tab = this.tabByVehicle.get(v.id) ?? '';
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
  /**
   * Opens the common-setup drawer for a vehicle straight from the list pen icon.
   * Selects the vehicle first so `common` and the sibling set `saveCommon` patches
   * are loaded, then shows the drawer. Stops the click from also toggling the row.
   */
  openCommonDrawer(v: CityVehicleRow, ev?: Event): void {
    ev?.stopPropagation();
    this.select(v);
    this.commonDrawerVehicle = v;
    this.commonDrawerOpen = true;
  }

  closeCommonDrawer(): void {
    this.commonDrawerOpen = false;
    this.commonDrawerVehicle = null;
  }

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
      next: () => { this.savingCommon = false; this.commonDrawerOpen = false; this.commonDrawerVehicle = null; this.toast.success('City vehicle saved'); this.load(); },
      error: (err) => { this.savingCommon = false; this.toast.error(err?.error?.message || 'Failed to save city vehicle'); },
    });
  }

  /**
   * Enable / disable the vehicle straight from the header. Persists immediately
   * (no Save needed) by patching is_active on every mode row that shares this
   * name + type, the same set Save touches. Optimistic: the pill flips at once
   * and rolls back on error.
   */
  toggleActive(): void {
    const v = this.selected;
    if (!v || this.cityId == null || this.savingActive) return;
    const next = !v.is_active;
    const key = this.groupKey(v);
    const siblings = this.rows.filter((r) => this.groupKey(r) === key);

    this.savingActive = true;
    v.is_active = next;
    this.common.is_active = next;
    forkJoin(siblings.map((r) => this.api.patch(`/admin/cities/${this.cityId}/vehicle-types/${r.id}`, { is_active: next }))).subscribe({
      next: () => {
        this.savingActive = false;
        this.toast.success(next ? `${v.display_name} enabled` : `${v.display_name} disabled`);
        this.load();
      },
      error: (err) => {
        this.savingActive = false;
        v.is_active = !next;
        this.common.is_active = !next;
        this.toast.error(err?.error?.message || 'Could not update availability');
      },
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
  createFareSetup(rt: RideTypeRef, silent = false): void {
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
        if (!silent) this.toast.success(res.message || `${rt.name} fare setup created`);
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

  /** Opens the map editor for a route shown in a group card.
   *  Accepts either a `RouteLite` or a numeric id; optional MouseEvent stops propagation.
   */
  editRoute(arg: RouteLite | number, ev?: MouseEvent): void {
    ev?.stopPropagation();
    const id = typeof arg === 'number' ? arg : arg.id;
    this.fixedRoutes?.openEditById(id);
  }

  /** A route can only join a group once it has a price. Warns + blocks otherwise —
   *  an unpriced route ("Needs pricing") can't be run, so it isn't assignable yet. */
  private routeIsGroupable(routeId: number): boolean {
    const r = this.routes.find((x) => x.id === routeId);
    if (r && r.flat_fare == null) {
      this.toast.warning(`“${r.name}” isn’t assignable yet — add a price to the route first.`);
      return false;
    }
    return true;
  }

  /** Assign an ungrouped route into an existing group from the holding card.
   *  The route leaves the "Needs a group" list, so the drawer closes. */
  assignRouteToGroup(routeId: number, g: GroupRow): void {
    if (!this.routeIsGroupable(routeId)) return;
    this.assignDrawerRouteId = null;
    this.saveGroupRoutes(g, [...g.route_ids, routeId], 'Route added to ' + g.name);
  }

  openAssignDrawer(r: RouteLite): void {
    if (!this.routeIsGroupable(r.id)) return;
    this.assignDrawerRouteId = r.id;
  }
  openRouteDrawer(g: GroupRow): void { this.routeDrawerId = g.id; }

  /** Seed the checklist from the group's current drivers so it opens pre-ticked. */
  openDriverDrawer(g: GroupRow): void {
    this.driverDrawerId = g.id;
    this.pendingDriverIds = [...g.driver_user_ids];
  }

  togglePendingDriver(userId: number): void {
    this.pendingDriverIds = this.pendingDriverIds.includes(userId)
      ? this.pendingDriverIds.filter((id) => id !== userId)
      : [...this.pendingDriverIds, userId];
  }

  /** Commit the whole selection at once, replacing the group's driver set. */
  commitDrawerDrivers(): void {
    const g = this.driverDrawerGroup;
    if (!g || this.cityId == null || this.savingGroupDrivers) return;
    this.savingGroupDrivers = true;
    this.api.put(`/admin/cities/${this.cityId}/route-groups/${g.id}/drivers`, { driver_user_ids: this.pendingDriverIds }).subscribe({
      next: () => { this.savingGroupDrivers = false; this.driverDrawerId = null; this.toast.success('Group drivers updated'); this.loadGroups(); },
      error: (err) => { this.savingGroupDrivers = false; this.toast.error(err?.error?.message || 'Could not update drivers'); },
    });
  }

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
    this.api.post(`/admin/cities/${this.cityId}/route-groups`, {
      name: this.groupName.trim(),
      city_vehicle_type_id: this.selected?.id ?? null,
    }).subscribe({
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
    if (!this.routeIsGroupable(routeId)) return;
    this.saveGroupRoutes(g, [...g.route_ids, routeId], 'Route added to ' + g.name);
  }

  ungroupRoute(g: GroupRow, routeId: number): void {
    this.saveGroupRoutes(g, g.route_ids.filter((id) => id !== routeId), 'Route removed from ' + g.name);
  }

  /**
   * Optimistic write: apply the new route set to the local state first so the
   * card updates the instant the button is pressed, then persist. Reload on
   * either outcome to reconcile — on error that rolls the optimistic change back.
   */
  private saveGroupRoutes(g: GroupRow, routeIds: number[], message: string): void {
    if (this.cityId == null) return;
    g.route_ids = routeIds;
    this.recompute();
    this.api.patch(`/admin/cities/${this.cityId}/route-groups/${g.id}`, { name: g.name, route_ids: routeIds }).subscribe({
      next: () => { this.toast.success(message); this.loadGroups(); },
      error: (err) => { this.toast.error(err?.error?.message || 'Could not save group'); this.loadGroups(); },
    });
  }

  addDriverToGroup(g: GroupRow, userId: number): void { this.saveGroupDrivers(g, [...g.driver_user_ids, userId]); }
  removeDriverFromGroup(g: GroupRow, userId: number): void { this.saveGroupDrivers(g, g.driver_user_ids.filter((id) => id !== userId)); }

  /** Optimistic, same as saveGroupRoutes — the chip disappears immediately. */
  private saveGroupDrivers(g: GroupRow, driverIds: number[]): void {
    if (this.cityId == null) return;
    g.driver_user_ids = driverIds;
    this.recompute();
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
    this.editingLayoutId = null;
    this.editingLayout = null;
    this.layoutDrawerOpen = true;
  }

  editLayout(l: VehicleSeatLayout): void {
    this.editingLayoutId = l.id;
    this.editingLayout = l;
    this.layoutDrawerOpen = true;
  }

  closeLayoutDrawer(): void {
    this.layoutDrawerOpen = false;
    this.editingLayoutId = null;
    this.editingLayout = null;
  }

  onLayoutSaved(): void {
    this.closeLayoutDrawer();
    this.load();
  }

  deleteLayout(l: VehicleSeatLayout): void {
    if (this.cityId == null || l.in_use) return;
    if (!confirm(`Delete layout "${l.name}"? This cannot be undone.`)) return;
    this.layoutsSvc.destroy(this.cityId, l.id).subscribe({
      next: () => { this.toast.success('Layout deleted'); this.load(); },
      error: (err) => this.toast.error(err?.error?.message || 'Failed to delete layout'),
    });
  }

  // ── spreadsheet interactions ───────────────────────────────
  isExpanded(v: CityVehicleRow): boolean { return !!this.expanded[v.id]; }

  /** Expand/collapse a vehicle's route-group detail row. Expanding selects the
   *  vehicle so `selected` (and the embedded map editor) bind to it. */
  toggleExpand(v: CityVehicleRow, ev?: Event): void {
    ev?.stopPropagation();
    const open = !this.expanded[v.id];
    // Accordion: only one vehicle's route-group detail is open at a time.
    this.expanded = open ? { [v.id]: true } : {};
    if (open) this.select(v);
  }

  // selection + bulk
  isSel(v: CityVehicleRow): boolean { return this.selectedIds.has(v.id); }
  toggleSel(v: CityVehicleRow, ev?: Event): void {
    ev?.stopPropagation();
    if (this.selectedIds.has(v.id)) this.selectedIds.delete(v.id); else this.selectedIds.add(v.id);
  }
  get allSelected(): boolean { return this.visible.length > 0 && this.visible.every((v) => this.selectedIds.has(v.id)); }
  toggleSelectAll(): void {
    if (this.allSelected) this.selectedIds.clear();
    else this.visible.forEach((v) => this.selectedIds.add(v.id));
  }
  clearSel(): void { this.selectedIds.clear(); }

  /** Enable/disable every checked vehicle by patching each one's sibling rows. */
  bulkSetActive(active: boolean): void {
    if (this.cityId == null || !this.selectedIds.size) return;
    const keys = new Set(
      [...this.selectedIds].map((id) => this.vehicles.find((x) => x.id === id)).filter(Boolean).map((v) => this.groupKey(v as CityVehicleRow)),
    );
    const targets = this.rows.filter((r) => keys.has(this.groupKey(r)));
    const n = this.selectedIds.size;
    forkJoin(targets.map((r) => this.api.patch(`/admin/cities/${this.cityId}/vehicle-types/${r.id}`, { is_active: active }))).subscribe({
      next: () => { this.toast.success(`${n} ${n === 1 ? 'vehicle' : 'vehicles'} ${active ? 'enabled' : 'disabled'}`); this.clearSel(); this.load(); },
      error: (err) => this.toast.error(err?.error?.message || 'Bulk update failed'),
    });
  }

  /** Client-side CSV of the checked vehicles. */
  bulkExport(): void {
    const ids = new Set(this.selectedIds);
    const rows = this.vehicles.filter((v) => ids.has(v.id));
    const header = ['Vehicle', 'Type', 'Status', 'Seats', 'Bags', 'Fare modes'];
    const body = rows.map((v) => [v.display_name, v.vehicle_type_name || '', v.is_active ? 'Enabled' : 'Disabled', v.max_people, v.luggage_capacity, this.fareModesLabel(v)]);
    const csv = [header, ...body].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'vehicles.csv'; a.click();
    URL.revokeObjectURL(url);
    this.toast.success(`Exported ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`);
  }

  // inline cell edit — name / seats / bags patch every sibling mode row
  isEditing(v: CityVehicleRow, field: string): boolean { return this.editId === v.id && this.editField === field; }
  startCellEdit(v: CityVehicleRow, field: 'name' | 'seats' | 'bags', ev?: Event): void {
    ev?.stopPropagation();
    this.editId = v.id; this.editField = field;
    this.editValue = field === 'name' ? v.display_name : String(field === 'seats' ? v.max_people : v.luggage_capacity);
  }
  cancelCellEdit(): void { this.editId = null; this.editField = ''; this.editValue = ''; }
  commitCellEdit(v: CityVehicleRow): void {
    const field = this.editField;
    if (!field || this.cityId == null) { this.cancelCellEdit(); return; }
    let payload: Record<string, unknown> | null = null;
    if (field === 'name') { const name = this.editValue.trim(); if (name && name !== v.display_name) payload = { display_name: name }; }
    else if (field === 'seats') { const num = Math.max(1, Math.round(+this.editValue) || v.max_people); if (num !== v.max_people) payload = { max_people: num }; }
    else { const num = Math.max(0, Math.round(+this.editValue) || 0); if (num !== v.luggage_capacity) payload = { luggage_capacity: num }; }
    this.cancelCellEdit();
    if (!payload) return;
    const key = this.groupKey(v);
    const siblings = this.rows.filter((r) => this.groupKey(r) === key);
    this.savingCell = true;
    forkJoin(siblings.map((r) => this.api.patch(`/admin/cities/${this.cityId}/vehicle-types/${r.id}`, payload))).subscribe({
      next: () => { this.savingCell = false; this.toast.success('Saved'); this.load(); },
      error: (err) => { this.savingCell = false; this.toast.error(err?.error?.message || 'Could not save'); },
    });
  }

  /** Per-row status toggle from the spreadsheet pill. */
  toggleActiveFor(v: CityVehicleRow, ev?: Event): void {
    ev?.stopPropagation();
    this.select(v);
    this.toggleActive();
  }

  // per-vehicle slices for the spreadsheet (independent of `selected`, so several
  // detail rows can be open at once and still read correctly)
  routesForVehicle(v: CityVehicleRow): RouteLite[] { return this.routes.filter((r) => r.city_vehicle_type_id === v.id); }
  groupsForVehicle(v: CityVehicleRow): GroupRow[] {
    const mine = new Set(this.routesForVehicle(v).map((r) => r.id));
    return this.groups.filter((g) => {
      // Bound groups belong to exactly one vehicle — shown there even when empty.
      if (g.city_vehicle_type_id != null) return g.city_vehicle_type_id === v.id;
      // Legacy unbound groups fall back to route ownership only; a route-less
      // unbound group belongs to no vehicle (it no longer leaks onto every row).
      return g.route_ids.some((id) => mine.has(id));
    });
  }
  ungroupedForVehicle(v: CityVehicleRow): RouteLite[] {
    const covered = new Set(this.groups.flatMap((g) => g.route_ids));
    return this.routesForVehicle(v).filter((r) => !covered.has(r.id));
  }
  driversFor(v: CityVehicleRow): DriverOpt[] { return this.cityDrivers.filter((d) => d.city_vehicle_type_id === v.id); }
  layoutCountFor(v: CityVehicleRow): number { return v.vehicle_type_id == null ? 0 : this.layouts.filter((l) => l.vehicle_type_id === v.vehicle_type_id).length; }

  /** Setup completeness: type, a fare mode, routes, a group, drivers, a layout. */
  setupPct(v: CityVehicleRow): number {
    const routes = this.routesForVehicle(v);
    const steps = [
      v.vehicle_type_id != null,
      (v.mode_ids ?? []).length > 0,
      routes.length > 0,
      this.groupsForVehicle(v).length > 0,
      this.driversFor(v).length > 0,
      this.layoutCountFor(v) > 0,
    ];
    return Math.round((steps.filter(Boolean).length / steps.length) * 100);
  }

  // fare column → real fare drawer (reuses the ride-type tab machinery)
  fareConfigured(v: CityVehicleRow, rt: RideTypeRef): boolean { return (v.mode_ids ?? []).includes(rt.id); }
  openFareDrawer(v: CityVehicleRow, rt: RideTypeRef, ev?: Event): void {
    ev?.stopPropagation();
    this.select(v);
    this.setTab('mode:' + rt.id); // drives activeRideType/activeRow (+ auto-creates the fare row)
    this.fareDrawerOpen = true;
  }
  closeFareDrawer(): void { this.fareDrawerOpen = false; }

  // seat-layouts list drawer
  openLayoutsList(v: CityVehicleRow, ev?: Event): void { ev?.stopPropagation(); this.select(v); this.layoutsListOpen = true; }
  closeLayoutsList(): void { this.layoutsListOpen = false; }

  // route map editor + group create, rebinding `selected` to the acted-on vehicle
  newRouteFor(v: CityVehicleRow): void { this.select(v); setTimeout(() => this.newRoute()); }
  // ── Edit an ungrouped route: choose Manual vs update-from-My-Maps ──────────
  editChoiceOpen = false;
  editChoiceRouteId: number | null = null;
  editChoiceVehicle: CityVehicleRow | null = null;
  editChoiceName = '';
  @ViewChild('editKmlInput') private editKmlInput?: ElementRef<HTMLInputElement>;

  /** The edit pen on an ungrouped route opens a choice: edit by hand, or replace
   *  its line & stops from a Google My Maps upload (keeping fare & settings). */
  editRouteFor(v: CityVehicleRow, routeId: number): void {
    this.editChoiceVehicle = v;
    this.editChoiceRouteId = routeId;
    this.editChoiceName = this.ungroupedForVehicle(v).find((r) => r.id === routeId)?.name ?? 'this route';
    this.editChoiceOpen = true;
  }

  chooseManualEdit(): void {
    const v = this.editChoiceVehicle;
    const id = this.editChoiceRouteId;
    this.editChoiceOpen = false;
    if (v && id != null) { this.select(v); setTimeout(() => this.editRoute(id)); }
  }

  chooseMyMapsEdit(): void {
    this.editChoiceOpen = false;
    const el = this.editKmlInput?.nativeElement;
    if (el) { el.value = ''; el.click(); }
  }

  /** Upload for the "edit → from My Maps" path: parse, then open the map editor
   *  for THIS route with the imported line + stops, preserving fare & settings. */
  onEditKmlFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const routeId = this.editChoiceRouteId;
    const v = this.editChoiceVehicle;
    if (!file || this.cityId == null || routeId == null || !v) return;

    const fd = new FormData();
    fd.append('file', file);
    this.importingKml = true;
    this.api.postMultipart<{ routes: ImportedRouteDraft[]; count: number }>(
      `/admin/cities/${this.cityId}/fixed-routes/import-kml`, fd,
    ).subscribe({
      next: (res) => {
        this.importingKml = false;
        const routes = res?.routes ?? [];
        if (!routes.length) { this.toast.error('No routes were found in that file.'); return; }
        // If the file holds several routes, prefer the one whose name matches
        // this route; otherwise use the first.
        const draft = routes.find((d) => d.existing_route_id === routeId) ?? routes[0];
        this.select(v);
        setTimeout(() => this.fixedRoutes?.openEditFromImport(routeId, draft));
      },
      error: (err) => {
        this.importingKml = false;
        this.toast.error(err?.error?.message || 'Could not read that file.');
      },
    });
  }

  // ── Import from Google My Maps (KML/KMZ) ──────────────────────────────────
  // The file is parsed server-side into draft routes; each draft is opened in the
  // normal map editor for review and saved through the normal create flow. When
  // a file holds several routes we queue them and open the next after each close.
  @ViewChild('kmlInput') private kmlInput?: ElementRef<HTMLInputElement>;
  importingKml = false;
  private importQueue: ImportedRouteDraft[] = [];
  private importTotal = 0;
  private importTargetVehicle: CityVehicleRow | null = null;

  // ── "Import from My Maps" → choose Single (review each) or Bulk (all now) ──
  importChoiceOpen = false;
  importChoiceVehicle: CityVehicleRow | null = null;
  @ViewChild('bulkKmlInput') private bulkKmlInput?: ElementRef<HTMLInputElement>;

  openImportChoice(v: CityVehicleRow): void {
    if (this.importingKml) return;
    this.importChoiceVehicle = v;
    this.importChoiceOpen = true;
  }

  chooseSingleImport(): void {
    const v = this.importChoiceVehicle;
    this.importChoiceOpen = false;
    if (v) this.triggerKmlImport(v);
  }

  chooseBulkImport(): void {
    this.importChoiceOpen = false;
    const el = this.bulkKmlInput?.nativeElement;
    if (el) { el.value = ''; el.click(); }
  }

  /** Bulk import: create every route across ALL chosen files for the vehicle,
   *  with name + line only (no stops/price) — they land as "Needs pricing".
   *  Files are sent one at a time and the counts are summed into one toast. */
  onBulkKmlFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    const v = this.importChoiceVehicle;
    if (!files.length || this.cityId == null || !v) return;

    this.importingKml = true;
    this.bulkImportNext(files, v.id, 0, { created: 0, skipped: 0, failed: 0 });
  }

  /** Sends one file, then recurses to the next — keeps a running tally. */
  private bulkImportNext(
    files: File[],
    cityVehicleTypeId: number,
    index: number,
    tally: { created: number; skipped: number; failed: number },
  ): void {
    if (index >= files.length) {
      this.importingKml = false;
      this.reportBulkImport(files.length, tally);
      this.loadRoutes();
      return;
    }

    const fd = new FormData();
    fd.append('file', files[index]);
    fd.append('city_vehicle_type_id', String(cityVehicleTypeId));
    this.api.postMultipart<{ created_count: number; skipped_count: number }>(
      `/admin/cities/${this.cityId}/fixed-routes/import-kml-bulk`, fd,
    ).subscribe({
      next: (res) => {
        tally.created += res?.created_count ?? 0;
        tally.skipped += res?.skipped_count ?? 0;
        this.bulkImportNext(files, cityVehicleTypeId, index + 1, tally);
      },
      error: () => {
        tally.failed += 1;
        this.bulkImportNext(files, cityVehicleTypeId, index + 1, tally);
      },
    });
  }

  private reportBulkImport(fileCount: number, tally: { created: number; skipped: number; failed: number }): void {
    const parts: string[] = [];
    if (tally.skipped) parts.push(`skipped ${tally.skipped} existing`);
    if (tally.failed) parts.push(`${tally.failed} file${tally.failed === 1 ? '' : 's'} could not be read`);
    const tail = parts.length ? ` (${parts.join(', ')})` : '';

    if (tally.created) {
      const scope = fileCount > 1 ? ` from ${fileCount} files` : '';
      this.toast.success(`Imported ${tally.created} route${tally.created === 1 ? '' : 's'}${scope}${tail} — add a price to finish each.`);
    } else if (tally.failed && !tally.skipped) {
      this.toast.error('Could not read those files.');
    } else {
      this.toast.info(tally.skipped ? (tally.skipped === 1 ? 'Route already exists' : 'Routes already exist') : 'No routes were found in those files.');
    }
  }

  triggerKmlImport(v: CityVehicleRow): void {
    if (this.importingKml) return;
    this.importTargetVehicle = v;
    const el = this.kmlInput?.nativeElement;
    if (el) { el.value = ''; el.click(); }
  }

  onKmlFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || this.cityId == null || !this.importTargetVehicle) return;

    const fd = new FormData();
    fd.append('file', file);
    this.importingKml = true;
    this.api.postMultipart<{ routes: ImportedRouteDraft[]; count: number }>(
      `/admin/cities/${this.cityId}/fixed-routes/import-kml`, fd,
    ).subscribe({
      next: (res) => {
        this.importingKml = false;
        const routes = res?.routes ?? [];
        if (!routes.length) { this.toast.error('No routes were found in that file.'); return; }

        // The import button only CREATES. Any route whose name already exists is
        // skipped (it's updated from its own Edit → "Update from My Maps"), so the
        // button can never silently make duplicates.
        const fresh = routes.filter((r) => !r.existing_route_id);
        const skipped = routes.filter((r) => r.existing_route_id);
        if (skipped.length) {
          this.toast.info(skipped.length === 1 ? 'Route already exists' : 'Routes already exist');
        }
        if (!fresh.length) { return; }

        this.importQueue = [...fresh];
        this.importTotal = fresh.length;
        this.toast.success(`Found ${fresh.length} new route${fresh.length === 1 ? '' : 's'} — review and save each one.`);
        this.openNextImported();
      },
      error: (err) => {
        this.importingKml = false;
        this.toast.error(err?.error?.message || 'Could not read that file.');
      },
    });
  }

  private openNextImported(): void {
    const draft = this.importQueue.shift();
    if (!draft || !this.importTargetVehicle) return;
    if (this.importTotal > 1) {
      this.toast.info(`Reviewing route ${this.importTotal - this.importQueue.length} of ${this.importTotal}`);
    }
    // The "Import from My Maps" button only ever CREATES new routes. Updating an
    // existing route from My Maps is done from the ungrouped route's edit menu.
    this.select(this.importTargetVehicle);
    setTimeout(() => this.fixedRoutes?.openImported(draft, false));
  }

  /** After a reviewed import is saved or cancelled, open the next queued route. */
  onRouteEditorClosed(): void {
    if (this.importQueue.length) setTimeout(() => this.openNextImported(), 150);
    else { this.importTotal = 0; this.importTargetVehicle = null; }
  }
  openGroupDrawerFor(v: CityVehicleRow): void { this.select(v); this.openGroupDrawer(); }

  // floating row kebab menu
  openRowMenu(v: CityVehicleRow, ev: MouseEvent): void {
    ev.stopPropagation();
    this.select(v);
    this.menuId = v.id;
    this.menuX = Math.min(ev.clientX, window.innerWidth - 230);
    this.menuY = Math.min(ev.clientY, window.innerHeight - 250);
  }
  closeRowMenu(): void { this.menuId = null; }

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
