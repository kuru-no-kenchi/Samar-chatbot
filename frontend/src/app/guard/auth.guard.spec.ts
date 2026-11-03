import { TestBed } from '@angular/core/testing';
import { CanActivateFn, Router, UrlTree, provideRouter } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { authGuard, guestGuard } from './auth.guard';

describe('route guards', () => {
  let loggedIn = false;
  let router: Router;

  const run = (guard: CanActivateFn) =>
    TestBed.runInInjectionContext(() => guard({} as any, {} as any)) as boolean | UrlTree;

  beforeEach(() => {
    loggedIn = false;
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: { isLoggedIn: () => loggedIn } }],
    });
    router = TestBed.inject(Router);
  });

  it('authGuard sends visitors to /login', () => {
    expect(router.serializeUrl(run(authGuard) as UrlTree)).toBe('/login');
  });

  it('authGuard lets signed-in users through', () => {
    loggedIn = true;
    expect(run(authGuard)).toBeTrue();
  });

  it('guestGuard sends signed-in users to /home', () => {
    loggedIn = true;
    expect(router.serializeUrl(run(guestGuard) as UrlTree)).toBe('/home');
  });

  it('guestGuard lets visitors see the login and landing pages', () => {
    expect(run(guestGuard)).toBeTrue();
  });
});