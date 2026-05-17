import { ChangeDetectionStrategy, Component, HostBinding, Input } from '@angular/core';

export type CardPadding = 'tight' | 'compact' | 'default' | 'loose' | 'none';
export type CardElevation = 'flat' | 'card' | 'pop';

/**
 * Container primitive.
 *
 *   <tm-card>
 *     <h3 class="tm-h3">Trips today</h3>
 *     <p class="tm-display">142</p>
 *   </tm-card>
 *
 * Defaults: 22px radius, white surface, card elevation, 24px padding.
 */
@Component({
  selector: 'tm-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content></ng-content>`,
  styles: [`
    :host {
      display: block;
      background: var(--tm-surface);
      border-radius: var(--tm-radius-lg);
    }
    :host(.pad-none)    { padding: 0; }
    :host(.pad-tight)   { padding: var(--tm-space-4); }
    :host(.pad-compact) { padding: var(--tm-space-5); }
    :host(.pad-default) { padding: var(--tm-space-6); }
    :host(.pad-loose)   { padding: var(--tm-space-8); }

    :host(.elev-flat) { box-shadow: none; border: 1px solid var(--tm-line); }
    :host(.elev-card) { box-shadow: var(--tm-shadow-card); }
    :host(.elev-pop)  { box-shadow: var(--tm-shadow-pop); }
  `],
})
export class CardComponent {
  @Input() padding: CardPadding = 'default';
  @Input() elevation: CardElevation = 'card';

  @HostBinding('class')
  get hostClass(): string { return `pad-${this.padding} elev-${this.elevation}`; }
}
