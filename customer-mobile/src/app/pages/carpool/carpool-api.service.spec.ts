import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CarpoolApiService } from './carpool-api.service';

describe('CarpoolApiService', () => {
  let api: jasmine.SpyObj<ApiService>;
  let service: CarpoolApiService;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'post', 'patch']);
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
    service = TestBed.inject(CarpoolApiService);
  });

  it('passes an enabled config through', (done) => {
    api.get.and.returnValue(of({ enabled: true, search_distance_m: 2000 }) as any);
    service.config().subscribe((c) => {
      expect(c.enabled).toBeTrue();
      expect(c.search_distance_m).toBe(2000);
      done();
    });
  });

  it('treats a failed call as off', (done) => {
    api.get.and.returnValue(throwError(() => new Error('offline')));
    service.enabled().subscribe((on) => {
      expect(on).toBeFalse();
      done();
    });
  });

  it('treats a malformed answer as off', (done) => {
    api.get.and.returnValue(of({ enabled: 'yes' }) as any);
    service.enabled().subscribe((on) => {
      expect(on).toBeFalse();
      done();
    });
  });

  it('keeps driver sign-up open while carpool is off for riders', (done) => {
    api.get.and.returnValue(of({ enabled: false, driver_signup: true }) as any);
    service.config().subscribe((c) => {
      expect(c.enabled).toBeFalse();
      expect(c.driver_signup).toBeTrue();
      done();
    });
  });

  it('closes driver sign-up when the call fails', (done) => {
    api.get.and.returnValue(throwError(() => new Error('offline')));
    service.signupOpen().subscribe((open) => {
      expect(open).toBeFalse();
      done();
    });
  });

  it('reuses one request while fresh', () => {
    api.get.and.returnValue(of({ enabled: false }) as any);
    service.config().subscribe();
    service.config().subscribe();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('unwraps the plan list', (done) => {
    api.get.and.returnValue(of({ data: [{ id: 1, title: 'P', amount: 99, days_count: 30 }] }) as any);
    service.plans().subscribe((p) => {
      expect(api.get).toHaveBeenCalledWith('/carpool/plans');
      expect(p.length).toBe(1);
      done();
    });
  });

  it('sends the payment proof with the plan id', () => {
    api.post.and.returnValue(of({}) as any);
    service.verifyPlanPayment(7, { razorpay_order_id: 'o', razorpay_payment_id: 'p', razorpay_signature: 's' }).subscribe();
    expect(api.post).toHaveBeenCalledWith('/carpool/plan/upi/verify', {
      plan_id: 7, razorpay_order_id: 'o', razorpay_payment_id: 'p', razorpay_signature: 's',
    });
  });

  it('unwraps a carpool list with its filter', (done) => {
    api.get.and.returnValue(of({ data: [{ id: 3 }] }) as any);
    service.myListings('past').subscribe((l) => {
      expect(api.get).toHaveBeenCalledWith('/carpool/driver/listings?filter=past');
      expect(l[0].id).toBe(3);
      done();
    });
  });

  it('sends only the changed fields when editing', () => {
    api.patch.and.returnValue(of({ data: { id: 4 } }) as any);
    service.editListing(4, { seats: 2 }).subscribe();
    expect(api.patch).toHaveBeenCalledWith('/carpool/driver/listings/4', { seats: 2 });
  });

  it('searches with the places, day and seats in the query', () => {
    api.get.and.returnValue(of({ results: [], other_days: [], distance_m: 2000 }) as any);
    service.search({ from_lat: 34.08, from_lng: 74.78, to_lat: 34.11, to_lng: 74.82, date: '2026-11-20', seats: 2 }).subscribe();
    expect(api.get).toHaveBeenCalledWith('/carpool/search?from_lat=34.08&from_lng=74.78&to_lat=34.11&to_lng=74.82&date=2026-11-20&seats=2');
  });

  it('opens a carpool page without a search when none is given', (done) => {
    api.get.and.returnValue(of({ data: { id: 9 } }) as any);
    service.ride(9).subscribe((r) => {
      expect(api.get).toHaveBeenCalledWith('/carpool/rides/9');
      expect(r.id).toBe(9);
      done();
    });
  });

  it('accepts a request by id and unwraps it', (done) => {
    api.post.and.returnValue(of({ data: { id: 5, status: 'accepted' } }) as any);
    service.acceptRequest(5).subscribe((r) => {
      expect(api.post).toHaveBeenCalledWith('/carpool/driver/join-requests/5/accept', {});
      expect(r.status).toBe('accepted');
      done();
    });
  });

  it('sends a chat message and unwraps it', (done) => {
    api.post.and.returnValue(of({ data: { id: 9, body: 'Hello' } }) as any);
    service.sendMessage(3, 'Hello').subscribe((m) => {
      expect(api.post).toHaveBeenCalledWith('/carpool/chats/3/messages', { body: 'Hello' });
      expect(m.id).toBe(9);
      done();
    });
  });

  it('asks only for newer messages after the last one seen', () => {
    api.get.and.returnValue(of({}) as any);
    service.chat(3, 41).subscribe();
    expect(api.get).toHaveBeenCalledWith('/carpool/chats/3?after=41');
    service.chat(3).subscribe();
    expect(api.get).toHaveBeenCalledWith('/carpool/chats/3');
  });

  it('answers a pickup request with accept or decline', () => {
    api.post.and.returnValue(of({}) as any);
    service.answerPickup(7, true).subscribe();
    service.answerPickup(7, false).subscribe();
    expect(api.post).toHaveBeenCalledWith('/carpool/pickup-proposals/7/accept', {});
    expect(api.post).toHaveBeenCalledWith('/carpool/pickup-proposals/7/decline', {});
  });

  it('starts and completes a ride and works each rider through the ride', () => {
    api.post.and.returnValue(of({ data: { id: 4 } }) as any);
    service.startRide(4).subscribe();
    service.completeRide(4).subscribe();
    service.markPickedUp(9).subscribe();
    service.markDropped(9).subscribe();
    service.markNoShow(9).subscribe();
    expect(api.post).toHaveBeenCalledWith('/carpool/driver/listings/4/start', {});
    expect(api.post).toHaveBeenCalledWith('/carpool/driver/listings/4/complete', {});
    expect(api.post).toHaveBeenCalledWith('/carpool/driver/join-requests/9/pick-up', {});
    expect(api.post).toHaveBeenCalledWith('/carpool/driver/join-requests/9/drop', {});
    expect(api.post).toHaveBeenCalledWith('/carpool/driver/join-requests/9/no-show', {});
  });

  it('checks a rider code and sends a rating', (done) => {
    api.post.and.returnValue(of({ data: { ok: false, tries_left: 2, locked_until: null } }) as any);
    service.checkCode(9, '5189').subscribe((r) => {
      expect(api.post).toHaveBeenCalledWith('/carpool/driver/join-requests/9/check-code', { code: '5189' });
      expect(r.tries_left).toBe(2);
      api.post.and.returnValue(of({ data: { rated: true } }) as any);
      service.rateDriver(4, 5, null).subscribe(() => {
        expect(api.post).toHaveBeenCalledWith('/carpool/rides/4/rating', { score: 5, comment: null });
        done();
      });
    });
  });

  it('sends confirm_overlap with a join request only when the rider chose to ask anyway', () => {
    api.post.and.returnValue(of({ data: { id: 1 } }) as any);
    const input = { seats: 1, pickup: { lat: 1, lng: 2, name: 'A' }, drop: { lat: 3, lng: 4, name: 'B' } };
    service.join(4, input).subscribe();
    service.join(4, { ...input, confirm_overlap: true }).subscribe();
    expect(api.post.calls.argsFor(0)[1]).toEqual(input);
    expect(api.post.calls.argsFor(1)[1]).toEqual({ ...input, confirm_overlap: true });
  });
});
