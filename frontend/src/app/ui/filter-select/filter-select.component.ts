import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icon-registry';

export interface FilterOption {
  label: string;
  value: string;
}

/**
 * Shared filter dropdown used in data-table toolbars across the admin.
 *
 *   <tm-filter-select
 *     icon="shield"
 *     ariaLabel="Status filter"
 *     allLabel="All statuses"
 *     [options]="statusOptions"
 *     [(value)]="status"
 *     (valueChange)="fetch()" />
 *
 * Self-manages its open/close state: clicking the trigger closes any other
 * open instance, document-click and Escape close it. A green "has-value"
 * treatment signals an active (non-"all") selection.
 */
@Component({
  selector: 'tm-filter-select',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="fs" [class.has-value]="hasValue" [class.is-open]="open">
      <button
        type="button"
        class="fs__trigger"
        (click)="toggle($event)"
        [attr.aria-expanded]="open"
        aria-haspopup="listbox"
        [attr.aria-label]="ariaLabel || allLabel"
      >
        <span class="fs__icon" aria-hidden="true"><tm-icon [name]="icon" [size]="14" /></span>
        <span class="fs__value">{{ currentLabel }}</span>
        <tm-icon name="chevron-down" [size]="12" class="fs__caret" />
      </button>

      <ul class="fs__menu" *ngIf="open" role="listbox" (click)="$event.stopPropagation()">
        <li
          *ngIf="includeAll"
          class="fs__option"
          [class.is-selected]="value === allValue"
          role="option"
          [attr.aria-selected]="value === allValue"
          (click)="select(allValue)"
        >
          <tm-icon *ngIf="value === allValue" name="check" [size]="12" class="fs__check" />
          <span class="fs__option-label">{{ allLabel }}</span>
        </li>
        <li
          *ngFor="let opt of options"
          class="fs__option"
          [class.is-selected]="value === opt.value"
          role="option"
          [attr.aria-selected]="value === opt.value"
          (click)="select(opt.value)"
        >
          <tm-icon *ngIf="value === opt.value" name="check" [size]="12" class="fs__check" />
          <span class="fs__option-label">{{ opt.label }}</span>
        </li>
      </ul>
    </div>
  `,
  styles: [`
    .fs { position: relative; display: inline-block; }
    .fs__trigger {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 9px 14px;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      background: transparent;
      font-family: var(--tm-font-body);
      font-size: 13px; font-weight: 700;
      color: var(--tm-text);
      cursor: pointer; line-height: 1.2;
      transition: border-color var(--tm-duration-fast) var(--tm-ease),
                  background var(--tm-duration-fast) var(--tm-ease);
    }
    .fs__trigger:hover { border-color: var(--tm-ink); }
    .fs.is-open .fs__trigger { border-color: var(--tm-ink); }
    .fs.has-value .fs__trigger {
      background: var(--tm-green-tint);
      border-color: var(--tm-green-deep);
    }
    .fs__icon { color: var(--tm-text-muted); display: inline-flex; }
    .fs.has-value .fs__icon { color: var(--tm-green-deep); }
    .fs__value { min-width: 96px; text-align: left; }
    .fs__caret {
      color: var(--tm-text-soft);
      transition: transform var(--tm-duration-fast) var(--tm-ease);
    }
    .fs.is-open .fs__caret { transform: rotate(180deg); }
    .fs.has-value .fs__caret { color: var(--tm-green-deep); }

    .fs__menu {
      position: absolute; top: calc(100% + 6px); left: 0; right: 0;
      min-width: 180px; margin: 0; padding: 6px;
      list-style: none;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      box-shadow: var(--tm-shadow-pop);
      z-index: 1100;
      animation: fs-in 140ms var(--tm-ease) both;
    }
    @keyframes fs-in {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .fs__option {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; border-radius: var(--tm-radius-sm);
      font-size: 12px; font-weight: 600; color: var(--tm-text);
      cursor: pointer;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .fs__option:hover { background: var(--tm-canvas-2); }
    .fs__option.is-selected {
      background: var(--tm-green-tint);
      color: var(--tm-green-deep);
      font-weight: 700;
    }
    .fs__check { color: var(--tm-green-deep); flex-shrink: 0; }
    .fs__option-label { flex: 1; }
  `],
})
export class FilterSelectComponent {
  private static openInstances = new Set<FilterSelectComponent>();

  @Input() icon: IconName = 'filter';
  @Input() options: FilterOption[] = [];
  @Input() value = 'all';
  @Input() allLabel = 'All';
  @Input() allValue = 'all';
  @Input() includeAll = true;
  @Input() ariaLabel = '';

  @Output() valueChange = new EventEmitter<string>();

  open = false;

  get hasValue(): boolean {
    return this.value !== this.allValue;
  }

  get currentLabel(): string {
    if (this.value === this.allValue) return this.allLabel;
    return this.options.find((o) => o.value === this.value)?.label ?? this.allLabel;
  }

  toggle(e: MouseEvent): void {
    e.stopPropagation();
    if (this.open) {
      this.close();
      return;
    }
    FilterSelectComponent.openInstances.forEach((i) => i.close());
    this.open = true;
    FilterSelectComponent.openInstances.add(this);
  }

  select(v: string): void {
    this.close();
    if (v === this.value) return;
    this.value = v;
    this.valueChange.emit(v);
  }

  close(): void {
    this.open = false;
    FilterSelectComponent.openInstances.delete(this);
  }

  @HostListener('document:click') onDocClick(): void {
    this.close();
  }

  @HostListener('document:keydown.escape') onEsc(): void {
    this.close();
  }
}
