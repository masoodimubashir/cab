import { of, throwError } from 'rxjs';
import { SignupDocs } from './signup-docs';
import { CarpoolFixDocumentsPage } from './carpool-fix-documents.page';
import { CarpoolStatusPage } from './carpool-status.page';

const req = (document_id: number, name: string, statuses: string[], reason: string | null = null) => ({
  document_id, name, required: 'yes', required_images: statuses.length, uploaded_images: 0, approved_images: 0,
  status: statuses.includes('rejected') ? 'rejected' : statuses.every((s) => s === 'approved') ? 'approved' : 'pending',
  slots: statuses.map((status, i) => ({ index: i + 1, status, rejection_reason: status === 'rejected' ? reason : null })),
});
const catalog = [
  { id: 1, name: 'Driving licence', no_of_images: 2, instructions: 'Front and back.', labels: [] },
  { id: 3, name: 'Insurance', no_of_images: 1, instructions: null, labels: [{ label: 'Expiry date', label_type: 'date', mandatory: true }] },
];
const me = { user: { id: 5 }, driver: { driver_type: 'carpool' }, document_requirements: [req(1, 'Driving licence', ['approved', 'rejected'], 'Blurry'), req(3, 'Insurance', ['missing'])] };
const file = () => ({ target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })], value: 'a.jpg' } }) as unknown as Event;

describe('Fix documents (its own screen, back returns to the status page)', () => {
  let api: any, nav: any;

  beforeEach(() => {
    api = { get: jasmine.createSpy('get').and.callFake((url: string) => of(url === '/drivers/me' ? me : { data: catalog })), postForm: jasmine.createSpy('postForm').and.returnValue(of({})) };
    nav = jasmine.createSpyObj('NavController', ['navigateBack', 'navigateForward', 'navigateRoot']);
  });

  describe('SignupDocs (shared with the sign-up wizard)', () => {
    it('builds the list from the requirements and the catalogue', () => {
      const d = new SignupDocs(api);
      d.load();
      expect(d.docs.map((x) => x.name)).toEqual(['Driving licence', 'Insurance']);
      expect(d.docs[0].instructions).toBe('Front and back.');
      expect(d.docs[1].labelValues).toEqual({ 'Expiry date': '' });
      expect(d.allUploaded).toBeFalse();
      expect(d.needsWork(d.docs[0])).toBeTrue();
    });

    it('asks for the expiry date before an insurance upload, then uploads the image', () => {
      const d = new SignupDocs(api);
      d.load();
      const ins = d.docs[1];
      d.upload(ins, ins.slots[0], file());
      expect(api.postForm).not.toHaveBeenCalled();
      expect(ins.slots[0].error).toContain('expiry date');
      ins.labelValues['Expiry date'] = '2027-06-30';
      d.upload(ins, ins.slots[0], file());
      expect(api.postForm).toHaveBeenCalledTimes(1);
      const fd = api.postForm.calls.mostRecent().args[1] as FormData;
      expect(fd.get('document_id')).toBe('3');
      expect(fd.get('label_values')).toBe('{"Expiry date":"2027-06-30"}');
      expect(ins.slots[0].status).toBe('uploaded');
    });

    it('shows the server message when an upload fails', () => {
      api.postForm.and.returnValue(throwError(() => ({ error: { message: 'File too large.' } })));
      const d = new SignupDocs(api);
      d.load();
      d.upload(d.docs[0], d.docs[0].slots[1], file());
      expect(d.docs[0].slots[1].error).toBe('File too large.');
      expect(d.docs[0].slots[1].uploading).toBeFalse();
    });
  });

  describe('the screen', () => {
    it('puts the documents that need work first and goes back to the status page', () => {
      const p = new CarpoolFixDocumentsPage(api, nav);
      p.ngOnInit();
      expect(p.docs.docs.length).toBe(2);
      expect(p.toFix).toBe(2);
      p.back();
      expect(nav.navigateBack).toHaveBeenCalledWith('/carpool-signup/status');
    });

    it('sends for review only when every image is in, then returns to the status page', () => {
      const p = new CarpoolFixDocumentsPage(api, nav);
      p.ngOnInit();
      p.send();
      expect(nav.navigateBack).not.toHaveBeenCalled();
      p.docs.docs.forEach((d) => d.slots.forEach((s) => (s.status = 'uploaded')));
      expect(p.docs.allUploaded).toBeTrue();
      p.send();
      expect(nav.navigateBack).toHaveBeenCalledWith('/carpool-signup/status');
    });
  });

  it('the status page Fix documents button opens the new screen, not the sign-up wizard', () => {
    const page = new CarpoolStatusPage({} as any, {} as any, nav, {} as any);
    page.fix();
    expect(nav.navigateForward).toHaveBeenCalledWith('/carpool-signup/documents');
  });
});
