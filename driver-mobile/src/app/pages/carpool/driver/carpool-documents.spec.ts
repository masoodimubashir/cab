import { of, throwError } from 'rxjs';
import { CarpoolApiService } from '../carpool-api.service';
import { CarpoolDocumentItem, CarpoolDocumentsSummary } from '../carpool.models';
import { cancelReasonLabel, documentBanner } from './carpool-format';
import { CarpoolDocumentsPage } from './carpool-documents.page';

function item(over: Partial<CarpoolDocumentItem> = {}): CarpoolDocumentItem {
  return { document_id: 10, name: 'Insurance (carpool)', expires_on: '2027-06-30', valid_until: '2027-06-30', expired: false, renewal: null, ...over };
}

function summary(over: Partial<CarpoolDocumentsSummary> = {}, items = [item()]): CarpoolDocumentsSummary {
  return { valid_until: '2027-06-30', expired: false, warn: false, document_id: 10, name: 'Insurance (carpool)', items, ...over };
}

describe('S11 dated documents (driver app)', () => {
  it('shows no Home card when nothing is ending', () => {
    expect(documentBanner(summary())).toBeNull();
    expect(documentBanner(undefined)).toBeNull();
  });

  it('warns before the last day, then says expired', () => {
    expect(documentBanner(summary({ warn: true }))?.title).toBe('Your Insurance (carpool) ends on 30 Jun');
    expect(documentBanner(summary({ warn: true }))?.text).toContain('Carpools after 30 Jun will be cancelled');
    expect(documentBanner(summary({ expired: true }))?.title).toBe('Your Insurance (carpool) has expired');
  });

  it('says a renewal is being checked, or why it was not accepted', () => {
    const pending = item({ renewal: { id: 4, status: 'pending', expiry_date: '2028-06-30', reason: null, sent_at: null } });
    expect(documentBanner(summary({ warn: true }, [pending]))?.title).toBe('New Insurance (carpool) sent');
    const rejected = item({ renewal: { id: 4, status: 'rejected', expiry_date: '2028-06-30', reason: 'The photo is blurry', sent_at: null } });
    expect(documentBanner(summary({}, [rejected]))?.text).toBe('The photo is blurry. Please send it again.');
  });

  it('labels a carpool cancelled for an expired document', () => {
    expect(cancelReasonLabel({ cancel_reason: 'documents', status: 'cancelled' } as any)).toBe('Cancelled: a document had expired');
  });

  describe('Renew screen', () => {
    let api: jasmine.SpyObj<CarpoolApiService>;
    let page: CarpoolDocumentsPage;

    beforeEach(() => {
      api = jasmine.createSpyObj<CarpoolApiService>('CarpoolApiService', ['driverDocuments', 'renewDocument']);
      api.driverDocuments.and.returnValue(of(summary()));
      page = new CarpoolDocumentsPage(api, { back: () => undefined } as any);
      page.load();
    });

    it('needs a photo and a date before sending, then reloads', () => {
      page.start(item());
      page.onPhoto({ target: { files: [new File(['x'], 'ins.jpg', { type: 'image/jpeg' })] } } as any);
      page.expiry = '2028-06-30';
      api.renewDocument.and.returnValue(of({ id: 4, status: 'pending', expiry_date: '2028-06-30' }));
      page.send(item());
      expect(api.renewDocument).toHaveBeenCalledWith(10, jasmine.any(File), '2028-06-30', 'ins.jpg');
      expect(page.renewing).toBeNull();
      expect(api.driverDocuments).toHaveBeenCalledTimes(2);
    });

    it('refuses a file that is not a photo', () => {
      page.start(item());
      page.onPhoto({ target: { files: [new File(['x'], 'doc.pdf', { type: 'application/pdf' })] } } as any);
      expect(page.file).toBeNull();
      expect(page.error).toBe('Choose a photo (JPG or PNG).');
    });

    it('shows the server message when sending fails and keeps the form', () => {
      page.start(item());
      page.onPhoto({ target: { files: [new File(['x'], 'ins.jpg', { type: 'image/jpeg' })] } } as any);
      page.expiry = '2026-01-01';
      api.renewDocument.and.returnValue(throwError(() => ({ error: { errors: { expiry_date: ['Enter the new expiry date. It must be after today.'] } } })));
      page.send(item());
      expect(page.error).toBe('Enter the new expiry date. It must be after today.');
      expect(page.renewing).toBe(10);
    });

    it('tells the driver up to which day they can publish', () => {
      expect(page.validText(item())).toBe('You can publish carpools up to 30 Jun 2027');
      expect(page.validText(item({ expired: true, valid_until: '2026-11-20' }))).toContain('Expired on 20 Nov 2026');
    });
  });
});
