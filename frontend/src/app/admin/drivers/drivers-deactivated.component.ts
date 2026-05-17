import { Component } from '@angular/core';
import { DriversListComponent } from './drivers-list.component';

@Component({
  selector: 'app-drivers-deactivated',
  standalone: true,
  imports: [DriversListComponent],
  template: `<app-drivers-list state="deactivated" title="Deactivated Drivers" />`,
})
export class DriversDeactivatedComponent {}
