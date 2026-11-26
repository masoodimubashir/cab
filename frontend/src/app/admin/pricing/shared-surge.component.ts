import { Component } from '@angular/core';
import { DynamicPricingPanelComponent } from './dynamic-pricing-panel.component';

@Component({
  standalone: true,
  imports: [DynamicPricingPanelComponent],
  template: `<h1>Shared surge rules</h1>
    <p>Changes here apply to all services covered by the rule.</p>
    <app-dynamic-pricing-panel [sharedOnly]="true" />`,
})
export class SharedSurgeComponent {}
