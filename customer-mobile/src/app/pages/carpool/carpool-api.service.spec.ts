import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CarpoolApiService } from './carpool-api.service';

describe('CarpoolApiService', () => {
  let api: jasmine.SpyObj<ApiService>;
  let service: CarpoolApiService;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'post']);
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
});
