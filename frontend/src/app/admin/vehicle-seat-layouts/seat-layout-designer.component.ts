import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, forkJoin, of } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import {
  SeatCategory,
  SeatCell,
  SeatCellKind,
  SeatLayoutPayload,
  VehicleSeatLayout,
  VehicleSeatLayoutsService,
} from './vehicle-seat-layouts.service';
import { SeatGridComponent } from './seat-grid.component';
import { ReturnToSetupComponent } from '../setup/return-to-setup.component';

interface VehicleTypeRef { id: number; name: string; }

interface LayoutPreset {
  key: string;
  title: string;
  desc: string;
  rows: number;
  cols: number;
  cells: SeatCell[];
}

// ── preset cell builders ──────────────────────────────────────────────
function seat(row: number, col: number, label: string, category: SeatCategory | null = null): SeatCell {
  return { row, col, kind: 'seat', label, category, price_delta: 0 };
}
function driver(row: number, col: number): SeatCell {
  // Driver seat = a blocked cell labelled "D"; the grid draws it with a 🚗.
  return { row, col, kind: 'blocked', label: 'D', category: null, price_delta: 0 };
}
function aisle(row: number, col: number): SeatCell {
  return { row, col, kind: 'aisle', label: null, category: null, price_delta: 0 };
}

/**
 * Ready-made seat maps drawn as a top view of the vehicle — driver (🚗) in
 * their real position, passengers (P1, P2 …) laid out where they actually sit.
 * Each carries a plain-word title + description so an operator picks the right
 * one without being taught the grid — the whole point of the chooser step.
 */
const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    key: 'twowheeler', title: 'Two-wheeler / Bike', desc: 'Driver in front, one pillion behind.',
    rows: 2, cols: 1,
    cells: [
      driver(1, 1),
      seat(2, 1, 'P1', 'rear'),
    ],
  },
  {
    key: 'auto', title: '3-wheeler / Shared auto', desc: 'Driver front-right, a bench of three, two at the back.',
    rows: 3, cols: 3,
    cells: [
      seat(1, 1, 'P1', 'front'), aisle(1, 2), driver(1, 3),
      seat(2, 1, 'P2', 'window'), seat(2, 2, 'P3', 'middle'), seat(2, 3, 'P4', 'window'),
      seat(3, 1, 'P5', 'window'), aisle(3, 2), seat(3, 3, 'P6', 'window'),
    ],
  },
  {
    key: 'hatchback', title: 'Hatchback / Sedan', desc: 'Front passenger + a rear bench of three.',
    rows: 2, cols: 3,
    cells: [
      seat(1, 1, 'P1', 'front'), aisle(1, 2), driver(1, 3),
      seat(2, 1, 'P2', 'window'), seat(2, 2, 'P3', 'middle'), seat(2, 3, 'P4', 'window'),
    ],
  },
  {
    key: 'suv', title: 'SUV', desc: 'Front passenger, a full middle bench, two rear rows.',
    rows: 4, cols: 3,
    cells: [
      seat(1, 1, 'P1', 'front'), aisle(1, 2), driver(1, 3),
      seat(2, 1, 'P2', 'window'), seat(2, 2, 'P3', 'middle'), seat(2, 3, 'P4', 'window'),
      seat(3, 1, 'P5', 'window'), aisle(3, 2), seat(3, 3, 'P6', 'window'),
      seat(4, 1, 'P7', 'rear'), aisle(4, 2), seat(4, 3, 'P8', 'rear'),
    ],
  },
  {
    key: 'van', title: 'Van / Tempo', desc: 'Front passenger + two full benches.',
    rows: 3, cols: 3,
    cells: [
      seat(1, 1, 'P1', 'front'), aisle(1, 2), driver(1, 3),
      seat(2, 1, 'P2', 'window'), seat(2, 2, 'P3', 'middle'), seat(2, 3, 'P4', 'window'),
      seat(3, 1, 'P5', 'window'), seat(3, 2, 'P6', 'middle'), seat(3, 3, 'P7', 'window'),
    ],
  },
];

