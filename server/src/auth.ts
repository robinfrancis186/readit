import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from './db.js';
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
  return createHmac('sha256', secret()).update(payload).digest('base64url');
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
    if (name === COOKIE) return decodeURIComponent(rest.join('='));
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
const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 60_000;

function throttled(ip: string): boolean {
  const record = attempts.get(ip);
  if (!record) return false;
  if (record.until > Date.now()) return true;
  if (record.until && record.until <= Date.now()) attempts.delete(ip);
  return false;
}

function recordFailure(ip: string): void {
  const record = attempts.get(ip) ?? { count: 0, until: 0 };
  record.count++;
  if (record.count >= MAX_ATTEMPTS) {
    record.until = Date.now() + LOCKOUT_MS;
    record.count = 0;
  }
  attempts.set(ip, record);
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
    if (throttled(ip)) {
      return reply.code(429).send({ error: 'Too many attempts. Wait a minute and try again.' });
    }

    const { password } = loginBody.parse(req.body);
    if (!passwordMatches(password)) {
      recordFailure(ip);
      return reply.code(401).send({ error: 'Wrong password.' });
    }

    attempts.delete(ip);
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
