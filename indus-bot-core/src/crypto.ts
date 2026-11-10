import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PREFIX = 'enc:v1:';

export function encryptString(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${data.toString('hex')}`;
}

export function decryptString(payload: string, key: Buffer): string {
  if (!payload.startsWith(PREFIX)) return payload;
  const parts = payload.split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[2], 'hex'));
  decipher.setAuthTag(Buffer.from(parts[3], 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(parts[4], 'hex')), decipher.final()]).toString('utf8');
}

export function loadKey(envValue: string | undefined, dir: string): Buffer {
  if (envValue && /^[0-9a-f]{64}$/i.test(envValue.trim())) return Buffer.from(envValue.trim(), 'hex');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'encryption.key');
  if (existsSync(file)) {
    const text = readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(text)) return Buffer.from(text, 'hex');
  }
  const key = randomBytes(32);
  writeFileSync(file, key.toString('hex'), { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* not unix */ }
  return key;
}

export function safeEqual(a: string, b: string): boolean {
  const left = createHmac('sha256', 'indus-eq').update(a).digest();
  const right = createHmac('sha256', 'indus-eq').update(b).digest();
  return timingSafeEqual(left, right);
}

export type SsoUser = { id: number; username: string };

export function signSso(secret: string, user: SsoUser, ttlSec = 60): string {
  const body = Buffer.from(JSON.stringify({ id: user.id, username: user.username, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySso(token: string, secret: string): SsoUser | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { id: number; username: string; exp: number };
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.username || typeof payload.id !== 'number') return null;
    return { id: payload.id, username: payload.username };
  } catch {
    return null;
  }
}
