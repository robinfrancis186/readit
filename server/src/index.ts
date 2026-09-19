import { app } from './app.js';
import { HOST, IS_EXPOSED, PORT } from './config.js';
import { authRequired } from './auth.js';
import { networkInterfaces } from 'node:os';

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  // Starting it twice is an ordinary mistake, not a crash. A Node stack trace
  // tells a reader nothing they can act on.
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(
      `\nPort ${PORT} is already in use — Readit may already be running.\n` +
        `Open http://localhost:${PORT} to check, or start this one on another ` +
        `port with:\n\n  PORT=4001 npm start\n`,
    );
    process.exit(1);
  }
  throw err;
}

/**
 * Print somewhere you can actually click or type. `0.0.0.0` is not an address
 * you can open on a phone, and looking up your own machine's LAN address is a
 * small chore that gets in the way of the one thing this is for.
 */
function addresses(): string[] {
  const urls = [`http://localhost:${PORT}`];
  if (!IS_EXPOSED) return urls;

  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) urls.push(`http://${net.address}:${PORT}`);
    }
  }
  return urls;
}

const urls = addresses();
app.log.info(`Readit is ready at ${urls[0]}`);
if (urls.length > 1) {
  app.log.info(`On the same network, open ${urls.slice(1).join(' or ')}`);
}

if (authRequired()) {
  app.log.info('Password protection is on.');
} else if (IS_EXPOSED) {
  app.log.warn(
    `Bound to ${HOST} with no password set, so anyone who can reach this port ` +
      'can read and delete your library. Set READIT_PASSWORD, or only do this ' +
      'on a network you trust.',
  );
} else {
  app.log.info('Bound to loopback only. Set HOST=0.0.0.0 to reach Readit from your phone.');
}
