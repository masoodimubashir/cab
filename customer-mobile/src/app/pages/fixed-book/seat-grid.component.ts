import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

export type SeatCellKind = 'seat' | 'blocked' | 'aisle';
export type SeatStatus = 'AVAILABLE' | 'HELD' | 'BOOKED' | 'BLOCKED' | 'AISLE';

export interface SeatMapCell {
  row: number;
  col: number;
  kind: SeatCellKind;
  label: string | null;
  category: string | null;
  price_delta: number;
  status: SeatStatus;
}

/**
 * Read-only seat grid for the customer picker. Renders the whole layout:
 * seats (tappable, colour-coded by status), blocked cells (hatched), aisles
 * (dashed placeholder). Emits (seatTap) with the seat label so the parent
 * can toggle selection.
 *
 * Ported from the admin `SeatGridComponent` (frontend/) with mobile-friendly
 * touch targets (min 44×44).
 */
@Component({
  selector: 'app-seat-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="wheel" *ngIf="showWheel">
      <span class="wheel__ic">🚗</span>
      <span class="wheel__lbl">Front</span>
    </div>

    <div class="grid" [style.grid-template-columns]="'repeat(' + cols + ', minmax(44px, 1fr))'">
      <ng-container *ngFor="let r of rowRange">
        <ng-container *ngFor="let c of colRange">
          <ng-container *ngIf="cellAt(r, c) as cell; else empty">
            <button
              type="button"
              class="cell"
              [class.cell--seat]="cell.kind === 'seat'"
              [class.cell--blocked]="cell.kind === 'blocked'"
              [class.cell--aisle]="cell.kind === 'aisle'"
              [class.cell--available]="cell.status === 'AVAILABLE'"
              [class.cell--held]="cell.status === 'HELD'"
              [class.cell--booked]="cell.status === 'BOOKED'"
              [class.cell--selected]="isSelected(cell.label)"
              [attr.data-cat]="cell.category || null"
              [disabled]="cell.kind !== 'seat' || cell.status === 'BOOKED' || (cell.status === 'HELD' && !isSelected(cell.label))"
              (click)="onSeatTap(cell)"
            >
              <span class="cell__lbl" *ngIf="cell.kind === 'seat'">{{ cell.label }}</span>
              <span class="cell__lbl cell__lbl--muted" *ngIf="cell.kind === 'blocked'">✕</span>
              <span class="cell__lbl cell__lbl--muted" *ngIf="cell.kind === 'aisle'">·</span>
              <span class="cell__delta" *ngIf="cell.kind === 'seat' && cell.price_delta">
                {{ cell.price_delta > 0 ? '+' : '' }}₹{{ cell.price_delta }}
              </span>
            </button>
          </ng-container>
          <ng-template #empty>
            <div class="cell cell--empty"></div>
          </ng-template>
        </ng-container>
      </ng-container>
    </div>

    <div class="legend" *ngIf="showLegend">
      <span class="legend__item"><span class="dot dot--available"></span>Available</span>
      <span class="legend__item"><span class="dot dot--selected"></span>Your pick</span>
      <span class="legend__item"><span class="dot dot--booked"></span>Taken</span>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .wheel { display: flex; align-items: center; gap: 8px; color: #6b7280; font-size: 12px; font-weight: 700; margin-bottom: 10px; padding: 8px 12px; background: linear-gradient(90deg, #f5f7fa, transparent); border-left: 3px solid #12b35b; border-radius: 4px; }
    .wheel__ic { font-size: 16px; }
    .grid { display: grid; gap: 8px; }
    .cell {
      position: relative; border: 1px solid #d7dde3; background: #fff; border-radius: 10px;
      aspect-ratio: 1 / 1; min-height: 44px;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 13px; color: #1a2028;
      transition: transform 80ms, border-color 100ms, background 100ms;
      padding: 0;
    }
    .cell[disabled] { opacity: .55; }
    .cell--seat:not([disabled]):active { transform: scale(.94); }
    .cell--available { background: #eefaf2; border-color: #b7e8ca; color: #0e7a3d; }
    .cell--held { background: #fff4e1; border-color: #f4c876; color: #a05a00; opacity: .75; }
    .cell--booked { background: #f2f4f6; border-color: #d3d8de; color: #9099a1; text-decoration: line-through; }
    .cell--selected { background: #12b35b !important; border-color: #0e7a3d !important; color: #fff !important; box-shadow: 0 4px 12px rgba(18,179,91,.35); }
    .cell--blocked { background: repeating-linear-gradient(45deg, #f3f5f7, #f3f5f7 6px, #e7ebef 6px, #e7ebef 12px); border-color: #d3d8de; color: #9099a1; }
    .cell--aisle { background: transparent; border: 1px dashed #d7dde3; color: #b5bbc2; }
    .cell--empty { background: transparent; border: 1px dashed #eceff2; }
    .cell__lbl { line-height: 1; }
    .cell__lbl--muted { color: inherit; opacity: .7; font-weight: 500; }
    .cell__delta { position: absolute; bottom: 2px; right: 3px; font-size: 9px; font-weight: 700; opacity: .8; }
    .legend { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 14px; padding-top: 12px; border-top: 1px dashed #eceff2; font-size: 12px; color: #6b7280; font-weight: 600; }
    .legend__item { display: inline-flex; align-items: center; gap: 6px; }
    .dot { width: 12px; height: 12px; border-radius: 4px; display: inline-block; }
    .dot--available { background: #eefaf2; border: 1px solid #b7e8ca; }
    .dot--selected { background: #12b35b; border: 1px solid #0e7a3d; }
    .dot--booked { background: #f2f4f6; border: 1px solid #d3d8de; }
  `],
})
export class SeatGridComponent {
  @Input() rows = 1;
  @Input() cols = 1;
  @Input() cells: SeatMapCell[] = [];
  @Input() selectedLabels: string[] = [];
  @Input() showLegend = true;
  @Input() showWheel = true;

  @Output() seatTap = new EventEmitter<string>();

  get rowRange(): number[] {
    return Array.from({ length: Math.max(1, this.rows) }, (_, i) => i + 1);
  }
  get colRange(): number[] {
    return Array.from({ length: Math.max(1, this.cols) }, (_, i) => i + 1);
  }

  cellAt(row: number, col: number): SeatMapCell | undefined {
    return this.cells.find((c) => c.row === row && c.col === col);
  }

  isSelected(label: string | null): boolean {
    return !!label && this.selectedLabels.includes(label);
  }

  onSeatTap(cell: SeatMapCell): void {
    if (cell.kind !== 'seat' || !cell.label) return;
    if (cell.status === 'BOOKED') return;
    if (cell.status === 'HELD' && !this.isSelected(cell.label)) return;
    this.seatTap.emit(cell.label);
  }
}
