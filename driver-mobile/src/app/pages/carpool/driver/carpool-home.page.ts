import { Component, OnDestroy } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { Subscription, forkJoin } from 'rxjs';
import { filter } from 'rxjs/operators';
import { ApiService } from '../../../core/api.service';
import { CarpoolApiService } from '../carpool-api.service';
import { CarpoolDriverHome, CarpoolListing, CarpoolPlanState } from '../carpool.models';
import { addDays, clock, dayLabel, documentBanner, greeting, indiaDate, priceLabel, shortDate } from './carpool-format';

interface Me {
  user?: { name?: string };
  driver?: { carpool_vehicle?: { make: string; model: string; colour: string; plate: string } | null };
}

/**
 * Carpool Home (mockup 2, "Home, no plan", "Home, plan ending"): greeting and
 * car, the Publish banner (See plans without a plan), the plan warning, the
 * requests switch, the waiting requests (M4) and the next carpool.
 */
@Component({
  selector: 'app-carpool-home',
  templateUrl: './carpool-home.page.html',
  styleUrls: ['./carpool-driver.scss'],
  standalone: false,
})
export class CarpoolHomePage implements OnDestroy {
  loading = true;
  error: string | null = null;
  name = '';
  initials = '';
  car = '';
  home: CarpoolDriverHome | null = null;
  plan: CarpoolPlanState | null = null;
  switching = false;
  readonly greeting = greeting();

  private entered: Subscription;

  constructor(
    private api: ApiService,
    private carpool: CarpoolApiService,
    private nav: NavController,
    private router: Router,
  ) {
    // Reload on every arrival: Ionic skips ionViewWillEnter on tab pages when
    // coming back from Publish or the carpool page.
    this.entered = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd && e.urlAfterRedirects.startsWith('/carpool/home')))
      .subscribe(() => this.load());
  }

  ngOnDestroy(): void {
    this.entered.unsubscribe();
  }

  load(done?: () => void): void {
    this.error = null;
    forkJoin({
      me: this.api.get<Me>('/drivers/me'),
      home: this.carpool.driverHome(),
      plan: this.carpool.planState(),
    }).subscribe({
      next: ({ me, home, plan }) => {
        const full = (me.user?.name ?? '').trim();
        this.name = full.split(' ')[0];
        this.initials = full.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
        const v = me.driver?.carpool_vehicle;
        this.car = v ? `${v.colour} ${v.make} ${v.model}, ${v.plate}` : '';
        this.home = home;
        this.plan = plan;
        this.loading = false;
        done?.();
      },
      error: () => {
        this.loading = false;
        this.error = 'Check your connection and pull down to try again.';
        done?.();
      },
    });
  }

  get planEndLabel(): string {
    const end = this.plan?.plan?.expires_at;
    if (!end) return '';
    const days = Math.max(0, Math.ceil((Date.parse(end) - Date.now()) / 86_400_000));
    return days <= 1 ? 'Your plan ends tomorrow' : `Your plan ends in ${days} days`;
  }

  /** Carpools on the end day and the day after continue; later ones are cancelled (section 2). */
  get planCutoff(): string {
    const end = this.plan?.plan?.expires_at;
    return end ? shortDate(addDays(indiaDate(new Date(end)), 1)).replace(/^\w+, /, '') : '';
  }

  isFull(l: CarpoolListing): boolean {
    return l.seats_taken >= l.seats_total;
  }

  nextTime(l: CarpoolListing): string {
    return clock(l.departs_at);
  }

  nextDay(l: CarpoolListing): string {
    return l.status === 'in_progress' ? 'In progress' : dayLabel(indiaDate(new Date(l.departs_at)));
  }

  price(l: CarpoolListing): string {
    return priceLabel(l);
  }

  publish(): void {
    void this.nav.navigateForward('/carpool/publish');
  }

  /** S11: the dated-documents card (null when nothing to say). */
  get docBanner(): { title: string; text: string } | null {
    return documentBanner(this.home?.documents);
  }

  documents(): void {
    void this.nav.navigateForward('/carpool/documents');
  }

  plans(): void {
    void this.nav.navigateForward('/carpool-signup/plans');
  }

  /** "Contact support" on the paused-access card. */
  support(): void {
    void this.nav.navigateForward('/support');
  }

  open(l: CarpoolListing): void {
    void this.nav.navigateForward(`/carpool/listing/${l.id}`);
  }

  // ── Waiting for you (M4) ──

  answering: 'accept' | 'decline' | null = null;
  answered: 'accepted' | 'declined' | null = null;
  answerError: string | null = null;

  /** "Leaves in 40 min", "Leaves today at 6:00 PM", "Leaves tomorrow at 6:00 PM", "Leaves Mon, 16 Nov at 7:00 AM". */
  leavesLine(iso: string): string {
    const mins = Math.round((Date.parse(iso) - Date.now()) / 60_000);
    if (mins > 0 && mins <= 60) return `Leaves in ${mins} min`;
    if (mins <= 0) return `Left at ${clock(iso)}`;
    const day = dayLabel(indiaDate(new Date(iso)));
    return `Leaves ${day === 'Today' || day === 'Tomorrow' ? day.toLowerCase() : day} at ${clock(iso)}`;
  }

  /** "2 seats · Free ride · Kashmir University to Bemina Bypass". */
  requestMeta(r: CarpoolDriverHome['first_request']): string {
    if (!r) return '';
    const seats = `${r.seats} ${r.seats === 1 ? 'seat' : 'seats'}`;
    return `${seats} · ${r.is_free ? 'Free ride' : `₹${r.total}`} · ${r.listing.start.name} to ${r.listing.end.name}`;
  }

  get moreLine(): string {
    const n = this.home?.more.count ?? 0;
    return `${n} more ${n === 1 ? 'request' : 'requests'}`;
  }

  get moreRoute(): string {
    const routes = this.home?.more.routes ?? [];
    return routes.length === 1 ? routes[0] : `${routes.length} carpools`;
  }

  answer(kind: 'accept' | 'decline'): void {
    const r = this.home?.first_request;
    if (!r || this.answering) return;
    this.answering = kind;
    this.answerError = null;
    const call = kind === 'accept' ? this.carpool.acceptRequest(r.id) : this.carpool.declineRequest(r.id);
    call.subscribe({
      next: () => {
        this.answering = null;
        this.answered = kind === 'accept' ? 'accepted' : 'declined';
        setTimeout(() => {
          this.answered = null;
          this.load();
        }, 1600);
      },
      error: (e) => {
        this.answering = null;
        this.answerError = (Object.values(e?.error?.errors ?? {})[0] as string[] | undefined)?.[0] ?? 'Something went wrong. Try again.';
        this.load();
      },
    });
  }

  inbox(): void {
    void this.nav.navigateRoot('/carpool/inbox');
  }

  toggleRequests(): void {
    if (!this.home || !this.home.has_live || this.switching) return;
    const on = !this.home.requests_on;
    this.switching = true;
    this.home.requests_on = on;
    this.carpool.setRequests(on).subscribe({
      next: (state) => {
        if (this.home) this.home.requests_on = state;
        this.switching = false;
      },
      error: () => {
        if (this.home) this.home.requests_on = !on;
        this.switching = false;
      },
    });
  }
}
