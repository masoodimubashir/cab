import { of } from 'rxjs';
import { CarpoolStatusPage } from './carpool-status.page';
import { CarpoolPlansPage } from './carpool-plans.page';
import { CarpoolSignupPage } from './carpool-signup.page';
import { DriverTypePage } from './driver-type.page';

const USER = 4242;
const me = (approval: string, docs: any[] = []) => ({
  user: { id: USER, name: 'Imran Bhat', phone: null, avatar_url: null },
  driver: { id: 1, driver_type: 'carpool', approval_status: approval, city_id: 1 },
  document_requirements: docs,
});
const doc = (status: string) => ({ document_id: 1, name: 'Vehicle RC', status, slots: [{ index: 1, status, rejection_reason: status === 'rejected' ? 'Photo is blurry' : null }] });
const active = { plan: { id: 9, title: 'Carpool 30 days', amount_paid: 199, days_count: 30, starts_at: null, expires_at: '2099-01-01T00:00:00Z', is_queued: false }, next_plan: null, can_publish: true, ending_soon: false };
const noPlan = { plan: null, next_plan: null, can_publish: false, ending_soon: false };
const plans = [{ id: 1, title: '7 days', subtitle: null, amount: 59, days_count: 7, terms: null }, { id: 2, title: '30 days', subtitle: null, amount: 199, days_count: 30, terms: null }];

