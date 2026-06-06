import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, IconComponent, ModalComponent } from '../../ui';
import { OutstationPackagesComponent } from './outstation-packages.component';
import { VehicleBasePricingComponent } from './vehicle-base-pricing.component';

type TollMode = 'no' | 'yes' | 'yes_locked';
type Platform = 'android' | 'ios';

interface VehicleType {
  id: number;
  city_id: number;
  ride_type_id: number;
  vehicle_type_id: number | null;
  vehicle_set_id: number | null;
  vehicle_set_name: string | null;
  ride_type_name: string;
  is_outstation: boolean;
  display_name: string;
  display_order: number;
  max_people: number;
  luggage_capacity: number;
  destination_mandatory: boolean;
  fare_mandatory: boolean;
  reverse_bidding_enabled: boolean;
  waiting_charges_applicable: boolean;
  customer_notes_enabled: boolean;
  multiple_destinations_enabled: boolean;
  show_low_wallet_alert: boolean;
  toll_mode: TollMode;
  commission_percent: number;
  fixed_commission: number;
  convenience_charge: number;
  convenience_customer_waiver: number;
  convenience_driver_cut: number;
  min_driver_balance: number;
  override_request_radius_m: number | null;
  override_hop_interval_sec: number | null;
  override_hop_radius_m: number | null;
  override_max_hops: number | null;
  is_active: boolean;
}

interface VehicleSetMember { id: number; display_name: string; }
interface VehicleSetOption {
  id: number;
  name: string;
  member_count: number;
  members?: VehicleSetMember[];
}

interface VehicleTypeImage {
  id: number;
  city_vehicle_type_id: number;
  platform: Platform;
  key: string;
  image_path: string | null;
  image_url: string | null;
}

/**
 * Vehicle Details — modeled on the reference's sectioned layout. One row =
 * one vehicle; each section (Vehicle Type, Fare Structure, Images, Dispatcher
 * Details) is edited independently with its own CHANGE / Cancel pair.
 */