/**
 * Split-screen designer: inputs on the left, live preview on the right.
 * Clicking a preview cell opens the inline cell editor at the bottom of the
 * left column (kind, label, category, price delta). The preview updates as
 * you type — no "commit cell" button needed.
 *
 * Two hosting modes:
 *  • Route mode (default) — reached at /vehicle-seat-layouts/new|:id, reads the
 *    city from the top bar and navigates back to the list on save.
 *  • Embedded mode ([embedded]="true") — hosted in the Vehicles workspace
 *    drawer. City + vehicle type come from inputs, save/cancel emit events, and
 *    a "Start from" chooser (templates / copy existing / blank) runs first so
 *    the operator never stares at an empty grid.
 *
 * Save posts (or patches) the whole layout in one call; the server wipes and
 * re-inserts the cell set, so we don't have to diff on the client.
 */
@Component({
  selector: 'app-seat-layout-designer',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, SeatGridComponent, ReturnToSetupComponent],
  template: `
    <app-return-to-setup *ngIf="!embedded"></app-return-to-setup>
    <div class="cue" *ngIf="cityId == null && !embedded">Select a city (top bar) to design a layout.</div>

    <ng-container *ngIf="cityId != null">
      <!-- Route-mode page header -->
      <header class="head" *ngIf="!embedded">
        <div>
          <a class="back" routerLink="/vehicle-seat-layouts">← All layouts</a>
          <h1 class="head__title">{{ editingId ? 'Edit layout' : 'New seat layout' }}</h1>
          <p class="head__sub" *ngIf="!editingId">Design a reusable seat map. Every fixed departure that uses this vehicle type will start from it.</p>
        </div>
        <div class="head__actions">
          <a class="btn btn--ghost" routerLink="/vehicle-seat-layouts">Cancel</a>
          <button class="btn btn--primary" [disabled]="saving || !canSave()" (click)="save()">
            {{ saving ? 'Saving…' : (editingId ? 'Save changes' : 'Create layout') }}
          </button>
        </div>
      </header>

      <!-- Embedded toolbar -->
      <header class="ehead" *ngIf="embedded">
        <div class="ehead__id">
          <button type="button" class="back" *ngIf="started && !editingId" (click)="backToChooser()">← Change starting point</button>
          <h2 class="ehead__title">
            {{ editingId ? 'Edit seat layout' : 'New seat layout' }}
            <span class="ehead__vt" *ngIf="embeddedVehicleTypeName">· {{ embeddedVehicleTypeName }}</span>
          </h2>
          <p class="ehead__sub">A seat map is the picture a passenger taps to choose where to sit. Set it once — every fixed departure on this vehicle reuses it.</p>
        </div>
        <div class="ehead__actions">
          <button type="button" class="btn btn--ghost" (click)="cancelled.emit()">Cancel</button>
          <button type="button" class="btn btn--primary" *ngIf="started" [disabled]="saving || !canSave()" (click)="save()">
            {{ saving ? 'Saving…' : (editingId ? 'Save changes' : 'Create layout') }}
          </button>
        </div>
      </header>

      <!-- Embedded chooser: start from a template, a copy, or blank -->
      <div class="chooser" *ngIf="embedded && !started">
        <div class="chooser__block">
          <h3 class="chooser__t">Start from a template</h3>
          <p class="chooser__hint">Closest match to the vehicle — you can add, remove or rename seats after.</p>
          <div class="tpls">
            <button type="button" class="tpl" *ngFor="let p of presets" (click)="startFromPreset(p)">
              <div class="tpl__preview">
                <app-seat-grid [rows]="p.rows" [cols]="p.cols" [cells]="p.cells" [frame]="true" [showWheel]="false" [showLegend]="false"></app-seat-grid>
              </div>
              <div class="tpl__body">
                <span class="tpl__title">{{ p.title }}</span>
                <span class="tpl__seats">{{ seatCountOf(p.cells) }} seats</span>
                <span class="tpl__desc">{{ p.desc }}</span>
              </div>
            </button>
          </div>
        </div>

        <div class="chooser__block" *ngIf="existingLayouts.length">
          <h3 class="chooser__t">Copy an existing {{ embeddedVehicleTypeName || '' }} layout</h3>
          <p class="chooser__hint">Duplicate one you already built and adjust it.</p>
          <div class="tpls">
            <button type="button" class="tpl tpl--sm" *ngFor="let l of existingLayouts" (click)="startFromCopy(l)">
              <div class="tpl__preview">
                <app-seat-grid [rows]="l.rows" [cols]="l.cols" [cells]="l.cells" [frame]="true" [showWheel]="false" [showLegend]="false"></app-seat-grid>
              </div>
              <div class="tpl__body">
                <span class="tpl__title">{{ l.name }}</span>
                <span class="tpl__seats">{{ l.seat_count }} seats</span>
              </div>
            </button>
          </div>
        </div>

        <button type="button" class="blank" (click)="startBlank()">Or start from a blank grid →</button>
      </div>

      <!-- Editor -->
      <div class="split" *ngIf="!embedded || started">
        <!-- Inputs -->
        <section class="pane pane--form">
          <div class="section">
            <h3 class="section__t">Basics</h3>
            <div class="fields">
              <label class="field">
                <span class="field__lbl">Name <i>*</i></span>
                <input type="text" [(ngModel)]="form.name" placeholder="e.g. Ertiga 6P std" maxlength="120" />
                <span class="field__hint">A short name only you see — helps you pick it later.</span>
              </label>
              <label class="field" *ngIf="!embedded">
                <span class="field__lbl">Vehicle type <i>*</i></span>
                <select [(ngModel)]="form.vehicle_type_id">
                  <option [ngValue]="null" disabled>Select vehicle type</option>
                  <option *ngFor="let vt of vehicleTypes" [ngValue]="vt.id">{{ vt.name }}</option>
                </select>
              </label>
              <div class="field" *ngIf="embedded">
                <span class="field__lbl">Vehicle type</span>
                <div class="locked">{{ embeddedVehicleTypeName || '—' }}</div>
              </div>
              <label class="field field--check">
                <input type="checkbox" [(ngModel)]="form.is_active" />
                <span>Active (drivers can pick this layout)</span>
              </label>
            </div>
          </div>

          <div class="section">
            <h3 class="section__t">Grid size</h3>
            <div class="fields fields--row">
              <label class="field">
                <span class="field__lbl">Rows</span>
                <input type="number" min="1" max="20" [ngModel]="form.rows" (ngModelChange)="setRows($event)" />
              </label>
              <label class="field">
                <span class="field__lbl">Columns</span>
                <input type="number" min="1" max="10" [ngModel]="form.cols" (ngModelChange)="setCols($event)" />
              </label>
            </div>
            <p class="hint">Click any cell in the preview to make it a seat, aisle, or blocked space.</p>
          </div>

          <div class="section" *ngIf="selected">
            <h3 class="section__t">Cell &mdash; row {{ selected.row }}, col {{ selected.col }}</h3>
            <div class="fields">
              <label class="field">
                <span class="field__lbl">Kind</span>
                <select [ngModel]="selected.kind" (ngModelChange)="setSelectedKind($event)">
                  <option value="seat">Seat</option>
                  <option value="blocked">Blocked (driver, gap, etc.)</option>
                  <option value="aisle">Aisle</option>
                </select>
              </label>

              <ng-container *ngIf="selected.kind === 'seat'">
                <label class="field">
                  <span class="field__lbl">Label <i>*</i></span>
                  <input
                    type="text"
                    [ngModel]="selected.label"
                    (ngModelChange)="setSelectedLabel($event)"
                    maxlength="32"
                    placeholder="e.g. 2A"
                  />
                </label>
                <label class="field">
                  <span class="field__lbl">Category</span>
                  <select [ngModel]="selected.category" (ngModelChange)="setSelectedCategory($event)">
                    <option [ngValue]="null">— none —</option>
                    <option value="front">Front</option>
                    <option value="window">Window</option>
                    <option value="middle">Middle</option>
                    <option value="rear">Rear</option>
                    <option value="premium">Premium</option>
                  </select>
                </label>
                <label class="field">
                  <span class="field__lbl">Price delta (₹)</span>
                  <input
                    type="number"
                    [ngModel]="selected.price_delta"
                    (ngModelChange)="setSelectedPriceDelta($event)"
                    placeholder="0"
                  />
                  <span class="field__hint">Added to (or subtracted from) the route fare.</span>
                </label>
              </ng-container>

              <div class="field field--check" *ngIf="selected.kind === 'blocked'">
                <input type="checkbox" [checked]="isSelectedDriver()" (change)="toggleSelectedDriver($event)" />
                <span>This is the driver seat (shows a 🚗)</span>
              </div>

              <button class="btn btn--danger btn--sm" (click)="clearCell()">Remove this cell</button>
            </div>
          </div>

          <div class="section" *ngIf="!selected">
            <h3 class="section__t">Tip</h3>
            <p class="hint">Click any square in the preview on the right to add or edit a cell here.</p>
          </div>
        </section>

        <!-- Preview -->
        <section class="pane pane--preview">
          <div class="pane__inner">
            <div class="preview__title">Preview</div>
            <div class="preview__sub">{{ seatCount() }} seat{{ seatCount() === 1 ? '' : 's' }} · {{ form.rows }} × {{ form.cols }} grid</div>

            <app-seat-grid
              class="preview__grid"
              [rows]="form.rows"
              [cols]="form.cols"
              [cells]="form.cells"
              [frame]="true"
              [interactive]="true"
              (cellClick)="selectCell($event.row, $event.col)"
            />

            <div class="warn" *ngFor="let w of warnings()">⚠ {{ w }}</div>
          </div>
        </section>
      </div>
    </ng-container>
  `,
  styles: [`
    .cue { padding: 20px; color: var(--tm-text-muted); font-size: 13px; }
    .back { display: inline-block; font-size: 12px; color: var(--tm-text-muted); text-decoration: none; margin-bottom: 4px; background: none; border: 0; cursor: pointer; padding: 0; }
    .back:hover { color: var(--tm-green, #12b35b); }
    .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
    .head__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .head__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); max-width: 560px; }
    .head__actions { display: flex; gap: 8px; }

    /* Embedded toolbar */
    .ehead { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 2px 2px 16px; margin-bottom: 16px; border-bottom: 1px solid var(--tm-line); }
    .ehead__title { margin: 0; font-size: 18px; font-weight: 800; color: var(--tm-text); }
    .ehead__vt { color: var(--tm-text-muted); font-weight: 700; }
    .ehead__sub { margin: 5px 0 0; font-size: 12.5px; color: var(--tm-text-muted); max-width: 620px; }
    .ehead__actions { display: flex; gap: 8px; flex: none; }

    .btn { display: inline-flex; align-items: center; justify-content: center; padding: 9px 14px; border-radius: 9px; font-weight: 700; font-size: 13px; cursor: pointer; border: 1px solid transparent; text-decoration: none; }
    .btn[disabled] { opacity: .5; cursor: not-allowed; }
    .btn--primary { background: var(--tm-green, #12b35b); color: #fff; border-color: var(--tm-green, #12b35b); }
    .btn--ghost { background: #fff; color: var(--tm-text); border-color: var(--tm-line); }
    .btn--danger { background: #fff; color: #c0392b; border-color: #f1c7c1; }
    .btn--sm { padding: 6px 10px; font-size: 12px; }

    /* Chooser */
    .chooser { display: flex; flex-direction: column; gap: 26px; }
    .chooser__block { display: flex; flex-direction: column; }
    .chooser__t { margin: 0; font-size: 14px; font-weight: 800; color: var(--tm-text); }
    .chooser__hint { margin: 3px 0 12px; font-size: 12.5px; color: var(--tm-text-muted); }
    .tpls { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 14px; }
    .tpl { display: flex; flex-direction: column; text-align: left; background: #fff; border: 1px solid var(--tm-line); border-radius: 14px; padding: 14px; cursor: pointer; transition: border-color 120ms, box-shadow 120ms, transform 120ms; }
    .tpl:hover { border-color: var(--tm-green, #12b35b); box-shadow: 0 8px 22px rgba(18,179,91,.12); transform: translateY(-2px); }
    .tpl__preview { height: 152px; overflow: hidden; display: flex; justify-content: center; align-items: flex-start; background: #fafbfc; border: 1px solid #eef1f4; border-radius: 10px; padding: 10px; margin-bottom: 12px; pointer-events: none; }
    .tpl__preview app-seat-grid { transform: scale(.55); transform-origin: top center; }
    .tpl--sm .tpl__preview { height: 120px; }
    .tpl__body { display: flex; flex-direction: column; gap: 2px; }
    .tpl__title { font-size: 13.5px; font-weight: 800; color: var(--tm-text); }
    .tpl__seats { font-size: 11px; font-weight: 700; color: var(--tm-green-deep, #0e7a3d); }
    .tpl__desc { font-size: 12px; color: var(--tm-text-muted); margin-top: 2px; }
    .blank { align-self: flex-start; background: none; border: 0; padding: 4px 0; font-size: 13px; font-weight: 700; color: var(--tm-text-muted); cursor: pointer; }
    .blank:hover { color: var(--tm-green, #12b35b); }

    .split { display: grid; grid-template-columns: 380px 1fr; gap: 20px; align-items: start; }
    @media (max-width: 900px) { .split { grid-template-columns: 1fr; } }
    .pane { background: #fff; border: 1px solid #eaeef2; border-radius: 14px; padding: 18px; }
    .pane--preview { background: #fafbfc; }
    .section + .section { margin-top: 22px; padding-top: 18px; border-top: 1px dashed #eceff2; }
    .section__t { margin: 0 0 10px; font-size: 13px; font-weight: 800; color: var(--tm-text); text-transform: uppercase; letter-spacing: .04em; }
    .fields { display: flex; flex-direction: column; gap: 12px; }
    .fields--row { flex-direction: row; }
    .fields--row .field { flex: 1; }
    .field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
    .field--check { flex-direction: row; align-items: center; gap: 8px; font-weight: 600; color: var(--tm-text); }
    .field__lbl { font-weight: 700; color: var(--tm-text); font-size: 12px; }
    .field__lbl i { color: #c0392b; font-style: normal; }
    .field__hint { font-size: 11px; color: var(--tm-text-muted); }
    .locked { padding: 8px 10px; border: 1px solid var(--tm-line); border-radius: 8px; font-size: 13px; font-weight: 700; color: var(--tm-text); background: #f6f8fa; }
    .field input, .field select { padding: 8px 10px; border: 1px solid var(--tm-line); border-radius: 8px; font-size: 13px; background: #fff; }
    .field input:focus, .field select:focus { outline: 2px solid #b7e8ca; outline-offset: -1px; border-color: #12b35b; }
    .hint { font-size: 12px; color: var(--tm-text-muted); margin: 8px 0 0; }
    .preview__title { font-size: 14px; font-weight: 800; color: var(--tm-text); }
    .preview__sub { font-size: 12px; color: var(--tm-text-muted); margin: 2px 0 14px; }
    .preview__grid { display: block; margin-top: 4px; }
    .warn { margin-top: 12px; font-size: 12px; color: #9a6a11; background: #fdf1dc; padding: 8px 12px; border-radius: 8px; }
  `],
})
export class SeatLayoutDesignerComponent implements OnInit, OnDestroy {
  // ── embedded-mode inputs/outputs ──────────────────────────────────
  @Input() embedded = false;
  @Input() embeddedCityId: number | null = null;
  @Input() embeddedVehicleTypeId: number | null = null;
  @Input() embeddedVehicleTypeName = '';
  @Input() embeddedLayoutId: number | null = null;
  /** Full layout to edit — passed straight in so the editor fills instantly,
   *  with no dependency on a re-fetch (list rows already carry all cells). */
  @Input() editLayoutData: VehicleSeatLayout | null = null;
  @Input() existingLayouts: VehicleSeatLayout[] = [];
  @Output() saved = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  cityId: number | null = null;
  editingId: number | null = null;
  vehicleTypes: VehicleTypeRef[] = [];
  saving = false;

