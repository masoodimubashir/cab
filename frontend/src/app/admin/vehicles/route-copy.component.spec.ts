import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { RouteCopyComponent } from './route-copy.component';

describe('Route copy dialog', () => {
  let api: { post: jasmine.Spy };
  let response: Subject<any>;
  beforeEach(() => {
    response = new Subject(); api = { post: jasmine.createSpy().and.returnValue(response) };
    TestBed.configureTestingModule({ imports: [RouteCopyComponent], providers: [
      { provide: ApiService, useValue: api }, { provide: ToastService, useValue: { success: jasmine.createSpy() } },
    ] });
  });
  function dialog(reverse = false) {
    const fixture = TestBed.createComponent(RouteCopyComponent);
    Object.assign(fixture.componentInstance, { cityId: 1, reverse, route: { id: 20, name: 'Outbound', origin_name: 'Srinagar', dest_name: 'Kupwara' } });
    fixture.detectChanges(); return fixture;
  }
  for (const reverse of [false, true]) {
    it(`creates a ${reverse ? 'reverse' : 'same-direction'} copy with a separate name and prevents repeat submission`, async () => {
      const fixture = dialog(reverse), page = fixture.componentInstance;
      const before = JSON.stringify(page.route), saved = jasmine.createSpy(), closed = jasmine.createSpy();
      page.saved.subscribe(saved); page.closed.subscribe(closed);
      await fixture.whenStable(); fixture.detectChanges();
      const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
      expect(input.value).toBe(reverse ? 'Kupwara → Srinagar' : 'Outbound (copy)');
      expect(fixture.nativeElement.querySelector('.direction').textContent).toContain(reverse ? 'Kupwara → Srinagar' : 'Srinagar → Kupwara');
      const submit = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(button => button.textContent?.trim() === 'Create copy')!;
      submit.click(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); page.save(); page.close();
      expect(api.post).toHaveBeenCalledOnceWith('/admin/cities/1/fixed-routes/20/copy', { name: page.name, reverse });
      expect(input.disabled).toBeTrue(); expect(closed).not.toHaveBeenCalled();
      response.next({ route: { id: 21, name: page.name } });
      expect(saved).toHaveBeenCalledOnceWith({ id: 21, name: page.name }); expect(closed).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(page.route)).toBe(before); fixture.destroy();
    });
  }
  it('blocks invalid names and keeps duplicate-name errors and draft available for retry', () => {
    const fixture = dialog(), page = fixture.componentInstance;
    page.name = ' '; page.save(); expect(api.post).not.toHaveBeenCalled();
    page.name = 'x'.repeat(121); page.save(); expect(api.post).not.toHaveBeenCalled();
    page.name = 'Taken'; page.save(); response.error({ status: 422, error: { errors: { name: ['Taken'] } } }); fixture.detectChanges();
    expect(page.name).toBe('Taken'); expect(page.saving).toBeFalse();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('unique route name');
    fixture.destroy();
  });
  it('cancels without creating a route and stops listening after destruction', () => {
    const fixture = dialog(), page = fixture.componentInstance, closed = jasmine.createSpy(), saved = jasmine.createSpy();
    page.closed.subscribe(closed); page.saved.subscribe(saved); page.close();
    expect(api.post).not.toHaveBeenCalled(); expect(closed).toHaveBeenCalledTimes(1);
    page.save(); fixture.destroy(); response.next({ route: { id: 21, name: 'Copy' } }); expect(saved).not.toHaveBeenCalled();
  });
});
