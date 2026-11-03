import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { authInterceptor } from './auth.interceptor';
import { API_URL } from '../app.config';

const user = { email: 'a@example.com', first_name: 'A', last_name: 'B' };
const unauthorized = { status: 401, statusText: 'Unauthorized' };

describe('authInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;
  let auth: AuthService;
  let router: { navigate: jasmine.Spy };

  beforeEach(() => {
    router = { navigate: jasmine.createSpy('navigate') };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: Router, useValue: router },
      ],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => ctrl.verify()); // fails if any request was left unanswered or unexpected

  function signIn(token: string) {
    auth.login('a@example.com', 'pw').subscribe();
    ctrl.expectOne(`${API_URL}/users/login`).flush({ token, user });
  }

  it('adds the token to requests for our API', () => {
    signIn('T1');
    http.get(`${API_URL}/profile/me`).subscribe();

    const req = ctrl.expectOne(`${API_URL}/profile/me`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer T1');
    req.flush({});
  });

  it('never sends the token to another site', () => {
    signIn('T1');
    http.get('https://example.com/data').subscribe();

    const req = ctrl.expectOne('https://example.com/data');
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({});
  });

  it('sends no token on the auth endpoints, but includes the cookie', () => {
    signIn('T1');
    http.post(`${API_URL}/users/refresh`, {}).subscribe();

    const req = ctrl.expectOne(`${API_URL}/users/refresh`);
    expect(req.request.headers.has('Authorization')).toBeFalse();
    expect(req.request.withCredentials).toBeTrue();
    req.flush({ token: 'T2', user });
  });

  it('on a 401, refreshes once and retries the request with the new token', () => {
    signIn('OLD');
    let result: unknown;
    http.get(`${API_URL}/profile/me`).subscribe((r) => (result = r));

    ctrl.expectOne(`${API_URL}/profile/me`).flush({}, unauthorized);
    ctrl.expectOne(`${API_URL}/users/refresh`).flush({ token: 'NEW', user });

    const retry = ctrl.expectOne(`${API_URL}/profile/me`);
    expect(retry.request.headers.get('Authorization')).toBe('Bearer NEW');
    retry.flush({ ok: true });
    expect(result).toEqual({ ok: true });
  });

  it('several parallel 401s trigger exactly one refresh', () => {
    signIn('OLD');
    http.get(`${API_URL}/a`).subscribe();
    http.get(`${API_URL}/b`).subscribe();

    ctrl.expectOne(`${API_URL}/a`).flush({}, unauthorized);
    ctrl.expectOne(`${API_URL}/b`).flush({}, unauthorized);

    const refreshes = ctrl.match(`${API_URL}/users/refresh`);
    expect(refreshes.length).toBe(1);
    refreshes[0].flush({ token: 'NEW', user });

    ctrl.expectOne(`${API_URL}/a`).flush({});
    ctrl.expectOne(`${API_URL}/b`).flush({});
  });

  it('if the refresh fails, clears the session and goes to login', () => {
    signIn('OLD');
    let error: { status: number } | undefined;
    http.get(`${API_URL}/profile/me`).subscribe({ error: (e) => (error = e) });

    ctrl.expectOne(`${API_URL}/profile/me`).flush({}, unauthorized);
    ctrl.expectOne(`${API_URL}/users/refresh`).flush({}, unauthorized);

    expect(auth.token).toBeNull();
    expect(auth.user()).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
    expect(error?.status).toBe(401);
  });

  it('other errors do not trigger a refresh or a logout', () => {
    signIn('T1');
    http.get(`${API_URL}/profile/me`).subscribe({ error: () => {} });

    ctrl.expectOne(`${API_URL}/profile/me`).flush({}, { status: 500, statusText: 'Server Error' });

    ctrl.expectNone(`${API_URL}/users/refresh`);
    expect(auth.token).toBe('T1');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('a failure of the retried request does not log the user out', () => {
    signIn('OLD');
    http.get(`${API_URL}/profile/me`).subscribe({ error: () => {} });

    ctrl.expectOne(`${API_URL}/profile/me`).flush({}, unauthorized);
    ctrl.expectOne(`${API_URL}/users/refresh`).flush({ token: 'NEW', user });
    ctrl.expectOne(`${API_URL}/profile/me`).flush({}, { status: 404, statusText: 'Not Found' });

    expect(auth.token).toBe('NEW');
    expect(router.navigate).not.toHaveBeenCalled();
  });
});