import { CommonModule } from '@angular/common';
import { Component, OnDestroy, Optional } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import { CarpoolApiService } from '../carpool/carpool-api.service';
import { CarpoolTrip } from '../carpool/carpool.models';
import { clock, dayOf, seatWord } from '../carpool/rider/rider-format';

type Source = 'fixed' | 'private' | 'shuttle' | 'scheduled' | 'carpool';
type TripTab = 'journeys' | 'upcoming' | 'prebooked' | 'past';
export interface TripCard {
  key: string; id: number; source: Source; tripId?: number; title: string; route: string;
  status: string; label: string; date?: string; created?: string; scheduled: boolean;
  past: boolean; fare?: number; currency: string; payment?: string; seats?: string;
  refund?: string; link: string; action: string;
  /** Carpool cards only (customer mockup 8, 8l): badge line, day, details and the rider code. */
  carpool?: { sub: string; day: string; meta: string[]; code: string | null; sent: boolean; navy: boolean };
}

/**
 * A carpool request as a My trips card. Carpools share the list with private
 * rides and carry a Carpool badge (Carpool.md section 2). Never pre-booked.
 */
export function carpoolCard(t: CarpoolTrip): TripCard {
  const first = t.driver.first_name;
  const money = t.is_free ? 'Free' : `₹${t.total}`;
  const ending: Record<string, string> = {
    completed: `Completed with ${t.driver.name}`,
    cancelled: t.listing.cancel_reason === 'plan_ended' ? "Cancelled: the driver's plan has ended"
      : t.listing.cancel_reason === 'admin' ? 'Cancelled by Dream Cabs'
      : t.listing.cancel_reason === 'missed_departure' ? "Cancelled: it didn't start that day" : `Cancelled by ${first}`,
    declined: `${first} couldn't take this request`,
    removed: 'Removed by the driver',
    filled: 'Filled up before the driver answered',
    ended: 'Ended before the driver answered',
    left: 'You left this carpool',
    withdrawn: 'You cancelled this request',
    no_show: 'Marked as a no-show',
  };
  return {
    key: `carpool-${t.id}`, id: t.id, source: 'carpool', title: `${t.pickup.name} to ${t.drop.name}`, route: '',
    status: t.state.toUpperCase(),
    label: t.state === 'accepted' ? 'Accepted' : t.state === 'sent' ? 'Request sent' : t.state === 'started' ? 'Started' : '',
    date: t.listing.departs_at, created: t.created_at ?? undefined, scheduled: false, past: t.past,
    currency: 'INR', link: `/carpool/ride/${t.listing_id}`, action: '',
    carpool: {
      sub: t.past ? ending[t.state] ?? '' : `with ${t.driver.name}`,
      day: dayOf(t.listing.departs_at),
      meta: t.past
        ? [seatWord(t.seats), ...(t.state === 'completed' ? [money] : [])]
        : [clock(t.listing.departs_at), seatWord(t.seats), money],
      code: t.code,
      sent: t.state === 'sent',
      navy: t.state === 'cancelled',
    },
  };
}
interface Feed { rows: TripCard[]; loading: boolean; error: string; page: number; requestedPage: number; more: boolean; }
const terminal = new Set(['COMPLETED', 'CANCELLED', 'NO_SHOW', 'DROPPED', 'EXPIRED', 'REJECTED']);
const labels: Record<string, string> = {
  BOOKED: 'Confirmed', CONFIRMED: 'Confirmed', COMPLETED: 'Completed', DROPPED: 'Completed',
  CANCELLED: 'Cancelled', NO_SHOW: 'Missed', BOARDED: 'On board', REQUESTED: 'Finding a driver',
  NEGOTIATION: 'Fare discussion', ASSIGNED: 'Driver assigned', EN_ROUTE_PICKUP: 'Driver on the way',
  ARRIVED_PICKUP: 'Driver arrived', EN_ROUTE_DROP: 'In progress', ARRIVED_DROP: 'At destination',
  PENDING_DRIVER_APPROVAL: 'Awaiting driver', PAYMENT_PENDING: 'Payment pending', EXPIRED: 'Expired', REJECTED: 'Declined',
};

