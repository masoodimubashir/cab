import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CarpoolApiService } from './carpool-api.service';

describe('CarpoolApiService', () => {
  let api: jasmine.SpyObj<ApiService>;
  let service: CarpoolApiService;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
    service = TestBed.inject(CarpoolApiService);
  });

  it('passes an enabled config through', (done) => {
    api.get.and.returnValue(of({ enabled: true, search_distance_m: 2000 }) as any);
    service.config().subscribe((c) => {
      expect(c.enabled).toBeTrue();
      expect(c.search_distance_m).toBe(2000);
      done();
    });
  });

  it('treats a failed call as off', (done) => {
    api.get.and.returnValue(throwError(() => new Error('offline')));
    service.enabled().subscribe((on) => {
      expect(on).toBeFalse();
      done();
    });
  });

  it('treats a malformed answer as off', (done) => {
    api.get.and.returnValue(of({ enabled: 'yes' }) as any);
    service.enabled().subscribe((on) => {
      expect(on).toBeFalse();
      done();
    });
  });

  it('reuses one request while fresh', () => {
    api.get.and.returnValue(of({ enabled: false }) as any);
    service.config().subscribe();
    service.config().subscribe();
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});
