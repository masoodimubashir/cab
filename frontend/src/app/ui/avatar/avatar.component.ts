import { ChangeDetectionStrategy, Component, HostBinding, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type AvatarTone = 'green' | 'ink';

/**
 *   <tm-avatar [src]="user.photo" [initials]="user.initials" size="md" [online]="true" />
 *
 * If `src` is provided it's used. Otherwise `initials` are rendered on a gradient.
 */
@Component({
  selector: 'tm-avatar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <img *ngIf="src" [src]="src" [alt]="alt || ''" />
    <span *ngIf="!src && initials">{{ initials }}</span>
    <span *ngIf="online" class="led" aria-label="online"></span>
  `,
  styles: [`
    :host {
      position: relative;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 50%;
      color: #fff;
      font-weight: 800;
      overflow: visible;
      flex-shrink: 0;
    }
    img, span:not(.led) {
      display: grid; place-items: center;
      width: 100%; height: 100%;
      border-radius: 50%;
      object-fit: cover;
    }
    :host(.tone-green) { background: linear-gradient(135deg, var(--tm-green), var(--tm-green-deep)); }
    :host(.tone-ink)   { background: linear-gradient(135deg, var(--tm-ink), var(--tm-ink-3)); }

    :host(.size-xs) { width: 24px; height: 24px; font-size: 10px; }
    :host(.size-sm) { width: 32px; height: 32px; font-size: 11px; }
    :host(.size-md) { width: 42px; height: 42px; font-size: 14px; }
    :host(.size-lg) { width: 60px; height: 60px; font-size: 18px; }
    :host(.size-xl) { width: 80px; height: 80px; font-size: 24px; }

    .led {
      position: absolute; right: 0; bottom: 0;
      width: 12px; height: 12px; border-radius: 50%;
      border: 2px solid var(--tm-surface);
      background: var(--tm-green);
    }
    :host(.size-lg) .led, :host(.size-xl) .led {
      width: 14px; height: 14px; border-width: 3px;
    }
  `],
})
export class AvatarComponent {
  @Input() size: AvatarSize = 'md';
  @Input() tone: AvatarTone = 'green';
  @Input() src?: string | null;
  @Input() initials?: string;
  @Input() alt?: string;
  @Input() online = false;

  @HostBinding('class')
  get hostClass(): string { return `tone-${this.tone} size-${this.size}`; }
}
