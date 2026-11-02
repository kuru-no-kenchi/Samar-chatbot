process.env.DISABLE_RATE_LIMIT = 'false';

jest.mock('../services/llm', () => ({ chat: jest.fn().mockResolvedValue('ok') }));
const { chat } = require('../services/llm');

const request = require('supertest');
const app = require('../app');
const { PATHS, auth, createUser } = require('./setup/helpers');

test('chat is limited to 10 messages per minute per user, and one user cannot use up another’s', async () => {
  const alice = await createUser();
  const bob = await createUser();
  const send = (token) => request(app).post(PATHS.chat).set(auth(token)).send({ message: 'hi' });

  for (let i = 0; i < 10; i++) expect((await send(alice.token)).status).toBe(200);

  expect((await send(alice.token)).status).toBe(429);
  expect(chat).toHaveBeenCalledTimes(10); // the blocked request never reached the model (or the bill)
  expect((await send(bob.token)).status).toBe(200);
});