/** Adapt existing authenticated booking responses; never manufacture reference records. */
export function tripCard(source: Source, row: any, now = new Date()): TripCard {
  const status = String(row.status || '').toUpperCase();
  const past = terminal.has(status);
  const date = row.scheduled_at || row.announced_depart_at || row.depart_at || row.service_date;
  // A future service date is pre-booked; today's fixed departures remain Upcoming.
  const serviceDay = date ? String(date).slice(0, 10) : '';
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const underway = ['BOARDED', 'EN_ROUTE_DROP', 'ARRIVED_DROP'].includes(status);
  const scheduled = !past && !underway && (row.scheduled_at
    ? new Date(row.scheduled_at).getTime() > now.getTime() : source === 'fixed' && serviceDay > today);
  const route = source === 'fixed' ? [row.board, row.drop] : source === 'shuttle'
    ? [row.pickup?.address, row.drop?.address] : [row.pickup_address, row.drop_address];
  const routeText = route.filter(Boolean).join(' → ');
  const fare = source === 'fixed' || source === 'shuttle' ? row.fare_amount : row.final_fare ?? row.estimated_fare;
  const tripId = row.trip_id;
  const link = source === 'fixed' ? `/customer-tabs/fixed-rides/${row.id}`
    : source === 'shuttle' ? '/customer-tabs/shuttle-rides'
    : `/customer-tabs/${past ? 'trip-details' : 'trip'}/${row.id}`;
  return {
    key: `${source === 'scheduled' ? 'private' : source}-${row.id}`, id: row.id, source, tripId,
    title: source === 'fixed' ? row.route_name || routeText || 'Fixed-route ride' : routeText || 'Your ride',
    route: source === 'fixed' ? routeText : '', status, label: labels[status] || status.toLowerCase().replace(/_/g, ' ') || 'Status unavailable',
    date: past ? row.completed_at || row.cancelled_at || date || row.created_at : date || row.created_at,
    created: row.created_at, scheduled, past, fare: fare == null ? undefined : Number(fare),
    currency: row.currency || 'INR', payment: row.payment_method || row.payment?.method,
    seats: row.seat_labels?.length ? row.seat_labels.join(', ') : row.seats ? `${row.seats} ${Number(row.seats) === 1 ? 'seat' : 'seats'}` : undefined,
    refund: row.refund_status && row.refund_status !== 'NONE' ? String(row.refund_status).toLowerCase().replace(/_/g, ' ') : undefined,
    link, action: past ? 'View details' : source === 'shuttle' ? 'View booking'
      : ['REQUESTED', 'NEGOTIATION', 'PENDING_DRIVER_APPROVAL', 'PAYMENT_PENDING'].includes(status) ? 'View booking' : 'Track ride',
  };
}

