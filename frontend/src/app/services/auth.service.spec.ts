/// <reference types="jasmine" />
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { API_URL } from '../app.config';

const user = { email: 'a@example.com', first_name: 'A', last_name: 'B' };


describe('AuthService', () => {
  let auth: AuthService;
  let ctrl: HttpTestingController;
  let router: { navigate: jasmine.Spy };

  beforeEach(() => {
    router = { navigate: jasmine.createSpy('navigate') };
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: Router, useValue: router }],
    });
    auth = TestBed.inject(AuthService);
    ctrl = TestBed.inject(HttpTestingController);
  });

  afterEach(() => ctrl.verify());

  it('login keeps the token in memory only, never in browser storage', () => {
    auth.login('a@example.com', 'pw').subscribe();
    const req = ctrl.expectOne(`${API_URL}/users/login`);
    expect(req.request.withCredentials).toBeTrue();
    req.flush({ token: 'SECRET-TOKEN', user });

    expect(auth.token).toBe('SECRET-TOKEN');
    expect(auth.user()).toEqual(user);
    expect(auth.isLoggedIn()).toBeTrue();

    const stored = [localStorage, sessionStorage].flatMap((s) =>
      Object.keys(s).map((k) => s.getItem(k) ?? '')
    );
    expect(stored.join('|')).not.toContain('SECRET-TOKEN');
  });

  it('restoreSession logs the user in when the cookie is valid', () => {
    let finished = false;
    auth.restoreSession().subscribe(() => (finished = true));
    ctrl.expectOne(`${API_URL}/users/refresh`).flush({ token: 'T', user });

    expect(finished).toBeTrue();
    expect(auth.isLoggedIn()).toBeTrue();
  });

  it('restoreSession still completes when there is no session, so app start is never blocked', () => {
    let finished = false;
    auth.restoreSession().subscribe(() => (finished = true));
    ctrl.expectOne(`${API_URL}/users/refresh`).flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(finished).toBeTrue();
    expect(auth.isLoggedIn()).toBeFalse();
    expect(auth.token).toBeNull();
  });

  it('logout clears the session and goes to login, even if the server cannot be reached', () => {
    auth.login('a@example.com', 'pw').subscribe();
    ctrl.expectOne(`${API_URL}/users/login`).flush({ token: 'T', user });

    auth.logout();
    const req = ctrl.expectOne(`${API_URL}/users/logout`);
    expect(req.request.withCredentials).toBeTrue();
    req.flush({}, { status: 500, statusText: 'Server Error' });

    expect(auth.token).toBeNull();
    expect(auth.isLoggedIn()).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });
});