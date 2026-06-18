import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { FixedDriverPage } from './fixed-driver.page';

const routes: Routes = [{ path: '', component: FixedDriverPage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class FixedDriverPageRoutingModule {}
