const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

jest.mock('../services/llm', () => ({ chat: jest.fn() }));
const { chat } = require('../services/llm');

const app = require('../app');
const Usage = require('../models/usage');
const { PATHS, auth, createUser } = require('../tests/setup/helpers');

const saved = { user: process.env.DAILY_USER_LIMIT, global: process.env.DAILY_GLOBAL_LIMIT };
const setLimits = (user, global = 0) => {
  process.env.DAILY_USER_LIMIT = String(user);
  process.env.DAILY_GLOBAL_LIMIT = String(global);
};

beforeEach(() => {
  chat.mockReset();
  chat.mockResolvedValue('Mock reply');
  setLimits(3);
});

afterAll(() => {
  process.env.DAILY_USER_LIMIT = saved.user;
  process.env.DAILY_GLOBAL_LIMIT = saved.global;
});

const send = (token, message = 'hi') =>
  request(app).post(PATHS.chat).set(auth(token)).send({ message });
const usage = (token) => request(app).get(PATHS.quota).set(auth(token));

describe('per-user daily limit', () => {
  test('allows the limit, then refuses with 429 before the model is called', async () => {
    const user = await createUser();
    for (let i = 0; i < 3; i++) expect((await send(user.token)).status).toBe(200);

    const refused = await send(user.token);
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe('DAILY_LIMIT');
    expect(chat).toHaveBeenCalledTimes(3); // the refused message never reached the model

    const d = new Date();
    const nextMidnight = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
    expect(new Date(refused.body.resetsAt).getTime()).toBe(nextMidnight.getTime());
  });

  test('one user using up their messages does not affect another', async () => {
    const alice = await createUser();
    const bob = await createUser();
    for (let i = 0; i < 3; i++) await send(alice.token);

    expect((await send(alice.token)).status).toBe(429);
    expect((await send(bob.token)).status).toBe(200);
  });

  test('every successful reply reports the current usage', async () => {
    const user = await createUser();
    const res = await send(user.token);
    expect(res.body.quota).toMatchObject({ used: 1, limit: 3, remaining: 2 });
    expect(new Date(res.body.quota.resetsAt).toString()).not.toBe('Invalid Date');
  });

  test('a new UTC day starts a fresh count', async () => {
    const user = await createUser();
    for (let i = 0; i < 3; i++) await send(user.token);
    expect((await send(user.token)).status).toBe(429);

    await Usage.updateMany({}, { day: '2000-01-01' }); // pretend all of that happened yesterday
    expect((await send(user.token)).status).toBe(200);
  });

  test('parallel requests cannot get past the limit', async () => {
    setLimits(5);
    const user = await createUser();
    const results = await Promise.all(Array.from({ length: 12 }, () => send(user.token)));

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(7);
    expect(chat).toHaveBeenCalledTimes(5);
  });
});

describe('reading the usage', () => {
  test('shows the count without using a message', async () => {
    const user = await createUser();
    expect((await usage(user.token)).body.quota).toMatchObject({ used: 0, limit: 3, remaining: 3 });

    await send(user.token);
    expect((await usage(user.token)).body.quota).toMatchObject({ used: 1, remaining: 2 });
    expect((await usage(user.token)).body.quota).toMatchObject({ used: 1, remaining: 2 }); // reading is free
  });

  test('is null when the limit is switched off', async () => {
    setLimits(0);
    const user = await createUser();
    expect((await usage(user.token)).body).toEqual({ quota: null });
  });
});

describe('what does not count', () => {
  test('invalid requests and missing discussions use nothing', async () => {
    const user = await createUser();
    expect((await send(user.token, '')).status).toBe(400);
    const missing = new mongoose.Types.ObjectId().toString();
    const res = await request(app).post(PATHS.chat).set(auth(user.token)).send({ message: 'hi', discussionId: missing });
    expect(res.status).toBe(404);

    expect((await usage(user.token)).body.quota.used).toBe(0);
  });

  test('a failed model call gives the user their message back', async () => {
    const user = await createUser();
    chat.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 503 }));

    expect((await send(user.token)).status).toBe(502);
    expect((await usage(user.token)).body.quota.used).toBe(0);
    for (let i = 0; i < 3; i++) expect((await send(user.token)).status).toBe(200); // the full allowance is still there
  });

  test('with the limit switched off, nothing is capped or stored', async () => {
    setLimits(0);
    const user = await createUser();
    for (let i = 0; i < 5; i++) expect((await send(user.token)).status).toBe(200);
    expect(await Usage.countDocuments()).toBe(0);
  });
});

describe('global daily limit', () => {
  test('is shared by every user', async () => {
    setLimits(10, 2);
    const alice = await createUser();
    const bob = await createUser();

    expect((await send(alice.token)).status).toBe(200);
    expect((await send(bob.token)).status).toBe(200);

    const refusedAlice = await send(alice.token);
    expect(refusedAlice.status).toBe(429);
    expect(refusedAlice.body.code).toBe('GLOBAL_LIMIT');
    expect((await send(bob.token)).status).toBe(429);
  });

  test("a message refused by the global limit isn't charged to the user", async () => {
    setLimits(10, 1);
    const alice = await createUser();
    const bob = await createUser();
    await send(alice.token);

    expect((await send(bob.token)).status).toBe(429);
    expect((await usage(bob.token)).body.quota.used).toBe(0);
  });

  test('stays charged after a failed model call, because the provider may have counted it', async () => {
    setLimits(10, 2);
    const user = await createUser();
    chat.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 503 }));

    expect((await send(user.token)).status).toBe(502);
    expect((await usage(user.token)).body.quota.used).toBe(0);
    expect((await Usage.findOne({ scope: 'global' })).count).toBe(1);

    expect((await send(user.token)).status).toBe(200);
    expect((await send(user.token)).status).toBe(429);
  });
});