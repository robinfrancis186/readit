import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';

process.env.READIT_DICTIONARY_DB = resolve('server/data/dictionary.db');
const ready = import('../server/src/app.js').then(async ({ app }) => {
  await app.ready();
  return app;
});
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await ready;
  app.server.emit('request', req, res);
}
