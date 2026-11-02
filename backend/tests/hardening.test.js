const request = require('supertest');
const app = require('../app');
const User = require('../models/user');
const { PATHS, PASSWORD } = require('./setup/helpers');

const ORIGIN = process.env.CLIENT_ORIGIN;
const EVIL = 'https://evil.example';

describe('headers', () => {
  test('hide the framework and set basic protections', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('CORS', () => {
  test('approves the app’s own origin, with credentials', async () => {
    const res = await request(app).get('/health').set('Origin', ORIGIN);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  test('never echoes a foreign origin and never allows "*"', async () => {
    const res = await request(app).get('/health').set('Origin', EVIL);
    // With one configured origin the header names that origin, so a browser on another site sees a mismatch and blocks it
    expect(res.headers['access-control-allow-origin']).not.toBe(EVIL);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });

  test('the preflight for PATCH is approved for the app origin', async () => {
    const res = await request(app)
      .options(PATHS.profile)
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'PATCH')
      .set('Access-Control-Request-Headers', 'authorization,content-type');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-methods']).toMatch(/PATCH/);
  });

  test('the preflight from another origin is not approved for it', async () => {
    const res = await request(app)
      .options(PATHS.profile)
      .set('Origin', EVIL)
      .set('Access-Control-Request-Method', 'PATCH');
    expect(res.headers['access-control-allow-origin']).not.toBe(EVIL);
  });
});

describe('request handling', () => {
  test('a body over 100 KB is refused with 413 as JSON', async () => {
    const res = await request(app)
      .post(PATHS.login)
      .send({ email: 'a@example.com', password: 'x'.repeat(150_000) });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'Request too large.' });
  });

  test('malformed JSON is a 400 without a stack trace', async () => {
    const res = await request(app)
      .post(PATHS.login)
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid JSON.' });
    expect(res.text).not.toMatch(/node_modules|\.js:\d+/);
  });

  test('unknown routes return a JSON 404, not an HTML page', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
  });

  test('an internal failure returns a generic 500 and leaks nothing', async () => {
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
    const boom = jest.spyOn(User, 'findOne').mockImplementationOnce(() => {
      throw new Error('secret internal detail at /app/models/user.js:12');
    });

    const res = await request(app).post(PATHS.login).send({ email: 'a@example.com', password: PASSWORD });
    expect(res.status).toBe(500);
    expect(res.text).not.toMatch(/secret|\/app\/|\.js:\d+/);

    boom.mockRestore();
    quiet.mockRestore();
  });

  test('the photo folder cannot be escaped with encoded dots', async () => {
    const res = await request(app).get('/users_photos/..%2f..%2fpackage.json');
    expect(res.status).not.toBe(200);
    expect(res.text).not.toContain('dependencies');
  });
});