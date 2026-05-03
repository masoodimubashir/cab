import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CustomerNegotiationPage } from './customer-negotiation.page';

const routes: Routes = [{ path: '', component: CustomerNegotiationPage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class CustomerNegotiationPageRoutingModule {}

