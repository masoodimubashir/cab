import { TestBed } from '@angular/core/testing';
import { Route } from '@angular/router';
import { AuthService } from './core/auth.service';
import { routes } from './app-routing.module';

/** No splash (Saqib, 2026-11-26): opening the app goes straight to the welcome page, or home when signed in. */
describe('start route', () => {
  const start = () => routes.find((r: Route) => r.path === '' && r.pathMatch === 'full')!;
  const target = (loggedIn: boolean) => {
    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: { isLoggedIn: () => loggedIn } }] });
    return TestBed.runInInjectionContext(() => (start().redirectTo as any)({}));
  };

  afterEach(() => TestBed.resetTestingModule());

  it('opens the welcome page when signed out', () => expect(target(false)).toBe('/welcome'));
  it('opens home when signed in', () => expect(target(true)).toBe('/tabs/dashboard'));
  it('has no splash page any more, and unknown addresses go to the start', () => {
    expect(routes.some((r: Route) => r.path === 'splash')).toBeFalse();
    expect(routes.find((r: Route) => r.path === '**')?.redirectTo).toBe('');
  });
});
