const request = require('supertest');
const app = require('../app');
const { PATHS, auth, createUser, refreshCookie } = require('./setup/helpers');

const refresh = (cookie) =>
    request(app).post(PATHS.refresh).set('Cookie', cookie).send({});

describe('refresh sessions', () => {
    test('rotates a valid refresh token and rejects reuse of the old token', async () => {
        const user = await createUser();
        const firstRefresh = await refresh(user.cookie);

        expect(firstRefresh.status).toBe(200);
        expect(firstRefresh.body.token).toEqual(expect.any(String));
        expect(firstRefresh.body.user.email).toBe(user.email);

        const nextCookie = refreshCookie(firstRefresh);
        expect(nextCookie).not.toBeNull();
        expect(nextCookie).not.toBe(user.cookie);

        await refresh(user.cookie).expect(401);
        await refresh(nextCookie).expect(200);
    });

    test('rejects refresh requests without a valid cookie', async () => {
        await request(app).post(PATHS.refresh).send({}).expect(401);
        await refresh('refresh_token=invalid').expect(401);
    });

    test('logout revokes the refresh-token family', async () => {
        const user = await createUser();
        const rotated = await refresh(user.cookie);
        const nextCookie = refreshCookie(rotated);

        await request(app)
            .post(PATHS.logout)
            .set('Cookie', nextCookie)
            .send({})
            .expect(200);

        await refresh(nextCookie).expect(401);
    });

    test('logout-all revokes refresh tokens across sessions', async () => {
        const user = await createUser();
        const otherSession = await request(app)
            .post(PATHS.login)
            .send({ email: user.email, password: user.password });
        const otherCookie = refreshCookie(otherSession);

        await request(app)
            .post(PATHS.logoutAll)
            .set(auth(user.token))
            .send({})
            .expect(200);

        await refresh(user.cookie).expect(401);
        await refresh(otherCookie).expect(401);
    });
});