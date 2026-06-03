import { Component } from '@angular/core';

@Component({
  selector: 'app-customer-tabs',
  templateUrl: './customer-tabs.page.html',
  styleUrls: ['./customer-tabs.page.scss'],
  standalone: false,
})
export class CustomerTabsPage {
  // Hide the bottom tab bar on the booking/home ("book") tab for a clean,
  // map-first screen. It shows on the Rides (my-trips) tab. The app also
  // navigates via the slide-out side menu.
  hideTabBar = true; // 'book' is the default landing tab

  onTabChange(ev: { tab?: string }): void {
    this.hideTabBar = ev?.tab === 'book';
  }
}

