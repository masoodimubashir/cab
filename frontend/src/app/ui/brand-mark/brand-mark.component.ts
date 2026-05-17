import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * TaxiMode logo wordmark. Two sizes for sidebar header and signin screen.
 *
 *   <tm-brand-mark />
 *   <tm-brand-mark [compact]="true" />
 */
@Component({
  selector: 'tm-brand-mark',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="text" *ngIf="!compact">
      <span>Dream</span><span class="accent">Cabs</span>
    </div>
  `,
  styles: [`
    :host {
      display: inline-flex; align-items: center;
    }
    .text {
      font-weight: 800; font-size: 18px; letter-spacing: -0.02em;
      color: var(--tm-text);
    }
    .accent { color: var(--tm-green); }
  `],
})
export class BrandMarkComponent {
  @Input() compact = false;
}
