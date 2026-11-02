const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');
const User = require('../models/user');
const { PATHS, PASSWORD, auth, login, createUser } = require('./setup/helpers');

describe('registration', () => {
    const valid = { first_name: 'Ada', last_name: 'Lovelace', email: 'Ada@Example.com', password: PASSWORD };

    test('creates the user, lowercases the email and stores only a bcrypt hash', async () => {
        const res = await request(app).post(PATHS.register).send(valid);
        expect(res.status).toBe(201);

        const user = await User.findOne({ email: 'ada@example.com' }).select('+password');
        expect(user).not.toBeNull();
        expect(user.password).not.toBe(PASSWORD);
        expect(user.password).toMatch(/^\$2[aby]\$/);
        expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
    });

    test('rejects a duplicate email with 409, ignoring case', async () => {
        await request(app).post(PATHS.register).send(valid).expect(201);
        const res = await request(app).post(PATHS.register).send({ ...valid, email: 'ADA@example.com' });
        expect(res.status).toBe(409);
    });

    test.each([
        ['a password shorter than 8 characters', { password: 'short' }],
        ['a password longer than 128 characters', { password: 'x'.repeat(129) }],
        ['a missing email', { email: undefined }],
        ['an email sent as an object (query injection attempt)', { email: { $gt: '' } }],
        ['a password sent as an array', { password: ['a', 'b'] }],
        ['a first name sent as a number', { first_name: 123 }],
    ])('rejects %s with 400', async (_label, override) => {
        const res = await request(app).post(PATHS.register).send({ ...valid, ...override });
        expect(res.status).toBe(400);
        expect(await User.countDocuments()).toBe(0);
    });
});

describe('login', () => {
    test('returns an access token and an HttpOnly, SameSite=Strict refresh cookie', async () => {
        const user = await createUser();
        const { res } = await login(user.email);

        expect(res.status).toBe(200);
        expect(res.body.token).toEqual(expect.any(String));
        expect(JSON.stringify(res.body)).not.toContain('password');
        expect(jwt.verify(res.body.token, process.env.JWT_SECRET)._id).toBeDefined();

        const cookie = res.headers['set-cookie'].find((c) => c.startsWith('refresh_token='));
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toMatch(/SameSite=Strict/i);
    });

    test('access tokens are short-lived', async () => {
        const user = await createUser();
        const { exp, iat } = jwt.decode(user.token);
        expect(exp - iat).toBeLessThanOrEqual(15 * 60);
    });

    test('gives the same answer for an unknown email and a wrong password', async () => {
        const user = await createUser();
        const wrongPassword = await request(app).post(PATHS.login).send({ email: user.email, password: 'wrong-password' });
        const unknownEmail = await request(app).post(PATHS.login).send({ email: 'nobody@example.com', password: PASSWORD });

        expect(wrongPassword.status).toBe(401);
        expect(unknownEmail.status).toBe(401);
        expect(unknownEmail.body).toEqual(wrongPassword.body); // no hint about which emails exist
    });

    test('accepts the email in any letter case', async () => {
        const user = await createUser();
        const { res } = await login(user.email.toUpperCase());
        expect(res.status).toBe(200);
    });

    test.each([
        ['an email object', { email: { $gt: '' }, password: 'whatever-123' }],
        ['a password object', { email: 'a@example.com', password: { $ne: null } }],
        ['no body fields', {}],
    ])('rejects %s with 400 instead of running it as a query', async (_label, body) => {
        const res = await request(app).post(PATHS.login).send(body);
        expect(res.status).toBe(400);
    });
});

// ---- every protected route must refuse every kind of bad token ----

const FAKE_ID = '64b64c4f9f1c2a0012345678';
const secret = process.env.JWT_SECRET;

const BAD_TOKENS = {
    'no token': null,
    'a garbage token': 'not-a-jwt',
    'a token signed with another secret': jwt.sign({ _id: FAKE_ID }, 'some-other-secret'),
    'an expired token': jwt.sign({ _id: FAKE_ID, exp: Math.floor(Date.now() / 1000) - 60 }, secret),
    'an unsigned token (alg none)': jwt.sign({ _id: FAKE_ID }, '', { algorithm: 'none' }),
};

const PROTECTED = [
    ['get', PATHS.profile],
    ['patch', PATHS.profile],
    ['post', PATHS.photo],
    ['get', PATHS.preferences],
    ['patch', PATHS.preferences],
    ['post', PATHS.chat],
    ['get', PATHS.discussions],
    ['delete', PATHS.removeAll],
    ['get', PATHS.messages(FAKE_ID)],
    ['patch', PATHS.rename(FAKE_ID)],
    ['delete', PATHS.remove(FAKE_ID)],
    ['patch', PATHS.password],
    ['delete', PATHS.deleteMe],
    ['post', PATHS.logoutAll],
];

describe('protected routes', () => {
    const cases = PROTECTED.flatMap(([method, path]) =>
        Object.entries(BAD_TOKENS).map(([label, token]) => [method.toUpperCase(), path, label, method, token])
    );

    test.each(cases)('%s %s with %s returns 401', async (_m, path, _label, method, token) => {
        let req = request(app)[method](path);
        if (token) req = req.set(auth(token));
        const res = await req.send({});
        expect(res.status).toBe(401);
    });
});