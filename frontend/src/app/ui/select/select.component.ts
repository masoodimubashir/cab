import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  ViewChild,
  forwardRef,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { IconComponent } from '../icon/icon.component';

export interface SelectOption<T = unknown> {
  label: string;
  value: T;
  disabled?: boolean;
}

/**
 * Branded dropdown that replaces `p-dropdown`. Button + popover + listbox,
 * keyboard-navigable, and a `ControlValueAccessor` so `[(ngModel)]` works.
 *
 *   <tm-select
 *     [options]="categoryOptions"
 *     [(ngModel)]="form.category"
 *     placeholder="Choose category"
 *   />
 */
@Component({
  selector: 'tm-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IconComponent],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      multi: true,
      useExisting: forwardRef(() => SelectComponent),
    },
  ],
  template: `
    <div class="wrap" [class.is-open]="open" [class.is-disabled]="disabled">
      <button
        #trigger
        type="button"
        class="trigger"
        [disabled]="disabled"
        [attr.aria-expanded]="open"
        aria-haspopup="listbox"
        (click)="toggle($event)"
        (keydown)="onTriggerKey($event)"
      >
        <span class="trigger__value" [class.is-placeholder]="!selectedLabel">
          {{ selectedLabel || placeholder }}
        </span>
        <tm-icon name="chevron-down" [size]="12" class="trigger__caret" />
      </button>

      <ul
        *ngIf="open"
        class="menu"
        role="listbox"
        (click)="$event.stopPropagation()"
      >
        <li
          *ngFor="let opt of options; let i = index; trackBy: trackByValue"
          class="opt"
          role="option"
          [class.is-selected]="isSelected(opt)"
          [class.is-active]="i === activeIndex"
          [class.is-disabled]="opt.disabled"
          [attr.aria-selected]="isSelected(opt)"
          (mouseenter)="activeIndex = i"
          (click)="pick(opt)"
        >
          <tm-icon *ngIf="isSelected(opt)" name="check" [size]="12" class="opt__check" />
          <span class="opt__label">{{ opt.label }}</span>
        </li>
        <li *ngIf="!options.length" class="opt opt--empty">No options</li>
      </ul>
    </div>
  `,
  styles: [`
    :host { display: inline-block; width: 100%; }
    .wrap { position: relative; display: block; }

    .trigger {
      width: 100%;
      display: inline-flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 9px 14px;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-sm);
      background: var(--tm-surface);
      font-family: var(--tm-font-body);
      font-size: 13px;
      font-weight: 600;
      color: var(--tm-text);
      cursor: pointer;
      line-height: 1.2;
      text-align: left;
      transition: border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .trigger:hover:not(:disabled) { border-color: var(--tm-ink); }
    .wrap.is-open .trigger { border-color: var(--tm-ink); }
    .wrap.is-disabled .trigger,
    .trigger:disabled {
      background: var(--tm-canvas-2);
      color: var(--tm-text-soft);
      cursor: not-allowed;
    }

    .trigger__value {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .trigger__value.is-placeholder { color: var(--tm-text-soft); font-weight: 500; }
    .trigger__caret {
      color: var(--tm-text-soft);
      transition: transform var(--tm-duration-fast) var(--tm-ease);
    }
    .wrap.is-open .trigger__caret { transform: rotate(180deg); }

    .menu {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      right: 0;
      margin: 0;
      padding: 6px;
      list-style: none;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      box-shadow: var(--tm-shadow-pop);
      max-height: 280px;
      overflow: auto;
      z-index: 1200;
      animation: menu-in 120ms var(--tm-ease) both;
    }
    @keyframes menu-in {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .opt {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: var(--tm-radius-sm);
      font-size: 13px;
      font-weight: 600;
      color: var(--tm-text);
      cursor: pointer;
    }
    .opt.is-active { background: var(--tm-canvas-2); }
    .opt.is-selected {
      background: var(--tm-green-tint);
      color: var(--tm-green-deep);
      font-weight: 700;
    }
    .opt.is-disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .opt__check { color: var(--tm-green-deep); flex-shrink: 0; }
    .opt__label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .opt--empty {
      color: var(--tm-text-soft);
      font-style: italic;
      cursor: default;
    }
  `],
})
export class SelectComponent<T = unknown> implements ControlValueAccessor {
  private readonly host = inject(ElementRef<HTMLElement>);

  @Input() options: SelectOption<T>[] = [];
  @Input() placeholder = 'Select…';
  @Input() disabled = false;
  /** Two-way binding fallback when not using forms. */
  @Input() value: T | null = null;
  @Output() valueChange = new EventEmitter<T | null>();

  @ViewChild('trigger', { static: true }) trigger!: ElementRef<HTMLButtonElement>;

  open = false;
  activeIndex = -1;

  private onChange: (v: T | null) => void = () => {};
  private onTouched: () => void = () => {};

  get selectedLabel(): string | null {
    const match = this.options.find((o) => this.eq(o.value, this.value));
    return match?.label ?? null;
  }

  trackByValue = (_: number, o: SelectOption<T>) => String(o.value);

  writeValue(v: T | null): void { this.value = v; }
  registerOnChange(fn: (v: T | null) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(d: boolean): void { this.disabled = d; }

  isSelected(opt: SelectOption<T>): boolean {
    return this.eq(opt.value, this.value);
  }

  toggle(event: MouseEvent): void {
    event.stopPropagation();
    if (this.disabled) return;
    this.open ? this.closeMenu() : this.openMenu();
  }

  pick(opt: SelectOption<T>): void {
    if (opt.disabled) return;
    this.value = opt.value;
    this.onChange(opt.value);
    this.valueChange.emit(opt.value);
    this.onTouched();
    this.closeMenu();
    this.trigger.nativeElement.focus();
  }

  private openMenu(): void {
    this.open = true;
    const idx = this.options.findIndex((o) => this.eq(o.value, this.value));
    this.activeIndex = idx >= 0 ? idx : 0;
  }

  private closeMenu(): void {
    this.open = false;
    this.activeIndex = -1;
  }

  onTriggerKey(e: KeyboardEvent): void {
    if (this.disabled) return;
    if (!this.open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.openMenu();
      }
      return;
    }
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        this.closeMenu();
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.moveActive(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.moveActive(-1);
        break;
      case 'Home':
        e.preventDefault();
        this.activeIndex = 0;
        break;
      case 'End':
        e.preventDefault();
        this.activeIndex = this.options.length - 1;
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (this.activeIndex >= 0 && this.activeIndex < this.options.length) {
          this.pick(this.options[this.activeIndex]);
        }
        break;
    }
  }

  private moveActive(delta: number): void {
    if (!this.options.length) return;
    let next = this.activeIndex + delta;
    if (next < 0) next = this.options.length - 1;
    if (next >= this.options.length) next = 0;
    this.activeIndex = next;
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent): void {
    if (!this.open) return;
    if (!this.host.nativeElement.contains(e.target as Node)) {
      this.closeMenu();
    }
  }

  /** Strict equality with primitive-friendly object comparison. */
  private eq(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    return a === b;
  }
}
