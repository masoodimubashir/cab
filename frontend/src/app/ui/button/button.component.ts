import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icon-registry';

export type ButtonVariant = 'ink' | 'green' | 'outline' | 'ghost' | 'text-green' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Single source of truth for buttons across the app.
 *
 *   <tm-button variant="green" (click)="...">Request a Trip</tm-button>
 *   <tm-button variant="ink" icon="plus">New Trip</tm-button>
 *   <tm-button variant="outline" size="sm">Back</tm-button>
 *   <tm-button variant="text-green">ADD NEW</tm-button>
 *
 * Variant maps to the design system recipes (see TAXIMODE_DESIGN_SYSTEM.md §9).
 */
@Component({
  selector: 'tm-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IconComponent],
  template: `
    <button
      [type]="type"
      [disabled]="disabled || loading"
      [class]="classes"
      [attr.aria-busy]="loading ? 'true' : null"
      (click)="onClick($event)"
    >
      <tm-icon *ngIf="icon && !loading" [name]="icon" [size]="iconSize" />
      <span *ngIf="loading" class="tm-btn__spinner" aria-hidden="true"></span>
      <span class="tm-btn__label"><ng-content></ng-content></span>
      <tm-icon *ngIf="iconTrail" [name]="iconTrail" [size]="iconSize" />
    </button>
  `,
  styles: [`
    :host { display: inline-flex; }
    :host([block]) { display: flex; }
    :host([block]) .tm-btn { width: 100%; }

    .tm-btn {
      display: inline-flex; align-items: center; justify-content: center;
      gap: 8px;
      font-family: inherit;
      font-weight: 700;
      line-height: 1;
      border-radius: var(--tm-radius-md);
      border: 1px solid transparent;
      cursor: pointer;
      white-space: nowrap;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease),
                  border-color var(--tm-duration-fast) var(--tm-ease),
                  box-shadow var(--tm-duration-fast) var(--tm-ease),
                  transform var(--tm-duration-fast) var(--tm-ease);
    }
    .tm-btn:active:not(:disabled) { transform: translateY(1px); }
    .tm-btn:disabled { opacity: 0.55; cursor: not-allowed; }

    /* Sizes */
    .tm-btn--sm { padding: 8px 12px; font-size: 12px; border-radius: var(--tm-radius-sm); }
    .tm-btn--md { padding: 11px 18px; font-size: 13px; }
    .tm-btn--lg { padding: 14px 22px; font-size: 14px; border-radius: var(--tm-radius-md); }

    /* Variants */
    .tm-btn--ink {
      background: var(--tm-ink); color: #fff;
    }
    .tm-btn--ink:hover:not(:disabled) { background: var(--tm-ink-2); }

    .tm-btn--green {
      background: var(--tm-green); color: #fff;
    }
    .tm-btn--green:hover:not(:disabled) { background: var(--tm-green-deep); }

    .tm-btn--outline {
      background: var(--tm-surface); color: var(--tm-text);
      border-color: var(--tm-line-2); font-weight: 600;
    }
    .tm-btn--outline:hover:not(:disabled) {
      background: var(--tm-canvas-2); border-color: var(--tm-text-soft);
    }

    .tm-btn--ghost {
      background: transparent; color: var(--tm-text-muted); font-weight: 600;
    }
    .tm-btn--ghost:hover:not(:disabled) {
      background: var(--tm-canvas-2); color: var(--tm-text);
    }

    .tm-btn--text-green {
      background: transparent; color: var(--tm-green-deep);
      padding-left: 0; padding-right: 0;
      font-weight: 800; font-size: 12px;
      letter-spacing: 0.04em; text-transform: uppercase;
    }
    .tm-btn--text-green:hover:not(:disabled) { color: var(--tm-green); }

    .tm-btn--danger {
      background: var(--tm-danger); color: #fff;
    }
    .tm-btn--danger:hover:not(:disabled) { filter: brightness(0.95); }

    /* Spinner */
    .tm-btn__spinner {
      width: 14px; height: 14px; border-radius: 50%;
      border: 2px solid currentColor; border-right-color: transparent;
      animation: tm-spin 0.6s linear infinite;
    }
    @keyframes tm-spin { to { transform: rotate(360deg); } }

    .tm-btn__label:empty { display: none; }
  `],
})
export class ButtonComponent {
  @Input() variant: ButtonVariant = 'ink';
  @Input() size: ButtonSize = 'md';
  @Input() type: 'button' | 'submit' | 'reset' = 'button';
  @Input() disabled = false;
  @Input() loading = false;
  @Input() icon?: IconName;
  @Input() iconTrail?: IconName;

  @Output() clicked = new EventEmitter<MouseEvent>();

  get iconSize(): number {
    return this.size === 'sm' ? 14 : this.size === 'lg' ? 18 : 16;
  }

  get classes(): string {
    return `tm-btn tm-btn--${this.variant} tm-btn--${this.size}`;
  }

  onClick(e: MouseEvent) {
    if (this.disabled || this.loading) return;
    this.clicked.emit(e);
  }
}
