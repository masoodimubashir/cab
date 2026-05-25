import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { CityContextService } from '../../core/city-context.service';
import { DynamicPricingPanelComponent } from './dynamic-pricing-panel.component';

@Component({
  selector: 'app-pricing',
  standalone: true,
  imports: [CommonModule, DynamicPricingPanelComponent],
  template: `
    <div class="pr">
      <header class="pr__head">
        <h1 class="pr__title">Pricing</h1>
        <p class="pr__sub">
          Dynamic surge regions{{ cityName ? ' for ' + cityName : '' }}.
        </p>
      </header>

      <app-dynamic-pricing-panel />
    </div>
  `,
  styles: [`
    .pr { display: flex; flex-direction: column; gap: 18px; }
    .pr__head { display: flex; flex-direction: column; gap: 2px; }
    .pr__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .pr__sub { margin: 0; font-size: 13px; color: var(--tm-text-muted); }
  `],
})
export class PricingComponent implements OnInit, OnDestroy {
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
