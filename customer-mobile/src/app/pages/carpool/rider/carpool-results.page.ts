import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { CarpoolApiService } from '../carpool-api.service';
import { CarpoolResult, CarpoolSearchAnswer } from '../carpool.models';
import { addDays, clock, dayLabel, distanceLabel, indiaDate, plainDate, priceLabel, shortDate, daysFromToday } from './rider-format';
import { clampDate, clampSeats, fromParams, getHorizonDays, getSeatsMax, setHorizonDays, setSeatsMax, RiderSearch, toParams, toQuery } from './rider-search';

/**
 * Results (customer mockup 3, 3b and the loading state). The day and seats
 * stay at the top so the rider can change either without going back. Full
 * carpools and ones without enough seats stay in the list, dimmed.
 */
@Component({
  selector: 'app-carpool-results',
  templateUrl: './carpool-results.page.html',
  styleUrls: ['./carpool-rider.scss'],
  standalone: false,
})
export class CarpoolResultsPage implements OnInit, OnDestroy {
  search: RiderSearch | null = null;
  answer: CarpoolSearchAnswer | null = null;
  loading = false;
  error = false;
  private sub?: Subscription;

  readonly today = indiaDate();
  get lastDay(): string { return addDays(indiaDate(), getHorizonDays()); }
  readonly price = priceLabel;
  seatsMax = getSeatsMax();
  readonly clock = clock;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private nav: NavController,
    private carpool: CarpoolApiService,
  ) {}

  ngOnInit(): void {
    this.search = fromParams(this.route.snapshot.queryParams);
    if (!this.search) {
      this.nav.navigateRoot('/carpool/search');
      return;
    }
    this.carpool.config().subscribe((c) => {
      setSeatsMax(c.seats_max);
      setHorizonDays(c.publish_horizon_days);
      this.seatsMax = getSeatsMax();
    });
    this.load();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  load(): void {
    if (!this.search) return;
    this.sub?.unsubscribe();
    this.loading = true;
    this.error = false;
    this.sub = this.carpool.search(toQuery(this.search)).subscribe({
      next: (a) => {
        this.answer = a;
        this.loading = false;
      },
      error: () => {
        this.answer = null;
        this.loading = false;
        this.error = true;
      },
    });
  }

  get title(): string {
    return this.search ? `${this.search.from.name} to ${this.search.to.name}` : '';
  }

  get dateTitle(): string { return this.search ? dayLabel(this.search.date) : ''; }
  get dateSub(): string { return this.search ? shortDate(this.search.date) : ''; }

  moveDay(n: number): void { if (this.search) this.change({ date: clampDate(addDays(this.search.date, n)) }); }
  pickDate(value: string): void { if (value) this.change({ date: clampDate(value) }); }
  setSeats(n: number): void { this.change({ seats: clampSeats(n) }); }
  goDay(date: string): void { this.change({ date }); }

  private change(patch: Partial<RiderSearch>): void {
    if (!this.search) return;
    this.search = { ...this.search, ...patch };
    void this.router.navigate([], { relativeTo: this.route, queryParams: toParams(this.search), replaceUrl: true });
    this.load();
  }

  edit(): void {
    if (this.search) this.nav.navigateBack('/carpool/search', { queryParams: toParams(this.search) });
  }

  open(r: CarpoolResult): void {
    if (this.search) void this.router.navigate(['/carpool/ride', r.id], { queryParams: toParams(this.search) });
  }

  get results(): CarpoolResult[] { return this.answer?.results ?? []; }

  get countLine(): string {
    const n = this.results.length;
    return `${n} ${n === 1 ? 'carpool passes' : 'carpools pass'} near both places`;
  }

  /** "today", "tomorrow" or "on Sun 15 Nov". */
  private get dayWord(): string {
    if (!this.search) return '';
    const n = daysFromToday(this.search.date);
    return n === 0 ? 'today' : n === 1 ? 'tomorrow' : `on ${plainDate(this.search.date)}`;
  }

  get emptyTitle(): string { return `No carpools ${this.dayWord}`; }
  get emptyText(): string { return `No one is driving past both places ${this.dayWord}. Try another day.`; }

  pickupLine(r: CarpoolResult): string {
    if (r.status === 'in_progress') return 'Already on the road';
    return `Pickup about ${clock(r.pickup.at)}, a ${distanceLabel(r.pickup.walk_m ?? 0)} walk`;
  }

  pickupClock(r: CarpoolResult): string {
    return clock(r.pickup.at);
  }

  walkLabel(r: CarpoolResult): string {
    return `${distanceLabel(r.pickup.walk_m ?? 0)}`;
  }

  leftLabel(r: CarpoolResult): string {
    return r.seats_free <= 0 ? 'Full' : `${r.seats_free} left`;
  }

  blockedLine(r: CarpoolResult): string {
    const why = r.blocked === 'full' ? 'Full'
      : r.blocked === 'off' ? 'Not taking requests right now'
      : `Not enough seats for ${this.search?.seats ?? 1}`;
    return `${r.driver.name}. ${why}`;
  }

  myLabel(r: CarpoolResult): string {
    return r.my_request?.status === 'accepted' ? "You're in" : 'Request sent';
  }

  otherDayTitle(d: { date: string; day: number }): string {
    return d.day === 1 ? `Tomorrow, ${plainDate(d.date)}` : d.day === 0 ? `Today, ${plainDate(d.date)}` : plainDate(d.date);
  }

  otherDaySub(d: { count: number; first_at: string }): string {
    return d.count === 1 ? `1 carpool, ${clock(d.first_at)}` : `${d.count} carpools, from ${clock(d.first_at)}`;
  }

  trackResult = (_: number, r: CarpoolResult) => r.id;
}
