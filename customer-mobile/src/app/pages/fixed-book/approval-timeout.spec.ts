import { of, throwError, Subject } from 'rxjs';
import { FixedBookPage as DirectBooking } from './fixed-book.page';
import { FixedBookPage as StepBooking } from '../booking/fixed/fixed.page';

for (const Page of [DirectBooking, StepBooking]) {
  describe(`Approval recovery (${Page === DirectBooking ? 'direct' : 'steps'})`, () => {
    let page: any;
    beforeEach(() => {
      page = Object.create(Page.prototype);
      Object.assign(page, {
        step: 'awaiting_approval',
        hold: { id: 12, status: 'PENDING_DRIVER_APPROVAL', expires_at: new Date(Date.now() - 1000).toISOString() },
        isCheckingTimeout: false, nextApprovalCheckAt: 0, approvalStatusMessage: '',
        cdr: { markForCheck: () => {} },
        api: { get: jasmine.createSpy() },
        alertCtrl: { create: jasmine.createSpy().and.resolveTo({ present: async () => {} }) },
        loadSeatMap: jasmine.createSpy(),
      });
    });

    it('retains the hold on network failure and throttles automatic retries', async () => {
      page.api.get.and.returnValue(throwError(() => new Error('offline')));
      await page.handleApprovalTimeout();
      expect(page.hold.id).toBe(12);
      expect(page.step).toBe('awaiting_approval');
      expect(page.approvalStatusMessage).toContain('Reconnecting');
      expect(page.alertCtrl.create).not.toHaveBeenCalled();
      await page.handleApprovalTimeout();
      expect(page.api.get).toHaveBeenCalledTimes(1);
    });

    it('persists the server deadline for subsequent countdown ticks', async () => {
      const expires_at = new Date(Date.now() + 30000).toISOString();
      page.api.get.and.returnValue(of({ hold: { ...page.hold, expires_at } }));
      await page.handleApprovalTimeout();
      page.updateApprovalCountdown();
      expect(page.hold.expires_at).toBe(expires_at);
      expect(page.approvalCountdown).toBeGreaterThan(25);
      expect(page.api.get).toHaveBeenCalledTimes(1);
    });

    it('does not clear a request without a server expiry confirmation', async () => {
      page.api.get.and.returnValue(of({ hold: page.hold }));
      await page.handleApprovalTimeout();
      expect(page.hold.id).toBe(12);
      expect(page.alertCtrl.create).not.toHaveBeenCalled();
    });

    it('releases local waiting state after confirmed server expiry', async () => {
      page.api.get.and.returnValue(of({ hold: { ...page.hold, status: 'EXPIRED' } }));
      await page.handleApprovalTimeout();
      expect(page.hold).toBeNull();
      expect(page.step).toBe('seats');
      expect(page.alertCtrl.create).toHaveBeenCalled();
    });

    it('ignores a stale response after the customer moves to payment', async () => {
      const response = new Subject<any>();
      page.api.get.and.returnValue(response);
      const checking = page.handleApprovalTimeout();
      page.step = 'review';
      response.next({ hold: { ...page.hold, status: 'EXPIRED' } });
      response.complete();
      await checking;
      expect(page.step).toBe('review');
      expect(page.hold.id).toBe(12);
      expect(page.alertCtrl.create).not.toHaveBeenCalled();
    });
  });
}
