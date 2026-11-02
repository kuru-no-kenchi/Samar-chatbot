const request = require('supertest');
jest.mock('../services/llm', () => ({ chat: jest.fn().mockResolvedValue('Mock reply') }));
const app = require('../app');
const User = require('../models/user');
const Discussion = require('../models/discussion');
const RefreshToken = require('../models/refreshToken');
const { PATHS, PASSWORD, auth, login, createUser, png, photoFiles } = require('./setup/helpers');

const del = (token, body) => request(app).delete(PATHS.deleteMe).set(auth(token)).send(body);
const chatAs = (token, message) => request(app).post(PATHS.chat).set(auth(token)).send({ message });

describe('deleting the account', () => {
  test.each([
    ['no password', {}],
    ['a password sent as a number', { password: 12345678 }],
    ['a password sent as an object', { password: { $ne: null } }],
  ])('rejects %s with 400', async (_label, body) => {
    const user = await createUser();
    expect((await del(user.token, body)).status).toBe(400);
    expect(await User.countDocuments()).toBe(1);
  });

  test('a wrong password is a 403 and deletes nothing', async () => {
    const user = await createUser();
    await chatAs(user.token, 'hello').expect(200);

    expect((await del(user.token, { password: 'wrong-password-1' })).status).toBe(403);
    expect(await User.countDocuments()).toBe(1);
    expect(await Discussion.countDocuments()).toBe(1);
  });

  test('removes the user, their chats and every session, and nobody else’s', async () => {
    const alice = await createUser();
    await login(alice.email); // a second device
    const bob = await createUser();
    await chatAs(alice.token, 'alice chat').expect(200);
    await chatAs(bob.token, 'bob chat').expect(200);

    expect((await del(alice.token, { password: PASSWORD })).status).toBe(200);

    expect(await User.findOne({ email: alice.email })).toBeNull();
    expect(await Discussion.countDocuments()).toBe(1);
    expect(await RefreshToken.countDocuments()).toBe(1); // only Bob's session is left

    // Alice's old credentials are all dead
    expect((await login(alice.email)).res.status).toBe(401);
    expect((await request(app).post(PATHS.refresh).set('Cookie', alice.cookie)).status).toBe(401);
    expect([401, 404]).toContain((await request(app).get(PATHS.profile).set(auth(alice.token))).status);
    expect((await chatAs(alice.token, 'still here?')).status).toBe(401);

    // Bob is untouched
    expect((await request(app).get(PATHS.profile).set(auth(bob.token))).status).toBe(200);
    const list = await request(app).get(PATHS.discussions).set(auth(bob.token));
    expect(list.body.discussions.map((d) => d.title)).toEqual(['bob chat']);
  });

  test('also removes the profile photo file', async () => {
    const user = await createUser();
    await request(app)
      .post(PATHS.photo)
      .set(auth(user.token))
      .attach('photo', png(), { filename: 'me.png', contentType: 'image/png' })
      .expect(200);
    expect(photoFiles()).toHaveLength(1);

    await del(user.token, { password: PASSWORD }).expect(200);
    expect(photoFiles()).toHaveLength(0);
  });
});