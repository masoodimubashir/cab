import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { FixedBookPage } from './fixed-book.page';

const routes: Routes = [
  {
    path: '',
    component: FixedBookPage,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class FixedBookPageRoutingModule {}
