import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icon/icon.component';

/**
 * Reusable right-side drawer — the standard surface for create/edit forms.
 *
 *   <tm-drawer [open]="isOpen" title="Add city" (closed)="isOpen = false">
 *     <ng-container slot="body">…form…</ng-container>
 *     <ng-container slot="footer">
 *       <tm-button variant="ghost" (clicked)="isOpen = false">Cancel</tm-button>
 *       <tm-button variant="green" (clicked)="submit()">Save</tm-button>
 *     </ng-container>
 *   </tm-drawer>
 *
 * Behavior mirrors <tm-modal>: blurred backdrop, animated open/close, Escape
 * and backdrop click both close, page scroll locked while open. The panel
 * slides in from the right on desktop and up as a sheet on small screens.
 */
@Component({
  selector: 'tm-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IconComponent],
  template: `
    <div
      *ngIf="mounted"
      class="tm-drawer"
      [class.is-closing]="closing"
      role="dialog"
      aria-modal="true"
      [attr.aria-labelledby]="title ? labelId : null"
      (click)="onBackdropClick($event)"
    >
      <div
        class="tm-drawer__panel"
        [style.width]="panelWidth"
        (click)="$event.stopPropagation()"
      >
        <header class="tm-drawer__head" *ngIf="title || showClose">
          <div class="tm-drawer__titles">
            <h2 *ngIf="title" class="tm-drawer__title" [id]="labelId">{{ title }}</h2>
            <p *ngIf="subtitle" class="tm-drawer__subtitle">{{ subtitle }}</p>
          </div>
          <button
            *ngIf="showClose"
            type="button"
            class="tm-drawer__close"
            (click)="close()"
            aria-label="Close"
          >
            <tm-icon name="x" [size]="16" />
          </button>
        </header>

        <div class="tm-drawer__body">
          <ng-content select="[slot=body]"></ng-content>
        </div>

        <footer class="tm-drawer__foot">
          <ng-content select="[slot=footer]"></ng-content>
        </footer>
      </div>
    </div>
  `,
  styles: [`
    :host { display: contents; }

    .tm-drawer {
      position: fixed;
      inset: 0;
      z-index: 1100;
      display: flex;
      justify-content: flex-end;
      background: rgba(15, 20, 25, 0.45);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      animation: tm-drawer-fade-in var(--tm-duration-base) var(--tm-ease) both;
    }
    .tm-drawer.is-closing {
      animation: tm-drawer-fade-out var(--tm-duration-base) var(--tm-ease) both;
    }
    @keyframes tm-drawer-fade-in  { from { opacity: 0; } to { opacity: 1; } }
    @keyframes tm-drawer-fade-out { from { opacity: 1; } to { opacity: 0; } }

    .tm-drawer__panel {
      position: relative;
      width: 460px;
      max-width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      background: var(--tm-surface);
      box-shadow: var(--tm-shadow-pop);
      animation: tm-drawer-slide-in var(--tm-duration-slow) var(--tm-ease) both;
    }
    .tm-drawer.is-closing .tm-drawer__panel {
      animation: tm-drawer-slide-out var(--tm-duration-base) var(--tm-ease) both;
    }
    @keyframes tm-drawer-slide-in {
      from { transform: translateX(100%); }
      to   { transform: translateX(0); }
    }
    @keyframes tm-drawer-slide-out {
      from { transform: translateX(0); }
      to   { transform: translateX(100%); }
    }

    .tm-drawer__head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--tm-space-3);
      padding: var(--tm-space-5) var(--tm-space-5) var(--tm-space-3);
      border-bottom: 1px solid var(--tm-line);
    }
    .tm-drawer__titles { min-width: 0; }
    .tm-drawer__title {
      margin: 0;
      font-size: 18px;
      font-weight: 800;
      letter-spacing: -0.01em;
      color: var(--tm-text);
    }
    .tm-drawer__subtitle {
      margin: 2px 0 0;
      font-size: 13px;
      color: var(--tm-text-muted);
    }
    .tm-drawer__close {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px; height: 32px;
      border-radius: 50%;
      background: var(--tm-canvas-2);
      color: var(--tm-text-muted);
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .tm-drawer__close:hover { background: var(--tm-ink); color: #fff; }

    .tm-drawer__body {
      flex: 1 1 auto;
      padding: var(--tm-space-5);
      overflow-y: auto;
      font-size: 14px;
      color: var(--tm-text);
    }

    .tm-drawer__foot {
      display: flex;
      justify-content: flex-end;
      gap: var(--tm-space-2);
      padding: var(--tm-space-3) var(--tm-space-5);
      border-top: 1px solid var(--tm-line);
    }
    .tm-drawer__foot:empty { display: none; }

    /* Mobile — slide-up sheet at the bottom */
    @media (max-width: 640px) {
      .tm-drawer { align-items: flex-end; }
      .tm-drawer__panel {
        width: 100% !important;
        height: auto;
        max-height: 92vh;
        border-radius: var(--tm-radius-xl) var(--tm-radius-xl) 0 0;
        animation: tm-drawer-sheet-up var(--tm-duration-slow) var(--tm-ease) both;
      }
      .tm-drawer.is-closing .tm-drawer__panel {
        animation: tm-drawer-sheet-down var(--tm-duration-base) var(--tm-ease) both;
      }
      @keyframes tm-drawer-sheet-up   { from { transform: translateY(100%); } to { transform: translateY(0); } }
      @keyframes tm-drawer-sheet-down { from { transform: translateY(0); } to { transform: translateY(100%); } }
    }
  `],
})
export class DrawerComponent implements OnChanges {
  @Input() open = false;
  @Input() title?: string;
  @Input() subtitle?: string;
  /** Panel width in px on desktop. */
  @Input() width = 460;
  /** Panel width as a viewport-width percentage (e.g. 90 → 90vw). Takes priority over `width`. */
  @Input() widthPercent?: number;
  /** Show the × close button in the header. */
  @Input() showClose = true;
  /** Click on the backdrop closes the drawer. */
  @Input() dismissible = true;
  /** Lock document scroll while open. */
  @Input() lockScroll = true;

  @Output() closed = new EventEmitter<void>();

  /** Computed inline width for the panel. */
  get panelWidth(): string {
    return this.widthPercent != null ? `${this.widthPercent}vw` : `${this.width}px`;
  }

  /** DOM-mounted (true during open AND closing animation). */
  mounted = false;
  /** Currently running the closing animation. */
  closing = false;

  private static idCounter = 0;
  readonly labelId = `tm-drawer-${++DrawerComponent.idCounter}`;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['open']) return;
    if (this.open) {
      this.mounted = true;
      this.closing = false;
      if (this.lockScroll) document.body.style.overflow = 'hidden';
    } else if (this.mounted) {
      this.closing = true;
      setTimeout(() => {
        this.mounted = false;
        this.closing = false;
        if (this.lockScroll) document.body.style.overflow = '';
      }, 220);
    }
  }

  close(): void {
    this.closed.emit();
  }

  onBackdropClick(_: MouseEvent): void {
    if (this.dismissible) this.close();
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.mounted && this.dismissible) this.close();
  }
}
