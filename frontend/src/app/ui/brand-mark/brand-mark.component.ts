import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * DreamCabs brand mark — the official logo image, presented as a rounded tile.
 * The logo already carries the "DREAMCABS" wordmark, so no separate text is
 * rendered.
 *
 *   <tm-brand-mark />                    sidebar header
 *   <tm-brand-mark size="lg" />          signin screen (large)
 *   <tm-brand-mark [compact]="true" />   collapsed sidebar (smaller)
 *
 * `tone` is accepted for backward compatibility with existing call sites but no
 * longer alters the mark — the logo supplies its own background.
 */
@Component({
  selector: 'tm-brand-mark',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <span
      class="logo"
      [class.logo--lg]="size === 'lg'"
      [class.logo--compact]="compact"
    >
      <img src="assets/dreamcabs-logo.jpeg" alt="DreamCabs" draggable="false" />
    </span>
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; }

    .logo {
      flex: none;
      display: block;
      overflow: hidden;
      width: 44px;
      height: 44px;
      border-radius: 10px;
      background: #0E1626; /* matches the logo's navy so scaled edges blend */
    }
    .logo img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      transform: scale(1.14); /* trim the logo's outer padding */
      user-select: none;
    }

    .logo--compact { width: 36px; height: 36px; border-radius: 9px; }

    .logo--lg { width: 96px; height: 96px; border-radius: 18px; }
  `],
})
export class BrandMarkComponent {
  @Input() compact = false;
  @Input() size: 'md' | 'lg' = 'md';
  @Input() tone: 'default' | 'inverse' = 'default';
}
