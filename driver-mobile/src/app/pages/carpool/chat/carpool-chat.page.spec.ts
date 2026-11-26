import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { of } from 'rxjs';
import { CarpoolApiService } from '../carpool-api.service';
import { CarpoolChatConversation, CarpoolChatMessage, CarpoolChatThread } from '../carpool.models';
import { CarpoolChatPage } from './carpool-chat.page';

/** The chat screen's rules: unread divider, who can answer a pickup card, the mini map, the length limit. Kept identical in both apps. */
describe('CarpoolChatPage', () => {
  let api: jasmine.SpyObj<CarpoolApiService>;
  let fixture: ComponentFixture<CarpoolChatPage>;
  let page: CarpoolChatPage;

  const listing = {
    id: 3, status: 'published', start: { name: 'Bemina' }, end: { name: 'University' }, departs_at: '2026-11-20T03:00:00Z', day: 1,
    seats_total: 4, seats_taken: 2, seats_free: 2, price_per_seat: 60, is_free: false,
  } as CarpoolChatConversation['listing'];

  const conv = (over: Partial<CarpoolChatConversation> = {}): CarpoolChatConversation => ({
    id: 1, kind: 'direct', title: 'Sana, private', request_id: 7, is_driver: true, other_initials: 'SM', other_first_name: 'Sana',
    other_user_id: 9, driver_first_name: 'Imran', pickup_name: 'Rajbagh', listing, members: 2, ...over,
  });

  const msg = (id: number, over: Partial<CarpoolChatMessage> = {}): CarpoolChatMessage => ({
    id, conversation_id: 1, type: 'text', body: `m${id}`, removed: false, masked: false, sender: { id: 9, first_name: 'Sana', initials: 'SM', is_driver: false },
    mine: false, proposal: null, created_at: '2026-11-19T08:00:00Z', ...over,
  });

  const card = (id: number, by: 'rider' | 'driver', over: Partial<NonNullable<CarpoolChatMessage['proposal']>> = {}): CarpoolChatMessage =>
    msg(id, {
      type: 'pickup_request',
      proposal: { id: 50 + id, status: 'pending', name: 'Silver Oak', address: null, lat: 34.08, lng: 74.78, proposed_by: by, request_id: 7, rider_first_name: 'Sana', for_me: false, ...over },
    });

  function open(thread: Partial<CarpoolChatThread> & { conversation: CarpoolChatConversation }): void {
    api.chat.and.returnValue(of({
      messages: [], writable: true, last_read_message_id: 0, route: [], retention_days: 1, message_max_chars: 1000, ...thread,
    }) as any);
    fixture = TestBed.createComponent(CarpoolChatPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    api = jasmine.createSpyObj<CarpoolApiService>('CarpoolApiService', ['chat', 'sendMessage', 'markChatRead', 'proposePickup', 'answerPickup', 'report']);
    api.markChatRead.and.returnValue(of({}));
    TestBed.configureTestingModule({
      declarations: [CarpoolChatPage],
      imports: [FormsModule],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        { provide: CarpoolApiService, useValue: api },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '1' }, queryParamMap: { get: () => null } } } },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
        { provide: NavController, useValue: jasmine.createSpyObj('NavController', ['navigateBack', 'navigateForward']) },
      ],
    });
  });

  afterEach(() => fixture?.destroy());

  it('draws the travel doodle wallpaper behind the messages (mockup option A)', () => {
    open({ conversation: conv() });
    const thread = fixture.nativeElement.querySelector('.thread') as HTMLElement;
    expect(thread.style.backgroundImage).toContain('assets/carpool/chat-doodles.svg');
  });

  it('puts the unread divider above the first message from someone else after the read marker', () => {
    open({ conversation: conv(), messages: [msg(1), msg(2, { mine: true }), msg(3), msg(4), msg(5, { type: 'system', sender: null })], last_read_message_id: 2 });
    expect(page.dividerId).toBe(3);
    expect(page.unreadCount).toBe(2);
  });

  it('draws no divider when everything is read', () => {
    open({ conversation: conv(), messages: [msg(1), msg(2)], last_read_message_id: 2 });
    expect(page.dividerId).toBeNull();
  });

  it('lets the driver answer a rider card, and only that rider answer the driver card', () => {
    open({ conversation: conv({ is_driver: true }) });
    expect(page.canAnswer(card(1, 'rider'))).toBeTrue();
    expect(page.canAnswer(card(2, 'driver', { for_me: false }))).toBeFalse();

    open({ conversation: conv({ is_driver: false, kind: 'group', request_id: null }) });
    expect(page.canAnswer(card(3, 'rider'))).toBeFalse();
    expect(page.canAnswer(card(4, 'driver', { for_me: true }))).toBeTrue();
    expect(page.canAnswer(card(5, 'driver', { for_me: false }))).toBeFalse();
    expect(page.canAnswer(card(6, 'driver', { for_me: true, status: 'accepted' }))).toBeFalse();
  });

  it('shows the pin button to riders in the private and the group chat, not to drivers', () => {
    open({ conversation: conv({ is_driver: false }) });
    expect(page.canAskPickup).toBeTrue();
    open({ conversation: conv({ is_driver: false, kind: 'group', request_id: null }) });
    expect(page.canAskPickup).toBeTrue();
    open({ conversation: conv({ is_driver: true }) });
    expect(page.canAskPickup).toBeFalse();
  });

  it('draws the mini map with the spot in the middle of the card', () => {
    const route: [number, number][] = Array.from({ length: 20 }, (_, i) => [34.07 + i * 0.003, 74.77 + i * 0.004]);
    open({ conversation: conv(), route });
    const m = card(1, 'rider', { lat: 34.1, lng: 74.8 });
    const mini = page.mini(m);
    expect(mini.d.startsWith('M')).toBeTrue();
    expect(mini.x).toBe(129);
    expect(mini.y).toBe(52);
  });

  it('refuses to send over the server limit and sends within it', () => {
    api.sendMessage.and.returnValue(of(msg(9, { mine: true, body: 'hi' })));
    open({ conversation: conv(), message_max_chars: 20 });
    expect(page.maxChars).toBe(20);
    page.draft = 'a'.repeat(21);
    page.send();
    expect(api.sendMessage).not.toHaveBeenCalled();
    page.draft = 'short one';
    page.send();
    expect(api.sendMessage).toHaveBeenCalledWith(1, 'short one');
  });

  it('updates an older pickup card when its status changes on a refresh', () => {
    open({ conversation: conv(), messages: [card(1, 'rider')], last_read_message_id: 0 });
    api.chat.and.returnValue(of({ conversation: conv(), messages: [], writable: true, last_read_message_id: 0, route: [], retention_days: 1,
      message_max_chars: 1000, proposal_states: { 51: 'replaced' } }) as any);
    (page as any).poll();
    expect(page.messages[0].proposal?.status).toBe('replaced');
  });

  it('names the other person on a waiting card, using the rider for the driver\'s card', () => {
    open({ conversation: conv({ is_driver: true, kind: 'group', request_id: null }) });
    expect(page.proposalWord(card(1, 'driver', { rider_first_name: 'Sana' }), true)).toBe('Waiting for Sana');
    open({ conversation: conv({ is_driver: false }) });
    expect(page.proposalWord(card(2, 'rider'), true)).toBe('Waiting for Imran');
  });

  // ── Header and trip card (v4 preview, 2026-11-20) ──

  const trip = (over: Partial<NonNullable<CarpoolChatConversation['trip']>> = {}): NonNullable<CarpoolChatConversation['trip']> => ({
    state: 'accepted', seats: 2, price_per_seat: 60, is_free: false, paid_marked: true, rider_first_name: 'Sana',
    pickup: { name: 'Rajbagh', at: '2026-11-20T03:12:00Z' }, drop: { name: 'Nigeen', at: '2026-11-20T03:30:00Z' }, ...over,
  });

  it('puts the person first in a private chat and the route first in a group, with one quiet line', () => {
    open({ conversation: conv({ is_driver: false, other_first_name: 'Imran', car_label: 'White Maruti Swift', trip: trip() }) });
    expect(page.headName).toBe('Imran');
    expect(page.headSub).toBe('Driver · White Maruti Swift');

    open({ conversation: conv({ is_driver: true, other_first_name: 'Sana', trip: trip() }) });
    expect(page.headName).toBe('Sana');
    expect(page.headSub).toBe('Rider · 2 seats · Paid');

    open({ conversation: conv({ kind: 'group', request_id: null, trip: null, member_names: ['Imran', 'Sana', 'You'] }) });
    expect(page.headName).toBe('Bemina to University');
    expect(page.headSub).toBe('Imran, Sana, You');
  });

  it('adds Read only to the quiet line and drops the Report circle once the chat is read only', () => {
    open({ conversation: conv({ is_driver: false, trip: trip() }), writable: false });
    expect(page.headSub).toContain('Read only');
    expect(fixture.nativeElement.querySelector('.icon-btn.report')).toBeNull();
    open({ conversation: conv({ is_driver: false, trip: trip() }), writable: true });
    expect(fixture.nativeElement.querySelector('.icon-btn.report')).not.toBeNull();
  });

  it('shows the rider\'s own pickup time and stops in a private chat, and the departure time in the group', () => {
    open({ conversation: conv({ is_driver: false, trip: trip() }) });
    expect(page.tripTime).toBe(page.time('2026-11-20T03:12:00Z'));
    expect(page.tripLabel.startsWith('Your pickup')).toBeTrue();
    expect(page.pillStops).toEqual({ from: 'Rajbagh', to: 'Nigeen' });
    expect(page.tripMeta).toContain('₹60 a seat');

    open({ conversation: conv({ is_driver: true, trip: trip() }) });
    expect(page.tripLabel.startsWith("Sana's pickup")).toBeTrue();
    expect(page.tripMeta).not.toContain('₹');

    open({ conversation: conv({ kind: 'group', request_id: null, trip: null }) });
    expect(page.tripTime).toBe(page.time(listing.departs_at));
    expect(page.pillStops).toBeNull();
    expect(page.tripMeta).toBe('2 seats left · ₹60 a seat');
  });

  it('says where a request stands, and shows the state instead of the stops once the trip is over', () => {
    open({ conversation: conv({ is_driver: false, trip: trip({ state: 'sent' }) }) });
    expect(page.tripStatus).toEqual({ text: 'Request sent', kind: 'sent' });
    expect(page.tripLabel).toContain('about');
    expect(page.pillStops).not.toBeNull();

    open({ conversation: conv({ is_driver: false, trip: trip({ state: 'started' }) }) });
    expect(page.tripStatus).toEqual({ text: 'Live', kind: 'live' });

    open({ conversation: conv({ is_driver: false, trip: trip({ state: 'cancelled' }) }) });
    expect(page.tripStatus).toEqual({ text: 'Cancelled', kind: 'cancel' });
    expect(page.pillStops).toBeNull();

    open({ conversation: conv({ kind: 'group', request_id: null, trip: null, listing: { ...listing, status: 'in_progress' } }) });
    expect(page.tripStatus).toEqual({ text: 'Live', kind: 'live' });
  });

  it('has a status word for every way a request can end, and shows it in the pill instead of the stops', () => {
    const words: Record<string, [string, string]> = {
      accepted: ['Accepted', 'ok'], completed: ['Completed', 'done'], declined: ['Declined', 'cancel'], removed: ['Removed', 'cancel'],
      filled: ['Carpool full', 'cancel'], no_show: ['No-show', 'cancel'], withdrawn: ['Withdrawn', 'done'], left: ['You left', 'done'], ended: ['Ended', 'done'],
    };
    for (const [state, [text, kind]] of Object.entries(words)) {
      open({ conversation: conv({ is_driver: false, trip: trip({ state }) }) });
      expect(page.tripStatus).toEqual({ text, kind: kind as 'ok' | 'done' | 'cancel' });
    }
    // The pill keeps the stops while the trip is going ahead and switches to the status once it is over.
    for (const state of ['sent', 'accepted', 'started']) {
      open({ conversation: conv({ trip: trip({ state }) }) });
      expect(page.pillStops).not.toBeNull();
    }
    for (const state of ['completed']) {
      open({ conversation: conv({ trip: trip({ state }) }) });
      expect(page.pillStops).not.toBeNull();
    }
    for (const state of ['cancelled', 'declined', 'removed', 'filled', 'no_show', 'withdrawn', 'left', 'ended']) {
      open({ conversation: conv({ trip: trip({ state }) }) });
      expect(page.pillStops).toBeNull();
    }
    // The driver sees "Rider left" where the rider sees "You left".
    open({ conversation: conv({ is_driver: true, trip: trip({ state: 'left' }) }) });
    expect(page.tripStatus?.text).toBe('Rider left');
  });

  it('keeps the card docked while the chat is short, makes the pill when messages would go behind it, and leaves an opened card alone', () => {
    open({ conversation: conv({ trip: trip() }) });
    page.chooseMode(true, 200);
    expect(page.tripMode).toBe('docked');
    expect(page.threadPad).toBe(220);

    page.chooseMode(false, 200);
    expect(page.tripMode).toBe('compact');
    expect(page.threadPad).toBe(64);

    page.openPeek();
    page.chooseMode(true, 200);
    expect(page.tripMode).toBe('peek');

    page.closePeek();
    expect(page.tripMode).toBe('compact');
  });
});