@Component({
  selector: 'app-vehicle-type-details',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    IconComponent,
    ModalComponent,
    OutstationPackagesComponent,
    VehicleBasePricingComponent,
  ],
  template: `
    <div *ngIf="loading" class="cue">
      <tm-icon name="refresh" [size]="20" /><p class="cue__text">Loading vehicle…</p>
    </div>

    <div class="page" *ngIf="!loading && form">
      <!-- ── Header bar ───────────────────────────── -->
      <header class="vhead">
        <button type="button" class="iconbtn" (click)="back()" aria-label="Back">
          <tm-icon name="chevron-left" [size]="18" />
        </button>
        <span class="vhead__icon"><tm-icon name="car" [size]="18" /></span>
        <div class="vhead__id">
          <div class="vhead__name">{{ form.display_name }}</div>
          <div class="vhead__meta">
            <span class="tag">{{ form.ride_type_name }}</span>
            <span class="tag" [class.tag--on]="form.is_active" [class.tag--off]="!form.is_active">
              {{ form.is_active ? 'Active' : 'Inactive' }}
            </span>
            <span class="tag" *ngIf="isOutstation()">Packages</span>
          </div>
        </div>
        <tm-button
          [variant]="form.is_active ? 'danger' : 'green'"
          size="sm"
          [icon]="form.is_active ? 'x' : 'check'"
          (clicked)="toggleActive()"
        >{{ form.is_active ? 'Disable' : 'Enable' }}</tm-button>
      </header>

      <!-- ── Edit Vehicle Type ────────────────────── -->
      <section class="psec">
        <header class="psec__head">
          <h3 class="psec__title"><tm-icon name="car" [size]="14" /> Edit Vehicle Type</h3>
        </header>
        <div class="psec__body">
          <div class="pgrid">
            <label class="pfield pfield--full">
              <span class="pfield__lbl">Vehicle Name</span>
              <input type="text" [(ngModel)]="form.display_name" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Display Order</span>
              <input type="number" min="0" max="9999" [(ngModel)]="form.display_order" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Max People</span>
              <input type="number" min="1" max="20" [(ngModel)]="form.max_people" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Luggage Capacity <i class="req">*</i></span>
              <input type="number" min="0" max="20" [(ngModel)]="form.luggage_capacity" />
            </label>
          </div>

          <div class="toggles">
            <label class="toggle"><input type="checkbox" [(ngModel)]="form.show_low_wallet_alert" />
              <span>Show low-wallet alert (driver)</span></label>
            <label class="toggle"><input type="checkbox" [(ngModel)]="form.reverse_bidding_enabled" />
              <span>Reverse bidding enabled</span></label>
            <label class="toggle"><input type="checkbox" [(ngModel)]="form.destination_mandatory" />
              <span>Destination mandatory</span></label>
            <label class="toggle"><input type="checkbox" [(ngModel)]="form.fare_mandatory" />
              <span>Fare mandatory (no bidding)</span></label>
            <label class="toggle"><input type="checkbox" [(ngModel)]="form.waiting_charges_applicable" />
              <span>Waiting charges applicable</span></label>
            <label class="toggle"><input type="checkbox" [(ngModel)]="form.customer_notes_enabled" />
              <span>Customer notes enabled</span></label>
            <label class="toggle"><input type="checkbox" [(ngModel)]="form.multiple_destinations_enabled" />
              <span>Multiple destinations enabled</span></label>
          </div>

          <div class="pfield pfield--full">
            <span class="pfield__lbl">Toll Applicable</span>
            <div class="chips">
              <button type="button" class="chip" [class.is-on]="form.toll_mode === 'yes'"        (click)="form.toll_mode = 'yes'">Yes</button>
              <button type="button" class="chip" [class.is-on]="form.toll_mode === 'yes_locked'" (click)="form.toll_mode = 'yes_locked'">Yes — driver locked</button>
              <button type="button" class="chip" [class.is-on]="form.toll_mode === 'no'"         (click)="form.toll_mode = 'no'">No</button>
            </div>
          </div>

          <div class="psec__sub">Commercials</div>
          <div class="pgrid">
            <label class="pfield">
              <span class="pfield__lbl">Commission (%)</span>
              <input type="number" min="0" max="100" step="0.01" [(ngModel)]="form.commission_percent" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Fixed commission</span>
              <input type="number" min="0" step="0.01" [(ngModel)]="form.fixed_commission" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Convenience charge</span>
              <input type="number" min="0" step="0.01" [(ngModel)]="form.convenience_charge" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Customer waiver</span>
              <input type="number" min="0" step="0.01" [(ngModel)]="form.convenience_customer_waiver" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Driver cut</span>
              <input type="number" min="0" step="0.01" [(ngModel)]="form.convenience_driver_cut" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Min driver balance</span>
              <input type="number" step="0.01" [(ngModel)]="form.min_driver_balance" />
            </label>
          </div>
        </div>
        <footer class="psec__foot">
          <tm-button variant="ghost" size="sm" (clicked)="cancelEdits()">Cancel</tm-button>
          <tm-button variant="green" size="sm" icon="check" [disabled]="saving" (clicked)="saveCore()">
            {{ saving ? 'Saving…' : 'Save changes' }}
          </tm-button>
        </footer>
      </section>

      <!-- ── Edit Vehicle Set ─────────────────────── -->
      <section class="psec">
        <header class="psec__head">
          <h3 class="psec__title"><tm-icon name="handshake" [size]="14" /> Vehicle Set</h3>
          <span class="psec__hint">Group related vehicles (e.g. SEDAN L + SEDAN O).</span>
        </header>
        <div class="psec__body">
          <div class="pgrid">
            <label class="pfield pfield--full">
              <span class="pfield__lbl">Set</span>
              <select [ngModel]="form.vehicle_set_id" (ngModelChange)="onSetChange($event)">
                <option [ngValue]="null">— Standalone (no set) —</option>
                <option *ngFor="let s of vehicleSets" [ngValue]="s.id">
                  {{ s.name }} ({{ s.member_count }})
                </option>
                <option [ngValue]="'__new'">+ Create new set…</option>
              </select>
            </label>
          </div>

          <div class="newset" *ngIf="creatingSet">
            <input
              type="text"
              [(ngModel)]="newSetName"
              placeholder="Set name — e.g. SWIFT family"
              (keydown.enter)="createSet()"
            />
            <tm-button variant="green" size="sm" [disabled]="!newSetName.trim() || savingSet" (clicked)="createSet()">
              {{ savingSet ? 'Saving…' : 'Create' }}
            </tm-button>
            <tm-button variant="ghost" size="sm" (clicked)="cancelNewSet()">Cancel</tm-button>
          </div>

          <div class="siblings" *ngIf="form.vehicle_set_id && siblingNames().length">
            <span class="overline">Other members</span>
            <div class="siblings__chips">
              <span class="tag" *ngFor="let n of siblingNames()">{{ n }}</span>
            </div>
          </div>
        </div>
        <footer class="psec__foot">
          <tm-button variant="ghost" size="sm" (clicked)="cancelEdits()">Cancel</tm-button>
          <tm-button variant="green" size="sm" icon="check" [disabled]="saving" (clicked)="saveCore()">
            {{ saving ? 'Saving…' : 'Save changes' }}
          </tm-button>
        </footer>
      </section>

      <!-- ── Edit Fare Structure ──────────────────── -->
      <section class="psec">
        <header class="psec__head">
          <h3 class="psec__title"><tm-icon name="bolt" [size]="14" /> Fare Structure</h3>
          <span class="psec__hint" *ngIf="!isOutstation()">Set the base rate card for this vehicle.</span>
          <span class="psec__hint" *ngIf="isOutstation()">Outstation vehicles use named fare packages instead of a base rate.</span>
        </header>
        <div class="psec__body" *ngIf="!isOutstation()">
          <app-vehicle-base-pricing [cityId]="cityId" [cityVehicleTypeId]="form.id"></app-vehicle-base-pricing>
        </div>
        <div class="psec__body" *ngIf="isOutstation()">
          <app-outstation-packages [cityId]="cityId" [vehicleTypeId]="form.id"></app-outstation-packages>
        </div>
      </section>

      <!-- ── Vehicle Type Images ──────────────────── -->
      <section class="psec">
        <header class="psec__head">
          <h3 class="psec__title"><tm-icon name="upload" [size]="14" /> Vehicle Images</h3>
          <tm-button variant="green" size="sm" icon="plus" (clicked)="openAddImage()">Add image</tm-button>
        </header>
        <div class="psec__body psec__body--padless">
          <div *ngIf="imagesLoading" class="cue cue--inline">
            <tm-icon name="refresh" [size]="20" /><p class="cue__text">Loading images…</p>
          </div>
          <ng-container *ngIf="!imagesLoading">
            <div class="imgblock" *ngFor="let plat of platformOptions">
              <div class="imgblock__head">
                <span class="overline">{{ plat.label }} app</span>
                <span class="overline overline--mute" *ngIf="!imagesFor(plat.value).length">empty</span>
              </div>
              <div class="imggrid" *ngIf="imagesFor(plat.value).length">
                <div class="imgcard" *ngFor="let img of imagesFor(plat.value)">
                  <div class="imgcard__media">
                    <img *ngIf="img.image_url" [src]="img.image_url" />
                  </div>
                  <div class="imgcard__meta">
                    <span class="imgcard__key">{{ img.key }}</span>
                    <div class="imgcard__actions">
                      <button type="button" class="iconact" (click)="replaceImage(img)" aria-label="Replace">
                        <tm-icon name="edit" [size]="13" />
                      </button>
                      <button type="button" class="iconact iconact--danger" (click)="deleteImage(img)" aria-label="Delete">
                        <tm-icon name="trash" [size]="13" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div class="imgblock__empty" *ngIf="!imagesFor(plat.value).length">
                No {{ plat.label }} images yet — add slots like <code>tab_normal</code> or <code>ride_now_highlighted</code>.
              </div>
            </div>
          </ng-container>
        </div>
      </section>

      <!-- ── Edit Dispatcher Details ──────────────── -->
      <section class="psec">
        <header class="psec__head">
          <h3 class="psec__title"><tm-icon name="map-marker" [size]="14" /> Dispatcher Overrides</h3>
          <span class="psec__hint">Leave blank to inherit the city defaults.</span>
        </header>
        <div class="psec__body">
          <div class="pgrid">
            <label class="pfield">
              <span class="pfield__lbl">Request radius (m)</span>
              <input type="number" min="0" max="50000" [(ngModel)]="form.override_request_radius_m" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Hop interval (sec)</span>
              <input type="number" min="1" max="600" [(ngModel)]="form.override_hop_interval_sec" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Hop radius (m)</span>
              <input type="number" min="0" max="50000" [(ngModel)]="form.override_hop_radius_m" />
            </label>
            <label class="pfield">
              <span class="pfield__lbl">Max hops</span>
              <input type="number" min="1" max="50" [(ngModel)]="form.override_max_hops" />
            </label>
          </div>
        </div>
        <footer class="psec__foot">
          <tm-button variant="ghost" size="sm" (clicked)="cancelEdits()">Cancel</tm-button>
          <tm-button variant="green" size="sm" icon="check" [disabled]="saving" (clicked)="saveCore()">
            {{ saving ? 'Saving…' : 'Save changes' }}
          </tm-button>
        </footer>
      </section>

      <!-- ── Danger zone ──────────────────────────── -->
      <section class="dangerzone">
        <div>
          <div class="dangerzone__title">Delete this vehicle</div>
          <div class="dangerzone__sub">Removes the vehicle row, its rate card and any uploaded images.</div>
        </div>
        <tm-button variant="danger" size="sm" icon="trash" (clicked)="deleteOpen = true">Delete</tm-button>
      </section>
    </div>

    <!-- Add / Replace image modal -->
    <tm-modal
      [open]="addImageOpen"
      [title]="addImageMode === 'replace' ? 'Replace Image' : 'Add Image'"
      (closed)="addImageOpen = false"
    >
      <div slot="body" class="form">
        <label class="f">
          <span class="f__lbl">Type <i class="req">*</i></span>
          <select [(ngModel)]="addImageForm.platform" [disabled]="addImageMode === 'replace'">
            <option [ngValue]="null" disabled>Select type</option>
            <option *ngFor="let p of platformOptions" [ngValue]="p.value">{{ p.label }}</option>
          </select>
        </label>
        <label class="f">
          <span class="f__lbl">Key <i class="req">*</i></span>
          <input
            type="text"
            [(ngModel)]="addImageForm.key"
            placeholder="e.g. tab_normal, ride_now_highlighted"
            [disabled]="addImageMode === 'replace'"
          />
        </label>
        <label class="f">
          <span class="f__lbl">Image <i class="req">*</i></span>
          <input type="file" accept="image/*" (change)="onAddImageFile($event)" />
        </label>
        <img *ngIf="addImageForm.previewUrl" [src]="addImageForm.previewUrl" class="img-thumb" />
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="addImageOpen = false">Cancel</tm-button>
        <tm-button variant="green" [disabled]="addImageSaving" (clicked)="submitAddImage()">
          {{ addImageSaving ? 'Saving…' : 'Save' }}
        </tm-button>
      </div>
    </tm-modal>

    <!-- Delete vehicle confirm -->
    <tm-modal [open]="deleteOpen" title="Delete this vehicle" (closed)="deleteOpen = false">
      <div slot="body">
        <p>Delete <strong>{{ form?.display_name }}</strong>? This cannot be undone.</p>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="deleteOpen = false">Cancel</tm-button>
        <tm-button variant="danger" (clicked)="doDelete()">Delete</tm-button>
      </div>
    </tm-modal>

    <!-- Delete image confirm -->
    <tm-modal [open]="!!imageToDelete" title="Delete image" (closed)="imageToDelete = null">
      <div slot="body">
        <p>Delete the <strong>{{ imageToDelete?.key }}</strong> {{ imageToDelete?.platform }} image?</p>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="imageToDelete = null">Cancel</tm-button>
        <tm-button variant="danger" (clicked)="doDeleteImage()">Delete</tm-button>
      </div>
    </tm-modal>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 18px; }

    /* ── Empty-state cue (shared) ─────────────────────────────── */
    .cue {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 48px 24px; text-align: center;
      background: var(--tm-surface);
      border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      color: var(--tm-text-muted);
    }
    .cue--inline { padding: 22px 18px; background: transparent; border: 0; }
    .cue__text { margin: 0; font-size: 13px; max-width: 380px; }

    /* ── Header bar ───────────────────────────────────────────── */
    .page { display: flex; flex-direction: column; gap: 18px; }
    .vhead {
      display: flex; align-items: center; gap: 12px;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      padding: 14px 16px;
    }
    .iconbtn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border-radius: 8px; flex: none; border: 0;
      background: var(--tm-canvas-2); color: var(--tm-text-muted); cursor: pointer;
    }
    .iconbtn:hover { background: var(--tm-ink, #111827); color: #fff; }
    .vhead__icon {
      width: 36px; height: 36px; border-radius: 9px; flex: none;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--tm-green-tint, #e0f7fa); color: var(--tm-green);
    }
    .vhead__id { flex: 1; min-width: 0; }
    .vhead__name { font-size: 17px; font-weight: 800; color: var(--tm-text); line-height: 1.2; }
    .vhead__meta { display: inline-flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
    .tag {
      font-size: 10px; font-weight: 800; letter-spacing: 0.3px;
      padding: 2px 8px; border-radius: 999px;
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
      text-transform: uppercase;
    }
    .tag--on  { background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .tag--off { background: var(--tm-warning-bg); color: var(--tm-warning-fg); }

    /* ── Section card ─────────────────────────────────────────── */
    .psec {
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      overflow: hidden;
    }
    .psec__head {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--tm-line);
    }
    .psec__title {
      display: flex; align-items: center; gap: 6px;
      margin: 0; font-size: 12px; font-weight: 800;
      text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--tm-text-muted);
    }
    .psec__hint { font-size: 12px; color: var(--tm-text-muted); }
    .psec__body { padding: 16px 18px; display: flex; flex-direction: column; gap: 14px; }
    .psec__body--padless { padding: 0; }
    .psec__body--cue { padding: 8px 12px; }
    .psec__sub {
      margin-top: 4px; font-size: 11px; font-weight: 800;
      text-transform: uppercase; letter-spacing: 0.4px;
      color: var(--tm-text-muted);
    }
    .psec__foot {
      display: flex; justify-content: flex-end; gap: 8px;
      padding: 10px 14px;
      background: var(--tm-canvas, #f8fafc);
      border-top: 1px solid var(--tm-line);
    }

    /* ── Form grid + field ────────────────────────────────────── */
    .pgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .pfield { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .pfield--full { grid-column: 1 / -1; }
    .pfield__lbl {
      font-size: 11px; font-weight: 700; color: var(--tm-text);
      display: inline-flex; align-items: center; gap: 4px;
    }
    .req { color: var(--tm-danger, #ef4444); font-style: normal; }
    .pfield input, .pfield select {
      width: 100%; height: 36px; padding: 0 10px;
      border: 1px solid var(--tm-line); border-radius: 8px;
      background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13px; outline: none; font-family: inherit;
    }
    .pfield input:focus, .pfield select:focus { border-color: var(--tm-green); }

    /* ── Toggles (compact, two-column) ────────────────────────── */
    .toggles {
      display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px;
    }
    .toggle {
      display: inline-flex; align-items: center; gap: 8px;
      font-size: 13px; font-weight: 600; color: var(--tm-text);
    }
    .toggle input { width: 16px; height: 16px; accent-color: var(--tm-green); }

    /* ── Chips (Toll Applicable, etc.) ────────────────────────── */
    .chips { display: flex; flex-wrap: wrap; gap: 7px; }
    .chip {
      padding: 7px 12px; border-radius: 999px;
      border: 1px solid var(--tm-line); background: var(--tm-canvas);
      font-size: 12px; font-weight: 700; color: var(--tm-text-muted); cursor: pointer;
    }
    .chip.is-on {
      background: var(--tm-green-tint, #e0f7fa);
      border-color: var(--tm-green); color: var(--tm-green);
    }

    /* ── Images section ───────────────────────────────────────── */
    .imgblock { padding: 14px 16px; border-bottom: 1px solid var(--tm-line); }
    .imgblock:last-child { border-bottom: 0; }
    .imgblock__head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .overline {
      font-size: 11px; font-weight: 800; letter-spacing: 0.5px;
      text-transform: uppercase; color: var(--tm-text-muted);
    }
    .overline--mute { color: var(--tm-text-muted); opacity: 0.7; }
    .imggrid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 10px;
    }
    .imgcard {
      background: var(--tm-canvas); border: 1px solid var(--tm-line);
      border-radius: 10px; overflow: hidden;
      display: flex; flex-direction: column;
    }
    .imgcard__media {
      aspect-ratio: 4/3;
      display: flex; align-items: center; justify-content: center;
      background: var(--tm-canvas-2);
    }
    .imgcard__media img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .imgcard__meta {
      display: flex; align-items: center; justify-content: space-between; gap: 6px;
      padding: 8px 10px;
      border-top: 1px solid var(--tm-line);
    }
    .imgcard__key {
      font-size: 12px; font-weight: 700; color: var(--tm-text);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .imgcard__actions { display: flex; gap: 4px; flex: none; }
    .iconact {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 7px; border: 0;
      background: var(--tm-canvas-2); color: var(--tm-text-muted); cursor: pointer;
    }
    .iconact:hover { background: var(--tm-ink, #111827); color: #fff; }
    .iconact--danger:hover { background: var(--tm-danger, #ef4444); }
    .imgblock__empty {
      padding: 12px; font-size: 12px; color: var(--tm-text-muted);
      background: var(--tm-canvas); border: 1px dashed var(--tm-line);
      border-radius: 8px;
    }
    .imgblock__empty code {
      font-size: 11px; padding: 1px 6px; border-radius: 4px;
      background: var(--tm-canvas-2); color: var(--tm-text);
    }

    /* ── Vehicle Set picker ───────────────────────────────────── */
    .newset { display: flex; gap: 8px; align-items: center; }
    .newset input {
      flex: 1; height: 36px; padding: 0 10px;
      border: 1px solid var(--tm-line); border-radius: 8px;
      background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13px; outline: none; font-family: inherit;
    }
    .newset input:focus { border-color: var(--tm-green); }
    .siblings { display: flex; flex-direction: column; gap: 6px; padding-top: 4px; }
    .siblings__chips { display: flex; flex-wrap: wrap; gap: 6px; }

    /* ── Danger zone ──────────────────────────────────────────── */
    .dangerzone {
      display: flex; align-items: center; justify-content: space-between; gap: 14px;
      padding: 14px 16px;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-left: 3px solid var(--tm-danger, #ef4444);
      border-radius: var(--tm-radius-lg, 14px);
    }
    .dangerzone__title { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .dangerzone__sub { font-size: 12px; color: var(--tm-text-muted); margin-top: 2px; }

    /* ── Add/replace image modal (reuses .pfield) ─────────────── */
    .form { display: flex; flex-direction: column; gap: 12px; }
    .img-thumb {
      max-width: 100%; max-height: 160px; border-radius: 8px;
      border: 1px solid var(--tm-line); display: block;
    }

    @media (max-width: 720px) {
      .pgrid { grid-template-columns: 1fr; }
      .toggles { grid-template-columns: 1fr; }
    }
  `],
})
export class VehicleTypeDetailsComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  vehicleRowId: number | null = null;
  loading = true;
  saving = false;
  form: VehicleType | null = null;
  openFareEditor = false;

  images: VehicleTypeImage[] = [];
  imagesLoading = false;
  platformOptions = [
    { label: 'Android', value: 'android' as const },
    { label: 'iOS', value: 'ios' as const },
  ];
  addImageOpen = false;
  addImageSaving = false;
  addImageMode: 'create' | 'replace' = 'create';
  addImageTargetId: number | null = null;
  addImageForm: {
    platform: Platform | null;
    key: string;
    file: File | null;
    previewUrl: string | null;
  } = { platform: null, key: '', file: null, previewUrl: null };

  deleteOpen = false;
  imageToDelete: VehicleTypeImage | null = null;

  // Vehicle Set picker state
  vehicleSets: VehicleSetOption[] = [];
  creatingSet = false;
  savingSet = false;
  newSetName = '';

  private subs: Subscription[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private cityCtx: CityContextService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.subs.push(
      this.cityCtx.cityId$.subscribe((id) => {
        this.cityId = id;
        this.fetchRow();
        this.loadVehicleSets();
      }),
      this.route.paramMap.subscribe((p) => {
        const raw = p.get('vehicleRowId');
        this.vehicleRowId = raw ? Number(raw) : null;
        this.fetchRow();
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  isOutstation(): boolean {
    // Prefer the server-computed flag (single source of truth); fall back to the
    // name only for older payloads that don't carry it yet.
    return this.form?.is_outstation
      ?? (this.form?.ride_type_name ?? '').toLowerCase() === 'outstation';
  }

  back(): void {
    this.router.navigateByUrl('/vehicle-fares');
  }

  fetchRow(): void {
    if (this.cityId == null || this.vehicleRowId == null) {
      this.form = null;
      this.loading = false;
      return;
    }
    this.loading = true;
    this.api
      .get<{ vehicle_type: VehicleType }>(
        `/admin/cities/${this.cityId}/vehicle-types/${this.vehicleRowId}`,
      )
      .subscribe({
        next: (res) => {
          this.form = res.vehicle_type;
          this.loading = false;
          this.loadImages();
        },
        error: () => {
          this.loading = false;
          this.toast.error('Failed to load vehicle');
        },
      });
  }

  /** Revert unsaved field changes by re-fetching the row. */
  cancelEdits(): void {
    this.fetchRow();
    this.cancelNewSet();
  }

  // ── Vehicle Set ────────────────────────────────────────────────
  loadVehicleSets(): void {
    if (this.cityId == null) {
      this.vehicleSets = [];
      return;
    }
    this.api
      .get<{ data: VehicleSetOption[] }>(`/admin/cities/${this.cityId}/vehicle-sets`)
      .subscribe({
        next: (res) => (this.vehicleSets = res?.data ?? []),
        error: () => (this.vehicleSets = []),
      });
  }

  onSetChange(value: number | null | '__new'): void {
    if (value === '__new') {
      this.creatingSet = true;
      this.newSetName = '';
      return;
    }
    if (this.form) this.form.vehicle_set_id = value as number | null;
  }

  cancelNewSet(): void {
    this.creatingSet = false;
    this.newSetName = '';
  }

  createSet(): void {
    if (this.cityId == null || !this.form || !this.newSetName.trim() || this.savingSet) return;
    this.savingSet = true;
    this.api
      .post<{ vehicle_set: VehicleSetOption }>(
        `/admin/cities/${this.cityId}/vehicle-sets`,
        { name: this.newSetName.trim() },
      )
      .subscribe({
        next: (res) => {
          this.savingSet = false;
          this.creatingSet = false;
          this.newSetName = '';
          if (res?.vehicle_set) {
            this.vehicleSets = [...this.vehicleSets, res.vehicle_set];
            if (this.form) this.form.vehicle_set_id = res.vehicle_set.id;
          }
          this.toast.success('Set created — save changes to attach this vehicle.');
        },
        error: (err) => {
          this.savingSet = false;
          this.toast.error(err?.error?.message || 'Failed to create set');
        },
      });
  }

  /** Names of other vehicles currently in this vehicle's set. */
  siblingNames(): string[] {
    const setId = this.form?.vehicle_set_id;
    if (!setId) return [];
    const set = this.vehicleSets.find((s) => s.id === setId);
    if (!set?.members) return [];
    return set.members
      .filter((m) => m.id !== this.form?.id)
      .map((m) => m.display_name);
  }

  saveCore(): void {
    if (!this.form || this.cityId == null) return;
    this.saving = true;
    const f = this.form;
    const fd = new FormData();
    fd.append('_method', 'PATCH');

    const append = (key: string, val: unknown): void => {
      if (val === null || val === undefined || val === '') return;
      if (typeof val === 'boolean') fd.append(key, val ? '1' : '0');
      else fd.append(key, String(val));
    };

    append('display_name', f.display_name);
    append('display_order', f.display_order);
    append('max_people', f.max_people);
    append('luggage_capacity', f.luggage_capacity);
    append('destination_mandatory', f.destination_mandatory);
    append('fare_mandatory', f.fare_mandatory);
    append('reverse_bidding_enabled', f.reverse_bidding_enabled);
    append('waiting_charges_applicable', f.waiting_charges_applicable);
    append('customer_notes_enabled', f.customer_notes_enabled);
    append('multiple_destinations_enabled', f.multiple_destinations_enabled);
    append('show_low_wallet_alert', f.show_low_wallet_alert);
    append('toll_mode', f.toll_mode);
    append('commission_percent', f.commission_percent);
    append('fixed_commission', f.fixed_commission);
    append('convenience_charge', f.convenience_charge);
    append('convenience_customer_waiver', f.convenience_customer_waiver);
    append('convenience_driver_cut', f.convenience_driver_cut);
    append('min_driver_balance', f.min_driver_balance);
    // vehicle_set_id is nullable — send empty string to clear it server-side.
    fd.append('vehicle_set_id', f.vehicle_set_id == null ? '' : String(f.vehicle_set_id));

    for (const k of [
      'override_request_radius_m',
      'override_hop_interval_sec',
      'override_hop_radius_m',
      'override_max_hops',
    ] as const) {
      const v = f[k];
      if (v !== null && v !== undefined && v !== ('' as unknown)) {
        fd.append(k, String(v));
      }
    }

    this.api
      .postMultipart<{ vehicle_type: VehicleType }>(
        `/admin/cities/${this.cityId}/vehicle-types/${f.id}`,
        fd,
      )
      .subscribe({
        next: (res) => {
          this.saving = false;
          this.form = res.vehicle_type;
          // Refresh set member lists since membership may have changed.
          this.loadVehicleSets();
          this.toast.success('Saved');
        },
        error: () => {
          this.saving = false;
          this.toast.error('Failed to save');
        },
      });
  }

  toggleActive(): void {
    if (!this.form || this.cityId == null) return;
    const next = !this.form.is_active;
    const fd = new FormData();
    fd.append('_method', 'PATCH');
    fd.append('is_active', next ? '1' : '0');
    this.api
      .postMultipart<{ vehicle_type: VehicleType }>(
        `/admin/cities/${this.cityId}/vehicle-types/${this.form.id}`,
        fd,
      )
      .subscribe({
        next: (res) => { this.form = res.vehicle_type; },
        error: () => this.toast.error('Failed to toggle'),
      });
  }

  doDelete(): void {
    if (!this.form || this.cityId == null) return;
    this.api
      .delete(`/admin/cities/${this.cityId}/vehicle-types/${this.form.id}`)
      .subscribe({
        next: () => {
          this.deleteOpen = false;
          this.toast.success('Deleted');
          this.back();
        },
        error: () => this.toast.error('Failed to delete'),
      });
  }

  // ---- Images ----
  imagesFor(platform: Platform): VehicleTypeImage[] {
    return this.images.filter((i) => i.platform === platform);
  }

  loadImages(): void {
    if (this.cityId == null || !this.form) {
      this.images = [];
      return;
    }
    this.images = [];
    this.imagesLoading = true;
    this.api
      .get<{ data: VehicleTypeImage[] }>(
        `/admin/cities/${this.cityId}/vehicle-types/${this.form.id}/images`,
      )
      .subscribe({
        next: (res) => {
          this.images = res.data ?? [];
          this.imagesLoading = false;
        },
        error: () => {
          this.imagesLoading = false;
        },
      });
  }

  openAddImage(): void {
    this.addImageMode = 'create';
    this.addImageTargetId = null;
    this.addImageForm = { platform: null, key: '', file: null, previewUrl: null };
    this.addImageOpen = true;
  }

  replaceImage(img: VehicleTypeImage): void {
    this.addImageMode = 'replace';
    this.addImageTargetId = img.id;
    this.addImageForm = {
      platform: img.platform,
      key: img.key,
      file: null,
      previewUrl: img.image_url,
    };
    this.addImageOpen = true;
  }

  onAddImageFile(ev: Event): void {
    const f = (ev.target as HTMLInputElement).files?.[0];
    this.addImageForm.file = f ?? null;
    if (f) {
      const reader = new FileReader();
      reader.onload = () => (this.addImageForm.previewUrl = reader.result as string);
      reader.readAsDataURL(f);
    }
  }

  submitAddImage(): void {
    if (!this.form || this.cityId == null) return;
    const f = this.addImageForm;
    if (this.addImageMode === 'create' && (!f.platform || !f.key.trim() || !f.file)) {
      this.toast.error('Type, key and image are all required');
      return;
    }
    if (this.addImageMode === 'replace' && !f.file) {
      this.toast.error('Pick a new image to replace');
      return;
    }

    this.addImageSaving = true;
    const fd = new FormData();
    if (this.addImageMode === 'create') {
      fd.append('platform', f.platform as string);
      fd.append('key', f.key.trim());
      fd.append('image', f.file as File);
    } else {
      fd.append('_method', 'PATCH');
      fd.append('image', f.file as File);
    }

    const url = this.addImageMode === 'create'
      ? `/admin/cities/${this.cityId}/vehicle-types/${this.form.id}/images`
      : `/admin/cities/${this.cityId}/vehicle-types/${this.form.id}/images/${this.addImageTargetId}`;

    this.api.postMultipart<{ image: VehicleTypeImage }>(url, fd).subscribe({
      next: (res) => {
        this.addImageSaving = false;
        this.addImageOpen = false;
        const idx = this.images.findIndex((x) => x.id === res.image.id);
        if (idx >= 0) this.images[idx] = res.image;
        else this.images = [...this.images, res.image];
        this.toast.success('Image saved');
      },
      error: (err) => {
        this.addImageSaving = false;
        this.toast.error(err?.error?.message || 'Failed to save image');
      },
    });
  }

  deleteImage(img: VehicleTypeImage): void {
    this.imageToDelete = img;
  }

  doDeleteImage(): void {
    const img = this.imageToDelete;
    if (!img || !this.form || this.cityId == null) return;
    this.api
      .delete(`/admin/cities/${this.cityId}/vehicle-types/${this.form.id}/images/${img.id}`)
      .subscribe({
        next: () => {
          this.imageToDelete = null;
          this.images = this.images.filter((x) => x.id !== img.id);
          this.toast.success('Image deleted');
        },
        error: () => this.toast.error('Failed to delete image'),
      });
  }
}
