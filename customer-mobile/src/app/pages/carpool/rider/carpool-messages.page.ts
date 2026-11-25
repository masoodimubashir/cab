import { Component } from '@angular/core';
import { NavController } from '@ionic/angular';
import { CarpoolApiService } from '../carpool-api.service';
import { CarpoolChatBox, CarpoolChatRow } from '../carpool.models';
import { dayOf, clock } from './rider-format';

/**
 * Messages (customer mockup 6): Active and Past at the top, one collapsible
 * container per trip titled by where the rider is going, holding the group
 * chat and the private chat with the driver. Past is read only. Opened from
 * the chat button on My trips.
 */
@Component({
  selector: 'app-carpool-messages',
  template: `
    <ion-content class="cr">
      <ion-refresher slot="fixed" (ionRefresh)="load($any($event).target.complete.bind($any($event).target))">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>
      <div class="cr-wrap">
        <div class="c-bar"><button class="icon-btn ring" aria-label="Back" (click)="back()"><ion-icon name="chevron-back-outline"></ion-icon></button><h1 class="grow">Messages</h1></div>
        <nav class="seg" aria-label="Show conversations" [style.--n]="2" [style.--i]="past ? 1 : 0">
          <span class="seg-thumb" aria-hidden="true"></span>
          <button [class.on]="!past" [attr.aria-pressed]="!past" (click)="past = false">Active</button>
          <button [class.on]="past" [attr.aria-pressed]="past" (click)="past = true">Past</button>
        </nav>
        <p class="keep-note" *ngIf="past"><ion-icon name="time-outline"></ion-icon>Chats are deleted soon after the trip ends.</p>
        <div class="center" *ngIf="!loaded && !error"><ion-spinner name="crescent"></ion-spinner></div>

        <div class="box" *ngFor="let b of shown; trackBy: trackBox" [class.closed]="isClosed(b)">
          <button class="box-h" [attr.aria-expanded]="!isClosed(b)" (click)="toggle(b)">
            <span class="grow">
              <span class="t">To {{ b.listing.end.name }} <span class="n" *ngIf="b.unread && !past">{{ b.unread }}</span></span>
              <small>From {{ b.listing.start.name }}, {{ when(b) }}{{ past ? ', ' + statusWord(b) : '' }}</small>
            </span>
            <ion-icon class="chev" name="chevron-down-outline"></ion-icon>
          </button>
          <div class="box-b">
            <button class="crow" *ngFor="let c of b.conversations" (click)="open(c)">
              <span class="av grp m" *ngIf="c.conversation.kind === 'group'"><ion-icon name="people-outline"></ion-icon></span>
              <span class="av m" *ngIf="c.conversation.kind === 'direct'">{{ c.conversation.other_initials }}</span>
              <span class="grow"><span class="nm">{{ name(c) }}<span class="role" *ngIf="c.conversation.kind === 'direct'"> driver</span><span class="n" *ngIf="c.unread">{{ c.unread }}</span></span><span class="pv ell">{{ preview(c) }}</span></span>
              <span class="t11 muted">{{ stamp(c) }}</span>
            </button>
            <div class="crow gone" *ngIf="b.chats_deleted">
              <span class="av m"><ion-icon name="time-outline"></ion-icon></span>
              <span class="grow"><span class="nm">This chat was deleted</span><span class="pv">Chats are deleted {{ retention }} {{ retention === 1 ? 'day' : 'days' }} after the trip ends. The trip is still in My trips.</span></span>
            </div>
          </div>
          <div class="box-f"><button class="link" (click)="seeTrip(b)">See trip<ion-icon name="chevron-forward-outline"></ion-icon></button></div>
        </div>

        <button type="button" class="more-btn" *ngIf="past && pastMore" [disabled]="loadingPast" (click)="loadOlderTrips()">{{ loadingPast ? 'Loading…' : 'Show older trips' }}</button>

        <div class="empty-plain" *ngIf="loaded && !shown.length">
          <div class="ec-i"><ion-icon name="chatbubbles-outline"></ion-icon></div>
          <h2>{{ past ? 'No past chats' : 'No messages yet' }}</h2>
          <p>{{ past ? 'Chats of finished and cancelled trips show here, read only.' : 'When you ask to join a carpool, your chat with the driver starts here.' }}</p>
        </div>
      </div>

      <div slot="fixed" class="errbar float" role="alert" *ngIf="error">
        <ion-icon name="alert-circle-outline"></ion-icon>
        <span class="grow"><b>Couldn't load your messages</b><small>Check your connection.</small></span>
        <button class="c-go line mini" (click)="load()">Try again</button>
      </div>
    </ion-content>
  `,
  styleUrls: ['./carpool-rider.scss'],
  styles: [`
    .crow { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 62px; padding: 0; border: 0; border-top: 1px solid var(--cr-line); background: transparent; text-align: left; color: var(--cr-ink); }
    .crow .grow { min-width: 0; }
    .crow .nm { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; }
    .crow .role { font-size: 12px; font-weight: 500; color: var(--cr-muted); }
    .crow .pv { display: block; font-size: 13px; color: var(--cr-muted); }
    .crow .pv.ell { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .crow .t11 { flex: none; font-size: 11px; }
    .crow .av { width: 40px; height: 40px; flex: none; display: grid; place-items: center; border-radius: 50%; background: #e6ecf2; color: #33445a; font-size: 13px; font-weight: 700; }
    .crow .av.grp { background: var(--cr-green-soft); color: var(--cr-green); font-size: 20px; }
    .crow.gone .av { background: #f2f4f7; color: var(--cr-muted); font-size: 20px; }
    .crow.gone .nm { color: var(--cr-muted); }
    .box { border: 1px solid var(--cr-line); border-radius: 14px; background: #fff; margin-top: 12px; }
    .box-h { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 56px; padding: 8px 12px 8px 14px; border: 0; border-radius: 14px; background: transparent; text-align: left; color: var(--cr-ink); }
    .box-h .t { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; }
    .box-h small { display: block; margin-top: 2px; font-size: 12px; color: var(--cr-muted); }
    .box-h .chev { flex: none; font-size: 18px; color: var(--cr-muted); transition: transform .2s ease; }
    .box.closed .chev { transform: rotate(-90deg); }
    .box-b { padding: 0 14px; border-top: 1px solid var(--cr-line); }
    .box.closed .box-b, .box.closed .box-f { display: none; }
    .box-f { display: flex; justify-content: flex-end; padding: 0 14px; border-top: 1px solid var(--cr-line); }
    .link { display: inline-flex; align-items: center; gap: 2px; min-height: 44px; border: 0; background: transparent; font-size: 13px; font-weight: 700; color: var(--cr-green); }
    .n { min-width: 18px; height: 18px; padding: 0 5px; display: inline-grid; place-items: center; border-radius: 10px; background: var(--cr-green); color: #fff; font-size: 12px; font-weight: 700; }
    .keep-note { display: flex; align-items: center; gap: 6px; margin: 4px 2px 0; font-size: 12px; color: var(--cr-muted); }
  `],
  standalone: false,
})
export class CarpoolMessagesPage {
  past = false;
  active: CarpoolChatBox[] = [];
  pastBoxes: CarpoolChatBox[] = [];
  pastMore = false;
  gonePage = 1;
  loadingPast = false;
  loaded = false;
  error = false;
  /** Days a chat is kept after the trip ends, for the "This chat was deleted" row. */
  retention = 1;
  private closed = new Set<number>();
  private openPast = new Set<number>();
  private seen = false;