describe('carpool sign-up pages, new look (W13, W14)', () => {
  const key = `dc_cp_approved_seen_${USER}`;
  let api: any, auth: any, nav: any, carpool: any;

  beforeEach(() => {
    localStorage.removeItem(key);
    api = { get: jasmine.createSpy('get') };
    auth = { getUser: () => null, logout: jasmine.createSpy('logout').and.resolveTo() }; // no stored login: the id comes from /drivers/me
    nav = jasmine.createSpyObj('NavController', ['navigateRoot', 'navigateForward', 'navigateBack']);
    carpool = jasmine.createSpyObj('CarpoolApiService', ['config', 'planState', 'plans', 'reset']);
    carpool.plans.and.returnValue(of(plans));
  });
  afterEach(() => localStorage.removeItem(key));

  function status(approval: string, opts: { on?: boolean; plan?: any; docs?: any[] } = {}): CarpoolStatusPage {
    api.get.and.returnValue(of(me(approval, opts.docs)));
    carpool.config.and.returnValue(of({ enabled: opts.on ?? true }));
    carpool.planState.and.returnValue(of(opts.plan ?? noPlan));
    const p = new CarpoolStatusPage(api, auth, nav, carpool);
    p.load();
    return p;
  }

  it('shows the approved page the first time, marks it seen, and keeps it on screen', () => {
    const p = status('approved', { plan: noPlan });
    expect(p.view).toBe('approved-no-plan');
    expect(p.hero.title).toBe("You're approved!");
    expect(localStorage.getItem(key)).toBe('1');
    expect(nav.navigateRoot).not.toHaveBeenCalled();
    p.load(true); // the 20 s refresh must not whisk it away
    expect(p.view).toBe('approved-no-plan');
  });

  it('goes straight to Home once the approved page was seen', () => {
    localStorage.setItem(key, '1');
    status('approved', { plan: active });
    expect(nav.navigateRoot).toHaveBeenCalledWith('/carpool/home');
  });

  it('with a plan, the approved page offers Home', () => {
    const p = status('approved', { plan: active });
    expect(p.view).toBe('approved-has-plan');
    p.goHome();
    expect(nav.navigateRoot).toHaveBeenCalledWith('/carpool/home');
  });

  it('says "Carpool opens soon" while the switch is off, and does not mark the page seen', () => {
    const p = status('approved', { on: false });
    expect(p.view).toBe('opens-soon');
    expect(localStorage.getItem(key)).toBeNull();
    expect(p.cheapest?.amount).toBe(59);
  });

  it('gives "carpool opens soon" a bottom bar with Get help (1g), and no bar once on the way Home', () => {
    expect(status('approved', { on: false }).hasDock).toBeTrue();
    expect(status('pending', { docs: [doc('pending')] }).hasDock).toBeTrue();
    localStorage.setItem(key, '1');
    expect(status('approved', { plan: active }).hasDock).toBeFalse();
  });

  it('shows documents to fix with the admin reason, and counts approved ones', () => {
    const p = status('pending', { docs: [doc('approved'), doc('rejected'), doc('pending')] });
    expect(p.view).toBe('fix');
    expect(p.hero.title).toBe('1 document to fix');
    expect(p.reason(p.realDocs[1] as any)).toBe('Photo is blurry');
    expect(p.progress).toEqual({ approved: 1, total: 3, percent: 33 });
    expect(carpool.config).not.toHaveBeenCalled();
  });

  it('shows "being checked" while documents wait', () => {
    expect(status('pending', { docs: [doc('approved'), doc('pending')] }).view).toBe('checking');
  });

  describe('Plans', () => {
    function plansPage(state: any): CarpoolPlansPage {
      carpool.planState.and.returnValue(of(state));
      const p = new CarpoolPlansPage(carpool, {} as any, nav);
      p.load();
      return p;
    }

    it('starts on the best value plan and offers one Buy button', () => {
      const p = plansPage(noPlan);
      expect(p.view).toBe('none');
      expect(p.selectedId).toBe(2);
      expect(p.showBuy).toBeTrue();
      expect(p.hero.title).toBe('Pick a plan');
    });

    it('hides Buy and the list while a next plan waits', () => {
      const p = plansPage({ ...active, ending_soon: true, next_plan: { ...active.plan, id: 10 } });
      expect(p.view).toBe('waiting');
      expect(p.showBuy).toBeFalse();
    });

    it('offers Go to Home in the bar only while a next plan waits (1i)', () => {
      const p = plansPage({ ...active, ending_soon: true, next_plan: { ...active.plan, id: 10 } });
      expect(p.showHome).toBeTrue();
      p.goHome();
      expect(nav.navigateRoot).toHaveBeenCalledWith('/carpool/home');
      expect(plansPage(noPlan).showHome).toBeFalse();
    });

    it('shows no Buy when the city has no plans', () => {
      carpool.plans.and.returnValue(of([]));
      const p = plansPage(noPlan);
      expect(p.showBuy).toBeFalse();
    });

    it('marks an ending plan amber with the days left', () => {
      const soon = new Date(Date.now() + 2 * 86_400_000 - 60_000).toISOString();
      const p = plansPage({ ...active, ending_soon: true, plan: { ...active.plan, expires_at: soon } });
      expect(p.view).toBe('ending');
      expect(p.left).toBe(2);
      expect(p.hero.chip).toBe('Ending soon');
    });
  });

  it('sends a commercial driver into the commercial sign-up, as the login screen does (W14)', () => {
    const page = new DriverTypePage({ getUser: () => ({ id: 77 }) } as any, nav);
    page.pick('commercial');
    page.continue();
    expect(nav.navigateRoot).toHaveBeenCalledWith('/profile?next=registration', jasmine.anything());
    page.pick('carpool');
    page.continue();
    expect(nav.navigateForward).toHaveBeenCalledWith('/carpool-signup/details');
    localStorage.removeItem('dc_driver_type_choice_77');
  });

  it('gives every sign-up step a one-line title and text for the navy header', () => {
    const page = new CarpoolSignupPage({} as any, {} as any, nav);
    for (const step of [2, 3, 4, 5] as const) {
      page.step = step;
      expect(page.head.title.length).withContext(`step ${step}`).toBeLessThanOrEqual(20);
      expect(page.head.sub.length).withContext(`step ${step}`).toBeGreaterThan(10);
    }
  });
});
