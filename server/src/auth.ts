import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from './db.js';
import { libraryDb } from './library-db.js';
import { READIT_PASSWORD, SESSION_DAYS } from './config.js';

const COOKIE = 'readit_session';

/**
 * Readit is single-user, so "authentication" is one password and a signed
 * cookie — no accounts, no user table. It exists so the app can be put on a
 * public host without handing the library to anyone who finds the URL.
 *
 * Set READIT_PASSWORD to turn it on. Left unset (the usual case when running on
 * your own machine, bound to loopback) every request is allowed.
 */
export const authRequired = (): boolean => READIT_PASSWORD.length > 0;

/**
 * The signing secret is generated once and stored, so sessions survive a
 * restart or a redeploy. It is not the password and never leaves the server.
 */
function secret(): Buffer {
  if (process.env.READIT_SESSION_SECRET) return Buffer.from(process.env.READIT_SESSION_SECRET);
  const row = db.prepare("SELECT value FROM settings WHERE key = 'session_secret'").get() as
    | { value: string }
    | undefined;
  if (row?.value) return Buffer.from(row.value, 'hex');

  const generated = randomBytes(32);
  db.prepare("INSERT INTO settings (key, value) VALUES ('session_secret', ?)").run(
    generated.toString('hex'),
  );
  return generated;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(READIT_PASSWORD).update('\0').update(payload).digest('base64url');
}

export function issueToken(): string {
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = String(expires);
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return false;

  const payload = token.slice(0, dot);
  const provided = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(payload));
  // Constant-time: a length-varying or early-exit compare leaks the signature.
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return false;

  const expires = Number(payload);
  return Number.isFinite(expires) && expires > Date.now();
}

function readCookie(req: FastifyRequest): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) {
      try { return decodeURIComponent(rest.join('=')); } catch { return undefined; }
    }
  }
  return undefined;
}

/** Compare the submitted password without leaking its length by timing. */
function passwordMatches(submitted: string): boolean {
  const a = createHmac('sha256', secret()).update(submitted).digest();
  const b = createHmac('sha256', secret()).update(READIT_PASSWORD).digest();
  return timingSafeEqual(a, b);
}

/**
 * Crude but sufficient brute-force protection: a few attempts, then a pause.
 * One user, one password — there is no legitimate reason to guess quickly.
 */
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 60_000;
async function throttled(ip: string): Promise<boolean> {
  const now = Date.now();
  const key = createHmac('sha256', secret()).update(ip).digest('hex');
  await libraryDb.prepare('DELETE FROM auth_attempts WHERE expires <= ?').run(now);
  const row = await libraryDb.prepare(`
    INSERT INTO auth_attempts (ip, count, expires) VALUES (?, 1, ?)
    ON CONFLICT(ip) DO UPDATE SET count = auth_attempts.count + 1
    RETURNING count
  `).get(key, now + LOCKOUT_MS);
  return row.count > MAX_ATTEMPTS;
}

const loginBody = z.object({ password: z.string().min(1).max(512) });

/**
 * Endpoints that must stay reachable without a session. Logout is here too: it
 * only clears a cookie and reveals nothing, and requiring a valid session to
 * sign out means an expired one cannot be cleared.
 */
const OPEN_PATHS = new Set([
  '/api/health',
  '/api/auth/login',
  '/api/auth/status',
  '/api/auth/logout',
]);

export function registerAuth(app: FastifyInstance): void {
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (process.env.VERCEL && (!authRequired() || !process.env.READIT_SESSION_SECRET)) {
      return reply.code(503).send({ error: 'Private library access has not been configured.' });
    }
    reply.header('Cache-Control', 'private, no-store');
    const origin = req.headers.origin;
    if (origin && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin !== `${req.protocol}://${req.host}`) {
      return reply.code(403).send({ error: 'Cross-origin changes are not allowed.' });
    }
    if (!authRequired()) return;
    const path = req.url.split('?')[0];
    if (OPEN_PATHS.has(path)) return;
    if (verifyToken(readCookie(req))) return;
    return reply.code(401).send({ error: 'Not signed in' });
  });

  app.get('/api/auth/status', async (req) => ({
    required: authRequired(),
    signedIn: !authRequired() || verifyToken(readCookie(req)),
  }));

  app.post('/api/auth/login', async (req, reply) => {
    if (!authRequired()) return { ok: true, signedIn: true };

    const ip = req.ip ?? 'unknown';
    if (await throttled(ip)) {
      return reply.code(429).send({ error: 'Too many attempts. Wait a minute and try again.' });
    }

    const { password } = loginBody.parse(req.body);
    if (!passwordMatches(password)) {
      return reply.code(401).send({ error: 'Wrong password.' });
    }

    await libraryDb.prepare('DELETE FROM auth_attempts WHERE ip = ?').run(createHmac('sha256', secret()).update(ip).digest('hex'));
    // Secure is set from the forwarded protocol so it works behind a proxy on
    // https while still functioning over plain http on a local network.
    const https = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
    reply.header(
      'Set-Cookie',
      [
        `${COOKIE}=${issueToken()}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
        https ? 'Secure' : '',
      ]
        .filter(Boolean)
        .join('; '),
    );
    return { ok: true, signedIn: true };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.header('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return { ok: true, signedIn: false };
  });
}
