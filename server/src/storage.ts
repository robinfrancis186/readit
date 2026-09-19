import { put, get, del } from '@vercel/blob';
import { createReadStream, existsSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { COVER_DIR, LIBRARY_DIR, MAX_UPLOAD_BYTES } from './config.js';

export const cloudStorage = Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
export async function storeFile(kind: 'library' | 'covers', name: string, data: Buffer): Promise<string> {
  if (cloudStorage) {
    const blob = await put(`${kind}/${name}`, data, { access: 'private', addRandomSuffix: true });
    return blob.pathname;
  }
  await writeFile(join(kind === 'covers' ? COVER_DIR : LIBRARY_DIR, name), data);
  return name;
}
export async function readFileStream(kind: 'library' | 'covers', name: string) {
  if (cloudStorage) {
    const blob = await get(name, { access: 'private' });
    return blob?.statusCode === 200 ? Readable.fromWeb(blob.stream as any) : null;
  }
  const path = join(kind === 'covers' ? COVER_DIR : LIBRARY_DIR, name);
  return existsSync(path) ? createReadStream(path) : null;
}
export async function removeFile(kind: 'library' | 'covers', name: string) {
  if (cloudStorage) return del(name);
  await unlink(join(kind === 'covers' ? COVER_DIR : LIBRARY_DIR, name)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
export async function readUpload(pathname: string): Promise<Buffer> {
  const blob = await get(pathname, { access: 'private' });
  if (!blob || blob.statusCode !== 200) throw Object.assign(new Error('Uploaded file was not found.'), { statusCode: 404 });
  if (blob.blob.size > MAX_UPLOAD_BYTES) throw Object.assign(new Error('File exceeds the upload limit.'), { statusCode: 413 });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of Readable.fromWeb(blob.stream as any)) {
    size += chunk.length;
    if (size > MAX_UPLOAD_BYTES) throw Object.assign(new Error('File exceeds the upload limit.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
