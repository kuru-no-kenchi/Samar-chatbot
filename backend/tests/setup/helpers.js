const request = require('supertest');
const app = require('../../app');
const fs = require('fs');

const PATHS = {
    register: '/users/register',
    login: '/users/login',
    refresh: '/users/refresh',
    logout: '/users/logout',
    logoutAll: '/users/logout-all',
    password: '/users/change/password',
    deleteMe: '/users/delete/me',
    profile: '/profile/me',
    photo: '/profile/me/photo',
    preferences: '/preferences',
    chat: '/chat/new',
    discussions: '/chat/discussions',
    messages: (id) => `/chat/discussions/${id}/messages`,
    rename: (id) => `/chat/discussions/${id}`,
    remove: (id) => `/chat/discussions/${id}`,
    removeAll: '/chat/discussions',
};

const PASSWORD = 'correct-horse-battery';
const auth = (token) => ({ Authorization: `Bearer ${token}` });

// "refresh_token=abc" from the Set-Cookie header, ready to send back as a Cookie header
const refreshCookie = (res) =>
    (res.headers['set-cookie'] ?? [])
        .map((c) => c.split(';')[0])
        .find((c) => c.startsWith('refresh_token=')) ?? null;

async function login(email, password = PASSWORD) {
    const res = await request(app).post(PATHS.login).send({ email, password });
    return { res, token: res.body.token, cookie: refreshCookie(res) };
}

async function createUser(overrides = {}) {
    const email = overrides.email ?? `user${Math.random().toString(36).slice(2, 10)}@example.com`;
    const body = { first_name: 'Test', last_name: 'User', password: PASSWORD, ...overrides, email };

    const reg = await request(app).post(PATHS.register).send(body);
    if (reg.status !== 201) throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.body)}`);

    const { res, token, cookie } = await login(email, body.password);
    if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
    return { email, password: body.password, token, cookie };
}

const png = (size = 64) =>
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(size)]);
const photoFiles = () => fs.readdirSync(process.env.PHOTO_DIR);

module.exports = { PATHS, PASSWORD, auth, refreshCookie, login, createUser, png, photoFiles };