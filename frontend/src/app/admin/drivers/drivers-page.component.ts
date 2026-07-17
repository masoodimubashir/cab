import {
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { IconComponent } from '../../ui';

import { DriversListComponent } from './drivers-list.component';
import { DriverDetailDrawerComponent } from './driver-detail/driver-detail.drawer';
import { DriversApprovalsTabComponent } from './tabs/drivers-approvals.tab';
import { DocumentsCatalogTabComponent } from './tabs/documents-catalog.tab';
import { DriversPayoutsTabComponent } from './tabs/drivers-payouts.tab';

export type DriversTab = 'all' | 'approvals' | 'documents' | 'payouts';

const TAB_FROM_DATA: Record<string, DriversTab> = {
  'drivers-all': 'all',
  'drivers-approvals': 'approvals',
  'drivers-documents': 'documents',
};

/**
 * Single-page shell for the whole Drivers module. The four legacy routes
 * (/drivers, /drivers/approvals, /drivers/approvals/:driverId, /drivers/documents)
 * all resolve here — we read `route.data.tab` plus `?tab=` and the `driverId`
 * param to decide which tab to render. Tab content is swapped in/out via
 * `*ngIf` so only the active tab is in the DOM; the route-level loadComponent
 * already gives us the bundle split.
 */
@Component({
  selector: 'app-drivers-page',
  standalone: true,
  // Default CD on purpose: this shell hosts default-CD descendants like
  // `DriversListComponent`. If the shell were OnPush and not marked dirty,
  // Angular would skip the entire subtree during zone ticks, and async data
  // updates inside the descendants wouldn't render until a click.
  imports: [
    CommonModule,
    IconComponent,
    DriversListComponent,
    DriverDetailDrawerComponent,
    DriversApprovalsTabComponent,
    DocumentsCatalogTabComponent,
    DriversPayoutsTabComponent,
  ],
  template: `
    <div class="page">
      <nav class="tabs" role="tablist" aria-label="Drivers sections">
        <button
          *ngFor="let t of tabs"
          type="button"
          role="tab"
          class="tabs__btn"
          [class.is-active]="activeTab === t.value"
          [attr.aria-selected]="activeTab === t.value"
          (click)="setTab(t.value)"
        >
          <tm-icon [name]="t.icon" [size]="16" />
          <span>{{ t.label }}</span>
        </button>
      </nav>

      <div class="tabs__panel" role="tabpanel">
        <ng-container [ngSwitch]="activeTab">
          <app-drivers-list                *ngSwitchCase="'all'" />
          <app-drivers-approvals-tab       *ngSwitchCase="'approvals'" />
          <app-documents-catalog-tab       *ngSwitchCase="'documents'" />
          <app-drivers-payouts-tab         *ngSwitchCase="'payouts'" />
        </ng-container>
      </div>

      <app-driver-detail-drawer
        [driverId]="driverId"
        (closed)="closeDrawer()"
      />
    </div>
  `,
  styles: [`
    :host { display: block; }

    .page {
      display: flex;
      flex-direction: column;
      gap: var(--tm-space-5);
    }

    .tabs {
      display: flex;
      gap: 4px;
      padding: 4px;
      background: var(--tm-canvas-2);
      border-radius: var(--tm-radius-md);
      align-self: flex-start;
      overflow-x: auto;
      max-width: 100%;
      scrollbar-width: none;
    }
    .tabs::-webkit-scrollbar { display: none; }
    .tabs__btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 9px 16px;
      border: 0;
      background: transparent;
      color: var(--tm-text-muted);
      font-family: var(--tm-font-body);
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      border-radius: calc(var(--tm-radius-md) - 4px);
      white-space: nowrap;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease),
                  box-shadow var(--tm-duration-fast) var(--tm-ease);
    }
    .tabs__btn:hover:not(.is-active) { color: var(--tm-text); }
    .tabs__btn.is-active {
      background: var(--tm-surface);
      color: var(--tm-text);
      box-shadow: 0 1px 3px rgba(15,20,25,0.08);
    }

    .tabs__panel { min-width: 0; }

    @media (max-width: 540px) {
      .tabs__btn span { display: none; }
      .tabs__btn { padding: 9px 12px; }
    }
  `],
})
export class DriversPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly tabs: { value: DriversTab; label: string; icon: 'user' | 'check' | 'edit' | 'rupee' }[] = [
    { value: 'all',        label: 'All Drivers',         icon: 'user' },
    { value: 'approvals',  label: 'Approvals',           icon: 'check' },
    { value: 'documents',  label: 'Documents Catalog',   icon: 'edit' },
    { value: 'payouts',    label: 'Payouts Due',         icon: 'rupee' },
  ];

  activeTab: DriversTab = 'all';
  /** Selected driver — drives the drawer mount. */
  driverId: number | null = null;

  private subs: Subscription[] = [];

  ngOnInit(): void {
    // Initial tab + driverId come from (in priority order): query param,
    // route data, then defaults. Re-evaluate on every emission so browser
    // back/forward and sidebar query-param links stay in sync.
    this.subs.push(
      this.route.queryParamMap.subscribe((qp) => {
        const fromQp = qp.get('tab');
        const fromData = this.route.snapshot.data?.['tab'] as DriversTab | undefined;
        const fromName = this.routeFallbackTab();
        const next = (this.normalize(fromQp) ?? fromData ?? fromName ?? 'all') as DriversTab;
        const tabChanged = next !== this.activeTab;
        if (tabChanged) this.activeTab = next;

        const idQp = qp.get('driverId');
        const idParam = this.route.snapshot.paramMap.get('driverId');
        const raw = idQp ?? idParam;
        const parsed = raw && /^\d+$/.test(raw) ? Number(raw) : null;
        const idChanged = parsed !== this.driverId;
        if (idChanged) this.driverId = parsed;

        // OnPush: queryParamMap fires inside zone but doesn't mark *this*
        // component dirty, so the new tab content / drawer wouldn't render
        // until some other event triggers CD on the shell.
        if (tabChanged || idChanged) this.cdr.markForCheck();
      }),
    );
  }

  closeDrawer(): void {
    if (this.driverId == null) return;
    // Strip both ?driverId= and any path-param :driverId. If we landed via
    // /drivers/approvals/:id, navigate to /drivers?tab=approvals so subsequent
    // closes don't bounce back into the legacy URL.
    const onLegacyPath = this.route.snapshot.paramMap.has('driverId');
    if (onLegacyPath) {
      this.router.navigate(['/drivers'], {
        queryParams: { tab: 'approvals' },
        replaceUrl: true,
      });
    } else {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { driverId: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  setTab(next: DriversTab): void {
    if (next === this.activeTab) return;
    // Single source of truth = the URL. Updating queryParams re-fires the
    // queryParamMap subscription which sets `activeTab`. The handler is
    // idempotent so the second emission with the same value is a no-op.
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: next === 'all' ? null : next },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private normalize(v: string | null): DriversTab | null {
    return v === 'all' || v === 'approvals' || v === 'documents' || v === 'payouts' ? v : null;
  }

  /**
   * If the user landed on a legacy URL (/drivers/approvals or /drivers/documents)
   * we map the route's data.name to the corresponding tab. This keeps the old
   * URLs working without a wholesale redirect.
   */
  private routeFallbackTab(): DriversTab | null {
    const name = this.route.snapshot.data?.['name'] as string | undefined;
    return name ? TAB_FROM_DATA[name] ?? null : null;
  }
}
