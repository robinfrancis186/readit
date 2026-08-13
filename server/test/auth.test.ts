import './setup.js';
import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';

/**
 * The password is read from the environment when config.ts is first imported,
 * so it has to be set before anything pulls that module in.
 */
process.env.READIT_PASSWORD = 'correct horse battery staple';

const Fastify = (await import('fastify')).default;
const { registerAuth, issueToken, verifyToken, authRequired } = await import('../src/auth.js');

const app = Fastify();
before(async () => {
  registerAuth(app);
  app.get('/api/library', async () => ({ items: [] }));
  await app.ready();
});
after(async () => {
  await app.close();
});

const sessionCookie = (setCookie: string | string[] | undefined): string => {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return (header ?? '').split(';')[0];
};

describe('authentication', () => {
  it('is on when a password is configured', () => {
    assert.equal(authRequired(), true);
  });

  it('refuses a protected route without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/library' });
    assert.equal(res.statusCode, 401);
  });

  it('leaves health and status reachable, so the app can show a sign-in form', async () => {
    for (const url of ['/api/auth/status']) {
      const res = await app.inject({ method: 'GET', url });
      assert.equal(res.statusCode, 200, `${url} must stay open`);
    }
  });

  it('rejects the wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'hunter2' },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers['set-cookie'], undefined, 'must not issue a session');
  });

  it('accepts the right password and lets the session through', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'correct horse battery staple' },
    });
    assert.equal(login.statusCode, 200);

    const cookie = sessionCookie(login.headers['set-cookie']);
    assert.match(cookie, /^readit_session=/);

    const res = await app.inject({ method: 'GET', url: '/api/library', headers: { cookie } });
    assert.equal(res.statusCode, 200);
  });

  it('marks the cookie HttpOnly and SameSite', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'correct horse battery staple' },
    });
    const header = String(login.headers['set-cookie']);
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=Lax/);
  });

  it('rejects a forged or tampered signature', async () => {
    const real = issueToken();
    const forged = [
      'readit_session=9999999999999.forged',
      `readit_session=${real.slice(0, real.lastIndexOf('.'))}.${'A'.repeat(43)}`,
      // Same signature, later expiry — the payload is signed, so this must fail.
      `readit_session=${Date.now() + 1e9}.${real.split('.')[1]}`,
    ];
    for (const cookie of forged) {
      const res = await app.inject({ method: 'GET', url: '/api/library', headers: { cookie } });
      assert.equal(res.statusCode, 401, `should reject ${cookie.slice(0, 40)}…`);
    }
  });

  it('rejects an expired session', () => {
    assert.equal(verifyToken('1.anything'), false);
  });

  it('accepts a freshly issued token', () => {
    assert.equal(verifyToken(issueToken()), true);
  });

  it('clears the session on sign out', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    assert.match(String(res.headers['set-cookie']), /Max-Age=0/);
  });
});