  /** Embedded only: has the operator chosen a starting point yet? */
  started = false;
  presets = LAYOUT_PRESETS;

  form: SeatLayoutPayload = this.blankForm();
  selected: SeatCell | null = null;

  private sub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cityCtx: CityContextService,
    private api: ApiService,
    private svc: VehicleSeatLayoutsService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    if (this.embedded) {
      this.cityId = this.embeddedCityId;
      this.form.vehicle_type_id = this.embeddedVehicleTypeId ?? 0;
      if (this.editLayoutData) {
        // Editing: fill straight from the passed-in layout so the current seats
        // show immediately. Jump past the chooser into the editor.
        this.editingId = this.editLayoutData.id;
        this.fillForm(this.editLayoutData);
        this.form.vehicle_type_id = this.embeddedVehicleTypeId ?? this.editLayoutData.vehicle_type_id;
        this.started = true;
      } else {
        // New: show the "start from" chooser first.
        this.editingId = this.embeddedLayoutId;
        this.started = this.editingId != null;
      }
      this.loadRefs();
      return;
    }

    const idParam = this.route.snapshot.paramMap.get('id');
    this.editingId = idParam && idParam !== 'new' ? Number(idParam) : null;

    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.sub = this.cityCtx.cityId$.subscribe((id) => {
      this.cityId = id;
      if (id != null) this.loadRefs();
    });
  }
  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  private blankForm(): SeatLayoutPayload {
    return { name: '', vehicle_type_id: 0, rows: 3, cols: 3, is_active: true, cells: [] };
  }

  private loadRefs(): void {
    if (this.cityId == null) return;

    // Skip the layout fetch when we were handed the full layout already.
    const layoutCall = this.editingId && !this.editLayoutData
      ? this.svc.get(this.cityId, this.editingId)
      : of(null);
    const vtCall = this.api.get<{ data: VehicleTypeRef[] }>('/admin/vehicle-types-global');

    forkJoin([vtCall, layoutCall]).subscribe({
      next: ([vtRes, layoutRes]) => {
        this.vehicleTypes = vtRes?.data || [];
        if (layoutRes?.layout) this.fillForm(layoutRes.layout);
      },
      error: (e) => { this.toast.error(e?.error?.message || 'Could not load form.'); },
    });
  }

  private fillForm(l: VehicleSeatLayout): void {
    this.form = {
      name: l.name,
      vehicle_type_id: l.vehicle_type_id,
      rows: l.rows,
      cols: l.cols,
      is_active: l.is_active,
      cells: l.cells.map((c) => ({
        row: c.row, col: c.col, kind: c.kind,
        label: c.label ?? null, category: c.category ?? null,
        price_delta: c.price_delta ?? 0,
      })),
    };
  }

  // ── Chooser (embedded) ────────────────────────────────────────────
  seatCountOf(cells: SeatCell[]): number {
    return cells.filter((c) => c.kind === 'seat').length;
  }

  startFromPreset(p: LayoutPreset): void {
    this.form.rows = p.rows;
    this.form.cols = p.cols;
    this.form.cells = p.cells.map((c) => ({ ...c }));
    if (!this.form.name.trim()) {
      const base = this.embeddedVehicleTypeName || p.title;
      this.form.name = `${base} ${this.seatCountOf(p.cells)}P`;
    }
    this.selected = null;
    this.started = true;
  }

  startFromCopy(l: VehicleSeatLayout): void {
    this.fillForm(l);
    // Lock to the workspace's vehicle type and make it a brand-new layout.
    this.form.vehicle_type_id = this.embeddedVehicleTypeId ?? l.vehicle_type_id;
    this.form.name = `${l.name} (copy)`;
    this.editingId = null;
    this.selected = null;
    this.started = true;
  }

  startBlank(): void {
    this.form.rows = 3;
    this.form.cols = 3;
    this.form.cells = [];
    this.selected = null;
    this.started = true;
  }

  backToChooser(): void {
    this.started = false;
    this.selected = null;
  }

  // ── Grid size ────────────────────────────────────────────────────
  setRows(n: number): void {
    const rows = Math.max(1, Math.min(20, Number(n) || 1));
    this.form.rows = rows;
    this.form.cells = this.form.cells.filter((c) => c.row <= rows);
    if (this.selected && this.selected.row > rows) this.selected = null;
  }
  setCols(n: number): void {
    const cols = Math.max(1, Math.min(10, Number(n) || 1));
    this.form.cols = cols;
    this.form.cells = this.form.cells.filter((c) => c.col <= cols);
    if (this.selected && this.selected.col > cols) this.selected = null;
  }

  // ── Cell selection & editing ──────────────────────────────────────
  selectCell(row: number, col: number): void {
    const existing = this.form.cells.find((c) => c.row === row && c.col === col);
    if (existing) { this.selected = existing; return; }
    // New cell defaults to a seat with an auto label.
    const seat: SeatCell = {
      row, col, kind: 'seat',
      label: this.suggestLabel(row, col),
      category: null,
      price_delta: 0,
    };
    this.form.cells.push(seat);
    this.selected = seat;
  }

  private suggestLabel(row: number, col: number): string {
    const col2Letter = String.fromCharCode(64 + col); // 1 → A, 2 → B, …
    const candidate = `${row}${col2Letter}`;
    // Bump if it collides with an existing label.
    const taken = new Set(this.form.cells.filter((c) => c.kind === 'seat' && c.label).map((c) => c.label));
    if (!taken.has(candidate)) return candidate;
    let i = 2;
    while (taken.has(`${candidate}-${i}`)) i++;
    return `${candidate}-${i}`;
  }

  setSelectedKind(kind: SeatCellKind): void {
    if (!this.selected) return;
    this.selected.kind = kind;
    if (kind !== 'seat') {
      this.selected.label = null;
      this.selected.category = null;
      this.selected.price_delta = 0;
    } else if (!this.selected.label) {
      this.selected.label = this.suggestLabel(this.selected.row, this.selected.col);
    }
  }
  setSelectedLabel(v: string): void {
    if (this.selected) this.selected.label = v;
  }
  setSelectedCategory(v: SeatCategory | null): void {
    if (this.selected) this.selected.category = v;
  }
  setSelectedPriceDelta(v: number | string): void {
    if (this.selected) this.selected.price_delta = Number(v) || 0;
  }
  clearCell(): void {
    if (!this.selected) return;
    this.form.cells = this.form.cells.filter((c) => c !== this.selected);
    this.selected = null;
  }

  isSelectedDriver(): boolean {
    return !!this.selected && this.selected.kind === 'blocked'
      && (this.selected.label || '').trim().toUpperCase() === 'D';
  }
  toggleSelectedDriver(e: Event): void {
    if (!this.selected) return;
    this.selected.label = (e.target as HTMLInputElement).checked ? 'D' : null;
  }

  // ── Derived ──────────────────────────────────────────────────────
  seatCount(): number {
    return this.form.cells.filter((c) => c.kind === 'seat').length;
  }
  warnings(): string[] {
    const out: string[] = [];
    if (this.seatCount() < 1) out.push('Add at least one seat cell before saving.');
    const seats = this.form.cells.filter((c) => c.kind === 'seat');
    if (seats.some((s) => !s.label || !s.label.trim())) out.push('Every seat needs a label.');
    const labels = seats.map((s) => (s.label || '').trim()).filter(Boolean);
    if (new Set(labels).size !== labels.length) out.push('Two seats share a label — labels must be unique.');
    return out;
  }
  canSave(): boolean {
    return !!this.form.name.trim()
      && !!this.form.vehicle_type_id
      && this.warnings().length === 0;
  }

  // ── Save ─────────────────────────────────────────────────────────
  save(): void {
    if (this.cityId == null || !this.canSave()) return;
    this.saving = true;
    const payload: SeatLayoutPayload = {
      ...this.form,
      name: this.form.name.trim(),
      cells: this.form.cells.map((c) => ({
        ...c,
        // Seats and blocked cells keep their label (blocked "D" = driver);
        // aisles never carry one.
        label: c.kind === 'aisle' ? null : ((c.label || '').trim() || null),
        price_delta: Number(c.price_delta) || 0,
      })),
    };

    const call = this.editingId
      ? this.svc.update(this.cityId, this.editingId, payload)
      : this.svc.create(this.cityId, payload);

    call.subscribe({
      next: () => {
        this.saving = false;
        this.toast.success(this.editingId ? 'Layout updated.' : 'Layout created.');
        if (this.embedded) { this.saved.emit(); return; }
        this.router.navigateByUrl('/vehicle-seat-layouts');
      },
      error: (e) => {
        this.saving = false;
        this.toast.error(e?.error?.message || 'Could not save layout.');
      },
    });
  }
}
