import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SeatCell } from './vehicle-seat-layouts.service';

/**
 * Shared seat-grid renderer. Given rows × cols + a sparse list of cells,
 * fills the grid and renders each cell as seat/blocked/aisle. Emits
 * (cellClick) with (row, col) when the parent wants to edit a cell.
 *
 * Reused by the admin designer and the customer picker (M5). The `selected`
 * input turns a seat green so the picker can highlight the passenger's choice.
 */
@Component({
  selector: 'app-seat-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <!-- Framed: draw the grid inside a car body with a rounded hood + headlights
         (top-view, airplane-seat-map style). -->
    <div class="body" [class.body--frame]="frame">
      <div class="hood" *ngIf="frame">
        <span class="hood__light"></span>
        <span class="hood__glass"></span>
        <span class="hood__light"></span>
      </div>

      <div class="wheel" *ngIf="showWheel && !frame">
        <span class="wheel__ic">🚗</span>
        <span class="wheel__lbl">Front</span>
      </div>

      <div class="grid" [class.grid--frame]="frame" [style.grid-template-columns]="'repeat(' + cols + ', minmax(' + (frame ? 44 : 52) + 'px, 1fr))'">
        <ng-container *ngFor="let r of rowRange">
          <ng-container *ngFor="let c of colRange">
            <ng-container *ngIf="cellAt(r, c) as cell; else empty">
              <button
                type="button"
                class="cell"
                [class.cell--seat]="cell.kind === 'seat'"
                [class.cell--blocked]="cell.kind === 'blocked' && !isDriver(cell)"
                [class.cell--driver]="isDriver(cell)"
                [class.cell--aisle]="cell.kind === 'aisle'"
                [class.cell--selected]="cell.kind === 'seat' && isSelected(cell.label)"
                [class.cell--interactive]="interactive"
                [attr.data-cat]="cell.category || null"
                [disabled]="!interactive"
                (click)="cellClick.emit({ row: r, col: c })"
              >
                <span class="cell__lbl" *ngIf="cell.kind === 'seat'">{{ cell.label || '?' }}</span>
                <span class="cell__lbl cell__wheel" *ngIf="isDriver(cell)" title="Driver">🚗</span>
                <span class="cell__lbl cell__lbl--muted" *ngIf="cell.kind === 'blocked' && !isDriver(cell)">{{ cell.label || '✕' }}</span>
                <span class="cell__lbl cell__lbl--muted" *ngIf="cell.kind === 'aisle' && interactive">·</span>
                <span
                  class="cell__delta"
                  *ngIf="cell.kind === 'seat' && cell.price_delta"
                >{{ (cell.price_delta! > 0 ? '+' : '') }}₹{{ cell.price_delta }}</span>
              </button>
            </ng-container>
            <ng-template #empty>
              <button
                type="button"
                class="cell cell--empty"
                [class.cell--interactive]="interactive"
                [disabled]="!interactive"
                (click)="cellClick.emit({ row: r, col: c })"
              >
                <span class="cell__lbl cell__lbl--muted" *ngIf="interactive">+</span>
              </button>
            </ng-template>
          </ng-container>
        </ng-container>
      </div>
    </div>

    <div class="legend" *ngIf="showLegend">
      <span class="legend__item"><span class="dot dot--seat"></span>Seat</span>
      <span class="legend__item"><span class="dot dot--blocked"></span>Blocked</span>
      <span class="legend__item"><span class="dot dot--aisle"></span>Aisle</span>
      <span class="legend__item" *ngIf="selectedLabels?.length"><span class="dot dot--selected"></span>Selected</span>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .wheel { display: flex; align-items: center; gap: 8px; color: var(--tm-text-muted); font-size: 12px; font-weight: 700; margin-bottom: 10px; padding: 8px 12px; background: linear-gradient(90deg, #f5f7fa, transparent); border-left: 3px solid #12b35b; border-radius: 4px; }
    .wheel__ic { font-size: 16px; }

    /* Vehicle body (top view) — rounded hood at the front + headlights. */
    .body--frame { display: inline-block; padding: 16px 18px 20px; border: 2px solid #cbd5e1; border-radius: 54px 54px 22px 22px; background: linear-gradient(#f8fafc, #eef2f7); box-shadow: inset 0 2px 10px rgba(15,23,42,.05); }
    .hood { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; padding: 0 4px; }
    .hood__light { width: 15px; height: 9px; border-radius: 7px; background: #fde68a; border: 1px solid #f2c94c; box-shadow: 0 0 7px rgba(250,204,21,.7); flex: none; }
    .hood__glass { flex: 1; height: 11px; border-radius: 9px; background: linear-gradient(#dbeafe, #bfdbfe); border: 1px solid #bcd3f2; }

    .grid { display: grid; gap: 8px; }
    .grid--frame { gap: 7px; }
    .cell {
      position: relative; border: 1px solid #d7dde3; background: #fff; border-radius: 10px;
      aspect-ratio: 1 / 1; min-height: 48px;
      display: flex; align-items: center; justify-content: center;
      font-weight: 800; font-size: 13px; color: var(--tm-text);
      cursor: default; transition: transform 80ms, border-color 100ms, background 100ms;
    }
    .cell--interactive { cursor: pointer; }
    .cell--interactive:hover { border-color: #12b35b; transform: translateY(-1px); }
    .cell--seat { background: #eefaf2; border-color: #b7e8ca; color: #0e7a3d; }
    .cell--seat[data-cat="premium"] { background: #fff4e1; border-color: #f4c876; color: #a05a00; }
    .cell--seat[data-cat="front"]   { background: #eaf2ff; border-color: #b6cff5; color: #244d99; }
    .cell--seat[data-cat="window"]  { background: #e6f8f5; border-color: #a7dfd3; color: #0f6d5a; }
    .cell--seat[data-cat="rear"]    { background: #f2eaf8; border-color: #ccb1e2; color: #593591; }
    .cell--blocked { background: repeating-linear-gradient(45deg, #f3f5f7, #f3f5f7 6px, #e7ebef 6px, #e7ebef 12px); border-color: #d3d8de; color: #9099a1; }
    .cell--driver { background: #eef2f7; border-color: #c3ccd6; color: #47536a; }
    .cell--driver .cell__wheel { font-size: 18px; }
    .cell--aisle { background: transparent; border: 1px dashed #d7dde3; color: #b5bbc2; }
    .cell--empty { background: #fafbfc; border-style: dashed; color: #c3c9d0; }
    /* In a read-only preview, aisles and unused cells are just clean spacing —
       no dashed boxes — so the seats read as a real vehicle top view. */
    .cell--aisle:not(.cell--interactive),
    .cell--empty:not(.cell--interactive) { background: transparent; border-color: transparent; box-shadow: none; }
    .cell--selected { background: #12b35b !important; border-color: #0e7a3d !important; color: #fff !important; box-shadow: 0 4px 12px rgba(18,179,91,.35); }
    .cell__lbl { line-height: 1; }
    .cell__lbl--muted { color: inherit; opacity: .8; font-weight: 600; }
    .cell__delta { position: absolute; bottom: 3px; right: 4px; font-size: 9px; font-weight: 700; opacity: .8; }
    .legend { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 14px; padding-top: 12px; border-top: 1px dashed #eceff2; font-size: 12px; color: var(--tm-text-muted); font-weight: 600; }
    .legend__item { display: inline-flex; align-items: center; gap: 6px; }
    .dot { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
    .dot--seat { background: #eefaf2; border: 1px solid #b7e8ca; }
    .dot--blocked { background: #e7ebef; }
    .dot--aisle { background: transparent; border: 1px dashed #d7dde3; }
    .dot--selected { background: #12b35b; border: 1px solid #0e7a3d; }
  `],
})
export class SeatGridComponent {
  @Input() rows = 1;
  @Input() cols = 1;
  @Input() cells: SeatCell[] = [];
  @Input() interactive = false;
  @Input() showLegend = true;
  @Input() showWheel = true;
  @Input() frame = false;
  @Input() selectedLabels: string[] = [];

  @Output() cellClick = new EventEmitter<{ row: number; col: number }>();

  get rowRange(): number[] {
    return Array.from({ length: Math.max(1, this.rows) }, (_, i) => i + 1);
  }
  get colRange(): number[] {
    return Array.from({ length: Math.max(1, this.cols) }, (_, i) => i + 1);
  }

  cellAt(row: number, col: number): SeatCell | undefined {
    return this.cells.find((c) => c.row === row && c.col === col);
  }

  isSelected(label?: string | null): boolean {
    return !!label && this.selectedLabels.includes(label);
  }

  /** A blocked cell labelled "D" is the driver position in a top-view map. */
  isDriver(cell: SeatCell): boolean {
    return cell.kind === 'blocked' && (cell.label || '').trim().toUpperCase() === 'D';
  }
}
