import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Page wrapper that gives every screen consistent gutters, max width,
 * and an optional header strip with title + actions.
 *
 *   <tm-page title="Drivers" subtitle="Active drivers in your fleet">
 *     <ng-container slot="actions">
 *       <tm-button variant="green" icon="plus">Add driver</tm-button>
 *     </ng-container>
 *     <tm-card>...content...</tm-card>
 *   </tm-page>
 *
 * If `title` is omitted, only the content slot is rendered (use when the
 * topbar already shows the page title).
 */
@Component({
  selector: 'tm-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <header class="pg__head" *ngIf="title">
      <div class="pg__head-text">
        <h1 class="tm-h1">{{ title }}</h1>
        <p class="pg__subtitle" *ngIf="subtitle">{{ subtitle }}</p>
      </div>
      <div class="pg__actions">
        <ng-content select="[slot=actions]"></ng-content>
      </div>
    </header>
    <div class="pg__body">
      <ng-content></ng-content>
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--tm-space-6);
      padding: var(--tm-space-6);
      max-width: var(--tm-content-max);
      width: 100%;
      margin: 0 auto;
      flex: 1 1 auto;
      min-width: 0;
    }
    .pg__head {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: var(--tm-space-4);
      flex-wrap: wrap;
    }
    .pg__head-text { display: flex; flex-direction: column; gap: 4px; }
    .pg__subtitle {
      font-size: 14px;
      color: var(--tm-text-muted);
      font-weight: 500;
    }
    .pg__actions {
      display: flex;
      align-items: center;
      gap: var(--tm-space-3);
      flex-wrap: wrap;
    }
    .pg__body {
      display: flex;
      flex-direction: column;
      gap: var(--tm-space-6);
      min-width: 0;
    }
    @media (max-width: 880px) {
      :host { padding: var(--tm-space-4); gap: var(--tm-space-4); }
      .pg__body { gap: var(--tm-space-4); }
    }
  `],
})
export class PageComponent {
  @Input() title?: string;
  @Input() subtitle?: string;
}
