import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { RidesListComponent } from './rides-list.component';
import { IconComponent, IconName } from '../../ui';

/**
 * Rides shell — a design-system tab bar over the reusable RidesListComponent.
 *   • All Rides  → category="all"        (everything, incl. a scheduled ride
 *                  once it goes live it also shows in the ongoing buckets)
 *   • Scheduled  → category="scheduled"  (upcoming pre-booked trips, by pickup)
 * The active tab is reflected in ?tab=scheduled for deep links.
 */
@Component({
  selector: 'app-rides-shell',
  standalone: true,
  imports: [CommonModule, IconComponent, RidesListComponent],
  template: `
    <div class="rsh">
      <nav class="rsh__tabs" role="tablist">
        <button
          *ngFor="let t of tabs; let i = index"
          type="button"
          role="tab"
          class="rsh__tab"
          [class.is-on]="activeIndex === i"
          [attr.aria-selected]="activeIndex === i"
          (click)="select(i)"
        >
          <tm-icon [name]="t.icon" [size]="15" />
          <span>{{ t.label }}</span>
        </button>
      </nav>

      <div class="rsh__panel">
        <app-rides-list
          *ngIf="activeIndex === 0"
          category="all"
          title="All Rides"
          emptyMessage="No rides match the current filters."
        />
        <app-rides-list
          *ngIf="activeIndex === 1"
          category="scheduled"
          title="Scheduled Rides"
          emptyMessage="No scheduled rides yet. Pre-booked trips show here until they start."
        />
      </div>
    </div>
  `,
  styles: [`
    .rsh { display: flex; flex-direction: column; gap: 18px; }

    .rsh__tabs {
      display: flex;
      gap: 2px;
      border-bottom: 1px solid var(--tm-line);
      overflow-x: auto;
    }
    .rsh__tab {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 11px 16px;
      background: transparent;
      border: 0;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 700;
      white-space: nowrap;
      color: var(--tm-text-muted);
      transition: color var(--tm-duration-fast) var(--tm-ease),
                  border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .rsh__tab:hover { color: var(--tm-text); }
    .rsh__tab.is-on {
      color: var(--tm-green);
      border-bottom-color: var(--tm-green);
    }

    .rsh__panel { min-width: 0; }
  `],
})
export class RidesShellComponent {
  activeIndex = 0;

  tabs: { label: string; icon: IconName }[] = [
    { label: 'All Rides', icon: 'road' },
    { label: 'Scheduled', icon: 'calendar' },
  ];

  constructor(route: ActivatedRoute, private router: Router) {
    route.queryParamMap.subscribe((q) => {
      this.activeIndex = q.get('tab') === 'scheduled' ? 1 : 0;
    });
  }

  select(i: number): void {
    this.activeIndex = i;
    this.router.navigate([], {
      queryParams: { tab: i === 1 ? 'scheduled' : null },
      queryParamsHandling: 'merge',
    });
  }
}
