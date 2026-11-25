import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ApiService } from '../../../core/api.service';
import { ToastService } from '../../../core/toast.service';
import { DocumentsCatalogTabComponent } from './documents-catalog.tab';

function doc(id: number, name: string, applies_to?: 'commercial' | 'carpool' | 'all') {
  return {
    id, name, no_of_images: 1, category: 'driver_document', required: 'mandatory_register',
    document_type: 'normal', gallery_restricted: false, instructions: null, status: null, applies_to, labels: [],
  } as any;
}

describe('DocumentsCatalogTabComponent: Commercial / Carpool switch', () => {
  let c: DocumentsCatalogTabComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: jasmine.createSpyObj('ApiService', ['get', 'post', 'patch', 'delete']) },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        { provide: ChangeDetectorRef, useValue: { markForCheck: () => undefined } },
      ],
    });
    c = TestBed.runInInjectionContext(() => new DocumentsCatalogTabComponent());
    c.documents = [
      doc(1, 'Aadhaar Card', 'commercial'),
      doc(2, 'Driving licence', 'commercial'),
      doc(3, 'Old row with no type'),
      doc(8, 'Driving licence (carpool)', 'carpool'),
      doc(9, 'Insurance (carpool)', 'carpool'),
      doc(20, 'Photo for everyone', 'all'),
    ];
  });

  it('starts on Commercial', () => {
    expect(c.typeView).toBe('commercial');
    expect(c.filteredRows.map((d) => d.id)).toEqual([1, 2, 3, 20]);
  });

  it('shows carpool documents when switched, and a document for all drivers in both', () => {
    c.setTypeView('carpool');
    expect(c.filteredRows.map((d) => d.id)).toEqual([8, 9, 20]);
  });

  it('counts each side the same way the list does', () => {
    expect(c.countFor('commercial')).toBe(4);
    expect(c.countFor('carpool')).toBe(3);
  });

  it('keeps the search inside the chosen type', () => {
    c.search = 'licence';
    expect(c.filteredRows.map((d) => d.id)).toEqual([2]);
    c.setTypeView('carpool');
    expect(c.filteredRows.map((d) => d.id)).toEqual([8]);
  });

  it('goes back to page 1 when the type changes', () => {
    c.page = 3;
    c.setTypeView('carpool');
    expect(c.page).toBe(1);
    c.page = 2;
    c.setTypeView('carpool'); // no change: the page stays
    expect(c.page).toBe(2);
  });

  it('starts a new document for the type being looked at', () => {
    c.openCreate();
    expect(c.form.applies_to).toBe('commercial');
    c.formOpen = false;
    c.setTypeView('carpool');
    c.openCreate();
    expect(c.form.applies_to).toBe('carpool');
  });
});
