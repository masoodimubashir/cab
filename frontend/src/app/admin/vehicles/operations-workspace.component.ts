import { Component, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { VehicleWorkspaceComponent } from './vehicle-workspace.component';
import { MasterSection } from './master-explorer.component';

/** Operations share the existing workspace and its API editors. */
@Component({
  selector: 'app-operations-workspace', standalone: true,
  imports: [VehicleWorkspaceComponent],
  template: '<app-vehicle-workspace [masterSection]="section" />',
})
export class OperationsWorkspaceComponent implements OnDestroy {
  section: MasterSection = 'routes';
  private subscription: Subscription;
  constructor(route: ActivatedRoute, router: Router) {
    this.subscription = route.paramMap.subscribe(params => {
      const section = params.get('section') ?? 'routes';
      if (['routes', 'drivers', 'route-groups', 'vehicle-configuration'].includes(section)) this.section = section as MasterSection;
      else void router.navigateByUrl('/operations/routes', { replaceUrl: true });
    });
  }
  ngOnDestroy(): void { this.subscription.unsubscribe(); }
}
