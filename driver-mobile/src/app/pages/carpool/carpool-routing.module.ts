import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

/**
 * Carpool screens, lazy loaded under /carpool behind AuthGuard and
 * CarpoolEnabledGuard (app-routing.module.ts). Pages are added from M3/M4
 * onward; until then nothing links here.
 */
const routes: Routes = [];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class CarpoolRoutingModule {}
