process.env.DISABLE_RATE_LIMIT = 'false';

const request = require('supertest');
const app = require('../app');
const { PATHS, PASSWORD } = require('./setup/helpers');

test('login is limited to 10 attempts per window, then answers 429', async () => {
  const attempt = () =>
    request(app).post(PATHS.login).send({ email: 'nobody@example.com', password: PASSWORD });

  for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401);

  const blocked = await attempt();
  expect(blocked.status).toBe(429);
  expect(blocked.body.error).toEqual(expect.any(String));
});