@Component({
  selector: 'app-my-trips', standalone: true, imports: [CommonModule, IonicModule, RouterModule],
  templateUrl: './my-trips.page.html', styleUrls: ['./my-trips.page.scss'],
})
export class MyTripsPage implements OnDestroy {
  tab: TripTab = 'journeys';
  readonly tabs: { id: TripTab; title: string }[] = [
    { id: 'journeys', title: 'Journeys' },
    { id: 'upcoming', title: 'Upcoming' }, { id: 'prebooked', title: 'Pre-booked' }, { id: 'past', title: 'Past' },
  ];
  readonly sources: Source[] = ['fixed', 'private', 'shuttle', 'scheduled'];
  readonly names: Record<Source, string> = { fixed: 'Fixed-route rides', private: 'Private rides', shuttle: 'Shuttle rides', scheduled: 'Pre-booked rides', carpool: 'Carpools' };
  feeds = this.sources.reduce((feeds, source) => {
    feeds[source] = { rows: [], loading: false, error: '', page: 0, requestedPage: 1, more: false };
    return feeds;
  }, {} as Record<Source, Feed>);
  /** Carpool requests (M4). Loaded only where the carpool service is available. */
  carpoolFeed: Feed = { rows: [], loading: false, error: '', page: 0, requestedPage: 1, more: false };
  /** Unread carpool messages, for the chat button (customer mockup 5). */
  chatUnread = 0;
  private requests = new Subscription();
  private arrivals?: Subscription;
  private refreshedAt = 0;
  constructor(private api: ApiService, @Optional() private carpool?: CarpoolApiService, @Optional() private route?: ActivatedRoute, @Optional() router?: Router) {
    // Ionic skips ionViewWillEnter when this tab page is re-entered from a page
    // outside the tabs (the carpool page after Send request, Cancel or Leave),
    // so arrivals are caught from the router too.
    this.arrivals = router?.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd && e.urlAfterRedirects.startsWith('/customer-tabs/trips')))
      .subscribe(e => this.arrive(new URL(e.urlAfterRedirects, 'http://app').searchParams.get('tab')));
  }
  ionViewWillEnter(): void { this.arrive(this.route?.snapshot.queryParamMap.get('tab')); }
  ionViewWillLeave(): void { this.requests.unsubscribe(); this.requests = new Subscription(); }
  ngOnDestroy(): void { this.ionViewWillLeave(); this.arrivals?.unsubscribe(); }
  private arrive(tab: string | null | undefined): void {
    // Cancel request and Leave carpool open My trips under Past (customer 8c, 8h).
    if (tab && this.tabs.some(t => t.id === tab)) this.tab = tab as TripTab;
    if (Date.now() - this.refreshedAt > 1000) this.refresh();
  }
  refresh(): void {
    this.refreshedAt = Date.now();
    this.requests.unsubscribe(); this.requests = new Subscription();
    for (const source of this.sources) this.load(source, 1);
    this.loadCarpools();
  }
  get showMessages(): boolean { return !!this.carpool && (this.carpoolFeed.rows.length > 0 || this.chatUnread > 0); }
  loadCarpools(): void {
    if (!this.carpool) return;
    this.requests.add(this.carpool.chatsUnread().subscribe({ next: n => this.chatUnread = n, error: () => undefined }));
    const feed = this.carpoolFeed;
    feed.loading = true; feed.error = '';
    this.requests.add(this.carpool.myTrips().subscribe({
      next: rows => { feed.rows = rows.map(carpoolCard); feed.loading = false; },
      // 404 means carpool is switched off everywhere: nothing to show, not an error.
      error: e => { feed.loading = false; feed.rows = []; feed.error = e?.status === 404 ? '' : 'Could not load carpools. Please try again.'; },
    }));
  }
  load(source: Source, page: number): void {
    const feed = this.feeds[source];
    feed.loading = true; feed.error = ''; feed.requestedPage = page;
    const url = source === 'fixed' ? `/fixed/bookings?page=${page}&per_page=50`
      : source === 'private' ? `/customer/trips/history?status=all&page=${page}`
      : source === 'shuttle' ? '/shuttle/bookings' : '/customer/trips/scheduled';
    this.requests.add(this.api.get<any>(url).subscribe({
      next: res => {
        const rows = source === 'private' ? res?.data?.data : res?.data;
        const cards = (Array.isArray(rows) ? rows : [])
          .filter(row => !['private', 'scheduled'].includes(source) || !row.route_departure_id)
          .map(row => tripCard(source, row));
        feed.rows = page === 1 ? cards : [...feed.rows, ...cards];
        feed.page = page;
        feed.more = source === 'fixed' ? !!res?.meta?.has_more
          : source === 'private' ? Number(res?.data?.current_page) < Number(res?.data?.last_page) : false;
        feed.loading = false;
      },
      error: () => { feed.loading = false; feed.error = `Could not load ${this.names[source].toLowerCase()}. Please try again.`; },
    }));
  }
  loadMore(): void {
    for (const source of this.sources) {
      const feed = this.feeds[source];
      if (feed.more && !feed.loading) this.load(source, feed.page + 1);
    }
  }
  retry(source: Source): void { this.load(source, this.feeds[source].requestedPage); }
  get loading(): boolean { return this.sources.some(source => this.feeds[source].loading) || this.carpoolFeed.loading; }
  get hasMore(): boolean { return this.sources.some(source => this.feeds[source].more); }
  get hasErrors(): boolean { return this.sources.some(source => !!this.feeds[source].error) || !!this.carpoolFeed.error; }
  get cards(): TripCard[] {
    const sharedTripIds = new Set([...this.feeds.fixed.rows, ...this.feeds.shuttle.rows].map(row => row.tripId).filter(Boolean));
    const cards = new Map<string, TripCard>();
    for (const source of this.sources) for (const card of this.feeds[source].rows) {
      if ((source === 'private' || source === 'scheduled') && sharedTripIds.has(card.id)) continue;
      // The scheduled endpoint supplies richer scheduling information for the same private trip.
      cards.set(card.key, card);
    }
    for (const card of this.carpoolFeed.rows) cards.set(card.key, card);
    return [...cards.values()].filter(card => this.tab === 'journeys' || (this.tab === 'past' ? card.past : !card.past && (this.tab === 'prebooked' ? card.scheduled : !card.scheduled)))
      .sort((a, b) => {
        const time = (value?: string) => value ? new Date(value).getTime() || 0 : 0;
        if (this.tab === 'journeys' && a.past !== b.past) return a.past ? 1 : -1;
        return a.past && b.past ? time(b.date) - time(a.date) : time(a.date) - time(b.date);
      });
  }
  trackCard(_index: number, card: TripCard): string { return card.key; }
  dateLabel(value?: string): string {
    if (!value) return '';
    const date = new Date(value);
    return isNaN(date.getTime()) ? '' : date.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  methodLabel(value?: string): string { return value ? value.toLowerCase().replace(/_/g, ' ') : ''; }
}
