import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { CityContextService } from '../../core/city-context.service';
import { IconComponent } from '../../ui';
import { AdminPricingComponent } from '../admin-pricing.component';
import { DynamicPricingPanelComponent } from './dynamic-pricing-panel.component';

/**
 * Pricing — the single home for everything fare-related in the selected city.
 * A segmented switcher flips between Base Pricing (rate cards per ride type)
 * and Dynamic Pricing (surge regions). Both tabs are scoped to the city
 * chosen in the topbar switcher.
 */
@Component({
  selector: 'app-pricing',
  standalone: true,
  imports: [CommonModule, IconComponent, AdminPricingComponent, DynamicPricingPanelComponent],
  template: `
    <div class="pr">
      <header class="pr__head">
        <h1 class="pr__title">Pricing</h1>
        <p class="pr__sub">
          Base fare rate cards and dynamic surge regions{{ cityName ? ' for ' + cityName : '' }}.
        </p>
      </header>

      <div class="seg" role="tablist">
        <button
          class="seg__btn"
          role="tab"
          [class.is-on]="tab === 'base'"
          [attr.aria-selected]="tab === 'base'"
          (click)="tab = 'base'"
        >
          <tm-icon name="tag" [size]="15" /> Base Pricing
        </button>
        <button
          class="seg__btn"
          role="tab"
          [class.is-on]="tab === 'dynamic'"
          [attr.aria-selected]="tab === 'dynamic'"
          (click)="tab = 'dynamic'"
        >
          <tm-icon name="bolt" [size]="15" /> Dynamic Pricing
        </button>
      </div>

      <app-admin-pricing *ngIf="tab === 'base'" />
      <app-dynamic-pricing-panel *ngIf="tab === 'dynamic'" />
    </div>
  `,
  styles: [`
    .pr { display: flex; flex-direction: column; gap: 18px; }
    .pr__head { display: flex; flex-direction: column; gap: 2px; }
    .pr__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .pr__sub { margin: 0; font-size: 13px; color: var(--tm-text-muted); }

    .seg {
      display: inline-flex; gap: 4px; padding: 4px;
      background: var(--tm-canvas-2); border-radius: var(--tm-radius-md, 10px);
      align-self: flex-start;
    }
    .seg__btn {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 8px 16px; border-radius: 8px;
      font-size: 13px; font-weight: 700; color: var(--tm-text-muted);
      background: transparent; cursor: pointer;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .seg__btn.is-on { background: var(--tm-surface); color: var(--tm-text); box-shadow: var(--tm-shadow-sm); }
  `],
})
export class PricingComponent implements OnInit, OnDestroy {
  tab: 'base' | 'dynamic' = 'base';
  cityName = '';

  private subs: Subscription[] = [];

  constructor(private cityCtx: CityContextService) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    let cities: { id: number; name: string }[] = [];
    let id: number | null = null;
    const apply = () => (this.cityName = cities.find((c) => c.id === id)?.name ?? '');
    this.subs.push(
      this.cityCtx.cities$.subscribe((list) => { cities = list; apply(); }),
      this.cityCtx.cityId$.subscribe((v) => { id = v; apply(); }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }
}
