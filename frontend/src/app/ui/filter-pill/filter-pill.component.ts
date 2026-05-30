import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icon-registry';

/**
 * Dismissable active-filter pill, shown in a data-table's banner slot.
 *
 *   <tm-filter-pill icon="search" label="Search" [value]="q" (clear)="clearSearch()" />
 *   <tm-filter-pill icon="shield" label="Status" [value]="statusLabel" (clear)="clearStatus()" />
 */
@Component({
  selector: 'tm-filter-pill',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <span class="fp__icon" *ngIf="icon"><tm-icon [name]="icon" [size]="11" /></span>
    <span class="fp__label" *ngIf="label">{{ label }}</span>
    <span class="fp__value">{{ value }}</span>
    <button
      type="button"
      class="fp__close"
      (click)="clear.emit()"
      [attr.aria-label]="'Clear ' + (label || 'filter')"
    >
      <tm-icon name="x" [size]="12" />
    </button>
  `,
  styles: [`
    :host {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 6px 6px 6px 12px;
      border-radius: var(--tm-radius-pill);
      background: var(--tm-surface);
      border: 1px solid var(--tm-line-2);
      font-size: 12px; font-weight: 700;
      color: var(--tm-text);
    }
    .fp__icon { display: inline-flex; color: var(--tm-text-muted); }
    .fp__label {
      font-size: 10px; font-weight: 800;
      letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--tm-text-muted);
    }
    .fp__value {
      font-family: var(--tm-font-mono);
      font-weight: 700;
      color: var(--tm-text);
    }
    .fp__close {
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px;
      border-radius: 50%; border: 0;
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
      cursor: pointer;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .fp__close:hover { background: var(--tm-ink); color: #fff; }
  `],
})
export class FilterPillComponent {
  @Input() icon: IconName = 'filter';
  @Input() label = '';
  @Input() value = '';

  @Output() clear = new EventEmitter<void>();
}
