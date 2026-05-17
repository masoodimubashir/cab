import { ChangeDetectionStrategy, Component, HostBinding, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icon-registry';

export type IconTileTone = 'ink' | 'green' | 'surface' | 'canvas';
export type IconTileSize = 'sm' | 'md' | 'lg';

/**
 * The signature TaxiMode element — a dark rounded square with a white glyph.
 * Used in nav items, action buttons, category headers.
 *
 *   <tm-icon-tile icon="home" />
 *   <tm-icon-tile icon="bell" tone="green" [active]="true" />
 *   <tm-icon-tile icon="user" size="lg" />
 */
@Component({
  selector: 'tm-icon-tile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IconComponent],
  template: `<tm-icon [name]="icon" [size]="glyphSize" />`,
  styles: [`
    :host {
      display: inline-grid; place-items: center;
      flex-shrink: 0;
      transition: box-shadow var(--tm-duration-fast) var(--tm-ease),
                  background var(--tm-duration-fast) var(--tm-ease);
    }
    :host(.tone-ink)     { background: var(--tm-ink);     color: #fff; }
    :host(.tone-green)   { background: var(--tm-green);   color: #fff; }
    :host(.tone-surface) { background: var(--tm-surface); color: var(--tm-text); border: 1px solid var(--tm-line); }
    :host(.tone-canvas)  { background: var(--tm-canvas-2); color: var(--tm-text); }

    :host(.size-sm) { width: 32px; height: 32px; border-radius: 10px; }
    :host(.size-md) { width: 38px; height: 38px; border-radius: 12px; }
    :host(.size-lg) { width: 48px; height: 48px; border-radius: 14px; }

    :host(.active) { box-shadow: 0 0 0 3px var(--tm-green-soft); }
  `],
})
export class IconTileComponent {
  @Input({ required: true }) icon!: IconName;
  @Input() tone: IconTileTone = 'ink';
  @Input() size: IconTileSize = 'md';
  @Input() active = false;

  @HostBinding('class')
  get hostClass(): string {
    return `tone-${this.tone} size-${this.size}${this.active ? ' active' : ''}`;
  }

  get glyphSize(): number {
    return this.size === 'sm' ? 16 : this.size === 'lg' ? 22 : 18;
  }
}