  constructor(private carpool: CarpoolApiService, private nav: NavController) {}

  get shown(): CarpoolChatBox[] {
    return this.past ? this.pastBoxes : this.active;
  }

  ionViewWillEnter(): void {
    this.load();
  }

  /** Older trips whose chats are gone, one page at a time (S12). */
  loadOlderTrips(): void {
    if (this.loadingPast) return;
    this.loadingPast = true;
    this.carpool.chats(this.gonePage + 1).subscribe({
      next: (c) => {
        this.pastBoxes = [...this.pastBoxes, ...c.past];
        this.pastMore = !!c.past_more;
        this.gonePage += 1;
        this.loadingPast = false;
      },
      error: () => (this.loadingPast = false),
    });
  }

  load(done?: () => void): void {
    this.error = false;
    this.carpool.chats().subscribe({
      next: (c) => {
        this.active = c.active;
        this.pastBoxes = c.past;
        this.pastMore = !!c.past_more;
        this.gonePage = 1;
        this.retention = c.retention_days ?? 1;
        this.loaded = true;
        // Containers with unread messages start open; the rest closed (mockup 6).
        if (!this.seen) c.active.filter((b) => !b.unread).forEach((b) => this.closed.add(b.listing.id));
        this.seen = true;
        done?.();
      },
      error: () => {
        this.error = true;
        done?.();
      },
    });
  }

  isClosed(b: CarpoolChatBox): boolean {
    return this.past ? !this.openPast.has(b.listing.id) : this.closed.has(b.listing.id);
  }

  toggle(b: CarpoolChatBox): void {
    const set = this.past ? this.openPast : this.closed;
    set.has(b.listing.id) ? set.delete(b.listing.id) : set.add(b.listing.id);
  }

  when(b: CarpoolChatBox): string {
    const c = b.conversations[0]?.conversation;
    return `${dayOf(b.listing.departs_at).toLowerCase()} ${clock(b.listing.departs_at)}${!this.past && c ? ' with ' + c.driver_first_name : ''}`;
  }

  statusWord(b: CarpoolChatBox): string {
    return b.listing.status === 'cancelled' ? 'cancelled' : b.listing.status === 'completed' ? 'completed' : 'closed';
  }

  name(c: CarpoolChatRow): string {
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
    return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { weekday: 'short' });
  }

  trackBox = (_: number, b: CarpoolChatBox) => b.listing.id;

  open(c: CarpoolChatRow): void {
    void this.nav.navigateForward(`/carpool/chat/${c.conversation.id}`);
  }

  seeTrip(b: CarpoolChatBox): void {
    void this.nav.navigateForward(`/carpool/ride/${b.listing.id}`);
  }

  back(): void {
    void this.nav.navigateBack('/customer-tabs/trips');
  }
}
