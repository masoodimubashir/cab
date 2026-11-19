import { Component, OnDestroy } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { CarpoolApiService } from '../carpool-api.service';
import { forkJoin } from 'rxjs';
import { CarpoolChatBox, CarpoolChatRow, CarpoolJoinRequest, CarpoolListingSummary } from '../carpool.models';
import { whenLabel } from './carpool-format';

/**
 * Inbox tab (mockup 7): one container per carpool, the route as its title,
 * with that carpool's join requests. Each request opens in place to its
 * pickup, drop, Accept and Decline. Below the requests: the group chat, then
 * the private chats (M5). Past holds finished and closed carpools, read only.
 */

/** One container: a carpool with its waiting requests and its chats. */
interface Box {
  listing: CarpoolListingSummary;
  requests: CarpoolJoinRequest[];
  chats: CarpoolChatRow[];
  count: number;
}
@Component({
  selector: 'app-carpool-inbox',
  template: `
    <ion-content class="cp">
      <ion-refresher slot="fixed" (ionRefresh)="load($any($event).target.complete.bind($any($event).target))">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>
      <div class="cp-wrap hm">
        <div class="d-head" style="margin-bottom: 6px"><h1>Inbox</h1></div>
        <nav class="seg" aria-label="Show conversations" [style.--n]="2" [style.--i]="past ? 1 : 0">
          <span class="seg-thumb" aria-hidden="true"></span>
          <button [class.on]="!past" [attr.aria-pressed]="!past" (click)="past = false">Active</button>
          <button [class.on]="past" [attr.aria-pressed]="past" (click)="past = true">Past</button>
        </nav>

        <ng-container *ngIf="!past">
          <div class="center" *ngIf="!loaded && !error"><ion-spinner name="crescent"></ion-spinner></div>
          <div class="box" *ngFor="let b of boxes; trackBy: trackBox" [class.closed]="closed.has(b.listing.id)">
            <button class="box-h" [attr.aria-expanded]="!closed.has(b.listing.id)" (click)="toggleBox(b.listing.id)">
              <span class="grow">
                <span class="t">{{ b.listing.start.name }} to {{ b.listing.end.name }} <span class="n" *ngIf="b.count">{{ b.count }}</span></span>
                <small>{{ boxLine(b.listing) }}</small>
              </span>
              <ion-icon class="chev" name="chevron-down-outline"></ion-icon>
            </button>
            <div class="box-b">
              <div class="rq" *ngFor="let r of b.requests; trackBy: trackRequest" [class.open]="openRq.has(r.id)">
                <button class="rq-h" [attr.aria-expanded]="openRq.has(r.id)" (click)="toggleRq(r.id)">
                  <span class="av m">{{ r.rider.initials }}</span>
                  <span class="grow"><span class="nm">{{ r.rider.name }} wants to join</span><span class="pv">{{ requestLine(r) }}</span></span>
                  <ion-icon class="chev" name="chevron-down-outline"></ion-icon>
                </button>
                <div class="rq-b">
                  <div class="hm-route"><span class="hm-rail"><i></i><b></b><ion-icon name="location"></ion-icon></span><span>Pickup: {{ r.pickup.name }}</span><span>Drop: {{ r.drop.name }}</span></div>
                  <p class="t12 muted" style="margin: 0 0 8px" *ngIf="r.pickup_passed_min !== null">On the road. By the plan the car {{ r.pickup_passed_min > 0 ? 'passed this pickup about ' + r.pickup_passed_min + ' min ago' : 'is reaching this pickup' }}. You can still accept.</p>
                  <div class="row" style="gap: 10px" *ngIf="!done[r.id]">
                    <button class="d-btn line" [disabled]="busy === r.id" (click)="answer(r, 'decline')">Decline</button>
                    <button class="d-btn" [disabled]="busy === r.id" (click)="answer(r, 'accept')">Accept</button>
                  </div>
                  <p class="req-done" *ngIf="done[r.id] === 'accepted'" role="status"><ion-icon name="checkmark-circle"></ion-icon>Accepted. {{ r.rider.first_name }} is on this carpool.</p>
                  <p class="req-done plain" *ngIf="done[r.id] === 'declined'" role="status"><ion-icon name="close-circle-outline"></ion-icon>Declined. {{ r.rider.first_name }} is told.</p>
                  <p class="req-err" *ngIf="errors[r.id]" role="alert">{{ errors[r.id] }}</p>
                </div>
              </div>
              <button class="crow" *ngFor="let c of b.chats" (click)="openChat(c)">
                <span class="av grp m" *ngIf="c.conversation.kind === 'group'"><ion-icon name="people-outline"></ion-icon></span>
                <span class="av m" *ngIf="c.conversation.kind === 'direct'">{{ c.conversation.other_initials }}</span>
                <span class="grow"><span class="nm">{{ chatName(c) }}<span class="n" *ngIf="c.unread">{{ c.unread }}</span></span><span class="pv ell">{{ preview(c) }}</span></span>
                <span class="t11 muted">{{ stamp(c) }}</span>
              </button>
            </div>
            <div class="box-f"><button class="link" (click)="open(b.listing.id)">See details<ion-icon name="chevron-forward-outline"></ion-icon></button></div>
          </div>
          <div class="empty-plain" *ngIf="loaded && !boxes.length">
            <div class="ec-i"><ion-icon name="chatbubbles-outline"></ion-icon></div>
            <h2>No requests or messages yet</h2>
            <p>When riders ask to join a carpool, their requests and your chats with them show here.</p>
          </div>
        </ng-container>

        <ng-container *ngIf="past">
          <p class="keep-note"><ion-icon name="time-outline"></ion-icon>Chats are deleted soon after the trip ends.</p>
          <div class="box" *ngFor="let b of pastBoxes; trackBy: trackBox" [class.closed]="!openPast.has(b.listing.id)">
            <button class="box-h" [attr.aria-expanded]="openPast.has(b.listing.id)" (click)="togglePast(b.listing.id)">
              <span class="grow">
                <span class="t">{{ b.listing.start.name }} to {{ b.listing.end.name }}</span>
                <small>{{ whenLabel(b.listing.departs_at) }}, {{ b.listing.status === 'cancelled' ? 'cancelled' : b.listing.status === 'completed' ? 'completed' : 'closed' }}</small>
              </span>
              <ion-icon class="chev" name="chevron-down-outline"></ion-icon>
            </button>
            <div class="box-b">
              <button class="crow" *ngFor="let c of b.conversations" (click)="openChat(c)">
                <span class="av grp m" *ngIf="c.conversation.kind === 'group'"><ion-icon name="people-outline"></ion-icon></span>
                <span class="av m" *ngIf="c.conversation.kind === 'direct'">{{ c.conversation.other_initials }}</span>
                <span class="grow"><span class="nm">{{ chatName(c) }}</span><span class="pv ell">{{ preview(c) }}</span></span>
                <span class="t11 muted">{{ stamp(c) }}</span>
              </button>
            </div>
          </div>
          <div class="empty-plain" *ngIf="loaded && !pastBoxes.length">
            <div class="ec-i"><ion-icon name="chatbubbles-outline"></ion-icon></div>
            <h2>No past chats</h2>
            <p>Chats of finished and cancelled carpools show here, read only. They are deleted soon after the trip ends.</p>
          </div>
        </ng-container>
      </div>

      <div slot="fixed" class="errbar float" role="alert" *ngIf="error">
        <ion-icon name="alert-circle-outline"></ion-icon>
        <span class="grow"><b>Couldn't load your inbox</b><small>Check your connection.</small></span>
        <button class="d-btn line mini" (click)="load()">Try again</button>
      </div>
    </ion-content>
  `,
  styleUrls: ['./carpool-driver.scss'],
  standalone: false,
})
export class CarpoolInboxPage implements OnDestroy {
  past = false;
  boxes: Box[] = [];
  pastBoxes: CarpoolChatBox[] = [];
  loaded = false;
  openPast = new Set<number>();
  readonly whenLabel = whenLabel;
  error = false;
  /** Containers the driver closed; all start open, since each holds waiting requests. */
  closed = new Set<number>();
  openRq = new Set<number>();
  busy: number | null = null;
  done: Record<number, 'accepted' | 'declined'> = {};
  errors: Record<number, string> = {};
  private seen = false;
  private entered: Subscription;

