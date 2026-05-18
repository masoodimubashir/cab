import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icon-registry';
import { ToastService, ToastKind } from '../../core/toast.service';

/**
 * Global toast stack. Mount once at the app root:
 *
 *   <tm-toast />
 *
 * Drive it through `ToastService` (success/error/info/warning).
 */
@Component({
  selector: 'tm-toast',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="stack" role="region" aria-label="Notifications" aria-live="polite">
      <div
        *ngFor="let t of toast.toasts(); trackBy: trackById"
        class="toast"
        [class]="'toast--' + t.kind"
        role="status"
      >
        <tm-icon class="toast__icon" [name]="iconFor(t.kind)" [size]="18" />
        <div class="toast__body">
          <strong *ngIf="t.title" class="toast__title">{{ t.title }}</strong>
          <span class="toast__msg">{{ t.message }}</span>
        </div>
        <button
          type="button"
          class="toast__close"
          aria-label="Dismiss notification"
          (click)="toast.dismiss(t.id)"
        >
          <tm-icon name="x" [size]="14" />
        </button>
      </div>
    </div>
  `,
  styles: [`
    .stack {
      position: fixed;
      top: var(--tm-space-5);
      right: var(--tm-space-5);
      /* Sit above modals/overlays so error toasts are never hidden by the backdrop. */
      z-index: 2147483000;
      display: flex;
      flex-direction: column;
      gap: var(--tm-space-3);
      width: min(380px, calc(100vw - var(--tm-space-8)));
      pointer-events: none;
    }
    .toast {
      pointer-events: auto;
      display: flex;
      align-items: flex-start;
      gap: var(--tm-space-3);
      padding: var(--tm-space-3) var(--tm-space-4);
      background: var(--tm-surface);
      border: 1px solid var(--tm-line-2);
      border-left-width: 4px;
      border-radius: var(--tm-radius-md);
      box-shadow: var(--tm-shadow-pop);
      animation: tm-toast-in var(--tm-duration-base) var(--tm-ease);
    }
    .toast__icon { flex-shrink: 0; margin-top: 1px; }
    .toast__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .toast__title { font-size: 13px; font-weight: 700; color: var(--tm-text); }
    .toast__msg   { font-size: 13px; font-weight: 500; color: var(--tm-text-muted); line-height: 1.45; }

    .toast__close {
      flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px;
      background: transparent; border: none; cursor: pointer;
      color: var(--tm-text-soft); border-radius: var(--tm-radius-sm);
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .toast__close:hover { background: var(--tm-canvas-2); color: var(--tm-text); }

    .toast--success { border-left-color: var(--tm-success); }
    .toast--success .toast__icon { color: var(--tm-success-fg); }
    .toast--error   { border-left-color: var(--tm-danger);  }
    .toast--error   .toast__icon { color: var(--tm-danger-fg);  }
    .toast--warning { border-left-color: var(--tm-warning); }
    .toast--warning .toast__icon { color: var(--tm-warning-fg); }
    .toast--info    { border-left-color: var(--tm-info);    }
    .toast--info    .toast__icon { color: var(--tm-info-fg);    }

    @keyframes tm-toast-in {
      from { opacity: 0; transform: translateY(-6px) scale(0.98); }
      to   { opacity: 1; transform: translateY(0)    scale(1); }
    }
  `],
})
export class ToastComponent {
  readonly toast = inject(ToastService);

  trackById = (_: number, t: { id: number }) => t.id;

  iconFor(kind: ToastKind): IconName {
    switch (kind) {
      case 'success': return 'check';
      case 'error':   return 'x';
      case 'warning': return 'bell';
      case 'info':    return 'bell';
    }
  }
}
