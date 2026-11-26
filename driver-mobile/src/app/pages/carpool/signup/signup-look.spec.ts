import { CarpoolPlan, CarpoolPlanState } from '../carpool.models';
import { DocumentRequirement } from './carpool-signup.models';
import { ApprovedSeen, bestValueId, daysLeft, docProgress, perDay, planView, ringOffset, statusView } from './signup-look';

const doc = (status: DocumentRequirement['status'], document_id: number | null = 1): DocumentRequirement => ({
  document_id, name: 'Doc', required: 'yes', required_images: 1, uploaded_images: 1, approved_images: status === 'approved' ? 1 : 0, status, slots: [],
});
const purchase = (expires_at: string, days_count = 30) => ({ id: 1, title: 'Carpool 30 days', amount_paid: 199, days_count, starts_at: null, expires_at, is_queued: false });
const plan = (id: number, amount: number, days_count: number): CarpoolPlan => ({ id, title: `${days_count} days`, subtitle: null, amount, days_count, terms: null });

describe('carpool sign-up look (W13)', () => {
  describe('statusView: which 1f / 1g screen to show', () => {
    it('shows "being checked" while documents wait and none need work', () => {
      expect(statusView({ approval: 'pending', docs: [doc('approved'), doc('pending')], carpoolOn: true, hasPlan: false, seenApproved: false })).toBe('checking');
    });

    it('shows "needs attention" when a document is rejected or missing', () => {
      expect(statusView({ approval: 'pending', docs: [doc('approved'), doc('rejected')], carpoolOn: true, hasPlan: false, seenApproved: false })).toBe('fix');
      expect(statusView({ approval: 'rejected', docs: [doc('missing')], carpoolOn: true, hasPlan: false, seenApproved: false })).toBe('fix');
    });

    it('shows the approved page once, then goes straight to Home', () => {
      expect(statusView({ approval: 'approved', docs: [], carpoolOn: true, hasPlan: false, seenApproved: false })).toBe('approved-no-plan');
      expect(statusView({ approval: 'approved', docs: [], carpoolOn: true, hasPlan: true, seenApproved: false })).toBe('approved-has-plan');
      expect(statusView({ approval: 'approved', docs: [], carpoolOn: true, hasPlan: false, seenApproved: true })).toBe('home');
    });

    it('says "carpool opens soon" while the switch is off, however often it is seen', () => {
      expect(statusView({ approval: 'approved', docs: [], carpoolOn: false, hasPlan: true, seenApproved: true })).toBe('opens-soon');
      expect(statusView({ approval: 'approved', docs: [], carpoolOn: false, hasPlan: false, seenApproved: false })).toBe('opens-soon');
    });
  });

  it('counts approved documents out of the real ones only', () => {
    expect(docProgress([doc('approved'), doc('pending'), doc('rejected'), doc('approved', null)])).toEqual({ approved: 1, total: 3, percent: 33 });
    expect(docProgress([])).toEqual({ approved: 0, total: 0, percent: 0 });
  });

  describe('planView: which 1h / 1i screen to show', () => {
    const now = new Date('2026-11-26T10:00:00+05:30');
    const state = (over: Partial<CarpoolPlanState>): CarpoolPlanState => ({ plan: null, next_plan: null, can_publish: false, ending_soon: false, ...over });

    it('no plan, active, ending soon and next plan waiting', () => {
      expect(planView(null)).toBe('none');
      expect(planView(state({}))).toBe('none');
      expect(planView(state({ plan: purchase('2026-12-17T23:59:59+05:30') }))).toBe('active');
      expect(planView(state({ plan: purchase('2026-11-28T23:59:59+05:30'), ending_soon: true }))).toBe('ending');
      expect(planView(state({ plan: purchase('2026-11-28T23:59:59+05:30'), ending_soon: true, next_plan: purchase('2026-12-28T23:59:59+05:30') }))).toBe('waiting');
    });

    it('counts whole days left, never below zero, and fills the ring by what is left', () => {
      expect(daysLeft('2026-12-17T23:59:59+05:30', now)).toBe(22);
      expect(daysLeft('2026-11-26T23:59:59+05:30', now)).toBe(1);
      expect(daysLeft('2026-11-20T23:59:59+05:30', now)).toBe(0);
      expect(daysLeft(null, now)).toBe(0);
      expect(ringOffset(30, 30)).toBe(0);
      expect(ringOffset(0, 30)).toBe(201);
      expect(ringOffset(15, 30)).toBe(101);
      expect(ringOffset(40, 30)).toBe(0);
    });
  });

  it('works out the price a day and the best value plan', () => {
    expect(perDay(plan(1, 59, 7))).toBe('₹8.43 a day');
    expect(perDay(plan(2, 199, 30))).toBe('₹6.63 a day');
    expect(perDay(plan(3, 100, 10))).toBe('₹10 a day');
    expect(bestValueId([plan(1, 59, 7), plan(2, 199, 30)])).toBe(2);
    expect(bestValueId([plan(1, 59, 7)])).toBeNull();
    expect(bestValueId([])).toBeNull();
  });

  describe('ApprovedSeen', () => {
    beforeEach(() => localStorage.removeItem('dc_cp_approved_seen_77'));
    afterEach(() => localStorage.removeItem('dc_cp_approved_seen_77'));

    it('remembers per person that the approved page was shown', () => {
      expect(ApprovedSeen.get(77)).toBeFalse();
      ApprovedSeen.set(77);
      expect(ApprovedSeen.get(77)).toBeTrue();
      expect(ApprovedSeen.get(78)).toBeFalse();
      expect(ApprovedSeen.get(undefined)).toBeFalse();
    });
  });
});
