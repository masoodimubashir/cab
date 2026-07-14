import { Component } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-customer-tabs',
  templateUrl: './customer-tabs.page.html',
  styleUrls: ['./customer-tabs.page.scss'],
  standalone: false,
})
export class CustomerTabsPage {
  constructor(private router: Router) {
    this.syncTabBar(this.router.url);
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => this.syncTabBar(event.urlAfterRedirects));
  }
  // Hide the bottom tab bar on the booking/home ("book") tab for a clean,
  // map-first screen. It shows on the Rides (my-trips) tab. The app also
  // navigates via the slide-out side menu.
  hideTabBar = true; // 'book' is the default landing tab

  onTabChange(ev: { tab?: string }): void {
    this.hideTabBar = ev?.tab === 'book' || this.router.url.includes('/customer-tabs/fixed-rides');
  }

  private syncTabBar(url: string): void {
    this.hideTabBar = url.includes('/customer-tabs/book') || url.includes('/customer-tabs/fixed-rides');
  }
}

