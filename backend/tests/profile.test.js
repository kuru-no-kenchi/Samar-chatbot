const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../services/llm', () => ({ chat: jest.fn().mockResolvedValue('Mock reply') }));

const app = require('../app');
const User = require('../models/user');
const { PATHS, PASSWORD, auth, login, createUser } = require('./setup/helpers');

const patchProfile = (token, body) => request(app).patch(PATHS.profile).set(auth(token)).send(body);

describe('reading the profile', () => {
  test('returns the profile and never the password', async () => {
    const user = await createUser({ first_name: 'Ada', last_name: 'Lovelace' });
    const res = await request(app).get(PATHS.profile).set(auth(user.token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ first_name: 'Ada', last_name: 'Lovelace', email: user.email });
    expect(res.body).not.toHaveProperty('password');
    expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/);
  });
});

describe('updating the profile', () => {
  test('changes only the fields sent, trimmed', async () => {
    const user = await createUser({ first_name: 'Ada', last_name: 'Lovelace' });
    const res = await patchProfile(user.token, { first_name: '  Grace  ' });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ first_name: 'Grace', last_name: 'Lovelace' });
    expect(res.body.user).not.toHaveProperty('password');
  });

  test('ignores fields a client must never set (mass assignment)', async () => {
    const user = await createUser();
    const other = await createUser();
    const otherId = jwt.decode(other.token)._id;

    const res = await patchProfile(user.token, {
      first_name: 'Mallory',
      password: 'hacked-password-1',
      role: 'admin',
      _id: otherId,
      personal_photo: '../../etc/passwd',
      preferences: { darkTheme: true },
    });
    expect(res.status).toBe(200);

    expect((await login(user.email, 'hacked-password-1')).res.status).toBe(401);
    expect((await login(user.email)).res.status).toBe(200);

    const doc = await User.findOne({ email: user.email });
    expect(String(doc._id)).toBe(jwt.decode(user.token)._id);
    expect(doc.get('role')).toBeUndefined();
    expect(doc.personal_photo).toBeUndefined();
    expect(doc.preferences.darkTheme).toBe(false);
    expect((await User.findOne({ email: other.email })).first_name).toBe('Test');
  });

  test.each([
    ['an empty first name', { first_name: '' }],
    ['a whitespace-only first name', { first_name: '   ' }],
    ['a first name over 50 characters', { first_name: 'x'.repeat(51) }],
    ['a first name sent as a number', { first_name: 123 }],
    ['a first name sent as an object', { first_name: { $ne: 'x' } }],
    ['a bot that is not in the list', { selectedBot: 'not-a-real-bot' }],
    ['a request with nothing to update', {}],
    ['a request with only unknown fields', { role: 'admin' }],
  ])('rejects %s with 400', async (_label, body) => {
    const user = await createUser();
    expect((await patchProfile(user.token, body)).status).toBe(400);
  });
});

describe('changing the email', () => {
  const newEmail = 'New.Address@Example.com';

  test('requires the current password', async () => {
    const user = await createUser();
    expect((await patchProfile(user.token, { email: newEmail })).status).toBe(400);
    expect(await User.countDocuments({ email: user.email })).toBe(1);
  });

  test('a wrong password is a 403, because a 401 would make the Angular interceptor try a refresh', async () => {
    const user = await createUser();
    const res = await patchProfile(user.token, { email: newEmail, currentPassword: 'wrong-password-1' });
    expect(res.status).toBe(403);
  });

  test('a wrong password changes nothing, even other fields sent with it', async () => {
    const user = await createUser({ first_name: 'Ada' });
    await patchProfile(user.token, { first_name: 'Mallory', email: newEmail, currentPassword: 'wrong-password-1' });

    const doc = await User.findOne({ email: user.email });
    expect(doc).not.toBeNull();
    expect(doc.first_name).toBe('Ada');
  });

  test('with the right password the email changes, lowercased, and login follows it', async () => {
    const user = await createUser();
    const res = await patchProfile(user.token, { email: newEmail, currentPassword: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('new.address@example.com');
    expect((await login('new.address@example.com')).res.status).toBe(200);
    expect((await login(user.email)).res.status).toBe(401);
  });

  test('an email that is already taken is a 409, ignoring case', async () => {
    const a = await createUser();
    const b = await createUser();
    const res = await patchProfile(a.token, { email: b.email.toUpperCase(), currentPassword: PASSWORD });
    expect(res.status).toBe(409);
  });

  test.each([
    ['text that is not an email', 'not-an-email'],
    ['an email over 254 characters', `${'a'.repeat(250)}@example.com`],
    ['an object', { $gt: '' }],
  ])('rejects %s with 400', async (_label, email) => {
    const user = await createUser();
    expect((await patchProfile(user.token, { email, currentPassword: PASSWORD })).status).toBe(400);
  });

  test('discussions stay attached to the account after the change', async () => {
    const user = await createUser();
    await request(app).post(PATHS.chat).set(auth(user.token)).send({ message: 'keep me' }).expect(200);
    await patchProfile(user.token, { email: newEmail, currentPassword: PASSWORD }).expect(200);

    const list = await request(app).get(PATHS.discussions).set(auth(user.token));
    expect(list.body.discussions.map((d) => d.title)).toEqual(['keep me']);
  });
});

describe('preferences', () => {
  const get = (token) => request(app).get(PATHS.preferences).set(auth(token));
  const patch = (token, body) => request(app).patch(PATHS.preferences).set(auth(token)).send(body);

  test('a new account starts with history on and the light theme', async () => {
    const user = await createUser();
    const res = await get(user.token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ darkTheme: false, conversationHistory: true });
    expect(res.body.language).toEqual(expect.any(String));
  });

  test('a partial update changes only that field', async () => {
    const user = await createUser();
    const before = (await get(user.token)).body;

    const res = await patch(user.token, { darkTheme: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...before, darkTheme: true });
    expect((await get(user.token)).body).toEqual({ ...before, darkTheme: true });
  });

  test('PUT still works for older clients', async () => {
    const user = await createUser();
    const res = await request(app).put(PATHS.preferences).set(auth(user.token)).send({ language: 'fr' });
    expect(res.status).toBe(200);
    expect(res.body.language).toBe('fr');
  });

  test.each([
    ['an unknown language', { language: 'xx' }],
    ['a language sent as an object', { language: { $ne: 'en' } }],
    ['darkTheme as a string', { darkTheme: 'yes' }],
    ['conversationHistory as a number', { conversationHistory: 1 }],
    ['an empty body', {}],
    ['only unknown keys', { isAdmin: true }],
  ])('rejects %s with 400', async (_label, body) => {
    const user = await createUser();
    expect((await patch(user.token, body)).status).toBe(400);
  });

  test('preferences belong to one user', async () => {
    const alice = await createUser();
    const bob = await createUser();
    await patch(alice.token, { darkTheme: true }).expect(200);
    expect((await get(bob.token)).body.darkTheme).toBe(false);
  });

  test('the old routes with an email in the URL no longer exist', async () => {
    const user = await createUser();
    const url = `${PATHS.preferences}/${user.email}`;
    expect((await request(app).get(url).set(auth(user.token))).status).toBe(404);
    expect((await request(app).put(url).set(auth(user.token)).send({ darkTheme: true })).status).toBe(404);
  });
});