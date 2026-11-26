import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { CarpoolDocItem, CarpoolDocumentsComponent } from './carpool-documents.component';
import { listingStatusLabel } from './carpool-admin.styles';

function item(over: Partial<CarpoolDocItem> = {}): CarpoolDocItem {
  return {
    document_id: 10, name: 'Insurance (carpool)', uploaded: true, approved: true, has_date: true,
    expires_on: '2027-06-30', allow_until: null, allow_note: null, valid_until: '2027-06-30', expired: false, renewal: null, ...over,
  };
}

describe('CarpoolDocumentsComponent (S11)', () => {
  let api: jasmine.SpyObj<ApiService>;
  let toast: jasmine.SpyObj<ToastService>;
  let c: CarpoolDocumentsComponent;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['post', 'getBlob']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    c = TestBed.runInInjectionContext(() => new CarpoolDocumentsComponent(api, toast));
    c.driverId = 33;
    c.items = [item()];
  });

  it('starts an expiry edit from the stored date and needs a reason', () => {
    c.openAsk({ kind: 'expiry', doc: item() });
    expect(c.date).toBe('2027-06-30');
    expect(c.canSave()).toBeFalse();
    c.note = 'Seen the paper';
    expect(c.canSave()).toBeTrue();
  });

  it('sends the new expiry date with the reason and keeps the answer', () => {
    const answer = [item({ expires_on: '2027-07-31', valid_until: '2027-07-31' })];
    api.post.and.returnValue(of({ data: answer, message: 'Expiry date saved.' }) as any);
    const seen: CarpoolDocItem[][] = [];
    c.changed.subscribe((x) => seen.push(x));
    c.openAsk({ kind: 'expiry', doc: item() });
    c.date = '2027-07-31';
    c.note = 'Seen the paper';
    c.save();
    expect(api.post).toHaveBeenCalledOnceWith('/admin/carpool/drivers/33/documents/10/expiry', { date: '2027-07-31', note: 'Seen the paper' });
    expect(c.items).toEqual(answer);
    expect(seen.length).toBe(1);
    expect(c.ask).toBeNull();
  });

  it('clears an allow-until with an empty date (sends null)', () => {
    api.post.and.returnValue(of({ data: [item()], message: 'Back to the document date.' }) as any);
    c.openAsk({ kind: 'allow', doc: item({ allow_until: '2027-07-10' }) });
    c.date = '';
    c.note = 'No longer needed';
    expect(c.saveLabel()).toBe('Clear');
    c.save();
    expect(api.post).toHaveBeenCalledOnceWith('/admin/carpool/drivers/33/documents/10/allow-until', { date: null, note: 'No longer needed' });
  });

  it('approves without a reason and rejects with one, by renewal id', () => {
    const renewal = { id: 7, status: 'pending' as const, expiry_date: '2028-06-30', reason: null, sent_at: null };
    api.post.and.returnValue(of({ data: [item()], message: 'ok' }) as any);
    c.openAsk({ kind: 'approve', doc: item({ renewal }) });
    expect(c.canSave()).toBeTrue();
    c.save();
    expect(api.post).toHaveBeenCalledWith('/admin/carpool/document-renewals/7/approve', {});

    c.openAsk({ kind: 'reject', doc: item({ renewal }) });
    expect(c.canSave()).toBeFalse();
    c.note = 'Photo is blurry';
    c.save();
    expect(api.post).toHaveBeenCalledWith('/admin/carpool/document-renewals/7/reject', { reason: 'Photo is blurry' });
  });

  it('shows the server message and keeps the dialog open when saving fails', () => {
    api.post.and.returnValue(throwError(() => ({ error: { errors: { document: ['This driver has no copy of this document to date.'] } } })) as any);
    c.openAsk({ kind: 'expiry', doc: item() });
    c.note = 'abc';
    c.save();
    expect(c.error).toBe('This driver has no copy of this document to date.');
    expect(c.ask).not.toBeNull();
  });

  it('labels a carpool cancelled for an expired document', () => {
    expect(listingStatusLabel('cancelled', 'documents')).toBe('Cancelled · Document expired');
  });
});
