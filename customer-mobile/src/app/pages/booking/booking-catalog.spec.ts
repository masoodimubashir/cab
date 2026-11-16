import { of, throwError } from 'rxjs';
import { BookingService } from './booking.service';

describe('Customer enabled service catalogue', () => {
  it('keeps all enabled services even when city pricing hides Fixed and has no routes', async () => {
    const modes = ['private', 'fixed', 'shuttle'].map(mode => ({ mode, name: mode }));
    const api = { get: jasmine.createSpy().and.callFake((url: string) => of({ scopes: [{
      scope: 'local', modes: url.startsWith('/catalog/') ? modes : modes.filter(m => m.mode !== 'fixed'),
    }] })) };
    const service = new BookingService(api as any);
    expect((await service.catalog(21))[0].modes.map(m => m.mode)).toEqual(['private', 'fixed', 'shuttle']);
  });

  it('does not invent switched-off services when city artwork has older data', async () => {
    const api = { get: jasmine.createSpy().and.callFake((url: string) => of({ scopes: [{
      scope: 'local', modes: (url.startsWith('/catalog/') ? ['private'] : ['private', 'fixed', 'shuttle'])
        .map(mode => ({ mode, name: mode })),
    }] })) };
    const service = new BookingService(api as any);
    expect((await service.catalog(21))[0].modes.map(m => m.mode)).toEqual(['private']);
  });

  it('still shows enabled services when optional city artwork fails', async () => {
    const api = { get: jasmine.createSpy().and.callFake((url: string) => url.startsWith('/catalog/')
      ? of({ scopes: [{ scope: 'local', modes: [{ mode: 'fixed', name: 'Fixed' }] }] })
      : throwError(() => new Error('artwork unavailable'))) };
    const service = new BookingService(api as any);
    expect((await service.catalog(21))[0].modes[0].mode).toBe('fixed');
  });
});
