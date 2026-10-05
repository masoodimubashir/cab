import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { VehicleSetsEditorComponent } from './vehicle-sets-editor.component';

describe('Vehicle sets editor', () => {
  let api: any;
  let toast: any;
  beforeEach(() => {
    api = { get: jasmine.createSpy().and.returnValue(of({ data: [{ id: 7, name: 'Shared fleet', members: [{ id: 1 }], route_group_ids: [10] }] })), post: jasmine.createSpy().and.returnValue(of({})), patch: jasmine.createSpy().and.returnValue(of({})) };
    toast = { success: jasmine.createSpy(), error: jasmine.createSpy() };
    TestBed.configureTestingModule({ imports: [VehicleSetsEditorComponent], providers: [{ provide: ApiService, useValue: api }, { provide: ToastService, useValue: toast }] });
  });
  it('renders vehicle and group selections inside the drawer and saves adding another member', () => {
    const fixture = TestBed.createComponent(VehicleSetsEditorComponent);
    const editor = fixture.componentInstance;
    editor.cityId = 2;
    editor.vehicles = [{ id: 1, display_name: 'Sumo', ride_type_name: 'Share a seat', vehicle_set_id: 7 }, { id: 2, display_name: 'Tavera', ride_type_name: 'Share a seat' }];
    editor.groups = [{ id: 10, name: 'Town group', route_ids: [20, 21] }];
    fixture.detectChanges();
    editor.select(7); fixture.detectChanges();
    const body: HTMLElement = fixture.nativeElement.querySelector('.tm-drawer__body');
    expect(body.textContent).toContain('Tavera'); expect(body.textContent).toContain('Town group');
    const checkboxes = body.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    expect(checkboxes[0].checked).toBeTrue(); expect(checkboxes[2].checked).toBeTrue();
    checkboxes[1].click();
    const saved = spyOn(editor.saved, 'emit'); editor.save();
    expect(api.patch).toHaveBeenCalledOnceWith('/admin/cities/2/vehicle-sets/7', { name: 'Shared fleet', vehicle_ids: [1, 2], route_group_ids: [10] });
    expect(saved).toHaveBeenCalled();
    fixture.destroy();
  });
  it('preserves selections on failure and blocks duplicate saves while a request is pending', () => {
    const editor = new VehicleSetsEditorComponent(api, toast);
    editor.cityId = 2; editor.name = 'New fleet'; editor.vehicleIds.add(1); editor.groupIds.add(10);
    const response = new Subject(); api.post.and.returnValue(response);
    editor.save(); editor.save(); expect(api.post).toHaveBeenCalledTimes(1);
    response.error(new Error('offline'));
    expect(editor.saving).toBeFalse(); expect(editor.vehicleIds.has(1)).toBeTrue(); expect(editor.groupIds.has(10)).toBeTrue();
    expect(toast.error).toHaveBeenCalled();
  });
  it('shows a retry state when loading fails', () => {
    api.get.and.returnValue(throwError(() => new Error('offline')));
    const editor = new VehicleSetsEditorComponent(api, toast); editor.cityId = 2; editor.load();
    expect(editor.loadError).toBeTrue(); expect(editor.loading).toBeFalse();
  });
});
