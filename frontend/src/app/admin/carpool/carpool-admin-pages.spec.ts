import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, BehaviorSubject } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { CarpoolListingsComponent } from './carpool-listings.component';
import { CarpoolReportsComponent } from './carpool-reports.component';
import { CarpoolPlansComponent } from './carpool-plans.component';
import { CarpoolOverviewComponent } from './carpool-overview.component';
import { CarpoolPeopleComponent } from './carpool-people.component';
import { CarpoolAccessComponent } from './carpool-access.component';
import { CarpoolHistoryComponent } from './carpool-history.component';
import { listingStatusLabel, reasonLabel, requestStatusLabel } from './carpool-admin.styles';

/** The carpool admin pages added 2026-11-25 (Admin-Audit.md section 7, screens). */
describe('Carpool admin pages', () => {
  let api: jasmine.SpyObj<ApiService>;
  let toast: jasmine.SpyObj<ToastService>;
  const route = { snapshot: { queryParamMap: convertToParamMap({}) }, queryParamMap: new BehaviorSubject(convertToParamMap({})) } as unknown as ActivatedRoute;
  const router = jasmine.createSpyObj<Router>('Router', ['navigate']);

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'patch', 'post', 'delete']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    api.get.and.returnValue(of({ data: [], meta: { total: 0 }, strip: { upcoming: 0, past_departure: 0, in_progress: 0, open_reports: 0 }, cities: [], can_edit: true }) as any);
    api.post.and.returnValue(of({ message: 'ok' }) as any);
    api.patch.and.returnValue(of({ message: 'ok' }) as any);
    api.delete.and.returnValue(of({ message: 'ok' }) as any);
  });

  describe('labels', () => {
    it('names a ride closed without a pickup tap differently from a real no-show', () => {
      expect(requestStatusLabel({ status: 'no_show', closed_reason: 'not_confirmed' })).toBe('Not confirmed');
      expect(requestStatusLabel({ status: 'no_show', closed_reason: null })).toBe('No-show');
      expect(requestStatusLabel({ status: 'removed', closed_reason: 'admin' })).toBe('Removed by Dream Cabs');
      expect(requestStatusLabel({ status: 'removed', closed_reason: null })).toBe('Removed by driver');
    });

    it('turns report reason keys and carpool statuses into words', () => {
      expect(reasonLabel('harassment')).toBe('Harassment');
      expect(reasonLabel('spam')).toBe('Spam or selling');
      expect(listingStatusLabel('ended_by_admin', null)).toBe('Ended by Dream Cabs');
      expect(listingStatusLabel('cancelled', 'admin')).toBe('Cancelled · Dream Cabs');
    });
  });

  describe('Listings', () => {
    function make() {
      const c = TestBed.runInInjectionContext(() => new CarpoolListingsComponent(api, toast, route, router));
      c.ngOnInit();
      return c;
    }

    it('sends the tab, search, city and dates to the server', () => {
      const c = make();
      c.tab = 'not_started';
      c.search = 'Bilal';
      c.cityId = '3';
      c.dateFrom = '2026-11-01';
      c.dateTo = '2026-11-30';
      c.load();
      const url = api.get.calls.mostRecent().args[0];
      expect(url).toContain('tab=not_started');
      expect(url).toContain('search=Bilal');
      expect(url).toContain('city_id=3');
      expect(url).toContain('date_from=2026-11-01');
      expect(url).toContain('date_to=2026-11-30');
    });

    it('needs a reason for end ride, remove and correct, but not for cancel', () => {
      const c = make();
      c.openAsk({ kind: 'end' });
      expect(c.canConfirm()).toBeFalse();
      c.note = 'ok';
      expect(c.canConfirm()).toBeFalse();
      c.note = 'Driver phone died';
      expect(c.canConfirm()).toBeTrue();
      c.openAsk({ kind: 'cancel' });
      expect(c.canConfirm()).toBeTrue();
    });

    it('posts each admin fix to its own endpoint with the reason', () => {
      const c = make();
      c.detail = { id: 7 } as any;
      const req = { id: 41, status: 'no_show', closed_reason: 'not_confirmed' } as any;
      c.openAsk({ kind: 'outcome', req });
      expect(c.outcome).toBe('completed');
      c.note = 'Driver confirmed by phone';
      c.confirm();
      expect(api.post).toHaveBeenCalledWith('/admin/carpool/requests/41/outcome', { note: 'Driver confirmed by phone', outcome: 'completed' });
      c.detail = { id: 7 } as any;
      c.openAsk({ kind: 'remove', req });
      c.note = 'Rider asked';
      c.confirm();
      expect(api.post).toHaveBeenCalledWith('/admin/carpool/requests/41/remove', { note: 'Rider asked' });
      c.detail = { id: 7 } as any; // the success path reloads the drawer from the (mocked) server
      c.openAsk({ kind: 'end' });
      c.note = 'Stuck on the road';
      c.confirm();
      expect(api.post).toHaveBeenCalledWith('/admin/carpool/listings/7/end', { note: 'Stuck on the road' });
    });

    it('keeps the dialog content while it closes', () => {
      const c = make();
      c.detail = { id: 7 } as any;
      c.openAsk({ kind: 'end' });
      c.note = 'Stuck on the road';
      c.confirm();
      expect(c.ask).toBeNull();
      expect(c.shown?.kind).toBe('end');
    });
  });

  describe('Reports', () => {
    it('starts the close dialog on the suggested outcome and sends the choice', () => {
      const c = TestBed.runInInjectionContext(() => new CarpoolReportsComponent(api, toast, route, router));
      c.ngOnInit();
      c.detail = { id: 5, suggested_outcome: 'actioned' } as any;
      c.openClose();
      expect(c.outcome).toBe('actioned');
      c.outcome = 'dismissed';
      c.note = 'Checked';
      c.close();
      expect(api.post).toHaveBeenCalledWith('/admin/carpool/reports/5/close', { note: 'Checked', outcome: 'dismissed' });
    });
  });

  describe('Plans', () => {
    function make() {
      const c = TestBed.runInInjectionContext(() => new CarpoolPlansComponent(api, toast));
      c.ngOnInit();
      c.cities = [{ id: 1, name: 'Srinagar', is_active: true }, { id: 2, name: 'Old Town', is_active: false }];
      return c;
    }

    it('needs a name, a price, days and at least one city', () => {
      const c = make();
      c.startNew();
      expect(c.valid()).toBeFalse();
      Object.assign(c.f, { title: 'Week', amount: 199, days_count: 7 });
      expect(c.valid()).toBeFalse();
      c.toggleCity(1);
      expect(c.valid()).toBeTrue();
      c.f.available_from = '2026-12-10';
      c.f.available_to = '2026-12-01';
      expect(c.valid()).toBeFalse();
    });

    it('creates one plan per chosen city, or all active cities', () => {
      const c = make();
      c.startNew();
      expect(c.activeCities().map((x) => x.id)).toEqual([1]);
      Object.assign(c.f, { title: 'Week', amount: 199, days_count: 7, all_cities: true });
      c.save();
      expect(api.post).toHaveBeenCalledWith('/admin/carpool/plans', jasmine.objectContaining({ title: 'Week', city_ids: ['all'] }));
    });

    it('edits never send a city or an audience, and can apply to the whole group', () => {
      const c = make();
      c.edit({ id: 9, title: 'Week', subtitle: null, amount: 199, days_count: 7, terms: null, city_id: 1, city: 'Srinagar', available_from: null, available_to: null, is_active: true, on_sale_now: true, bought: 2, running: 1, waiting: 0, group_size: 3 });
      c.f.amount = 249;
      c.f.apply_to_group = true;
      c.save();
      const body = api.patch.calls.mostRecent().args[1] as Record<string, unknown>;
      expect(api.patch.calls.mostRecent().args[0]).toBe('/admin/carpool/plans/9');
      expect(body['apply_to_group']).toBeTrue();
      expect('city_id' in body).toBeFalse();
      expect('audience' in body).toBeFalse();
    });

    it('filters the city list', () => {
      const c = make();
      c.cityQuery = 'sri';
      expect(c.filteredCities().map((x) => x.name)).toEqual(['Srinagar']);
    });
  });

  describe('Overview', () => {
    it('asks for the chosen period and draws bars relative to the busiest day', () => {
      const c = TestBed.runInInjectionContext(() => new CarpoolOverviewComponent(api, toast));
      c.ngOnInit();
      c.setPreset('7');
      expect(api.get.calls.mostRecent().args[0]).toContain('/admin/carpool/overview?from=');
      c.data = { days: [{ day: '2026-11-20', carpools: 4, completed: 1, cancelled: 2, riders: 1, seats_offered: 8 }, { day: '2026-11-21', carpools: 1, completed: 0, cancelled: 0, riders: 0, seats_offered: 4 }] } as any;
      expect(c.height(4)).toBe(100);
      expect(c.height(1)).toBe(25);
      expect(c.height(0)).toBe(0);
      expect(c.pct(6, 92)).toBe('7%');
      expect(c.pct(1, 0)).toBe('—');
    });
  });

  describe('People', () => {
    it('describes plans and roles in words', () => {
      const c = TestBed.runInInjectionContext(() => new CarpoolPeopleComponent(api, toast, route, router));
      expect(c.planText(null)).toBe('—');
      expect(c.planText({ active_until: null, waiting: false, waiting_starts: null })).toBe('No running plan');
      expect(c.approval('pending')).toBe('Waiting for approval');
    });

    it('asks the server for every carpool when Show all is pressed', () => {
      const c = TestBed.runInInjectionContext(() => new CarpoolPeopleComponent(api, toast, route, router));
      c.person = { id: 7, as_rider: [], as_driver: [], as_driver_total: 80 } as any;
      api.get.calls.reset();
      c.showAll();
      expect(api.get).toHaveBeenCalledWith('/admin/carpool/people/7?all=1');
    });
  });

  describe('Access card', () => {
    it('lets only staff with the carpool permission act, and restores with a note', () => {
      const auth = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission']);
      auth.hasPermission.and.returnValue(false);
      const c = TestBed.runInInjectionContext(() => new CarpoolAccessComponent(api, toast, auth));
      c.userId = 12;
      expect(c.canAct).toBeFalse();
      auth.hasPermission.and.returnValue(true);
      expect(c.canAct).toBeTrue();
      c.banned = true;
      c.openRestore();
      c.note = 'Checked ID';
      c.restore();
      expect(api.post).toHaveBeenCalledWith('/admin/carpool/users/12/restore', { note: 'Checked ID' });
      expect(c.banned).toBeFalse();
    });
  });

  describe('Pause choice (S10)', () => {
    it('sends the choice about upcoming carpools and explains it', () => {
      const auth = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission']);
      auth.hasPermission.and.returnValue(true);
      const c = TestBed.runInInjectionContext(() => new CarpoolAccessComponent(api, toast, auth));
      c.userId = 9;
      c.impact = { is_driver: true, upcoming_carpools: 2, riders_told: 3, rider_seats: 0, rider_pending: 0 };
      expect(c.hasOpen()).toBeTrue();
      expect(c.cancelUpcoming).toBeTrue();
      expect(c.effect()).toContain('2 upcoming carpools will be cancelled');
      c.cancelUpcoming = false;
      expect(c.effect()).toContain('stay as they are');
      c.note = 'Warning only';
      c.ban();
      expect(api.post).toHaveBeenCalledWith('/admin/carpool/users/9/ban', { note: 'Warning only', cancel_upcoming: false });
    });

    it('offers no choice when there is nothing open', () => {
      const auth = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission']);
      const c = TestBed.runInInjectionContext(() => new CarpoolAccessComponent(api, toast, auth));
      c.impact = { is_driver: false, upcoming_carpools: 0, riders_told: 0, rider_seats: 0, rider_pending: 0 };
      expect(c.hasOpen()).toBeFalse();
    });
  });

  describe('History list', () => {
    it('shows what an edit changed', () => {
      const h = new CarpoolHistoryComponent();
      expect(h.change({ id: 1, at: null, admin: 'A', action: 'settings', label: 'Changed settings', note: null, before: { plan_warning_days: 3 }, after: { plan_warning_days: 5 } }))
        .toBe('plan warning days: 3 → 5');
      expect(h.change({ id: 2, at: null, admin: 'A', action: 'ban', label: 'Paused', note: 'x', before: null, after: { upcoming_carpools: 1 } })).toBeNull();
    });
  });
});