  constructor(
    private carpool: CarpoolApiService,
    private nav: NavController,
    private router: Router,
  ) {
    // Reload on every arrival (Ionic skips ionViewWillEnter on tab pages re-entered from outside).
    this.entered = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd && e.urlAfterRedirects.startsWith('/carpool/inbox')))
      .subscribe(() => this.load());
  }

  ngOnDestroy(): void {
    this.entered.unsubscribe();
  }

  load(done?: () => void): void {
    this.error = false;
    forkJoin({ inbox: this.carpool.inbox(), chats: this.carpool.chats() }).subscribe({
      next: ({ inbox, chats }) => {
        this.boxes = this.merge(inbox.active, chats.active);
        this.pastBoxes = chats.past;
        this.loaded = true;
        this.done = {};
        this.errors = {};
        // The first request opens by default, the others stay closed (mockup 7).
        const first = this.boxes.find((b) => b.requests.length);
        if (!this.seen && first) this.openRq.add(first.requests[0].id);
        // Carpools with no waiting requests start closed.
        if (!this.seen) this.boxes.filter((b) => !b.requests.length).forEach((b) => this.closed.add(b.listing.id));
        this.seen = true;
        done?.();
      },
      error: () => {
        this.error = true;
        done?.();
      },
    });
  }

  /** Requests first, then chats, per carpool; carpools with waiting requests lead (mockup 7). */
  private merge(reqs: { listing: CarpoolListingSummary; requests: CarpoolJoinRequest[] }[], chats: CarpoolChatBox[]): Box[] {
    const byId = new Map<number, Box>();
    for (const r of reqs) byId.set(r.listing.id, { listing: r.listing, requests: r.requests, chats: [], count: r.requests.length });
    for (const c of chats) {
      const box = byId.get(c.listing.id) ?? { listing: c.listing, requests: [], chats: [], count: 0 };
      box.chats = c.conversations;
      box.count += c.unread;
      byId.set(c.listing.id, box);
    }
    return [...byId.values()].sort((a, b) => Number(!!b.requests.length) - Number(!!a.requests.length) || a.listing.departs_at.localeCompare(b.listing.departs_at));
  }

  chatName(c: CarpoolChatRow): string {
    return c.conversation.kind === 'group' ? 'Group chat' : c.conversation.title.replace(', private', '');
  }

  preview(c: CarpoolChatRow): string {
    const m = c.last;
    if (!m) return 'No messages yet';
    if (m.type === 'system') return m.body;
    const who = m.mine ? 'You: ' : c.conversation.kind === 'group' && m.sender ? `${m.sender.first_name}: ` : '';
    return who + m.body;
  }

  stamp(c: CarpoolChatRow): string {
    const m = c.last;
    if (!m) return '';
    const d = new Date(m.created_at);
    return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { weekday: 'short' });
  }

  openChat(c: CarpoolChatRow): void {
    void this.nav.navigateForward(`/carpool/chat/${c.conversation.id}`);
  }

  togglePast(id: number): void {
    this.openPast.has(id) ? this.openPast.delete(id) : this.openPast.add(id);
  }

  /** "Tomorrow, 6:00 PM, 3 seats free" or "Today, 8:30 AM, full". */
  boxLine(l: CarpoolListingSummary): string {
    const free = l.seats_free <= 0 ? 'full' : `${l.seats_free} ${l.seats_free === 1 ? 'seat' : 'seats'} free`;
    return `${whenLabel(l.departs_at)}, ${free}`;
  }

  /** "2 seats · Free ride" or "1 seat · ₹250". */
  requestLine(r: CarpoolJoinRequest): string {
    return `${r.seats} ${r.seats === 1 ? 'seat' : 'seats'} · ${r.is_free ? 'Free ride' : `₹${r.total}`}`;
  }

  toggleBox(id: number): void {
    this.closed.has(id) ? this.closed.delete(id) : this.closed.add(id);
  }

  toggleRq(id: number): void {
    this.openRq.has(id) ? this.openRq.delete(id) : this.openRq.add(id);
  }

  answer(r: CarpoolJoinRequest, kind: 'accept' | 'decline'): void {
    if (this.busy) return;
    this.busy = r.id;
    delete this.errors[r.id];
    const call = kind === 'accept' ? this.carpool.acceptRequest(r.id) : this.carpool.declineRequest(r.id);
    call.subscribe({
      next: () => {
        this.busy = null;
        this.done[r.id] = kind === 'accept' ? 'accepted' : 'declined';
        setTimeout(() => this.load(), 1600);
      },
      error: (e) => {
        this.busy = null;
        this.errors[r.id] = (Object.values(e?.error?.errors ?? {})[0] as string[] | undefined)?.[0] ?? 'Something went wrong. Try again.';
      },
    });
  }

  open(id: number): void {
    void this.nav.navigateForward(`/carpool/listing/${id}`);
  }

  trackBox = (_: number, b: { listing: { id: number } }) => b.listing.id;
  trackRequest = (_: number, r: CarpoolJoinRequest) => r.id;
}
