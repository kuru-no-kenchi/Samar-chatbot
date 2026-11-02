const request = require('supertest');
const app = require('../app');
const User = require('../models/user');
const { PATHS, auth, createUser, png, photoFiles } = require('./setup/helpers');

const upload = (token, buffer, opts = { filename: 'me.png', contentType: 'image/png' }, field = 'photo') => {
  let req = request(app).post(PATHS.photo);
  if (token) req = req.set(auth(token));
  return req.attach(field, buffer, opts);
};

describe('uploading a photo', () => {
  test('stores it under a random name and serves it back', async () => {
    const user = await createUser();
    const res = await upload(user.token, png(), { filename: 'my-secret-name.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.photo).toMatch(/^\/users_photos\/[0-9a-f]{32}\.png$/);
    expect(res.body.photo).not.toContain('my-secret-name');
    expect(photoFiles()).toHaveLength(1);

    const doc = await User.findOne({ email: user.email });
    expect(doc.personal_photo).toBe(res.body.photo.replace('/users_photos/', ''));

    const served = await request(app).get(res.body.photo);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toMatch(/image\/png/);
    expect(served.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  test('replacing the photo deletes the old file', async () => {
    const user = await createUser();
    await upload(user.token, png()).expect(200);
    const second = await upload(user.token, png(128));

    expect(photoFiles()).toEqual([second.body.photo.replace('/users_photos/', '')]);
  });

  test("one user's upload never removes another user's photo", async () => {
    const alice = await createUser();
    const bob = await createUser();
    await upload(alice.token, png()).expect(200);
    await upload(bob.token, png(128)).expect(200);
    await upload(bob.token, png(256)).expect(200); // replaces Bob's own

    expect(photoFiles()).toHaveLength(2);
  });
});

describe('refused uploads leave nothing on disk', () => {
  test.each([
    ['an HTML file', Buffer.from('<script>alert(1)</script>'), { filename: 'x.html', contentType: 'text/html' }],
    ['an SVG image', Buffer.from('<svg onload="alert(1)"/>'), { filename: 'x.svg', contentType: 'image/svg+xml' }],
    ['a GIF image', Buffer.from('GIF89a......'), { filename: 'x.gif', contentType: 'image/gif' }],
    ['a text file pretending to be a PNG', Buffer.from('this is not an image at all'), { filename: 'x.png', contentType: 'image/png' }],
  ])('%s is rejected with 400', async (_label, buffer, opts) => {
    const user = await createUser();
    const res = await upload(user.token, buffer, opts);
    expect(res.status).toBe(400);
    expect(photoFiles()).toHaveLength(0);
  });

  test('a file over 2 MB is rejected with 413', async () => {
    const user = await createUser();
    const res = await upload(user.token, png(2 * 1024 * 1024 + 1024));
    expect(res.status).toBe(413);
    expect(photoFiles()).toHaveLength(0);
  });

  test('a file sent under the wrong field name is rejected', async () => {
    const user = await createUser();
    const res = await upload(user.token, png(), { filename: 'me.png', contentType: 'image/png' }, 'avatar');
    expect(res.status).toBe(400);
    expect(photoFiles()).toHaveLength(0);
  });

  test('an upload without a token never touches the disk', async () => {
    const res = await upload(null, png());
    expect(res.status).toBe(401);
    expect(photoFiles()).toHaveLength(0);
  });
});