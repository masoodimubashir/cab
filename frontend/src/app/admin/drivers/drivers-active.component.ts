import { Component } from '@angular/core';
import { DriversListComponent } from './drivers-list.component';

@Component({
  selector: 'app-drivers-active',
  standalone: true,
  imports: [DriversListComponent],
  template: `<app-drivers-list state="active" title="Active Drivers" />`,
})
export class DriversActiveComponent {}
