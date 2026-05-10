import { Component } from '@angular/core';
import { RidesListComponent } from './rides-list.component';

@Component({
  selector: 'app-rides-all',
  standalone: true,
  imports: [RidesListComponent],
  template: `<app-rides-list category="all" title="All Rides" emptyMessage="No rides match the current filters." />`,
})
export class RidesAllComponent {}
