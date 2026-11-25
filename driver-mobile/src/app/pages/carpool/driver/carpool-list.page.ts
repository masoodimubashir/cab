import { Component, OnDestroy } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { CarpoolApiService } from '../carpool-api.service';
import { CarpoolListFilter, CarpoolListing } from '../carpool.models';
import { cancelReasonLabel, endedLabel, priceLabel, whenLabel } from './carpool-format';

/** The Carpools tab (mockup 2b): every carpool, filtered Upcoming · Today · Past. */
@Component({
  selector: 'app-carpool-list',
  templateUrl: './carpool-list.page.html',
  styleUrls: ['./carpool-driver.scss'],
  standalone: false,
})
export class CarpoolListPage implements OnDestroy {
  readonly filters: { key: CarpoolListFilter; label: string }[] = [
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'today', label: 'Today' },
    { key: 'past', label: 'Past' },
  ];
  filter: CarpoolListFilter = 'upcoming';
  items: CarpoolListing[] = [];
  more = false;
  page = 1;
  loadingMore = false;
  loading = true;
  error = false;

  private entered: Subscription;

  constructor(
    private carpool: CarpoolApiService,
    private nav: NavController,
    private router: Router,
  ) {
    // Ionic doesn't fire ionViewWillEnter on a tab page when the tabs are
    // re-entered from outside (after Cancel, say), so reload on every arrival.
    this.entered = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd && e.urlAfterRedirects.startsWith('/carpool/carpools')))
      .subscribe(() => this.enter());
  }

  ngOnDestroy(): void {
    this.entered.unsubscribe();
  }

  private enter(): void {
    // Cancel opens this tab under Past (mockup 8g).
    const wanted = this.router.lastSuccessfulNavigation?.extras?.state?.['filter'] as CarpoolListFilter | undefined;
    if (wanted && this.filters.some((f) => f.key === wanted)) this.filter = wanted;
    this.load();
  }

  get filterIndex(): number {
    return this.filters.findIndex((f) => f.key === this.filter);
  }

  pick(f: CarpoolListFilter): void {
    if (f === this.filter) return;
    this.filter = f;
    this.load();
  }

  load(done?: () => void): void {
    this.loading = true;
    this.error = false;
    const asked = this.filter;
    this.carpool.myListingsPage(asked, 1).subscribe({
      next: (res) => {
        if (asked !== this.filter) return;
        this.items = res.data;
        this.more = res.has_more;
        this.page = 1;
        this.loading = false;
        this.error = false;
        done?.();
      },
      error: () => {
        if (asked !== this.filter) return;
        this.items = [];
        this.loading = false;
        this.error = true;
        done?.();
      },
    });
  }

  /** Older past carpools, one page at a time (S12). */
  loadMore(): void {
    if (this.loadingMore || !this.more) return;
    const asked = this.filter;
    this.loadingMore = true;
    this.carpool.myListingsPage(asked, this.page + 1).subscribe({
      next: (res) => {
        this.loadingMore = false;
        if (asked !== this.filter) return;
        this.items = [...this.items, ...res.data];
        this.more = res.has_more;
        this.page += 1;
      },
      error: () => (this.loadingMore = false),
    });
  }

  when(l: CarpoolListing): string {
    return whenLabel(l.departs_at);
  }

  price(l: CarpoolListing): string {
    return priceLabel(l);
  }

  ended(l: CarpoolListing): string {
    return endedLabel(l);
  }

  reason(l: CarpoolListing): string | null {
    return cancelReasonLabel(l);
  }

  open(l: CarpoolListing): void {
    void this.nav.navigateForward(`/carpool/listing/${l.id}`);
  }

  get emptyText(): string {
    return {
      upcoming: 'Carpools you publish for later days show here.',
      today: "Nothing leaving today. Carpools for today show here.",
      past: 'Finished and cancelled carpools show here.',
    }[this.filter];
  }
}
