import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient, type InArgs, type Transaction } from '@libsql/client';
import { DB_PATH, SCHEMA } from './db.js';

// The personal library can live on Turso; bundled dictionaries stay local and
// read-only on Vercel. Both local and cloud library queries use the same SQL.
if (process.env.VERCEL && !process.env.TURSO_DATABASE_URL) throw new Error('TURSO_DATABASE_URL is required on Vercel.');
const client = createClient({
  url: process.env.TURSO_DATABASE_URL || `file:${DB_PATH}`,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const transaction = new AsyncLocalStorage<Transaction>();
let initialized: Promise<void> | undefined;
export function initLibrary(): Promise<void> {
  return initialized ??= client.executeMultiple(SCHEMA).catch((error) => {
    initialized = undefined;
    throw error;
  });
}

export const libraryDb = {
  prepare(sql: string) {
    const execute = async (params: unknown[]) => {
      const args = (params.length === 1 && typeof params[0] === 'object' && params[0] !== null
        ? params[0] : params) as InArgs;
      return (transaction.getStore() ?? client).execute({ sql, args });
    };
    return {
      async get(...args: unknown[]): Promise<any> { return (await execute(args)).rows[0]; },
      async all(...args: unknown[]): Promise<any[]> { return (await execute(args)).rows; },
      async run(...args: unknown[]) { return execute(args); },
    };
  },
  transaction<T>(fn: () => Promise<T>) {
    return async (): Promise<T> => {
      if (transaction.getStore()) return fn();
      const tx = await client.transaction('write');
      try {
        const result = await transaction.run(tx, fn);
        await tx.commit();
        return result;
      } catch (error) {
        await tx.rollback();
        throw error;
      } finally { tx.close(); }
    };
  },
};
