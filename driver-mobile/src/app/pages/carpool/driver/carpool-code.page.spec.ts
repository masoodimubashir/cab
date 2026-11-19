import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { NavController } from '@ionic/angular';
import { of, throwError } from 'rxjs';
import { CarpoolApiService } from '../carpool-api.service';
import { CarpoolRiderProfile } from '../carpool.models';
import { CarpoolCodePage } from './carpool-code.page';

/** Check code and pick up (mockups 11, 11b): the code is required, wrong tries are counted, a lock stops guessing. */
describe('CarpoolCodePage', () => {
  let api: jasmine.SpyObj<CarpoolApiService>;
  let fixture: ComponentFixture<CarpoolCodePage>;
  let page: CarpoolCodePage;

  const profile = (over: Partial<CarpoolRiderProfile> = {}): CarpoolRiderProfile => ({
    id: 9, listing_id: 4, status: 'accepted', rider: { name: 'Aamir Lone', first_name: 'Aamir', initials: 'AL' }, seats: 1, price_per_seat: 60,
    is_free: false, total: 60, paid_marked: false, chat_id: 5, ride_state: 'waiting', picked_up_at: null, dropped_at: null, no_show_at: null,
    code_verified: false, code_locked_until: null, pickup: { name: 'Jawahar Nagar', lat: 1, lng: 1, at: '2026-11-20T03:00:00Z' },
    drop: { name: 'University', lat: 1, lng: 1, at: '2026-11-20T03:20:00Z' }, created_at: null,
    profile: { joined: '2026-10', phone_verified: true, photo_added: true, carpools_taken: 0 },
    listing: {} as any, ...over,
  });

  function open(p = profile()): void {
    api.joinRequest.and.returnValue(of(p));
    fixture = TestBed.createComponent(CarpoolCodePage);
    page = fixture.componentInstance;
    page.ionViewWillEnter();
    fixture.detectChanges();
  }

  beforeEach(() => {
    api = jasmine.createSpyObj<CarpoolApiService>('CarpoolApiService', ['joinRequest', 'checkCode', 'markPickedUp']);
    TestBed.configureTestingModule({
      declarations: [CarpoolCodePage],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        { provide: CarpoolApiService, useValue: api },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: (k: string) => (k === 'id' ? '4' : '9') } } } },
        { provide: NavController, useValue: jasmine.createSpyObj('NavController', ['navigateBack', 'navigateForward']) },
      ],
    });
  });

  it('only keeps four digits', () => {
    open();
    page.onInput('51a89x7');
    expect(page.digits).toBe('5189');
  });

  it('a right code turns green and then marks the rider as picked up', () => {
    open();
    api.checkCode.and.returnValue(of({ ok: true, tries_left: 3, locked_until: null }));
    api.markPickedUp.and.returnValue(of(profile({ ride_state: 'picked_up' })));
    page.onInput('4729');
    page.check();
    expect(page.step).toBe('right');
    page.pickUp();
    expect(api.markPickedUp).toHaveBeenCalledWith(9);
    expect(page.step).toBe('done');
  });

  it('a wrong code counts the tries left and Try again clears the boxes', () => {
    open();
    api.checkCode.and.returnValue(of({ ok: false, tries_left: 2, locked_until: null }));
    page.onInput('1111');
    page.check();
    expect(page.step).toBe('wrong');
    expect(page.triesLeft).toBe(2);
    page.retry();
    expect(page.digits).toBe('');
    expect(page.step).toBe('enter');
  });

  it('too many wrong codes lock checking', () => {
    open();
    const until = new Date(Date.now() + 5 * 60000).toISOString();
    api.checkCode.and.returnValue(of({ ok: false, tries_left: 0, locked_until: until }));
    page.onInput('1111');
    page.check();
    expect(page.locked).toBeTrue();
  });

  it('a server refusal while locked shows its message', () => {
    open();
    api.checkCode.and.returnValue(throwError(() => ({ error: { errors: { code: ['Too many wrong codes. Try again at 9:05 AM.'] } } })));
    page.onInput('1111');
    page.check();
    expect(page.failure).toContain('Too many wrong codes');
    expect(page.locked).toBeTrue();
  });

  it('opens already green when the code was checked before', () => {
    open(profile({ code_verified: true }));
    expect(page.step).toBe('right');
  });

  it('shows done when the rider is already picked up', () => {
    open(profile({ ride_state: 'picked_up' }));
    expect(page.step).toBe('done');
  });
});
