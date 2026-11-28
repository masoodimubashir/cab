import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { of, Subject, throwError } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { RealtimeService } from '../../core/realtime.service';
import { PaymentOptionsService } from '../../core/payment-options.service';
import { BookingService } from './booking.service';
import { PrivateBookPage } from './private/private.page';
import { ShuttleBookPage } from './shuttle/shuttle.page';
import { StepShellComponent } from './step-shell.component';
import { SeatGridComponent } from './fixed/seat-grid.component';

describe('Private and Shuttle booking safeguards', () => {
  let api: any;
  let router: any;
  beforeEach(async () => {
    spyOn(PrivateBookPage.prototype, 'ngOnInit').and.stub();
    spyOn(ShuttleBookPage.prototype, 'ngOnInit').and.stub();
    api = { get: jasmine.createSpy('get').and.returnValue(of({})), post: jasmine.createSpy('post').and.returnValue(of({})) };
    router = { navigateByUrl: jasmine.createSpy('navigateByUrl').and.resolveTo(true), navigate: jasmine.createSpy('navigate').and.resolveTo(true) };
    await TestBed.configureTestingModule({
      declarations: [PrivateBookPage, ShuttleBookPage],
      imports: [CommonModule, FormsModule, StepShellComponent, SeatGridComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        { provide: ApiService, useValue: api }, { provide: Router, useValue: router },
        { provide: BookingService, useValue: { trip: { cityId: 3, scope: 'local', pickup: { address: 'Pickup', lat: 34, lng: 74 }, drop: { address: 'Destination', lat: 34.1, lng: 74.1 } } } },
        ...[AuthService, RealtimeService, PaymentOptionsService, AlertController, ToastController].map(provide => ({ provide, useValue: {} })),
      ],
    }).compileComponents();
  });

  function privatePage(step: 'car' | 'price') {
    const fixture = TestBed.createComponent(PrivateBookPage);
    Object.assign(fixture.componentInstance, { step, estimate: { estimated_fare: 200 }, minFare: 150 });
    fixture.detectChanges();
    return fixture;
  }
  function shuttlePage(step: 'fare' | 'seats' | 'paying') {
    const fixture = TestBed.createComponent(ShuttleBookPage);
    Object.assign(fixture.componentInstance, { step, estimate: { estimated_fare: 100, available: true }, seatRows: 1, seatCols: 2, seatCells: [
      { row: 1, col: 1, kind: 'seat', label: '1A', price_delta: 0, status: 'AVAILABLE' },
      { row: 1, col: 2, kind: 'seat', label: '1B', price_delta: 0, status: 'BOOKED' },
    ] });
    fixture.detectChanges();
    return fixture;
  }
  function refresh(fixture: any) { fixture.componentInstance.cdr.markForCheck(); fixture.detectChanges(); }

  it('keeps the Private guide separate from the customer offer and advances without sending a trip', () => {
    const fixture = privatePage('car');
    expect(fixture.nativeElement.querySelector('.pv-rides')).toBeTruthy();
    fixture.nativeElement.querySelector('.pv-rides-next').click();
    refresh(fixture);
    expect(fixture.componentInstance.step).toBe('price');
    expect(fixture.componentInstance.offer).toBeNull();
    expect(fixture.nativeElement.querySelector('.sf__cta').disabled).toBeTrue();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('explains missing vehicle pricing without asking the customer to retry', async () => {
    const f = privatePage('car');
    api.post.and.returnValue(throwError(() => ({ status: 404, error: { message: 'Pricing rule not set for this vehicle.' } })));
    f.componentInstance.vehicleTypeId = 9;
    await (f.componentInstance as any).loadEstimate();
    refresh(f);
    expect(f.nativeElement.textContent).toContain('This vehicle isn’t available for your journey. Please choose another vehicle.');
    expect(f.nativeElement.querySelector('.pv-rides-error')).toBeNull();
    expect(f.nativeElement.querySelector('.pv-rides-footer-row')).toBeNull();
    expect(f.nativeElement.querySelector('.pv-rides-next')).toBeNull();
    f.componentInstance.goToPrice();
    expect(f.componentInstance.step).toBe('car');
    api.post.and.returnValue(of({ estimated_fare: 220 }));
    await (f.componentInstance as any).loadEstimate();
    refresh(f);
    expect(f.nativeElement.querySelector('.pv-rides-unavailable')).toBeNull();
    expect(f.nativeElement.querySelector('.pv-rides-next').disabled).toBeFalse();
  });

  it('keeps connection and server errors retryable instead of claiming no service', async () => {
    const f = privatePage('car');
    for (const status of [0, 500, 404]) {
      api.post.and.returnValue(throwError(() => ({ status, error: { message: 'Request failed' } })));
      await (f.componentInstance as any).loadEstimate();
      refresh(f);
      expect(f.componentInstance.vehicleUnavailable).toBeFalse();
      expect(f.nativeElement.textContent).toContain('We couldn’t check the fare. Please try again.');
      expect(f.nativeElement.querySelector('.pv-rides-error button').textContent).toContain('Retry');
    }
  });

  it('handles missing fares and destination restrictions with customer guidance', async () => {
    const f = privatePage('car');
    api.post.and.returnValue(of({ estimated_fare: 0 }));
    await (f.componentInstance as any).loadEstimate();
    expect(f.componentInstance.availabilityMessage).toContain('Please choose a specific vehicle.');
    api.post.and.returnValue(throwError(() => ({ status: 422, error: { message: 'Destination is outside the service area for Sopore.' } })));
    await (f.componentInstance as any).loadEstimate();
    expect(f.componentInstance.availabilityMessage).toContain('Please choose a different destination.');
  });

  it('ignores a stale fare response after another vehicle is selected', async () => {
    const f = privatePage('car');
    const old = new Subject<any>();
    api.post.and.returnValue(old);
    const pending = (f.componentInstance as any).loadEstimate();
    api.post.and.returnValue(of({ estimated_fare: 275 }));
    f.componentInstance.chooseVehicle(2);
    await Promise.resolve();
    old.error({ status: 404, error: { message: 'No matching vehicle for this booking.' } });
    await pending;
    expect(f.componentInstance.estimatedFare).toBe(275);
    expect(f.componentInstance.vehicleUnavailable).toBeFalse();
  });

  it('prevents submitting a Private offer below the minimum fare', async () => {
    const fixture = privatePage('price');
    fixture.componentInstance.offer = 100;
    refresh(fixture);
    expect(fixture.nativeElement.textContent).toContain('Too low');
    expect(fixture.nativeElement.querySelector('.sf__cta').disabled).toBeTrue();
    await fixture.componentInstance.sendToDrivers();
    expect(api.post).not.toHaveBeenCalled();
    fixture.componentInstance.offer = 175;
    refresh(fixture);
    expect(fixture.nativeElement.querySelector('.sf__cta').disabled).toBeFalse();
  });

  it('keeps five distinct carousel vehicles and wraps selection in both directions', () => {
    const page = privatePage('car').componentInstance;
    page.vehicleTypes = [1, 2, 3, 4, 5, 6].map(id => ({ id, name: `Car ${id}` }));
    api.post.and.returnValue(of({ estimated_fare: 200 }));
    expect(page.carouselSlots.map(slot => slot.offset)).toEqual([-2, -1, 0, 1, 2]);
    expect(new Set(page.carouselSlots.map(slot => slot.vehicle.id)).size).toBe(5);
    expect(page.carouselSlots[2].vehicle.id).toBeNull();
    page.moveCarousel(-1);
    expect(page.vehicleTypeId).toBe(6);
    page.moveCarousel(1);
    expect(page.vehicleTypeId).toBeNull();
    page.vehicleQuery = 'Car 3';
    expect(page.vehicleSearchResults.map(v => v.id)).toEqual([3]);
    expect(page.vehicleTypeId).toBeNull();
    page.selectCarouselVehicle(3);
    expect(page.vehicleQuery).toBe('');
    expect(page.carouselSlots[2].vehicle.id).toBe(3);
  });

  it('swipes horizontally once, suppresses the following click and ignores vertical gestures', () => {
    const page = privatePage('car').componentInstance;
    page.vehicleTypes = [{ id: 1, name: 'Car 1' }, { id: 2, name: 'Car 2' }];
    const start = { isPrimary: true, button: 0, pointerId: 1, clientX: 200, clientY: 100 } as PointerEvent;
    page.startCarouselSwipe(start);
    page.moveCarouselSwipe({ ...start, clientX: 160, clientY: 103 } as PointerEvent);
    expect(page.carouselDrag).toBe(-40);
    expect(page.carouselDragging).toBeTrue();
    page.finishCarouselSwipe({ ...start, clientX: 130, clientY: 105 } as PointerEvent);
    expect(page.carouselDrag).toBe(0);
    expect(page.carouselDragging).toBeFalse();
    expect(page.vehicleTypeId).toBe(1);
    page.selectCarouselVehicle(2);
    expect(page.vehicleTypeId).toBe(1);
    page.startCarouselSwipe(start);
    page.finishCarouselSwipe({ ...start, clientX: 195, clientY: 180 } as PointerEvent);
    expect(page.vehicleTypeId).toBe(1);
    expect(new Set(page.carouselSlots.map(slot => slot.vehicle.id)).size).toBe(3);
    page.startCarouselSwipe(start);
    page.moveCarouselSwipe({ ...start, clientX: 450 } as PointerEvent);
    expect(page.carouselDrag).toBeLessThan(250);
    page.cancelCarouselSwipe();
    expect(page.carouselDrag).toBe(0);
    expect(page.carouselDragging).toBeFalse();
  });

  it('opens Shuttle payment-method selection without creating a booking or charging', () => {
    const fixture = shuttlePage('fare');
    fixture.nativeElement.querySelector('.sf__cta').click();
    expect(fixture.componentInstance.paymentModalOpen).toBeTrue();
    expect(api.post).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('ion-icon[name="bus-outline"]')).toBeTruthy();
  });

  it('disables Shuttle continuation when the estimate says the service is unavailable', () => {
    const fixture = shuttlePage('fare');
    fixture.componentInstance.estimate = { estimated_fare: 100, available: false };
    refresh(fixture);
    expect(fixture.nativeElement.querySelector('.sf__cta').disabled).toBeTrue();
    fixture.componentInstance.choosePayment();
    expect(fixture.componentInstance.paymentModalOpen).toBeFalse();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('opens seats after a mocked booking response and does not submit twice while busy', async () => {
    const fixture = shuttlePage('fare');
    const created = new Subject<any>();
    api.post.and.returnValue(created);
    api.get.and.returnValue(of({ seat_map: { layout: { rows: 1, cols: 2 }, cells: fixture.componentInstance.seatCells } }));
    const pending = fixture.componentInstance.confirm('cash');
    await fixture.componentInstance.confirm('cash');
    expect(api.post.calls.count()).toBe(1);
    expect(api.post.calls.mostRecent().args[1].payment_method).toBe('cash');
    created.next({ booking: { id: 99 } }); created.complete();
    await pending;
    refresh(fixture);
    expect(fixture.componentInstance.step).toBe('seats');
    expect(fixture.nativeElement.querySelectorAll('.cell:disabled').length).toBe(1);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('waits for the seat hold before continuing to the approval/payment list', () => {
    const fixture = shuttlePage('seats');
    fixture.componentInstance.booking = { id: 99 };
    const hold = new Subject<any>(); api.post.and.returnValue(hold);
    fixture.nativeElement.querySelector('.cell:not(:disabled)').click();
    refresh(fixture);
    expect(fixture.componentInstance.selectedSeats).toEqual(['1A']);
    expect(fixture.nativeElement.querySelector('.sf__cta').disabled).toBeTrue();
    fixture.componentInstance.continueToPay();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    hold.next({}); hold.complete();
    refresh(fixture);
    expect(fixture.nativeElement.querySelector('.sf__cta').disabled).toBeFalse();
    fixture.nativeElement.querySelector('.sf__cta').click();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/customer-tabs/shuttle-rides');
  });

  it('clears a rejected seat and keeps continuation disabled', () => {
    const fixture = shuttlePage('seats');
    fixture.componentInstance.booking = { id: 99 };
    const hold = new Subject<any>(); api.post.and.returnValue(hold);
    api.get.and.returnValue(of({ seat_map: { layout: { rows: 1, cols: 2 }, cells: fixture.componentInstance.seatCells } }));
    fixture.nativeElement.querySelector('.cell:not(:disabled)').click();
    hold.error({ error: { message: 'Seat already taken' } });
    refresh(fixture);
    expect(fixture.componentInstance.selectedSeats).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('Seat already taken');
    expect(fixture.nativeElement.querySelector('.sf__cta').disabled).toBeTrue();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('shows discount, tip and cash split without claiming the full fare is due online', () => {
    const fixture = shuttlePage('paying');
    Object.assign(fixture.componentInstance, { payMethod: 'cash', cashDepositPercent: 20, coupon: { discount: 10 }, tipping: { enabled: true, values: [10], in_percentage: false }, selectedTipPreset: 10 });
    refresh(fixture);
    expect(fixture.componentInstance.payableTotal).toBe(100);
    expect(fixture.componentInstance.cashDeposit).toBe(20);
    expect(fixture.componentInstance.cashBalance).toBe(80);
    expect(fixture.nativeElement.querySelector('.sf__cta').textContent).toContain('Pay ₹20');
    expect(fixture.nativeElement.textContent).toContain('Cash to driver');
    expect(api.post).not.toHaveBeenCalled();
  });
});
