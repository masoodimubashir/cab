import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CustomerBookPage } from './customer-book.page';

const routes: Routes = [{ path: '', component: CustomerBookPage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class CustomerBookPageRoutingModule {}

