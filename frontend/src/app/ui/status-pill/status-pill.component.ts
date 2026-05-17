import { ChangeDetectionStrategy, Component, HostBinding, Input } from '@angular/core';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/**
 * LED dot + uppercase status pill — the design system's standard status indicator.
 *
 *   <tm-status-pill tone="success">Completed</tm-status-pill>
 *   <tm-status-pill tone="warning">Confirm</tm-status-pill>
 *
 * For DB enum values (REQUESTED, CONFIRMED, EN_ROUTE_PICKUP, etc.) map at the
 * call site to a tone — see TAXIMODE_DESIGN_SYSTEM.md §13 for the canonical mapping.
 */
@Component({
  selector: 'tm-status-pill',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="led" aria-hidden="true"></span>
    <ng-content></ng-content>
  `,
  styles: [`
    :host {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 4px 10px; border-radius: var(--tm-radius-pill);
      font-size: 11px; font-weight: 800;
      letter-spacing: 0.05em; text-transform: uppercase;
      white-space: nowrap;
    }
    .led { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }

    :host(.tone-success)  { background: var(--tm-success-bg); color: var(--tm-success-fg); }
    :host(.tone-success) .led { background: var(--tm-success); }

    :host(.tone-warning)  { background: var(--tm-warning-bg); color: var(--tm-warning-fg); }
    :host(.tone-warning) .led { background: var(--tm-warning); }

    :host(.tone-danger)   { background: var(--tm-danger-bg);  color: var(--tm-danger-fg); }
    :host(.tone-danger) .led  { background: var(--tm-danger); }

    :host(.tone-info)     { background: var(--tm-info-bg);    color: var(--tm-info-fg); }
    :host(.tone-info) .led    { background: var(--tm-info); }

    :host(.tone-neutral)  { background: var(--tm-canvas-2);   color: var(--tm-text-muted); }
    :host(.tone-neutral) .led { background: var(--tm-text-soft); }
  `],
})
export class StatusPillComponent {
  @Input() tone: StatusTone = 'neutral';

  @HostBinding('class')
  get hostClass(): string { return `tone-${this.tone}`; }
}
