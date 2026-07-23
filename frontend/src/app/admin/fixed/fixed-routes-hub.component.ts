import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FixedRoutesComponent } from './fixed-routes.component';
import { RouteGroupsBoardComponent } from './route-groups-board.component';
import { ReturnToSetupComponent } from '../setup/return-to-setup.component';

/**
 * Fixed Routes hub. Default view is the drag-and-drop board (routes as cards,
 * groups as columns, drivers per group). "Add fixed route" flips to the route
 * editor; a back link returns to the board.
 */
@Component({
  selector: 'app-fixed-routes-hub',
  standalone: true,
  imports: [CommonModule, FixedRoutesComponent, RouteGroupsBoardComponent, ReturnToSetupComponent],
  template: `
    <div class="frh">
      <app-return-to-setup></app-return-to-setup>
      <ng-container *ngIf="view === 'board'">
        <app-route-groups-board (addRoute)="view = 'routes'"></app-route-groups-board>
      </ng-container>

      <ng-container *ngIf="view === 'routes'">
        <button class="frh__back" (click)="view = 'board'">← Back to board</button>
        <app-fixed-routes></app-fixed-routes>
      </ng-container>
    </div>
  `,
  styles: [`
    .frh { display: flex; flex-direction: column; gap: 12px; }
    .frh__back { align-self: flex-start; border: 1px solid var(--tm-line); background: #fff; border-radius: 8px; padding: 7px 12px; font-size: 12.5px; font-weight: 700; color: var(--tm-text); cursor: pointer; }
    .frh__back:hover { background: #f4f6f8; }
  `],
})
export class FixedRoutesHubComponent {
  view: 'board' | 'routes' = 'board';
}
