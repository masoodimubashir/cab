import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { RidesShellComponent } from '../rides/rides-shell.component';
import { FixedDeparturesComponent } from '../fixed/fixed-departures.component';
import { CustomersListComponent } from '../customers/customers-list.component';
import { IconComponent, IconName } from '../../ui';

type OpsTab = 'rides' | 'vehicles' | 'customers';

@Component({
  selector: 'app-operations',
  standalone: true,
  imports: [CommonModule, IconComponent, RidesShellComponent, FixedDeparturesComponent, CustomersListComponent],
  template: `
    <div class="ops">
      <header class="ops__head">
        <div>
          <h1 class="ops__title">Operations</h1>
          <p class="ops__sub">Trip history, live vehicles, and customer records in one place.</p>
        </div>
      </header>

      <nav class="ops__tabs" role="tablist" aria-label="Operations tabs">
        <button
          *ngFor="let tab of tabs"
          type="button"
          class="ops__tab"
          [class.is-on]="activeTab === tab.value"
          [attr.aria-selected]="activeTab === tab.value"
          role="tab"
          (click)="select(tab.value)"
        >
          <tm-icon [name]="tab.icon" [size]="14" />
          <span>{{ tab.label }}</span>
        </button>
      </nav>

      <section class="ops__panel">
        <app-rides-shell *ngIf="activeTab === 'rides'" />
        <app-fixed-departures *ngIf="activeTab === 'vehicles'" />
        <app-customers-list *ngIf="activeTab === 'customers'" />
      </section>
    </div>
  `,
  styles: [`
    .ops { display: flex; flex-direction: column; gap: 16px; }
    .ops__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .ops__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .ops__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); }
    .ops__tabs {
      display: flex;
      gap: 2px;
      border-bottom: 1px solid var(--tm-line);
      overflow-x: auto;
    }
    .ops__tab {
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
    }
    .ops__tab:hover { color: var(--tm-text); }
    .ops__tab.is-on { color: var(--tm-green); border-bottom-color: var(--tm-green); }
    .ops__panel { min-width: 0; }
  `],
})
export class OperationsComponent implements OnInit, OnDestroy {
  tabs: { label: string; value: OpsTab; icon: IconName }[] = [
    { label: 'Rides', value: 'rides', icon: 'road' },
    { label: 'Active Vehicles', value: 'vehicles', icon: 'calendar' },
    { label: 'Customers', value: 'customers', icon: 'user-plus' },
  ];

  activeTab: OpsTab = 'rides';
  private sub?: Subscription;

  constructor(private route: ActivatedRoute, private router: Router) {}

  ngOnInit(): void {
    this.sub = this.route.queryParamMap.subscribe((q) => {
      const tab = q.get('opsTab');
      this.activeTab = tab === 'vehicles' || tab === 'customers' ? tab : 'rides';
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  select(tab: OpsTab): void {
    this.activeTab = tab;
    this.router.navigate([], {
      queryParams: { opsTab: tab === 'rides' ? null : tab },
      queryParamsHandling: 'merge',
    });
  }
}
