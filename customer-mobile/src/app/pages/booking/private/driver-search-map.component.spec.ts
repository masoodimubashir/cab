import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { of } from 'rxjs';
import { DriverSearchMapComponent } from './driver-search-map.component';

describe('Private driver discovery', () => {
  it('scans first, reveals staggered drivers and switches one anchored popover', fakeAsync(() => {
    const cars = [11, 12, 13].map(id => ({id, lat: 34, lng: 74, driver_name: 'Driver ' + id, vehicle: {name: 'SUMO', color: 'White'}}));
    const popover = jasmine.createSpyObj('popover', ['open', 'close', 'setContent', 'setHeaderContent', 'addListener']);
    const maps = {
      Map: class { addListener() {} getBounds() { return {contains: () => true}; } },
      LatLngBounds: class { extend() {} },
      InfoWindow: class { constructor() { return popover; } },
      marker: { AdvancedMarkerElement: class {
        constructor(options: object) { Object.assign(this, options); }
        addListener() {}
      } },
    };
    const host = window as any;
    const previous = host.google;
    host.google = {maps};
    const component = new DriverSearchMapComponent({ensureLoaded: async () => {}} as any,
      {get: () => of({data: cars})} as any);
    const state = component as any;
    try {
      component.pickup = {lat: 34, lng: 74};
      component.canvas = component.origin = component.pin = {nativeElement: document.createElement('div')};
      void component.ngAfterViewInit();
      flushMicrotasks();
      tick(2799);
      expect(state.markers.size).toBe(0);
      tick(1);
      expect([...state.markers.keys()]).toEqual([11]);
      component.rejectedDrivers = new Set([12]);
      tick(550);
      expect([...state.markers.keys()]).toEqual([11, 13]);
      state.openDetails({}, 11);
      state.openDetails({}, 13);
      expect(popover.open.calls.count()).toBe(2);
      expect(popover.open.calls.mostRecent().args[0].anchor).toBe(state.markers.get(13));
      expect(popover.setHeaderContent.calls.mostRecent().args[0].textContent).toBe('Driver 13');
      const details = popover.setContent.calls.mostRecent().args[0];
      expect(details.textContent).toContain('SUMO');
      expect(details.querySelector('img').alt).toBe('SUMO');
      expect(state.markers.get(13).content.textContent).toContain('View car details');
      component.rejectedDrivers = new Set([12, 13]);
      expect(popover.close).toHaveBeenCalled();
    } finally {
      component.ngOnDestroy();
      host.google = previous;
    }
  }));
});
