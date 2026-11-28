import { Component, Input } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'app-fare-field-help',
  standalone: true,
  imports: [TooltipModule],
  template: `<button type="button" [attr.aria-label]="'About ' + label" [pTooltip]="text"
    tooltipEvent="both" tooltipPosition="top" appendTo="body" tooltipZIndex="1200">!</button>`,
  styles: [`
    :host { display: inline-flex; }
    button { display: inline-grid; place-items: center; width: 20px; height: 20px; padding: 0;
      border: 1px solid var(--tm-line); border-radius: 50%; background: var(--tm-surface);
      color: var(--tm-text-muted); font-family: inherit; font-size: 12px; font-weight: 700; cursor: help; }
    button:hover, button:focus-visible { color: var(--tm-green-deep); border-color: currentColor; }
  `],
})
export class FareFieldHelpComponent {
  @Input({required: true}) label!: string;
  @Input({required: true}) text!: string;
}
